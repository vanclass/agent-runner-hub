//! Format-specific validation and preview-only conversion of selected images.
use std::io::{Cursor, Write};

use image::{codecs::webp::WebPDecoder, ImageDecoder, ImageFormat, ImageReader};

use crate::image_validation::{validate_gif, validate_png, within_pixels};

#[path = "local_svg.rs"]
mod svg;

const MAX_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 128 * 1024 * 1024;
// Charge the full compositing canvas per GIF frame, even for partial updates.
const GIF_CANVAS_PIXEL_BUDGET: u64 = 2 * MAX_PIXELS;

pub fn decode(bytes: Vec<u8>, mime: &str, output_limit: usize) -> Result<Vec<u8>, &'static str> {
    match mime {
        "image/png" => validate_png(&bytes, MAX_DECODED_BYTES, MAX_DECODED_BYTES, |info| {
            within_pixels(info.width, info.height, MAX_PIXELS)
        })?,
        "image/gif" => validate_gif(&bytes, MAX_PIXELS, Some(GIF_CANVAS_PIXEL_BUDGET), |_, _| true)?,
        "image/jpeg" => { read_pixels(raster_decoder(&bytes, ImageFormat::Jpeg)?)?; }
        "image/webp" => validate_webp(&bytes)?,
        "image/bmp" => return raster_to_png(raster_decoder(&bytes, ImageFormat::Bmp)?, output_limit),
        "image/x-icon" => return raster_to_png(raster_decoder(&bytes, ImageFormat::Ico)?, output_limit),
        "image/svg+xml" => return svg::rasterize(&bytes),
        _ => return Err("unsupported"),
    }
    Ok(bytes)
}

fn image_error(error: image::ImageError) -> &'static str {
    if matches!(error, image::ImageError::Limits(_)) { "oversize" } else { "decoding" }
}

fn validate_webp(bytes: &[u8]) -> Result<(), &'static str> {
    let decoder = WebPDecoder::new(Cursor::new(bytes)).map_err(image_error)?;
    if decoder.has_animation() { return Err("unsupported"); }
    if bytes.get(12..16) == Some(b"VP8X") {
        check_extended_webp(&bytes[12..], decoder.dimensions())?;
    }
    read_pixels(decoder).map(drop)
}

fn check_extended_webp(mut chunks: &[u8], dimensions: (u32, u32)) -> Result<(), &'static str> {
    // The lossy codec allocates from the VP8 frame header before comparing it to VP8X.
    // Check this pair before decoding so the pixel budget applies to both dimensions.
    while !chunks.is_empty() {
        let (header, data) = chunks.split_at_checked(8).ok_or("decoding")?;
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
        let padded = length.checked_add(length % 2).ok_or("decoding")?;
        let (chunk, rest) = data.split_at_checked(padded).ok_or("decoding")?;
        match &header[..4] {
            b"ANIM" | b"ANMF" => return Err("decoding"),
            b"VP8 " => {
                let header = chunk[..length].get(6..10).ok_or("decoding")?;
                let width = u16::from_le_bytes([header[0], header[1]]) & 0x3fff;
                let height = u16::from_le_bytes([header[2], header[3]]) & 0x3fff;
                if (u32::from(width), u32::from(height)) != dimensions {
                    return Err("decoding");
                }
            }
            _ => {}
        }
        chunks = rest;
    }
    Ok(())
}

fn raster_decoder(bytes: &[u8], format: ImageFormat) -> Result<impl ImageDecoder + '_, &'static str> {
    if image::guess_format(bytes).ok() != Some(format) { return Err("decoding"); }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODED_BYTES as u64);
    reader.limits(limits);
    reader.into_decoder().map_err(image_error)
}

fn raster_to_png(decoder: impl ImageDecoder, limit: usize) -> Result<Vec<u8>, &'static str> {
    let (width, height) = decoder.dimensions();
    let color = match decoder.color_type() {
        image::ColorType::Rgb8 => png::ColorType::Rgb,
        image::ColorType::Rgba8 => png::ColorType::Rgba,
        _ => return Err("decoding"),
    };
    let pixels = read_pixels(decoder)?;
    encode_png(&pixels, width, height, color, limit)
}

fn read_pixels(decoder: impl ImageDecoder) -> Result<Vec<u8>, &'static str> {
    let (width, height) = decoder.dimensions();
    let size = decoder.total_bytes();
    if !within_pixels(width, height, MAX_PIXELS) || size > MAX_DECODED_BYTES as u64 {
        return Err("oversize");
    }
    let mut pixels = vec![0; size as usize];
    decoder.read_image(&mut pixels).map_err(image_error)?;
    Ok(pixels)
}

fn encode_png(pixels: &[u8], width: u32, height: u32, color: png::ColorType, limit: usize) -> Result<Vec<u8>, &'static str> {
    struct BoundedPng { bytes: Vec<u8>, limit: usize, exceeded: bool }

    impl Write for BoundedPng {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.limit - self.bytes.len() {
                self.exceeded = true;
                return Err(std::io::ErrorKind::FileTooLarge.into());
            }
            self.bytes.write(bytes)
        }

        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    let mut output = BoundedPng { bytes: Vec::new(), limit, exceeded: false };
    let mut encoder = png::Encoder::new(&mut output, width, height);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_color(color);
    let result = encoder.write_header().and_then(|mut writer| {
        writer.write_image_data(pixels)?;
        writer.finish()
    });
    result.map_err(|_| if output.exceeded { "oversize" } else { "decoding" })?;
    Ok(output.bytes)
}
