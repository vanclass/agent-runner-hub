//! Decode checks shared by selected files and verified generated images.
use std::{io::{Cursor, Read}, num::NonZeroU64};

pub fn within_pixels(width: u32, height: u32, max_pixels: u64) -> bool {
    width != 0 && height != 0 && u64::from(width) * u64::from(height) <= max_pixels
}

pub fn validate_png(
    bytes: &[u8],
    decoder_limit: usize,
    output_limit: usize,
    validate_info: impl FnOnce(&png::Info<'_>) -> bool,
) -> Result<(), &'static str> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: decoder_limit });
    let mut reader = decoder.read_info().map_err(|_| "decoding")?;
    let info = reader.info();
    if info.animation_control.is_some() || !validate_info(info) {
        return Err("decoding");
    }
    let size = reader.output_buffer_size().filter(|size| *size <= output_limit).ok_or("oversize")?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| "decoding")?;
    reader.finish().map_err(|_| "decoding")?;
    Ok(())
}

pub fn validate_gif(
    bytes: &[u8],
    max_pixels: u64,
    animation_budget: Option<u64>,
    validate_size: impl FnOnce(u32, u32) -> bool,
) -> Result<(), &'static str> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::Indexed);
    options.set_memory_limit(gif::MemoryLimit::Bytes(NonZeroU64::new(max_pixels).unwrap()));
    options.check_frame_consistency(true);
    options.check_lzw_end_code(true);
    options.allow_unknown_blocks(false);
    let mut reader = options.read_info(Cursor::new(bytes)).map_err(|_| "decoding")?;
    let (width, height) = (u32::from(reader.width()), u32::from(reader.height()));
    if !within_pixels(width, height, max_pixels) || !validate_size(width, height) {
        return Err("decoding");
    }
    let canvas_pixels = u64::from(width) * u64::from(height);
    let mut remaining = animation_budget.unwrap_or(u64::MAX);
    let mut pixels = Vec::new();
    let mut has_frame = false;
    while let Some(frame) = reader.next_frame_info().map_err(|_| "decoding")? {
        remaining = remaining.checked_sub(canvas_pixels).ok_or("oversize")?;
        let (width, height) = (u32::from(frame.width), u32::from(frame.height));
        if !within_pixels(width, height, max_pixels) {
            return Err("decoding");
        }
        let transparent = frame.transparent;
        pixels.resize((u64::from(width) * u64::from(height)) as usize, 0);
        let colors = reader.palette().map_err(|_| "decoding")?.len() / 3;
        reader.read_into_buffer(&mut pixels).map_err(|_| "decoding")?;
        if pixels.iter().any(|index| usize::from(*index) >= colors)
            || transparent.is_some_and(|index| usize::from(index) >= colors)
        {
            return Err("decoding");
        }
        // Drain through the LZW end code and reject excess raster data.
        if reader.fill_buffer(&mut [0]).map_err(|_| "decoding")? {
            return Err("decoding");
        }
        has_frame = true;
    }
    if !has_frame || reader.into_inner().read(&mut [0]).map_err(|_| "decoding")? != 0 {
        return Err("decoding");
    }
    Ok(())
}
