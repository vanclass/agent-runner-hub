//! Independent Run initiation evidence; IssueRun remains the execution authority.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "run.invoke")]
    Invoke { api_version: u32 },
    #[serde(rename = "run.status")]
    Status { api_version: u32, invocation_request_id: u64 },
}
impl Request {
    pub fn operation(&self) -> &'static str {
        match self { Self::Invoke { .. } => "run.invoke", Self::Status { .. } => "run.status" }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Invoke { api_version } => *api_version == 1,
            Self::Status { api_version, invocation_request_id } => *api_version == 1 && (1..=MAX_SAFE).contains(invocation_request_id),
        };
        if valid { Ok(()) } else { Err("INVALID_RUN_REQUEST") }
    }
    pub fn response(&self, packet: &Value, id: u64) -> Result<Response, &'static str> {
        let reply: Response = serde_json::from_value(packet.clone()).map_err(|_| "Malformed Run response")?;
        if packet["status"] == "accepted" {
            let run = reply.run.as_ref().ok_or("Missing Run observation")?;
            let original = match self { Self::Invoke { .. } => id, Self::Status { invocation_request_id, .. } => *invocation_request_id };
            if packet["phase"] != "completed" || run.invocation_request_id != original || !run.valid()
                || matches!(self, Self::Invoke { .. }) && reply.receipt.as_deref() != Some("request_accepted") {
                return Err("Unconfirmed Run receipt or initiation authority");
            }
        } else if !matches!(packet["status"].as_str(), Some("rejected" | "failure"))
            || reply.outcome_unknown.is_none() || reply.run.is_some() {
            return Err("Malformed Run rejection");
        }
        Ok(reply)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability { pub version: u32, pub operations: Vec<String> }
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let cap: Self = serde_json::from_value(value.clone()).ok()?;
        (cap.version == 1 && ["run.invoke", "run.status"].iter().all(|op| cap.operations.iter().any(|s| s == op))
            && value["run_modes"] == serde_json::json!(["issue-run"])
            && value["observation_lifetime"] == "process_session" && value["automatic_retry"] == false
            && value["receipt"] == "request_accepted").then_some(cap)
    }
}
const MAX_SAFE: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Observation {
    pub invocation_request_id: u64, pub request_status: String, pub initiation_status: String,
    pub dispatch_status: String, pub issue_run_id: String, pub authority_digest: String, pub state_revision: u64,
    pub lifecycle_status: String, pub lifecycle_terminal: bool, pub terminal_reason: String,
    pub outcome: String, pub owner_status: String, pub outcome_unknown: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub user_input_required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub code: Option<String>,
}
impl Observation {
    fn valid(&self) -> bool {
        let authority = !self.issue_run_id.is_empty() && self.issue_run_id.len() <= 256
            && !self.issue_run_id.chars().any(char::is_control) && self.authority_digest.len() == 64
            && self.authority_digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && self.state_revision > 0 && self.state_revision <= MAX_SAFE && !self.lifecycle_status.is_empty();
        self.invocation_request_id > 0 && self.invocation_request_id <= MAX_SAFE && self.request_status == "accepted"
            && matches!(self.dispatch_status.as_str(), "dispatching" | "returned" | "unknown")
            && match self.initiation_status.as_str() {
                "started" => authority,
                "pending" | "not_started" | "unknown" => self.issue_run_id.is_empty() && self.authority_digest.is_empty()
                    && self.state_revision == 0 && self.lifecycle_status.is_empty() && !self.lifecycle_terminal
                    && match self.initiation_status.as_str() {
                        "pending" => self.dispatch_status == "dispatching" && !self.outcome_unknown,
                        "not_started" => self.dispatch_status == "returned" && !self.outcome_unknown,
                        _ => self.outcome_unknown,
                    },
                _ => false,
            }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Response {
    #[serde(skip_serializing_if = "Option::is_none")] pub receipt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub run: Option<Observation>,
    #[serde(skip_serializing_if = "Option::is_none")] pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub outcome_unknown: Option<bool>,
}
