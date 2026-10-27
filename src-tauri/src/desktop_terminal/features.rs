//! Implemented native feature contracts share the v1 transport and identity.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::{session_config, work};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "feature", content = "request", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request { SessionConfig(session_config::Request), Work(work::Request) }
impl Request {
    pub fn name(&self) -> &'static str { match self { Self::SessionConfig(_) => "session_config", Self::Work(_) => "work" } }
    pub fn operation(&self) -> &'static str { match self {
        Self::SessionConfig(r) => r.operation(), Self::Work(r) => r.operation() } }
    pub fn validate(&self) -> Result<(), &'static str> { match self {
        Self::SessionConfig(r) => r.validate(), Self::Work(r) => r.validate() } }
    pub fn fields(&self) -> Value { match self {
        Self::SessionConfig(r) => serde_json::to_value(r).unwrap(), Self::Work(r) => serde_json::to_value(r).unwrap() } }
    pub fn wait_limit(&self) -> std::time::Duration { match self {
        Self::SessionConfig(r) => r.wait_limit(), Self::Work(r) => r.wait_limit() } }
    pub fn response(&self, packet: &Value, id: u64) -> Result<Response, &'static str> {
        match self { Self::SessionConfig(r) => r.response(packet).map(Response::SessionConfig),
            Self::Work(r) => r.response(packet, id).map(Response::Work) }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capability { pub version: u32, pub operations: Vec<String>, pub options_page_size: u32,
    #[serde(default)] pub options_revision: bool }
impl Capability {
    fn read(value: &Value) -> Option<Self> {
        let mut cap: Self = serde_json::from_value(value.clone()).ok()?;
        cap.operations.retain(|operation| matches!(operation.as_str(),
            "session_config.inspect" | "session_config.plan" | "session_config.apply"));
        (cap.version == 1 && cap.options_page_size > 0 && cap.options_page_size <= 32
            && cap.operations.iter().any(|op| op == "session_config.inspect")
            && value["interaction_owner"] == "runner_terminal" && value["automatic_retry"] == false)
            .then_some(cap)
    }
    pub fn supports(&self, request: &Request) -> bool {
        self.operations.iter().any(|op| op == request.operation())
            && match request {
                Request::SessionConfig(session_config::Request::Inspect { options_revision: Some(_), .. }) => self.options_revision,
                _ => true,
            }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum Response { SessionConfig(session_config::Response), Work(work::Response) }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultView {
    pub id: u64, pub feature: String, pub operation: String, pub state: String,
    pub admission: String, pub phase: Option<String>, pub code: Option<String>,
    pub reply: Option<Response>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub generation: u64, pub session_config: Option<Capability>, pub work: Option<work::Capability>, pub results: Vec<ResultView>,
}
impl Features {
    pub fn discover(&mut self, packet: &Value) {
        self.session_config = Capability::read(&packet["session_config"]);
        self.work = work::Capability::read(&packet["work"]);
    }
    pub fn supports(&self, request: &Request) -> bool { match request {
        Request::SessionConfig(_) => self.session_config.as_ref().is_some_and(|cap| cap.supports(request)),
        Request::Work(r) => self.work.as_ref().is_some_and(|cap| cap.operations.iter().any(|op| op == r.operation())),
    } }
    pub fn begin(&mut self, id: u64, request: &Request) {
        // Completed reads/plans can retire; apply receipts and uncertain results survive.
        self.results.retain(|r| r.operation == "session_config.apply" || r.operation == "work.submit"
            || !matches!(r.state.as_str(), "accepted" | "rejected" | "failure"));
        self.results.push(ResultView { id, feature: request.name().into(), operation: request.operation().into(),
            state: "sending".into(), admission: "unconfirmed".into(), phase: None, code: None, reply: None });
    }
    pub fn response(&mut self, id: u64, request: &Request, state: &str, finished: bool, packet: &Value) -> Result<(), &'static str> {
        let result = self.results.iter_mut().find(|r| r.id == id).ok_or("Missing feature request")?;
        result.state = state.into();
        result.phase = packet["phase"].as_str().map(str::to_owned);
        if state == "queued" || state == "pending-interaction" || result.phase.as_deref() == Some("completed") {
            result.admission = "queued".into();
        } else if finished { result.admission = "rejected".into(); }
        result.code = super::result_code(packet);
        if finished { result.reply = Some(request.response(packet, id)?); }
        Ok(())
    }
    pub fn disconnect(&mut self, pending: impl Iterator<Item = (u64, bool)>) {
        self.session_config = None;
        self.work = None;
        for (id, untouched) in pending {
            if let Some(result) = self.results.iter_mut().find(|r| r.id == id) {
                let not_sent = untouched && result.admission == "unconfirmed";
                result.state = if not_sent { "not-sent" } else { "outcome-unknown" }.into();
                if not_sent { result.admission = "not-sent".into(); }
            }
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Admission { Submitted { id: u64, generation: u64 }, NotSent { detail: String }, OutcomeUnknown { detail: String } }
