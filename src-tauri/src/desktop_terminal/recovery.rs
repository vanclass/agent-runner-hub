//! Exact recovery contracts consumed through authenticated local control.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "family", deny_unknown_fields)]
pub enum Reference {
    #[serde(rename = "direct-run")]
    Direct { version: u32, session_id: String, generation_id: String, thread_id: String,
        resume_id: String, source_exec_run_id: String },
    #[serde(rename = "task-run")]
    Task { version: u32, repository_namespace: String, task_number: String, task_workload_id: String },
    #[serde(rename = "issue-run")]
    Issue { version: u32, issue_run_id: String, created_by_runner_session_id: String, creation_provenance_digest: String },
}
impl Reference {
    pub fn valid(&self) -> bool {
        let value = serde_json::to_value(self).unwrap();
        value["version"] == 1 && value.as_object().unwrap().iter().all(|(key, v)| {
            if key == "version" || key == "family" { return true; }
            let Some(s) = v.as_str() else { return false; };
            if matches!(key.as_str(), "thread_id" | "resume_id") && s.is_empty() { return true; }
            let base = s.split('.').next().unwrap().to_ascii_uppercase();
            !s.is_empty() && s.len() <= 255 && s.as_bytes()[0].is_ascii_alphanumeric()
                && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)) && !s.ends_with('.')
                && !matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(base.len() == 4 && (base.starts_with("COM") || base.starts_with("LPT"))
                    && matches!(base.as_bytes()[3], b'1'..=b'9'))
        }) && !matches!(self, Self::Direct { thread_id, resume_id, .. } if thread_id.is_empty() && resume_id.is_empty())
    }
    pub fn successor(&self) -> Option<&str> {
        match self { Self::Direct { session_id, .. } => Some(session_id), _ => None }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "recovery.reference")]
    Reference { api_version: u32, observation_id: String },
    #[serde(rename = "recovery.recover")]
    Recover { api_version: u32, reference: Reference },
    #[serde(rename = "recovery.observe")]
    Observe { api_version: u32, reference: Reference },
}
impl Request {
    pub fn operation(&self) -> &'static str { match self { Self::Reference { .. } => "recovery.reference", Self::Recover { .. } => "recovery.recover", Self::Observe { .. } => "recovery.observe" } }
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Reference { api_version, observation_id } => *api_version == 1 && observation_id.split_once(':').is_some_and(|(origin, id)|
                matches!(origin, "api" | "terminal") && !id.starts_with('0') && id.parse::<u64>().is_ok_and(|n| n > 0)),
            Self::Recover { api_version, reference } | Self::Observe { api_version, reference } => *api_version == 1 && reference.valid(),
        };
        if valid { Ok(()) } else { Err("INVALID_RECOVERY_REQUEST") }
    }
    pub fn response(&self, packet: &Value) -> Result<Response, &'static str> {
        let reply: Response = serde_json::from_value(packet.clone()).map_err(|_| "Malformed recovery result")?;
        if reply.reference.as_ref().is_some_and(|r| !r.valid()) { return Err("Invalid recovery reference"); }
        if let Self::Observe { reference, .. } = self {
            reply.validate_lifecycle(reference, packet)?;
            return Ok(reply);
        }
        if let Self::Reference { observation_id, .. } = self {
            if packet["status"] == "accepted" && packet["phase"] == "completed" && reply.reference.is_some()
                && reply.observation_id.as_ref() == Some(observation_id) && reply.recovery_status.is_none() { return Ok(reply); }
        }
        let outcome = reply.recovery_status.as_deref().ok_or("Unverified recovery result")?;
        if !matches!(outcome, "recovered" | "absent" | "blocked" | "identity_conflict" | "interaction_required" | "unverified" | "partial") {
            return Err("Unknown recovery outcome");
        }
        if let Self::Recover { reference, .. } = self {
            if reply.reference.as_ref() != Some(reference) { return Err("Crossed recovery result"); }
        }
        if outcome == "recovered" && (packet["status"] != "accepted" || packet["phase"] != "completed" || reply.outcome_unknown != Some(false)) {
            return Err("Unconfirmed recovery success");
        }
        Ok(reply)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Response {
    pub recovery_status: Option<String>, pub reference: Option<Reference>, pub observation_id: Option<String>,
    pub code: Option<String>, pub owner_status: Option<String>, pub outcome_unknown: Option<bool>,
    pub lifecycle_version: Option<u32>, pub disposition: Option<String>, pub terminal: Option<bool>,
    pub authoritative: Option<bool>, pub ownership: Option<String>, pub evidence: Option<Value>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability { pub version: u32, pub operations: Vec<String>, pub lifecycle_version: Option<u32> }
impl Response {
    fn validate_lifecycle(&self, reference: &Reference, packet: &Value) -> Result<(), &'static str> {
        let disposition = self.disposition.as_deref().ok_or("Missing lifecycle disposition")?;
        let terminal = matches!(disposition, "completed" | "discarded");
        if packet["status"] != "accepted" || packet["phase"] != "completed"
            || self.reference.as_ref() != Some(reference) || self.lifecycle_version != Some(1)
            || !matches!(disposition, "completed" | "discarded" | "suspended" | "incomplete" | "in_use" | "identity_conflict" | "absent" | "unverified")
            || self.terminal != Some(terminal) || self.authoritative.is_none()
            || self.recovery_status.is_some() || self.observation_id.is_some() || self.owner_status.is_some() || self.outcome_unknown.is_some()
            || !self.code.as_deref().is_some_and(|s| s.len() <= 100 && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')) {
            return Err("Invalid lifecycle observation");
        }
        let verified = matches!(disposition, "completed" | "discarded" | "suspended" | "incomplete" | "in_use");
        let ownership = if disposition == "in_use" { "in_use" } else if verified { "available" } else { "unavailable" };
        if self.authoritative != Some(verified) || self.ownership.as_deref() != Some(ownership)
            || if verified { !valid_evidence(self.evidence.as_ref(), reference, disposition) } else { self.evidence.is_some() } {
            return Err("Inconsistent lifecycle evidence");
        }
        Ok(())
    }
}
fn valid_evidence(value: Option<&Value>, reference: &Reference, disposition: &str) -> bool {
    let Some(e) = value.and_then(Value::as_object) else { return false; };
    let (owner, extra, count) = match reference {
        Reference::Task { .. } => ("task_workload", &[][..], 2),
        Reference::Issue { .. } => ("issue_lifecycle", &["ownership_revision"][..], 1),
        Reference::Direct { .. } => ("direct_generation", &["session_revision", "sealed"][..], 3),
    };
    let safe = |s: &str| s.len() <= 100
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    e.len() == 5 + extra.len() && e.keys().all(|k|
        ["owner", "revision", "digests", "state", "phase"].contains(&k.as_str()) || extra.contains(&k.as_str()))
        && e["owner"] == owner && e["revision"].as_u64().is_some()
        && match (reference, disposition) {
            (Reference::Task { .. }, "completed") => e["state"] == "completed",
            (Reference::Issue { .. }, "completed") => e["state"] == "finalized",
            (Reference::Task { .. } | Reference::Issue { .. }, "discarded") => e["state"] == "aborted",
            (Reference::Direct { .. }, "completed") => e["state"] == "completed" && e["phase"] == "exited",
            (Reference::Direct { .. }, "discarded") => e["sealed"] == true,
            _ => true,
        }
        && ["state", "phase"].iter().all(|key| e[*key].as_str().is_some_and(safe))
        && extra.iter().all(|key| if *key == "sealed" { e[*key].is_boolean() } else { e[*key].as_u64().is_some() })
        && e["digests"].as_object().is_some_and(|d| d.len() == count && (0..count).all(|i|
            d.get(&i.to_string()).and_then(Value::as_str).is_some_and(|s| s.len() == 64
                && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))))
}
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let cap: Self = serde_json::from_value(value.clone()).ok()?;
        let mut cap = cap;
        if cap.lifecycle_version != Some(1) || value["lifecycle_dispositions"] != json!([
            "completed", "discarded", "suspended", "incomplete", "in_use", "identity_conflict", "absent", "unverified"]) {
            cap.lifecycle_version = None;
            cap.operations.retain(|op| op != "recovery.observe");
        }
        (cap.version == 1 && ["recovery.reference", "recovery.recover"].iter().all(|op| cap.operations.iter().any(|v| v == op))
            && value["reference_version"] == 1 && value["automatic_retry"] == false && value["instruction_replay"] == false
            && value["families"] == json!(["direct-run", "task-run", "issue-run"])
            && value["outcomes"] == json!(["recovered", "absent", "blocked", "identity_conflict", "interaction_required", "unverified", "partial"])).then_some(cap)
    }
}
