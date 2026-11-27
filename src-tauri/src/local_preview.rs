//! Read-only previews of explicitly selected local files; no Runner registration.
use std::{fs::File, io::Read, path::Path, sync::OnceLock};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

#[path = "local_archive.rs"]
mod archive;
#[path = "local_image.rs"]
mod image;
#[path = "local_pdf.rs"]
mod pdf;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Category { Image, Text, Pdf, Archive }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Format {
    category: Category,
    mime: Option<String>,
    preview_mime: Option<String>,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    filenames: Vec<String>,
}

fn classify(path: &str) -> Option<&'static Format> {
    static FORMATS: OnceLock<Vec<Format>> = OnceLock::new();
    let formats = FORMATS.get_or_init(|| serde_json::from_str(include_str!("preview_formats.json"))
        .expect("checked-in preview format catalog"));
    let name = path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next()?;
    if let Some(format) = formats.iter().find(|format| format.filenames.iter().any(|item| item.eq_ignore_ascii_case(name))) {
        return Some(format);
    }
    let (stem, extension) = name.rsplit_once('.')?;
    if stem.is_empty() { return None; }
    formats.iter().find(|format| format.extensions.iter().any(|item| item.eq_ignore_ascii_case(extension)))
}

// Bound IPC payload and decoder allocation independently; never truncate a successful preview.
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Preview {
    Image { path: String, base64: String, mime: &'static str },
    Text { path: String, text: String },
    Pdf { path: String, base64: String },
    Archive { path: String, entries: Vec<archive::Entry> },
    Unavailable { path: String, reason: &'static str },
}

pub fn read(path: String) -> Preview {
    match content(&path) {
        Ok(value) => value,
        Err(reason) => Preview::Unavailable { path, reason },
    }
}

fn content(path: &str) -> Result<Preview, &'static str> {
    let format = classify(path).ok_or("unsupported")?;
    match format.category {
        Category::Image => read_image(path, format),
        Category::Text => read_text(path),
        Category::Pdf => pdf::read(path),
        Category::Archive => archive::read(path),
    }
}

fn read_bounded(path: &str, limit: usize) -> Result<Vec<u8>, &'static str> {
    if Path::new(path).is_dir() { return Err("unsupported"); }
    let file = File::open(path).map_err(|_| "unreadable")?;
    if !file.metadata().map_err(|_| "unreadable")?.is_file() { return Err("unsupported"); }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|_| "unreadable")?;
    if bytes.len() > limit { return Err("oversize"); }
    Ok(bytes)
}

fn read_text(path: &str) -> Result<Preview, &'static str> {
    let text = String::from_utf8(read_bounded(path, MAX_TEXT_BYTES)?).map_err(|_| "decoding")?;
    if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
        return Err("decoding");
    }
    Ok(Preview::Text { path: path.into(), text })
}

fn read_image(path: &str, format: &'static Format) -> Result<Preview, &'static str> {
    let mime = format.mime.as_deref().ok_or("unsupported")?;
    let bytes = read_bounded(path, MAX_FILE_BYTES)?;
    let bytes = image::decode(bytes, mime, MAX_FILE_BYTES)?;
    Ok(Preview::Image {
        path: path.into(),
        base64: STANDARD.encode(bytes),
        mime: format.preview_mime.as_deref().unwrap_or(mime),
    })
}

#[cfg(test)]
#[path = "local_preview_tests.rs"]
mod tests;
