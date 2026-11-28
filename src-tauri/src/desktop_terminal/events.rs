use super::{Protocol, RequestKind};
use serde::Serialize;
use serde_json::{Value, json};

const TOPICS: &[(&str, &str, &str)] = &[
    ("runner.observation.changed", "runner", "observation"),
    ("work.changed", "runner", "work"),
    ("recovery.changed", "runner", "recovery"),
    ("generated_images.changed", "runner", "generated_images"),
    ("brief.changed", "runner", "brief"),
    ("run.changed", "runner", "run"),
    ("provider.codex.notification", "provider", "codex"),
];

#[derive(Clone, Debug, Serialize)]
pub struct Notification {
    pub topic: String,
    pub payload: Value,
}

fn payload_for(topic: &str, payload: &Value) -> Option<Value> {
    const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let positive = |v: &Value| v.as_u64().is_some_and(|n| (1..=SAFE_INTEGER).contains(&n));
    match topic {
        "runner.observation.changed" | "recovery.changed" | "generated_images.changed" =>
            payload.as_object()?.is_empty().then(|| json!({})),
        "work.changed" => {
            let action = payload["change"].as_str()?;
            let work: super::work::Observation = serde_json::from_value(payload["work"].clone()).ok()?;
            (matches!(action, "created" | "updated") && work.valid_envelope())
                .then(|| json!({"change":action, "work":work}))
        }
        "run.changed" => {
            let run: super::run::Observation = serde_json::from_value(payload["run"].clone()).ok()?;
            (run.revision.is_some() && run.valid()).then(|| json!({"run":run}))
        }
        "brief.changed" => {
            let action = payload["action"].as_str()?;
            let request = payload.get("staging_request_id");
            (matches!(action, "staged" | "consumed" | "cleared") && positive(&payload["revision"])
                && payload["count"].as_u64().is_some_and(|n| n <= SAFE_INTEGER)
                && request.is_none_or(positive)).then(|| payload.clone())
        }
        "provider.codex.notification" => {
            let text = |v: &Value| v.as_str().is_some_and(|s| !s.is_empty());
            (["execution_id", "instance_id", "thread_id", "turn_id"].iter().all(|key| text(&payload[*key]))
                && positive(&payload["launch_generation"]) && positive(&payload["provider_sequence"])
                && text(&payload["notification"]["method"]) && payload["notification"]["params"].is_object())
                .then(|| payload.clone())
        }
        _ => None,
    }
}

#[derive(Default)]
pub(super) struct Delivery {
    discovered: bool,
    topics: Vec<String>,
    pending: Option<u64>,
    active: Option<u64>,
    sequence: u64,
    subscribe: bool,
    observe: bool,
    retried: bool,
}

impl Protocol {
    pub(super) fn discover_events(&mut self, capabilities: &Value) {
        if self.events.discovered { return; }
        self.events.discovered = true;
        let capability = &capabilities["event_delivery"];
        if capability["version"] != 1 { return; }
        self.events.topics = TOPICS.iter().filter(|(topic, kind, owner)|
            capability["event_types"][*topic] == json!({"kind":kind, "owner":owner}))
            .map(|(topic, _, _)| (*topic).into()).collect();
        self.events.subscribe = !self.events.topics.is_empty();
        if self.events.subscribe {
            self.snapshot.state = "connecting".into();
            self.snapshot.observation = None;
            self.snapshot.observation_current = false;
        }
    }

    pub(super) fn follow_up(&mut self, key: &str) -> Result<Option<Vec<u8>>, &'static str> {
        if self.connection.is_none() || self.recovering_direct() || self.pending.len() >= 32 {
            return Ok(None);
        }
        if self.events.subscribe {
            let fields = json!({"operation":"events.subscribe", "api_version":1,
                "event_types":self.events.topics});
            let bytes = self.request_fields(None, None, Some(fields), key)?;
            self.pending.get_mut(&self.next).unwrap().kind = RequestKind::Subscribe;
            self.events.subscribe = false;
            self.events.pending = Some(self.next);
            return Ok(Some(bytes));
        }
        if self.events.observe && self.events.pending.is_none()
            && !self.pending.values().any(|request| request.kind == RequestKind::Observe) {
            return self.request(None, key).map(Some);
        }
        Ok(None)
    }

    pub(super) fn start_observation(&mut self) {
        self.events.observe = false;
    }

    pub(super) fn schedule_observation(&mut self) {
        self.events.observe = true;
        self.snapshot.observation_current = false;
    }

    pub(super) fn complete_observation(&mut self) {
        self.snapshot.observation_current = !self.events.observe && self.snapshot.observation.is_some();
        if self.snapshot.observation_current && self.events.active.is_some() {
            self.events.retried = false;
            self.snapshot.delivery_incomplete = false;
        }
    }

    pub(super) fn subscription_reply(&mut self, id: u64, packet: &Value) {
        self.events.pending = None;
        if packet["status"] == "accepted" && packet["api_version"] == 1
            && packet["subscription_id"].as_u64() == Some(id)
            && packet["event_types"] == json!(self.events.topics) {
            self.events.active = Some(id);
            self.events.sequence = 0;
            self.snapshot.coverage = self.events.topics.clone();
            self.snapshot.subscription = Some(id);
            self.schedule_observation();
        } else if self.snapshot.state == "connecting" {
            self.schedule_observation();
        }
    }

    pub(super) fn notification(&mut self, packet: Value) -> Result<Option<Notification>, &'static str> {
        if !self.identity_matches(&packet) || packet["connection_id"].as_str() != self.connection.as_deref()
            || self.events.active.is_none() || packet["subscription_id"].as_u64() != self.events.active {
            return Ok(None);
        }
        let topic = packet["event_type"].as_str().unwrap_or_default();
        let source = &packet["source"];
        let payload = payload_for(topic, &packet["payload"]);
        let expected = self.events.sequence.checked_add(1);
        if topic == "events.incomplete" || expected.is_none() || expected != packet["sequence"].as_u64()
            || packet.get("request_id").is_some() || packet.get("key").is_some()
            || payload.is_none() || !self.events.topics.iter().any(|name| name == topic)
            || !TOPICS.iter().any(|(name, kind, owner)| *name == topic
                && source == &json!({"kind":kind, "owner":owner})) {
            self.retire_delivery();
            // Try once until a fresh observation establishes a new baseline.
            self.events.subscribe = !self.events.retried;
            self.events.retried = true;
            return Ok(Some(Notification { topic: "events.incomplete".into(), payload: json!({}) }));
        }
        self.events.sequence = expected.ok_or("Runner event sequence exhausted")?;
        if topic == "runner.observation.changed" {
            self.events.observe = true;
            self.snapshot.observation_current = false;
            return Ok(None);
        }
        Ok(payload.map(|payload| Notification { topic: topic.into(), payload }))
    }

    pub(super) fn retire_delivery(&mut self) {
        self.snapshot.delivery_incomplete |= self.events.active.is_some();
        self.events.active = None;
        self.events.observe = false;
        self.snapshot.subscription = None;
        self.snapshot.coverage.clear();
        self.snapshot.observation_current = false;
    }
}
