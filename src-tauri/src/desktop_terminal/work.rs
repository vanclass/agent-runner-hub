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
}
impl Request {
    pub fn operation(&self) -> &'static str {
        match self { Self::Submit { .. } => "work.submit", Self::Status { .. } => "work.status" }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Submit { api_version, instruction } => *api_version == 1
                && !instruction.trim().is_empty() && !instruction.contains('\0')
                && !instruction.trim_start().starts_with('/'),
            Self::Status { api_version, submission_request_id } => *api_version == 1 && *submission_request_id > 0,
        };
        if valid { Ok(()) } else { Err("INVALID_WORK_REQUEST") }
    }
    pub fn wait_limit(&self) -> Duration { Duration::from_secs(60) }
    pub fn response(&self, packet: &Value, id: u64) -> Result<Response, &'static str> {
        let reply: Response = serde_json::from_value(packet.clone()).map_err(|_| "Malformed work completion")?;
        let original = match self { Self::Submit { .. } => id, Self::Status { submission_request_id, .. } => *submission_request_id };
        if let Some(work) = &reply.work {
            if work.submission_request_id != original || !work.valid() { return Err("Work submission correlation mismatch"); }
        } else if packet["status"] == "accepted" { return Err("Missing work observation"); }
        if matches!(self, Self::Submit { .. }) && packet["status"] == "accepted"
            && reply.receipt.as_deref() != Some("dispatch_received") { return Err("Missing work dispatch receipt"); }
        if reply.code.as_ref().is_some_and(|code| !code.is_empty() && !valid_code(code)) {
            return Err("Malformed work code");
        }
        Ok(reply)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability { pub version: u32, pub operations: Vec<String>, pub run_modes: Vec<String> }
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let mut cap: Self = serde_json::from_value(value.clone()).ok()?;
        cap.operations.retain(|op| matches!(op.as_str(), "work.submit" | "work.status"));
        (cap.version == 1 && ["work.submit", "work.status"].iter().all(|op| cap.operations.iter().any(|s| s == op))
            && cap.run_modes.len() == RUN_MODES.len() && RUN_MODES.iter().all(|mode| cap.run_modes.iter().any(|s| s == mode))
            && value["observation_lifetime"] == "process_session" && value["automatic_retry"] == false).then_some(cap)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct WorkIdentity { pub kind: String, pub id: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Observation {
    pub submission_request_id: u64, pub run_mode: String, pub state: String, pub admission: String,
    pub work_id: Option<WorkIdentity>, pub execution_id: String, pub event_id: u64, pub started_event_id: u64,
    pub terminal: bool, pub outcome: String, pub code: String, pub owner: String, pub owner_revision: u64,
}
fn identifier(value: &str) -> bool {
    value.len() <= 256 && !value.chars().any(char::is_control)
}
fn valid_code(value: &str) -> bool {
    value.len() <= 96 && value.bytes().next().is_some_and(|b| b.is_ascii_uppercase())
        && value.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}
impl Observation {
    fn valid(&self) -> bool {
        self.event_id > 0 && self.started_event_id <= self.event_id && RUN_MODES.contains(&self.run_mode.as_str())
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
}