//! Read-only previews of explicitly selected local files; no Runner registration.
use std::{fs::File, io::{Cursor, Read}, path::Path};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

// Bound IPC payload and decoder allocation independently; never truncate a successful preview.
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 128 * 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Preview {
    Image { path: String, base64: String },
    Text { path: String, text: String },
    Unavailable { path: String, reason: &'static str },
}

pub fn read(path: String) -> Preview {
    match content(&path) {
        Ok(value) => value,
        Err(reason) => Preview::Unavailable { path, reason },
    }
}

fn content(path: &str) -> Result<Preview, &'static str> {
    let extension = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let formats: serde_json::Value = serde_json::from_str(include_str!("preview_formats.json"))
        .expect("checked-in preview format catalog");
    let supports = |kind: &str| formats[kind].as_array().is_some_and(|items|
        items.iter().any(|item| item.as_str() == Some(extension.as_str())));
    let image = supports("image");
    let limit = if image { MAX_FILE_BYTES } else if supports("text") { MAX_TEXT_BYTES }
        else { return Err("unsupported"); };
    if Path::new(path).is_dir() { return Err("unsupported"); }
    let file = File::open(path).map_err(|_| "unreadable")?;
    if !file.metadata().map_err(|_| "unreadable")?.is_file() { return Err("unsupported"); }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|_| "unreadable")?;
    if bytes.len() > limit { return Err("oversize"); }
    if !image {
        let text = String::from_utf8(bytes).map_err(|_| "decoding")?;
        if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) { return Err("decoding"); }
        return Ok(Preview::Text { path: path.into(), text });
    }
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_limits(png::Limits { bytes: MAX_DECODED_BYTES });
    let mut reader = decoder.read_info().map_err(|_| "decoding")?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 || u64::from(info.width) * u64::from(info.height) > MAX_PIXELS
        || info.animation_control.is_some() { return Err("decoding"); }
    let size = reader.output_buffer_size().filter(|s| *s <= MAX_DECODED_BYTES).ok_or("oversize")?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| "decoding")?;
    reader.finish().map_err(|_| "decoding")?;
    Ok(Preview::Image { path: path.into(), base64: STANDARD.encode(bytes) })
}

#[cfg(test)]
#[path = "local_preview_tests.rs"]
mod tests;
