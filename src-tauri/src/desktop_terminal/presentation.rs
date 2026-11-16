//! Presentation v1 pull requests; no command/feature completion records.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::mpsc::Sender;

pub type Completion = Sender<Result<Value, String>>;
pub struct Delivery { pub request: Request, pub completion: Option<Completion> }
impl Delivery {
    pub fn settle(&mut self, result: Result<Value, String>) {
        if let Some(completion) = self.completion.take() { let _ = completion.send(result); }
    }
}
impl super::Protocol {
    pub(super) fn expire_presentations(&mut self) {
        for pending in self.pending.values_mut() {
            if pending.started.elapsed() > super::COMPLETION_TIMEOUT {
                if let Some(delivery) = &mut pending.presentation {
                    delivery.settle(Err("Presentation timed out; coverage is unverified".into()));
                }
            }
        }
    }
    pub(super) fn has_unsettled_requests(&self) -> bool {
        self.pending.values().any(|p| p.presentation.as_ref().is_none_or(|d| d.completion.is_some()))
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "presentation.subscribe")]
    Subscribe { api_version: u64, types: Vec<String> },
    #[serde(rename = "presentation.read")]
    Read { api_version: u64, subscription_id: String, after_sequence: u64 },
    #[serde(rename = "presentation.unsubscribe")]
    Unsubscribe { api_version: u64, subscription_id: String },
}
impl Request {
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Subscribe { api_version, types } => *api_version == 1 && *types == ["log", "activity"],
            Self::Read { api_version, subscription_id, .. } |
            Self::Unsubscribe { api_version, subscription_id } => *api_version == 1 && identity(subscription_id),
        };
        if valid { Ok(()) } else { Err("Invalid presentation request") }
    }
    pub fn response(&self, packet: &Value) -> Result<Value, String> {
        if packet["status"] != "accepted" || packet["outcome_unknown"] == true {
            return Err(format!("Presentation request rejected: {}", super::result_code(packet).unwrap_or_default()));
        }
        if let Self::Unsubscribe { .. } = self {
            return if packet["unsubscribed"] == true { Ok(json!({"unsubscribed":true})) }
                else { Err("Invalid presentation release".into()) };
        }
        if packet["api_version"] != 1 || !packet["stream_id"].as_str().is_some_and(identity)
            || !packet["subscription_id"].as_str().is_some_and(identity) {
            return Err("Invalid presentation identity".into());
        }
        if let Self::Read { subscription_id, .. } = self {
            if packet["subscription_id"] != *subscription_id { return Err("Presentation subscription changed".into()); }
        }
        let fields: &[&str] = match self {
            Self::Subscribe { .. } => &["api_version", "stream_id", "subscription_id", "snapshot_sequence", "activities", "closed", "first_sequence"],
            _ => &["api_version", "stream_id", "subscription_id", "events", "next_sequence", "through_sequence", "caught_up", "coverage", "missing_range", "closed"],
        };
        // Never expose the authenticated envelope (or private pipe identity) to the WebView.
        Ok(Value::Object(fields.iter().map(|key| ((*key).into(), packet[*key].clone())).collect()))
    }
}
fn identity(value: &str) -> bool { value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
pub fn supported(cap: &Value) -> bool {
    cap["version"] == 1 && cap["delivery"] == "pull" && cap["read_only"] == true
        && cap["lifetime"] == "process_session"
        && ["presentation.subscribe", "presentation.read", "presentation.unsubscribe"].iter().all(|op|
            cap["operations"].as_array().is_some_and(|ops| ops.contains(&json!(op))))
}
