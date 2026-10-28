//! Work v1 mirrors Runner's process/session-lifetime evidence; never executes work.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const RUN_MODES: [&str; 4] = ["pure-direct-run", "direct-run", "task-run", "issue-run"];
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "work.submit")]
    Submit { api_version: u32, instruction: String },
    #[serde(rename = "work.status")]
    Status { api_version: u32, submission_request_id: u64 },
    #[serde(rename = "work.list")]
    List { api_version: u32, after_event_id: u64, limit: u32 },
    #[serde(rename = "work.observe")]
    Observe { api_version: u32, observation_id: String },
}
impl Request {
    pub fn operation(&self) -> &'static str {
        match self { Self::Submit { .. } => "work.submit", Self::Status { .. } => "work.status",
            Self::List { .. } => "work.list", Self::Observe { .. } => "work.observe" }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Submit { api_version, instruction } => *api_version == 1
                && !instruction.trim().is_empty() && !instruction.contains('\0')
                && !instruction.trim_start().starts_with('/'),
            Self::Status { api_version, submission_request_id } => *api_version == 1 && *submission_request_id > 0,
            Self::List { api_version, after_event_id, limit } => *api_version == 1
                && *after_event_id <= MAX_EVENT && (1..=100).contains(limit),
            Self::Observe { api_version, observation_id } => *api_version == 1 && observation_identity(observation_id),
        };
        if valid { Ok(()) } else { Err("INVALID_WORK_REQUEST") }
    }
    pub fn wait_limit(&self) -> Duration { Duration::from_secs(60) }
    pub fn response(&self, packet: &Value, id: u64) -> Result<Response, &'static str> {
        let reply: Response = serde_json::from_value(packet.clone()).map_err(|_| "Malformed work completion")?;
        if let Some(work) = &reply.work {
            let correlated = match self {
                Self::Submit { .. } => work.submission_request_id == Some(id) && work.origin.as_deref() != Some("terminal"),
                Self::Status { submission_request_id, .. } => work.submission_request_id == Some(*submission_request_id),
                Self::Observe { observation_id, .. } => work.observation_id.as_ref() == Some(observation_id),
                Self::List { .. } => false,
            };
            if !correlated || !work.valid() { return Err("Work observation correlation mismatch"); }
        } else if packet["status"] == "accepted" && !matches!(self, Self::List { .. }) {
            return Err("Missing work observation");
        }
        if packet["status"] == "accepted" {
            if packet["phase"] != "completed" { return Err("Incomplete work response"); }
            if let Self::List { after_event_id, limit, .. } = self {
                reply.validate_page(*after_event_id, *limit)?;
            }
        }
        if matches!(self, Self::Submit { .. }) && packet["status"] == "accepted"
            && reply.receipt.as_deref() != Some("dispatch_received") { return Err("Missing work dispatch receipt"); }
        if reply.code.as_ref().is_some_and(|code| !code.is_empty() && !valid_code(code)) {
            return Err("Malformed work code");
        }
        Ok(reply)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability {
    pub version: u32, pub operations: Vec<String>, pub run_modes: Vec<String>,
    #[serde(default)] pub origins: Vec<String>,
    #[serde(default)] pub max_page_size: Option<u32>,
}
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let mut cap: Self = serde_json::from_value(value.clone()).ok()?;
        let discovery = cap.origins.len() == 2 && ["api", "terminal"].iter().all(|origin|
            cap.origins.iter().any(|s| s == origin)) && cap.max_page_size.is_some_and(|size| (1..=100).contains(&size));
        cap.operations.retain(|op| matches!(op.as_str(), "work.submit" | "work.status")
            || discovery && matches!(op.as_str(), "work.list" | "work.observe"));
        (cap.version == 1 && ["work.submit", "work.status"].iter().all(|op| cap.operations.iter().any(|s| s == op))
            && cap.run_modes.len() == RUN_MODES.len() && RUN_MODES.iter().all(|mode| cap.run_modes.iter().any(|s| s == mode))
            && value["observation_lifetime"] == "process_session" && value["automatic_retry"] == false).then_some(cap)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct WorkIdentity { pub kind: String, pub id: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Observation {
    #[serde(skip_serializing_if = "Option::is_none")] pub observation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub origin: Option<String>,
    #[serde(deserialize_with = "nullable_submission")] pub submission_request_id: Option<u64>,
    pub run_mode: String, pub state: String, pub admission: String,
    pub work_id: Option<WorkIdentity>, pub execution_id: String, pub event_id: u64, pub started_event_id: u64,
    pub terminal: bool, pub outcome: String, pub code: String, pub owner: String, pub owner_revision: u64,
}
fn identifier(value: &str) -> bool {
    value.len() <= 256 && !value.chars().any(char::is_control)
}
const MAX_EVENT: u64 = 9_007_199_254_740_991;
fn nullable_submission<'de, D: serde::Deserializer<'de>>(value: D) -> Result<Option<u64>, D::Error> {
    Option::<u64>::deserialize(value)
}
fn observation_identity(value: &str) -> bool {
    value.split_once(':').is_some_and(|(origin, id)| matches!(origin, "api" | "terminal")
        && id.parse::<u64>().is_ok_and(|number| number > 0 && number <= MAX_EVENT && number.to_string() == id))
}
fn valid_code(value: &str) -> bool {
    value.len() <= 96 && value.bytes().next().is_some_and(|b| b.is_ascii_uppercase())
        && value.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}
impl Observation {
    fn valid(&self) -> bool {
        let identity = match (&self.observation_id, self.origin.as_deref(), self.submission_request_id) {
            (None, None, Some(id)) => id > 0 && id <= MAX_EVENT,
            (Some(observation), Some("api"), Some(id)) => id > 0 && id <= MAX_EVENT && observation == &format!("api:{id}"),
            (Some(observation), Some("terminal"), None) => observation.starts_with("terminal:") && observation_identity(observation),
            _ => false,
        };
        identity && self.event_id > 0 && self.event_id <= MAX_EVENT && self.owner_revision <= MAX_EVENT
            && self.started_event_id <= self.event_id && RUN_MODES.contains(&self.run_mode.as_str())
            && ["dispatching", "instruction_admitted", "execution_started", "active", "suspended", "incomplete",
                "succeeded", "failed", "interrupted", "unknown", "rejected"].contains(&self.state.as_str())
            && ["pending", "admitted", "rejected", "unknown"].contains(&self.admission.as_str())
            && ["pending", "succeeded", "failed", "interrupted", "incomplete", "unknown", "rejected"].contains(&self.outcome.as_str())
            && (self.code.is_empty() || valid_code(&self.code)) && identifier(&self.execution_id) && identifier(&self.owner)
            && self.work_id.as_ref().is_none_or(|work| ["direct_turn", "task", "issue"].contains(&work.kind.as_str())
                && !work.id.is_empty() && identifier(&work.id))
            && (self.started_event_id == 0 || self.admission == "admitted")
            && (!self.terminal || self.outcome != "pending")
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Response {
    #[serde(skip_serializing_if = "Option::is_none")] pub receipt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub work: Option<Observation>,
    #[serde(skip_serializing_if = "Option::is_none")] pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub outcome_unknown: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub works: Option<Vec<Observation>>,
    #[serde(skip_serializing_if = "Option::is_none")] pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub next_after_event_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub latest_event_id: Option<u64>,
}
impl Response {
    fn validate_page(&self, after: u64, limit: u32) -> Result<(), &'static str> {
        let (Some(works), Some(more), Some(next), Some(latest)) =
            (&self.works, self.has_more, self.next_after_event_id, self.latest_event_id)
            else { return Err("Missing work page"); };
        let mut previous = after;
        let valid = works.len() <= limit as usize && works.iter().all(|work| {
            let ordered = work.event_id > previous && work.event_id <= latest;
            previous = work.event_id;
            ordered && work.observation_id.is_some() && work.valid()
        });
        if !valid || latest > MAX_EVENT || latest < after || next < previous
            || (more && (works.is_empty() || next != previous || next >= latest)) || (!more && next != latest) {
            return Err("Malformed work page cursor");
        }
        Ok(())
    }
}
