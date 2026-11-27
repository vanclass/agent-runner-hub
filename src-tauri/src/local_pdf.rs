use super::{read_bounded, Preview, STANDARD};
use base64::Engine;

// Bound the native read and base64 IPC allocation separately from image and text previews.
pub(super) const MAX_PDF_BYTES: usize = 24 * 1024 * 1024;

pub(super) fn read(path: &str) -> Result<Preview, &'static str> {
    let bytes = read_bounded(path, MAX_PDF_BYTES)?;
    let header = &bytes[..bytes.len().min(1024)];
    if !header.windows(5).any(|signature| signature == b"%PDF-") {
        return Err("decoding");
    }
    Ok(Preview::Pdf { path: path.into(), base64: STANDARD.encode(bytes) })
}
