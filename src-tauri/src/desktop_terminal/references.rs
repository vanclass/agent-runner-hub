//! Allowlisted reference extension metadata; PendingReferences remains Runner-owned.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum ReferenceRequest {
    #[serde(rename = "references.register")]
    Register { path: String },
    #[serde(rename = "references.list")]
    List { offset: u64 },
    #[serde(rename = "references.remove")]
    Remove { reference_id: String },
}
#[derive(Serialize)]
#[serde(tag = "state")]
pub enum ReferenceAdmission {
    #[serde(rename = "admitted")]
    Admitted { id: u64 },
    #[serde(rename = "failure")]
    Failure { detail: String },
    #[serde(rename = "outcome-unknown")]
    Unknown { detail: String },
}
impl ReferenceRequest {
    pub fn operation(&self) -> &'static str {
        match self {
            Self::Register { .. } => "references.register",
            Self::List { .. } => "references.list",
            Self::Remove { .. } => "references.remove",
        }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Self::Register { path } = self {
            if path.is_empty() || path.contains('\0') || !std::path::Path::new(path).is_absolute() {
                return Err("Choose an absolute native file or folder path");
            }
        }
        if let Self::Remove { reference_id } = self {
            if reference_id.len() != 32 || !reference_id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                return Err("Choose the exact committed reference ID");
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability {
    pub version: u64, pub operations: Vec<String>, pub batch: bool,
    pub inventory_page_size: u64, pub image_details: Vec<String>, pub interaction_owner: String,
}
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let item: Self = serde_json::from_value(value.clone()).ok()?;
        (item.version == 1 && !item.batch && item.inventory_page_size > 0
            && item.operations == ["references.register", "references.list"]
            && item.interaction_owner == "runner_terminal"
            && item.image_details.iter().all(|s| matches!(s.as_str(), "auto" | "low" | "high" | "original")))
            .then_some(item)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RemovalCapability {
    pub version: u64, pub operations: Vec<String>, pub batch: bool,
    pub reference_id_format: String, pub interaction_owner: String,
}
impl RemovalCapability {
    pub fn read(value: &Value) -> Option<Self> {
        let item: Self = serde_json::from_value(value.clone()).ok()?;
        (item.version == 1 && !item.batch && item.operations == ["references.remove"]
            && item.reference_id_format == "32_lowercase_hex"
            && item.interaction_owner == "runner_terminal").then_some(item)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Reference {
    pub reference_id: String, pub display_index: u64, pub display_name: String,
    pub kind: String, pub image_detail: Option<String>, pub media_kind: Option<String>,
}
impl Reference {
    pub fn read(value: &Value) -> Result<Self, &'static str> {
        let item: Self = serde_json::from_value(value.clone()).map_err(|_| "Malformed reference metadata")?;
        if item.reference_id.len() != 32 || !item.reference_id.bytes().all(|b| b.is_ascii_hexdigit())
            || item.display_index == 0 || item.display_name.is_empty() {
            return Err("Invalid stable reference identity or metadata");
        }
        Ok(item)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Inventory {
    pub total_count: u64, pub offset: u64, pub next_offset: Option<u64>, pub references: Vec<Reference>,
}
impl Inventory {
    pub fn read(value: &Value, offset: u64, page_size: u64) -> Result<Self, &'static str> {
        let item: Self = serde_json::from_value(value.clone()).map_err(|_| "Malformed reference inventory")?;
        if item.offset != offset || item.references.len() as u64 > page_size
            || (item.references.len() as u64) > item.total_count.saturating_sub(offset)
            || item.next_offset != ((offset + item.references.len() as u64) < item.total_count)
                .then_some(offset + item.references.len() as u64) {
            return Err("Invalid reference inventory pagination");
        }
        let mut ids = std::collections::BTreeSet::new();
        for (index, reference) in item.references.iter().enumerate() {
            Reference::read(&serde_json::to_value(reference).unwrap())?;
            if reference.display_index != offset + index as u64 + 1 || !ids.insert(&reference.reference_id) {
                return Err("Invalid ordered reference inventory");
            }
        }
        Ok(item)
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceResult {
    pub id: u64, pub operation: String, pub offset: u64, pub state: String, pub code: Option<String>,
    pub registration_status: Option<String>, pub reference: Option<Reference>, pub inventory: Option<Inventory>,
    pub reference_id: Option<String>, pub removal_status: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct References {
    pub capability: Option<Capability>, pub removal_capability: Option<RemovalCapability>, pub results: Vec<ReferenceResult>,
}
impl References {
    pub fn begin(&mut self, id: u64, request: &ReferenceRequest) {
        self.results.push(ReferenceResult { id, operation: request.operation().into(),
            offset: match request { ReferenceRequest::List { offset } => *offset, _ => 0 },
            state: "sending".into(), code: None, registration_status: None, reference: None, inventory: None,
            reference_id: match request { ReferenceRequest::Remove { reference_id } => Some(reference_id.clone()), _ => None },
            removal_status: None });
    }
    pub fn response(&mut self, id: u64, state: &str, finished: bool, packet: &Value) -> Result<(), &'static str> {
        let Some(result) = self.results.iter_mut().find(|r| r.id == id) else { return Ok(()); };
        if !finished { result.state = state.into(); return Ok(()); }
        let status = packet["registration_status"].as_str();
        let removal = packet["removal_status"].as_str();
        let unknown = state == "outcome-unknown" || status == Some("unknown") || removal == Some("unknown")
            || packet["outcome_unknown"].as_bool() == Some(true);
        let registered = result.operation == "references.register" && state == "accepted" && status == Some("registered") && !unknown;
        let removing = result.operation == "references.remove";
        if removing && !packet["reference_id"].is_null() && packet["reference_id"].as_str() != result.reference_id.as_deref() {
            return Err("Removal receipt reference ID mismatch");
        }
        let removed = removing && state == "accepted" && removal == Some("removed") && !unknown
            && packet["reference_id"].as_str() == result.reference_id.as_deref();
        // Parse the entire receipt before publishing any committed result.
        let reference = if registered { Some(Reference::read(&packet["reference"])?) } else { None };
        let inventory = if !unknown && !packet["inventory"].is_null() {
            Some(Inventory::read(&packet["inventory"], result.offset,
                self.capability.as_ref().ok_or("Reference capability unavailable")?.inventory_page_size)?)
        } else { None };
        if state == "accepted" && !unknown && (result.operation == "references.register" && !registered
            || removing && !removed || result.operation == "references.list" && inventory.is_none()) {
            return Err("Completed reference receipt is missing authoritative results");
        }
        result.state = if unknown || removing && state == "failure" && removal != Some("not_removed") { "outcome-unknown" }
            else if registered { "registered" } else if removed { "removed" } else { state }.into();
        result.removal_status = removal.filter(|s| matches!(*s, "removed" | "not_removed" | "unknown")).map(str::to_owned);
        result.registration_status = status.filter(|s| matches!(*s, "registered" | "not_registered" | "unknown")).map(str::to_owned);
        result.reference = reference;
        result.inventory = inventory;
        result.code = super::result_code(packet);
        Ok(())
    }
    pub fn disconnect(&mut self) {
        for result in &mut self.results {
            if matches!(result.state.as_str(), "sending" | "queued" | "pending-interaction") {
                result.state = "outcome-unknown".into();
            }
        }
    }
}
