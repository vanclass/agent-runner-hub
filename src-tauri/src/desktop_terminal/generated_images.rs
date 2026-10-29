//! Connection-scoped image metadata and ordered, verified PNG retrieval. No disk writes.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Cursor, sync::Mutex};

const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_IMAGES: u64 = 128;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct Failure { pub state: &'static str, pub detail: &'static str }
impl Failure {
    pub fn failed(detail: &'static str) -> Self { Self { state: "failed", detail } }
    pub fn unavailable() -> Self { Self { state: "unavailable", detail: "Image unavailable from the owning Runner. Refresh to discover current images." } }
    fn collection(packet: &Value) -> Self {
        let detail = match packet["code"].as_str() {
            Some("GENERATED_IMAGE_RESOLVER_UNAVAILABLE") => "GENERATED_IMAGE_RESOLVER_UNAVAILABLE: Opaque file IDs require an authenticated App Server resolver. Request native inline PNG output.",
            Some("GENERATED_IMAGE_CONTRACT_INVALID") => "GENERATED_IMAGE_CONTRACT_INVALID: An output failed the image contract. Regenerate as native inline PNG.",
            Some("GENERATED_IMAGE_CAPACITY_EXCEEDED") => "GENERATED_IMAGE_CAPACITY_EXCEEDED: Collection safety bounds were exhausted. Use a new owning Runner session.",
            Some("GENERATED_IMAGE_SOURCE_UNVERIFIED") => "GENERATED_IMAGE_SOURCE_UNVERIFIED: Verify the installed App Server runtime before regenerating.",
            Some("GENERATED_IMAGE_UNAVAILABLE") => "GENERATED_IMAGE_UNAVAILABLE: A source expired or changed. Regenerate in the owning Runner.",
            _ => "Runner rejected image collection. Refresh or regenerate in the owning Runner.",
        };
        Self { state: "incomplete", detail }
    }
}
type Result<T> = std::result::Result<T, Failure>;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Capability {
    version: u64, operations: Vec<String>, mime_types: Vec<String>,
    pub max_image_bytes: u64, pub max_chunk_bytes: u64, pub page_size: u64,
    lifetime: String, read_only: bool,
}
impl Capability {
    pub fn read(value: &Value) -> Option<Self> {
        let item: Self = serde_json::from_value(value.clone()).ok()?;
        (item.version == 1 && item.operations == ["generated_images.list", "generated_images.read"]
            && item.mime_types == ["image/png"] && item.read_only
            && item.lifetime == "owning_control_connection"
            && (1..=MAX_BYTES).contains(&item.max_image_bytes)
            && (1..=32768).contains(&item.max_chunk_bytes)
            && (1..=32).contains(&item.page_size)).then_some(item)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Metadata {
    pub image_id: String, pub source_sequence: u64, pub output_index: u64,
    pub source: String, pub mime_type: String, pub byte_length: u64,
    pub sha256: String, pub width: u32, pub height: u32,
}
fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Metadata {
    fn read(value: &Value, cap: &Capability) -> Result<Self> {
        let item: Self = serde_json::from_value(value.clone()).map_err(|_| Failure::failed("Malformed image metadata"))?;
        if !hex(&item.image_id, 32) || !hex(&item.sha256, 64) || item.source_sequence == 0
            || item.output_index != 0 || item.source != "codex.imageGeneration" || item.mime_type != "image/png"
            || !(1..=cap.max_image_bytes).contains(&item.byte_length)
            || item.width == 0 || item.height == 0 || u64::from(item.width) * u64::from(item.height) > MAX_PIXELS {
            return Err(Failure::failed("Unsupported or invalid image metadata"));
        }
        Ok(item)
    }
}
#[derive(Clone, Debug)]
pub enum Request {
    List { offset: u64 },
    Read { image: Metadata, offset: u64, length: u64 },
}
impl Request {
    pub fn fields(&self) -> Value {
        match self {
            Self::List { offset } => json!({"operation":"generated_images.list", "offset":offset}),
            Self::Read { image, offset, length } => json!({"operation":"generated_images.read",
                "image_id":image.image_id, "offset":offset, "length":length}),
        }
    }
}
pub enum Reply {
    Page { images: Vec<Metadata>, total: u64, next: Option<u64>, incomplete: Option<Failure> },
    Chunk { bytes: Vec<u8>, next: Option<u64> },
}
fn nullable_offset(value: &Value) -> Result<Option<u64>> {
    if value.is_null() { Ok(None) } else { value.as_u64().map(Some).ok_or_else(|| Failure::failed("Malformed image continuation")) }
}
pub fn response(request: &Request, cap: &Capability, packet: &Value, state: &str) -> Result<Reply> {
    let partial = state == "rejected" && matches!(request, Request::List { .. })
        && packet["code"].as_str().is_some_and(|code| matches!(code,
            "GENERATED_IMAGE_RESOLVER_UNAVAILABLE" | "GENERATED_IMAGE_CONTRACT_INVALID"
            | "GENERATED_IMAGE_CAPACITY_EXCEEDED" | "GENERATED_IMAGE_SOURCE_UNVERIFIED" | "GENERATED_IMAGE_UNAVAILABLE"));
    if state != "accepted" && !partial {
        return Err(if packet["code"] == "GENERATED_IMAGE_UNAVAILABLE" { Failure::unavailable() }
            else { Failure::failed("Runner rejected image retrieval") });
    }
    if packet["phase"] != "completed" || packet.get("next_offset").is_none() {
        return Err(Failure::failed("Incomplete image result"));
    }
    let next = nullable_offset(&packet["next_offset"])?;
    match request {
        Request::List { offset } => {
            let total = packet["total_count"].as_u64().filter(|n| *n <= MAX_IMAGES)
                .ok_or_else(|| Failure::failed("Invalid image inventory size"))?;
            let values = packet["images"].as_array().ok_or_else(|| Failure::failed("Missing image inventory"))?;
            let count = values.len() as u64;
            if packet["offset"].as_u64() != Some(*offset) || *offset > total
                || count != cap.page_size.min(total - offset)
                || next != ((*offset + count < total).then_some(*offset + count)) {
                return Err(Failure::failed("Invalid image pagination"));
            }
            let mut incomplete = partial.then(|| Failure::collection(packet));
            let images = values.iter().filter_map(|value| match Metadata::read(value, cap) {
                Ok(image) => Some(image),
                Err(error) => { if incomplete.is_none() { incomplete = Some(error); } None }
            }).collect();
            Ok(Reply::Page { images, total, next, incomplete })
        }
        Request::Read { image, offset, length } => {
            if Metadata::read(packet, cap)? != *image || packet["offset"].as_u64() != Some(*offset) {
                return Err(Failure::failed("Image identity or offset changed during retrieval"));
            }
            let expected = (*length).min(image.byte_length.saturating_sub(*offset));
            let encoded = packet["data_base64"].as_str().filter(|s| s.len() <= (cap.max_chunk_bytes as usize).div_ceil(3) * 4)
                .ok_or_else(|| Failure::failed("Missing or oversized image chunk"))?;
            let bytes = STANDARD.decode(encoded).map_err(|_| Failure::failed("Malformed image chunk encoding"))?;
            let end = *offset + bytes.len() as u64;
            if expected == 0 || *length == 0 || *length > cap.max_chunk_bytes || bytes.len() as u64 != expected
                || next != (end < image.byte_length).then_some(end) {
                return Err(Failure::failed("Image chunk boundary or completion mismatch"));
            }
            Ok(Reply::Chunk { bytes, next })
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verified { pub image: Metadata, pub png: Vec<u8> }
#[derive(Serialize)]
pub struct Inventory { pub images: Vec<Metadata>, pub incomplete: Option<Failure> }
#[derive(Default)]
pub struct Images { catalog: Mutex<Vec<Metadata>>, operation: Mutex<()> }
impl Images {
    pub fn clear(&self) { self.catalog.lock().unwrap().clear(); }
    pub fn list(&self, mut send: impl FnMut(Request) -> Result<Reply>, alive: impl Fn() -> bool) -> Result<Inventory> {
        let _operation = self.operation.try_lock().map_err(|_| Failure::failed("Image retrieval is already loading"))?;
        let result = (|| {
            let mut images = Vec::new();
            let mut ids = HashSet::new();
            let mut offset = 0;
            let mut total_count = None;
            let mut incomplete = None;
            loop {
                if !alive() { return Err(Failure::unavailable()); }
                let Reply::Page { images: page, total, next, incomplete: warning } = send(Request::List { offset })? else {
                    return Err(Failure::failed("Unexpected image discovery result"));
                };
                if total_count.is_some_and(|count| count != total) { return Err(Failure::failed("Image inventory changed; refresh again")); }
                total_count = Some(total);
                if incomplete.is_none() { incomplete = warning; }
                for image in page {
                    if !ids.insert(image.image_id.clone()) { return Err(Failure::failed("Duplicate image identity in inventory")); }
                    images.push(image);
                }
                match next { Some(next) if next > offset && next < MAX_IMAGES => offset = next,
                    Some(_) => return Err(Failure::failed("Invalid image continuation")), None => break }
            }
            if !alive() { return Err(Failure::unavailable()); }
            Ok(Inventory { images, incomplete })
        })();
        *self.catalog.lock().unwrap() = result.as_ref().map(|result| result.images.clone()).unwrap_or_default();
        result
    }
    pub fn read(&self, id: &str, mut send: impl FnMut(Request) -> Result<Reply>, alive: impl Fn() -> bool) -> Result<Verified> {
        let _operation = self.operation.try_lock().map_err(|_| Failure::failed("Image retrieval is already loading"))?;
        let image = self.catalog.lock().unwrap().iter().find(|image| image.image_id == id).cloned().ok_or_else(Failure::unavailable)?;
        let mut bytes = Vec::with_capacity(image.byte_length as usize);
        let mut offset = 0;
        loop {
            if !alive() { return Err(Failure::unavailable()); }
            let Reply::Chunk { bytes: chunk, next } = send(Request::Read { image: image.clone(), offset, length: image.byte_length - offset })? else {
                return Err(Failure::failed("Unexpected image read result"));
            };
            bytes.extend(chunk);
            if bytes.len() as u64 > image.byte_length { return Err(Failure::failed("Image exceeded its declared size")); }
            match next { Some(next) if next == bytes.len() as u64 && next > offset => offset = next,
                Some(_) => return Err(Failure::failed("Nonconsecutive image read")), None => break }
        }
        verify(&image, &bytes)?;
        if !alive() { return Err(Failure::unavailable()); }
        Ok(Verified { image, png: bytes })
    }
}
fn verify(image: &Metadata, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != image.byte_length || format!("{:x}", Sha256::digest(bytes)) != image.sha256 {
        return Err(Failure::failed("Image length or SHA-256 verification failed"));
    }
    let invalid = || Failure::failed("Image is not a complete supported PNG");
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") { return Err(invalid()); }
    let mut end = 8;
    loop {
        let header = bytes.get(end..end + 8).ok_or_else(invalid)?;
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        end = end.checked_add(length + 12).filter(|end| *end <= bytes.len()).ok_or_else(invalid)?;
        if &header[4..] == b"IEND" {
            if length != 0 || end != bytes.len() { return Err(invalid()); }
            break;
        }
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: (MAX_PIXELS * 4 + 65536) as usize });
    let mut reader = decoder.read_info().map_err(|_| invalid())?;
    let info = reader.info();
    if info.width != image.width || info.height != image.height || info.interlaced
        || info.bit_depth != png::BitDepth::Eight || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
        || info.animation_control.is_some() { return Err(invalid()); }
    let size = reader.output_buffer_size().filter(|size| *size <= (MAX_PIXELS * 4) as usize).ok_or_else(invalid)?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| invalid())?;
    reader.finish().map_err(|_| invalid())?;
    Ok(())
}

#[cfg(test)]
#[path = "generated_image_tests.rs"]
mod tests;