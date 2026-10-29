//! Native-only Runner v1 protocol. Public snapshots omit transport identity and secrets.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::{Duration, Instant}};

// Local-control v1 frame ceiling and Hub-owned transport deadlines.
const FRAME_BYTES: usize = 65536;
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(windows)]
const DELIVERY_GRACE: Duration = Duration::from_secs(5);

#[path = "references.rs"]
pub mod references;
use references::{ReferenceRequest, References};
#[path = "session_config.rs"]
pub mod session_config;
#[path = "features.rs"]
pub mod features;
#[path = "work.rs"]
pub mod work;
#[path = "brief.rs"]
pub mod brief;
#[path = "run.rs"]
pub mod run;
#[path = "interaction.rs"]
pub mod interaction;
#[cfg(windows)]
#[path = "generated_images.rs"]
pub mod generated_images;
#[cfg(windows)]
type ImageCompletion = std::sync::mpsc::Sender<Result<generated_images::Reply, generated_images::Failure>>;

#[cfg(windows)]
#[path = "control_windows.rs"]
mod windows;
#[cfg(windows)]
pub use windows::{Client, Launch};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommandView {
    pub id: String,
    pub text: String,
    pub aliases: Vec<String>,
    pub parent_id: Option<String>,
    pub visible: bool,
    pub enabled: bool,
    pub disabled_reason: String,
    pub description: String,
    pub children: Vec<CommandView>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Target { pub binding_state: String, pub owner: String, pub project: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Selection {
    pub account: String, pub model: String, pub reasoning_effort: String,
    pub service_tier: String, pub source: String, pub next_model: String,
    pub next_reasoning_effort: String, pub next_service_tier: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Execution {
    pub lifecycle_state: String, pub owned_execution_alive: bool, pub workflow_kind: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Attention {
    pub foreground_interaction_active: bool, pub restart_confirmation_required: bool,
    pub termination_confirmation_active: bool, pub account_setup_required: bool,
    pub awaiting_user_command_reason: String, pub suspension_status: String, pub suspension_reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Observation {
    pub run_mode: String, pub target: Target, pub selection: Selection,
    pub execution: Execution, pub attention: Attention, pub commands: Vec<CommandView>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub id: u64, pub command: String, pub state: String, pub code: Option<String>,
    pub owner_status: Option<String>, pub changed: Option<Value>, pub settings_change_count: Option<Value>,
    pub phase: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub state: String, pub observation: Option<Observation>,
    pub observation_serial: u64, pub observation_age_ms: Option<u64>,
    pub results: Vec<CommandResult>, pub detail: Option<String>,
    pub references: References,
    pub clipboard_staging: bool,
    pub generated_images_supported: bool,
    pub features: features::Features,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self { state: "connecting".into(), observation: None, observation_serial: 0,
            observation_age_ms: None, results: Vec::new(), detail: None, references: References::default(),
            clipboard_staging: false, generated_images_supported: false, features: features::Features::default() }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum RequestKind { Observe, Command, Reference, Image, Feature }
struct Pending {
    kind: RequestKind, feature: Option<features::Request>, wire_start: u64,
    command: Option<String>, reference: Option<ReferenceRequest>, started: Instant, awaiting_interaction: bool,
    #[cfg(windows)] image: Option<(generated_images::Request, ImageCompletion)>,
}
struct Protocol {
    queued_bytes: u64, written_bytes: u64,
    pid: u32, session: String, connection: Option<String>, next: u64,
    pending: BTreeMap<u64, Pending>, snapshot: Snapshot,
    observed_at: Option<Instant>,
    #[cfg(windows)] image_capability: Option<generated_images::Capability>,
}
impl Protocol {
    fn new(pid: u32, session: String) -> Self {
        static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let mut snapshot = Snapshot::default();
        snapshot.features.generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Self { pid, session, connection: None, next: 0, pending: BTreeMap::new(),
            snapshot, observed_at: None, queued_bytes: 0, written_bytes: 0,
            #[cfg(windows)] image_capability: None }
    }
    fn identity_matches(&self, packet: &Value) -> bool {
        packet["version"].as_u64() == Some(1)
            && packet["process_id"].as_u64() == Some(self.pid as u64)
            && packet["session_id"].as_str() == Some(self.session.as_str())
    }
    fn hello(&mut self, packet: &Value) -> Result<(), &'static str> {
        let connection = packet["connection_id"].as_str().ok_or("Invalid control hello")?;
        if !self.identity_matches(packet) || packet["event"] != "hello"
            || connection.len() != 32 || !connection.bytes().all(|b| b.is_ascii_hexdigit())
            || packet["interaction_owner"] != "runner_terminal"
            || packet["operations"] != json!(["observe", "command"]) {
            return Err("Runner control identity did not match the created process");
        }
        self.connection = Some(connection.into());
        Ok(())
    }
    fn request(&mut self, command: Option<String>, key: &str) -> Result<Vec<u8>, &'static str> {
        self.request_inner(command, None, key)
    }
    fn reference_request(&mut self, request: ReferenceRequest, key: &str) -> Result<Vec<u8>, &'static str> {
        request.validate()?;
        if self.snapshot.state != "ready" || self.snapshot.references.capability.is_none() {
            return Err("This Runner does not offer authenticated reference operations");
        }
        if matches!(request, ReferenceRequest::Remove { .. }) && self.snapshot.references.removal_capability.is_none() {
            return Err("This Runner requires manual /files removal");
        }
        self.request_inner(None, Some(request), key)
    }
    fn request_inner(&mut self, command: Option<String>, reference: Option<ReferenceRequest>, key: &str) -> Result<Vec<u8>, &'static str> {
        self.request_fields(command, reference, None, key)
    }
    fn request_fields(&mut self, command: Option<String>, reference: Option<ReferenceRequest>, fields: Option<Value>, key: &str) -> Result<Vec<u8>, &'static str> {
        if self.connection.is_none() || self.pending.len() >= 32 { return Err("Control is not ready"); }
        let next = self.next.checked_add(1).ok_or("Control request sequence exhausted")?;
        let mut packet = json!({"version":1, "process_id":self.pid, "session_id":self.session,
            "connection_id":self.connection, "request_id":next, "key":key,
            "operation":if command.is_some() { "command" } else { "observe" }});
        if let Some(request) = &reference {
            packet.as_object_mut().unwrap().extend(serde_json::to_value(request).unwrap().as_object().unwrap().clone());
        }
        if let Some(text) = &command { packet["command"] = json!(text); }
        if let Some(fields) = fields { packet.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone()); }
        let mut bytes = serde_json::to_vec(&packet).map_err(|_| "Control encoding failed")?;
        if bytes.len() > FRAME_BYTES { return Err("Runner control request exceeded v1 limit"); }
        self.next = next;
        if let Some(text) = &command {
            self.snapshot.results.retain(|r| !matches!(r.state.as_str(), "accepted" | "rejected" | "failure"));
            self.snapshot.results.push(CommandResult { id: self.next, command: text.clone(), state: "sending".into(), code: None, phase: None,
                owner_status: None, changed: None, settings_change_count: None });
        }
        if let Some(request) = &reference { self.snapshot.references.begin(self.next, request); }
        let kind = if command.is_some() { RequestKind::Command } else if reference.is_some() {
            RequestKind::Reference } else { RequestKind::Observe };
        self.pending.insert(self.next, Pending { kind, feature: None, wire_start: self.queued_bytes,
            command, reference, started: Instant::now(), awaiting_interaction: false,
            #[cfg(windows)] image: None });
        bytes.push(b'\n');
        self.queued_bytes += bytes.len() as u64;
        Ok(bytes)
    }
    #[cfg(windows)]
    fn image_request(&mut self, mut request: generated_images::Request, completion: ImageCompletion, key: &str) -> Result<Vec<u8>, &'static str> {
        let cap = self.image_capability.as_ref().filter(|_| self.snapshot.state == "ready")
            .ok_or("Generated images are unsupported or disconnected")?;
        if let generated_images::Request::Read { length, .. } = &mut request { *length = (*length).min(cap.max_chunk_bytes); }
        let bytes = self.request_fields(None, None, Some(request.fields()), key)?;
        self.pending.get_mut(&self.next).unwrap().kind = RequestKind::Image;
        self.pending.get_mut(&self.next).unwrap().image = Some((request, completion));
        Ok(bytes)
    }
    fn feature_request(&mut self, request: features::Request, key: &str) -> Result<Vec<u8>, &'static str> {
        request.validate()?;
        if self.snapshot.state != "ready" || !self.snapshot.features.supports(&request) {
            return Err("Unsupported or unavailable native feature");
        }
        let bytes = self.request_fields(None, None, Some(request.fields()), key)?;
        let pending = self.pending.get_mut(&self.next).unwrap();
        pending.kind = RequestKind::Feature;
        pending.feature = Some(request.clone());
        self.snapshot.features.begin(self.next, &request);
        Ok(bytes)
    }
    fn response(&mut self, packet: Value) -> Result<(), &'static str> {
        if !self.identity_matches(&packet) || packet["connection_id"].as_str() != self.connection.as_deref() {
            return Err("Runner control response identity mismatch");
        }
        let id = packet["request_id"].as_u64().ok_or("Malformed control response")?;
        let pending = self.pending.get(&id).ok_or("Unexpected control response")?;
        let status = packet["status"].as_str().ok_or("Malformed control result")?;
        let phase = packet["phase"].as_str();
        let finished = phase == Some("completed") || (phase.is_none() && matches!(status, "failure" | "rejected"));
        let state = match (phase, status) {
            (Some("queued"), "accepted") => "queued",
            (Some("awaiting_interaction"), "pending-interaction") => "pending-interaction",
            (Some("completed"), "accepted" | "rejected" | "failure") => {
                if packet["outcome_unknown"].as_bool() == Some(true) { "outcome-unknown" } else { status }
            }
            (None, "rejected" | "failure") => status,
            _ => return Err("Malformed control result phase"),
        };
        if pending.kind == RequestKind::Observe && finished {
            if state != "accepted" { return Err("Runner observation was rejected"); }
            let observation: Observation = serde_json::from_value(packet["observation"].clone())
                .map_err(|_| "Malformed canonical observation")?;
            // A completed authenticated observe round-trip establishes readiness, not hello alone.
            self.snapshot.observation = Some(observation);
            self.snapshot.observation_serial += 1;
            self.observed_at = Some(Instant::now());
            self.snapshot.state = "ready".into();
            self.snapshot.references.capability = references::Capability::read(&packet["capabilities"]["references"]);
            self.snapshot.references.removal_capability = references::RemovalCapability::read(&packet["capabilities"]["reference_removal"]);
            self.snapshot.features.discover(&packet["capabilities"]);
            #[cfg(windows)] {
                self.image_capability = generated_images::Capability::read(&packet["capabilities"]["generated_images"]);
                self.snapshot.generated_images_supported = self.image_capability.is_some();
            }
        }
        #[cfg(windows)]
        if finished {
            if let Some((request, completion)) = &pending.image {
                let result = self.image_capability.as_ref().ok_or_else(generated_images::Failure::unavailable)
                    .and_then(|cap| generated_images::response(request, cap, &packet, state));
                let _ = completion.send(result);
            }
        }
        if finished && (pending.command.is_some() || pending.reference.is_some()) && !packet["observation"].is_null() {
            self.snapshot.observation = Some(serde_json::from_value(packet["observation"].clone())
                .map_err(|_| "Malformed canonical observation")?);
        }
        if let Some(request) = &pending.feature {
            self.snapshot.features.response(id, request, state, finished, &packet)?;
        }
        self.snapshot.references.response(id, state, finished, &packet)?;
        if let Some(result) = self.snapshot.results.iter_mut().find(|r| r.id == id) {
            result.state = state.into();
            result.phase = phase.map(str::to_owned);
            if finished {
                result.owner_status = packet["owner_status"].as_str().filter(|status|
                    !status.is_empty() && status.len() <= 100 && status.bytes().all(|b|
                        b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')).map(str::to_owned);
                let acknowledgement = |field: &str| packet.get(field).filter(|value|
                    value.is_boolean() || value.as_i64().is_some()).cloned();
                result.changed = acknowledgement("changed");
                result.settings_change_count = acknowledgement("settings_change_count");
            }
            result.code = result_code(&packet);
        }
        if finished {
            let was_front = self.pending.keys().next().copied() == Some(id);
            self.pending.remove(&id);
            if was_front {
                if let Some(mut next) = self.pending.first_entry() { next.get_mut().started = Instant::now(); }
            }
        }
        else if state == "pending-interaction" { self.pending.get_mut(&id).unwrap().awaiting_interaction = true; }
        Ok(())
    }
    fn public_snapshot(&self) -> Snapshot {
        let mut snapshot = self.snapshot.clone();
        snapshot.observation_age_ms = self.observed_at.map(|time| time.elapsed().as_millis() as u64);
        snapshot
    }
    fn expired(&self) -> bool {
        // Runner owns the FIFO and emits no processing-start event. A queued
        // follower cannot time out while an earlier owner is legitimately busy.
        self.pending.first_key_value().is_some_and(|(_, pending)| !pending.awaiting_interaction
            && pending.started.elapsed() > pending.feature.as_ref().map_or(COMPLETION_TIMEOUT, |r| r.wait_limit()))
    }
    fn disconnect(&mut self, detail: &str) {
        let unverified = self.snapshot.observation.is_none();
        self.snapshot.state = "disconnected".into();
        self.snapshot.detail = Some(if unverified {
            format!("{detail}. The installed Runner launch entry must retain the inherited control pipes in the created process before Hub can connect.")
        } else { detail.into() });
        for result in &mut self.snapshot.results {
            if self.pending.contains_key(&result.id) { result.state = "outcome-unknown".into(); }
        }
        self.snapshot.references.disconnect();
        self.snapshot.features.disconnect(self.pending.iter().filter(|(_, p)| p.kind == RequestKind::Feature)
            .map(|(id, p)| (*id, self.written_bytes <= p.wire_start)));
        self.snapshot.generated_images_supported = false;
        #[cfg(windows)] {
            self.image_capability = None;
            for pending in self.pending.values() {
                if let Some((_, completion)) = &pending.image { let _ = completion.send(Err(generated_images::Failure::unavailable())); }
            }
        }
        self.pending.clear();
    }
}

fn result_code(packet: &Value) -> Option<String> {
    ["code", "failure_code", "error_code"].iter().find_map(|key| packet[*key].as_str())
        .filter(|code| code.len() <= 100 && code.bytes().all(|b|
            b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')).map(str::to_owned)
}

#[cfg(test)]
#[path = "control_tests.rs"]
mod tests;
