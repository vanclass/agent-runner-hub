//! Typed foreground input only; domain effects remain with the initiating owner.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capability { pub version: u32, pub operations: Vec<String>,
    pub dispatch_boundary: String, pub automatic_replay: bool, pub lifetime: String }
impl Capability {
    pub fn read(v: &Value) -> Option<Self> {
        let c: Self = serde_json::from_value(v.clone()).ok()?;
        (c.version == 1 && c.dispatch_boundary == "foreground_input" && !c.automatic_replay
            && c.lifetime == "current_owner" && c.operations == ["interaction.observe", "interaction.respond"])
            .then_some(c)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action { Confirm { choice_id: String }, Select { choice_id: String }, Text { text: String }, Back, Cancel }
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "operation")]
pub enum Request {
    #[serde(rename = "interaction.observe")]
    Observe { api_version: u32 },
    #[serde(rename = "interaction.respond")]
    Respond { api_version: u32, interaction_id: String, #[serde(flatten)] action: Action },
}
impl<'de> Deserialize<'de> for Request {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let mut fields = serde_json::Map::<String, Value>::deserialize(deserializer)?;
        let operation = fields.remove("operation").ok_or_else(|| D::Error::custom("Missing operation"))?;
        let version = fields.remove("api_version").and_then(|v| v.as_u64()).filter(|v| *v == 1)
            .ok_or_else(|| D::Error::custom("Invalid API version"))? as u32;
        match operation.as_str() {
            Some("interaction.observe") if fields.is_empty() => Ok(Self::Observe { api_version: version }),
            Some("interaction.respond") => {
                let interaction_id = fields.remove("interaction_id").and_then(|v| v.as_str().map(str::to_owned))
                    .ok_or_else(|| D::Error::custom("Missing interaction identity"))?;
                let expected = match fields.get("action").and_then(Value::as_str) {
                    Some("back" | "cancel") => 1, Some("select" | "confirm" | "text") => 2,
                    _ => return Err(D::Error::custom("Invalid interaction action")),
                };
                if fields.len() != expected { return Err(D::Error::custom("Unexpected action fields")); }
                let action = serde_json::from_value(Value::Object(fields)).map_err(D::Error::custom)?;
                Ok(Self::Respond { api_version: version, interaction_id, action })
            },
            _ => Err(D::Error::custom("Invalid interaction request fields")),
        }
    }
}
impl Request {
    pub fn operation(&self) -> &'static str { match self {
        Self::Observe { .. } => "interaction.observe", Self::Respond { .. } => "interaction.respond" } }
    pub fn validate(&self) -> Result<(), &'static str> {
        let (Self::Observe { api_version } | Self::Respond { api_version, .. }) = self;
        if *api_version != 1 { return Err("Invalid interaction API version"); }
        if let Self::Respond { interaction_id, action, .. } = self {
            if interaction_id.is_empty() { return Err("Exact interaction required"); }
            match action {
                Action::Confirm { choice_id } | Action::Select { choice_id } if choice_id.is_empty() =>
                    return Err("Explicit choice required"),
                Action::Text { text } if text.contains(['\r', '\n', '\0']) => return Err("Single-line text required"),
                _ => (),
            }
        }
        Ok(())
    }
    pub fn permitted(&self, v: &Value) -> bool {
        let Self::Respond { interaction_id, action, .. } = self else { return true; };
        if !valid_view(v) || v["state"] != "active" || v["interaction_id"] != *interaction_id { return false; }
        let action_name = match action { Action::Confirm { .. } => "confirm", Action::Select { .. } => "select",
            Action::Text { .. } => "text", Action::Back => "back", Action::Cancel => "cancel" };
        if !v["actions"].as_array().unwrap().iter().any(|a| a == action_name) { return false; }
        match action {
            Action::Confirm { choice_id } | Action::Select { choice_id } => v["choices"].as_array().unwrap()
                .iter().any(|c| c["choice_id"] == *choice_id && c["enabled"] == true),
            _ => true,
        }
    }
    pub fn response(&self, p: &Value) -> Result<Response, &'static str> {
        let status = p["status"].as_str().ok_or("Invalid interaction receipt")?;
        let completed = p["phase"] == "completed";
        if status == "accepted" && !completed { return Err("Incomplete interaction receipt"); }
        if let Some(v) = p.get("interaction") { if !valid_view(v) { return Err("Invalid interaction projection"); } }
        match self {
            Self::Observe { .. } if status == "accepted" => {
                if !valid_view(&p["interaction"]) { return Err("Missing interaction projection"); }
            },
            Self::Respond { .. } if completed => {
                let valid = match status {
                    "accepted" => p["input_status"] == "accepted" && p["outcome_unknown"] == false
                        && p["effect_status"] == "awaiting_command_owner"
                        && matches!(p["interaction_status"].as_str(), Some("active" | "completed" | "cancelled")),
                    "rejected" => p["input_status"] == "not_accepted" && p["outcome_unknown"] == false,
                    "failure" => p["input_status"] == "unknown" && p["effect_status"] == "unknown" && p["outcome_unknown"] == true,
                    _ => false,
                };
                if !valid { return Err("Invalid interaction input receipt"); }
            },
            _ => (),
        }
        Ok(Response { api_version: 1, interaction: p.get("interaction").cloned(),
            input_status: p["input_status"].as_str().map(str::to_owned),
            interaction_status: p["interaction_status"].as_str().map(str::to_owned),
            effect_status: p["effect_status"].as_str().map(str::to_owned),
            outcome_unknown: p["outcome_unknown"].as_bool() })
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Response { pub api_version: u32, pub interaction: Option<Value>, pub input_status: Option<String>,
    pub interaction_status: Option<String>, pub effect_status: Option<String>, pub outcome_unknown: Option<bool> }
pub fn valid_view(v: &Value) -> bool {
    match v["state"].as_str() {
        Some("none" | "unsupported") => v.get("prompt").is_none() && v.get("interaction_id").is_none()
            && v.get("code").is_none_or(Value::is_string),
        Some("active") => {
            let Some(id) = v["interaction_id"].as_str() else { return false; };
            let Some(choices) = v["choices"].as_array() else { return false; };
            let Some(actions) = v["actions"].as_array() else { return false; };
            let kind = v["kind"].as_str().unwrap_or("");
            let primary = match kind { "confirmation" => "confirm", "selection" => "select", "text" => "text", _ => return false };
            let mut ids = std::collections::HashSet::new();
            !id.is_empty() && v["prompt"].is_string() && v["context"].is_string()
                && !actions.is_empty() && actions.iter().all(|a| a == primary || a == "back" || a == "cancel")
                && actions.iter().collect::<std::collections::HashSet<_>>().len() == actions.len()
                && choices.iter().all(|c| c["choice_id"].as_str().is_some_and(|s| !s.is_empty() && ids.insert(s))
                    && c["label"].is_string() && c["description"].is_string() && c["enabled"].is_boolean() && c["disabled_reason"].is_string())
                && (if kind == "text" { choices.is_empty() && v["text_input"]["required"] == true && v["text_input"]["multiline"] == false }
                    else { v["text_input"].is_null() })
                && (kind != "confirmation" || v["consequences"].as_array().is_some_and(|items| items.iter().all(|c|
                    c["text"].is_string() && c["role"].is_string() && c["details"].as_array().is_some_and(|d| d.iter().all(Value::is_string)))))
        },
        _ => false,
    }
}
