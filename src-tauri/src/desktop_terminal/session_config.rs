//! Session configuration v1, mirrored from the installed Runner contract.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Account { pub agent_id: String, pub profile_name: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Model { pub id: String, pub reasoning_effort: String }
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Desired {
    #[serde(skip_serializing_if = "Option::is_none")] pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub account: Option<Account>,
    #[serde(skip_serializing_if = "Option::is_none")] pub model: Option<Model>,
    #[serde(skip_serializing_if = "Option::is_none")] pub service_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub run_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub root: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "session_config.inspect")]
    Inspect { api_version: u32, #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")] account: Option<Account>,
        #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")] offset: Option<u32>,
        #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")] options_revision: Option<String>,
        #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")] execution_context: Option<String> },
    #[serde(rename = "session_config.plan")]
    Plan { api_version: u32, desired: Desired },
    #[serde(rename = "session_config.apply")]
    Apply { api_version: u32, desired: Desired, revision: String, plan_id: String },
}
fn text(value: &str) -> bool { !value.is_empty() && value == value.trim() && !value.contains('\0') }
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
fn account(value: &Account) -> bool { text(&value.agent_id) && text(&value.profile_name) }
pub fn digest(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
impl Desired {
    fn valid(&self) -> bool {
        self.target.as_deref().is_none_or(text) && self.account.as_ref().is_none_or(account)
            && self.model.as_ref().is_none_or(|m| text(&m.id) && text(&m.reasoning_effort))
            && self.service_tier.as_deref().is_none_or(text) && self.run_mode.as_deref().is_none_or(text)
            && self.root.as_ref().is_none_or(|root| !root.is_empty() && !root.contains('\0'))
    }
}
impl Request {
    pub fn operation(&self) -> &'static str { match self {
        Self::Inspect { .. } => "session_config.inspect", Self::Plan { .. } => "session_config.plan",
        Self::Apply { .. } => "session_config.apply",
    } }
    pub fn validate(&self) -> Result<(), &'static str> {
        let valid = match self {
            Self::Inspect { api_version, account: selected, offset, options_revision, execution_context } => *api_version == 1
                && selected.as_ref().is_none_or(account) && options_revision.as_deref().is_none_or(digest)
                && execution_context.as_ref().is_none_or(|context| context == "test"
                    && selected.is_none() && offset.is_none() && options_revision.is_none()),
            Self::Plan { api_version, desired } => *api_version == 1 && desired.valid(),
            Self::Apply { api_version, desired, revision, plan_id } => *api_version == 1
                && desired.valid() && digest(revision) && digest(plan_id),
        };
        if valid { Ok(()) } else { Err("INVALID_SESSION_CONFIG_REQUEST") }
    }
    pub fn wait_limit(&self) -> std::time::Duration {
        // model/list owns up to 32 RPC pages at 10 seconds each; plan adds
        // policy checks and apply repeats validation around canonical commits.
        std::time::Duration::from_secs(match self {
            Self::Inspect { .. } => 420, Self::Plan { .. } => 600, Self::Apply { .. } => 1800,
        })
    }
    pub fn response(&self, packet: &Value) -> Result<Response, &'static str> {
        let parse = || match self {
            Self::Inspect { execution_context: Some(_), .. } if packet["status"] == "accepted" => {
                let selection: TestSelection = serde_json::from_value(packet.clone())?;
                if !selection.valid() { return Err(serde::de::Error::custom("Invalid test account evidence")); }
                Ok(Response::TestSelection(selection))
            },
            Self::Inspect { .. } if packet.get("options").is_some() =>
                serde_json::from_value(packet.clone()).map(Response::Inspect),
            Self::Plan { .. } if packet.get("plan_status").is_some() =>
                serde_json::from_value(packet.clone()).map(Response::Plan),
            Self::Apply { .. } if packet.get("apply_status").is_some() =>
                serde_json::from_value(packet.clone()).map(Response::Apply),
            _ => serde_json::from_value(packet.clone()).map(Response::Error),
        };
        parse().map_err(|_| "Malformed session configuration completion")
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Settings { pub target: String, pub account: Account, pub model: Model,
    pub service_tier: String, pub run_mode: String, pub root: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TargetOption { pub id: String, pub owner: String, pub project: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ModelOption { pub id: String, pub reasoning_efforts: Vec<String>, pub service_tiers: Vec<String> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Options { pub targets: Vec<TargetOption>, pub accounts: Vec<Account>,
    pub models: Vec<ModelOption>, pub run_modes: Vec<String> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Page { pub offset: u32, pub totals: BTreeMap<String, u32>, pub next_offset: Option<u32> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Inspection { pub api_version: u32, pub revision: String, pub options_revision: Option<String>,
    pub current: Settings, pub effective: super::Selection, pub runner_kind: String, pub setup_required: bool,
    pub availability: BTreeMap<String, bool>, pub constraints: Vec<String>, pub root_requirements: BTreeMap<String, String>,
    pub model_catalog_status: String, pub model_options_account: Account, pub options: Options, pub options_page: Page }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Change { pub from: Value, pub to: Value }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Plan { pub api_version: u32, pub revision: String, pub desired: Desired,
    pub changes: BTreeMap<String, Change>, pub steps: Vec<String>, pub atomic: bool, pub errors: Vec<String>,
    pub required_confirmations: Vec<String>, pub impact: BTreeMap<String, String>, pub plan_status: String,
    pub plan_id: Option<String> }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome { Success, Rejected, Cancelled, Failed, Unknown, NotAttempted }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Receipt { pub setting: String, pub outcome: Outcome, pub owner_status: Option<String>,
    pub committed: Option<Desired>, pub code: Option<String>, pub codes: Option<Vec<String>> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Apply { pub api_version: u32, pub apply_status: String, pub atomic: bool, pub results: Vec<Receipt>,
    pub outcome_unknown: bool, pub inspection_unavailable: Option<bool>, pub current: Option<Settings>,
    pub revision: Option<String>, pub code: Option<String>, pub plan: Option<Plan> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Failure { pub api_version: Option<u32>, pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub actual_result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub recommended_next_action: Option<String> }
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum Response { Inspect(Inspection), TestSelection(TestSelection), Plan(Plan), Apply(Apply), Error(Failure) }

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TestSelection { pub api_version: u32, pub execution_context: String,
    pub account: Account, pub codex_home: String, pub runner_root: String, pub authentication: String }
impl TestSelection {
    fn valid(&self) -> bool {
        self.api_version == 1 && self.execution_context == "test" && account(&self.account)
            && self.authentication == "available" && canonical_path(&self.codex_home) && canonical_path(&self.runner_root)
    }
}
fn canonical_path(value: &str) -> bool {
    text(value) && !value.contains('\\') && std::path::Path::new(value).is_absolute()
        && value.split('/').all(|part| part != "." && part != "..")
}
pub fn verify_test_installation(packet: &Value, opened_root: &str) -> Result<(), &'static str> {
    let selection: TestSelection = serde_json::from_value(packet.clone()).map_err(|_| "Malformed test selection")?;
    if !selection.valid() { return Err("Unverified test account evidence"); }
    let canonical = |value: &str| std::path::Path::new(value).canonicalize().map_err(|_| "Test account path unavailable");
    let root = canonical(&selection.runner_root)?;
    let home = canonical(&selection.codex_home)?;
    let spelling = |path: &std::path::Path| {
        let value = path.to_string_lossy().replace('\\', "/");
        let value = value.strip_prefix("//?/UNC/").map(|v| format!("//{v}"))
            .unwrap_or_else(|| value.strip_prefix("//?/").unwrap_or(&value).to_owned());
        if cfg!(windows) { value.to_lowercase() } else { value }
    };
    if root != canonical(opened_root)? || !root.is_dir() || !home.is_dir()
        || spelling(&home) != spelling(std::path::Path::new(&selection.codex_home))
        || spelling(&root) != spelling(std::path::Path::new(&selection.runner_root)) {
        return Err("Test account installation mismatch");
    }
    Ok(())
}
