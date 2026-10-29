//! Independent session-local Brief staging; Run invocation is a separate operation.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "brief.stage")]
    Stage { api_version: u32, body: String },
}
impl Request {
    pub fn validate(&self) -> Result<(), &'static str> {
        let Self::Stage { api_version, body } = self;
        if *api_version == 1 && !body.trim().is_empty() { Ok(()) } else { Err("INVALID_BRIEF_REQUEST") }
    }
    pub fn response(&self, packet: &Value) -> Result<Response, &'static str> {
        let reply: Response = serde_json::from_value(packet.clone()).map_err(|_| "Malformed Brief receipt")?;
        let valid = match packet["status"].as_str() {
            Some("accepted") => packet["phase"] == "completed" && reply.staging_status == "staged"
                && reply.owner.as_deref() == Some("brief_staging") && reply.count.is_some_and(|n| n > 0)
                && !reply.outcome_unknown,
            Some("rejected") => reply.staging_status == "not_staged" && !reply.outcome_unknown,
            Some("failure") => reply.staging_status == "unknown" && reply.outcome_unknown,
            _ => false,
        };
        if valid { Ok(reply) } else { Err("Unconfirmed Brief receipt") }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability { pub version: u32, pub operations: Vec<String> }
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let cap: Self = serde_json::from_value(value.clone()).ok()?;
        (cap.version == 1 && cap.operations.iter().any(|op| op == "brief.stage")
            && value["run_modes"] == serde_json::json!(["issue-run"])
            && value["lifetime"] == "process_session" && value["automatic_retry"] == false).then_some(cap)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Response {
    pub staging_status: String, pub outcome_unknown: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub count: Option<u64>,
}
