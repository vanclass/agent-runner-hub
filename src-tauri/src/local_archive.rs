use super::Preview;
use serde::Serialize;
use std::{
    fs::File,
    io::{Cursor, Read, Seek, SeekFrom},
    path::Path,
};
use zip::{read::{ArchiveOffset, Config}, unstable::read::ZipIterable};

const MAX_ENTRIES: u64 = 2_048;
const MAX_DIRECTORY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DEPTH: usize = 32;
const MAX_COMPONENTS: usize = 8_192;
const END_BYTES: usize = 22;
const CENTRAL_HEADER_BYTES: usize = 46;
const END_MAGIC: &[u8; 4] = b"PK\x05\x06";
const CENTRAL_MAGIC: &[u8; 4] = b"PK\x01\x02";

#[derive(Debug, Serialize)]
pub struct Entry {
    name: String,
    directory: bool,
    // A JSON number could round an original ZIP64 byte count in JavaScript.
    size: String,
}

pub(super) fn read(path: &str) -> Result<Preview, &'static str> {
    if Path::new(path).is_dir() {
        return Err("unsupported");
    }
    let mut file = File::open(path).map_err(|_| "unreadable")?;
    let metadata = file.metadata().map_err(|_| "unreadable")?;
    if !metadata.is_file() {
        return Err("unsupported");
    }

    let (offset, length, count) = directory(&mut file, metadata.len())?;
    let mut bytes = vec![0; length as usize];
    read_at(&mut file, offset, &mut bytes)?;
    check_headers(&bytes, count as usize)?;

    // The library sees only the bounded directory. Rebase its footer to this
    // in-memory span and keep local-header validation disabled.
    let mut end = [0; END_BYTES];
    end[..4].copy_from_slice(END_MAGIC);
    end[8..10].copy_from_slice(&(count as u16).to_le_bytes());
    end[10..12].copy_from_slice(&(count as u16).to_le_bytes());
    end[12..16].copy_from_slice(&(length as u32).to_le_bytes());
    bytes.extend_from_slice(&end);
    let config = Config { archive_offset: ArchiveOffset::Known(0) };
    let mut archive = ZipIterable::try_new(Cursor::new(bytes), config).map_err(|_| "decoding")?;

    let mut entries = Vec::with_capacity(count as usize);
    let mut components = 0;
    for entry in archive.files().map_err(|_| "decoding")? {
        let entry = entry.map_err(|_| "decoding")?;
        let name = entry.name().map_err(|_| "decoding")?;
        if name.is_empty() {
            return Err("decoding");
        }
        let directory = entry.is_dir();
        let display_path = if directory { name.strip_suffix(['/', '\\']).unwrap_or(&name) } else { &name };
        let depth = display_path.split('/').count();
        components += depth;
        if depth > MAX_DEPTH || components > MAX_COMPONENTS {
            return Err("oversize");
        }
        entries.push(Entry { name: name.into_owned(), directory, size: entry.size().to_string() });
    }
    if entries.len() != count as usize {
        return Err("decoding");
    }
    Ok(Preview::Archive { path: path.into(), entries })
}

fn read_at(file: &mut File, offset: u64, bytes: &mut [u8]) -> Result<(), &'static str> {
    file.seek(SeekFrom::Start(offset)).map_err(|_| "unreadable")?;
    file.read_exact(bytes).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof { "decoding" } else { "unreadable" }
    })
}

fn directory(file: &mut File, file_length: u64) -> Result<(u64, u64, u64), &'static str> {
    let (end_offset, end) = find_end(file, file_length)?;
    let disk = u16_at(&end, 4);
    let directory_disk = u16_at(&end, 6);
    let disk_count = u16_at(&end, 8);
    let count = u16_at(&end, 10);
    let length = u32_at(&end, 12);
    let offset = u32_at(&end, 16);
    if disk != 0 || directory_disk != 0 || disk_count != count {
        return Err("unsupported");
    }
    let (offset, length, count, directory_end) = if count == u16::MAX || length == u32::MAX
        || offset == u32::MAX || u64::from(offset) + u64::from(length) != end_offset
    {
        let (zip64_offset, zip64_length, zip64_count, footer_offset) = zip64_directory(file, end_offset)?;
        if (offset != u32::MAX && u64::from(offset) != zip64_offset)
            || (length != u32::MAX && u64::from(length) != zip64_length)
            || (count != u16::MAX && u64::from(count) != zip64_count)
        {
            return Err("decoding");
        }
        (zip64_offset, zip64_length, zip64_count, footer_offset)
    } else {
        (offset.into(), length.into(), count.into(), end_offset)
    };
    if length > MAX_DIRECTORY_BYTES || count > MAX_ENTRIES {
        return Err("oversize");
    }
    if offset.checked_add(length) != Some(directory_end) || count * CENTRAL_HEADER_BYTES as u64 > length {
        return Err("decoding");
    }
    Ok((offset, length, count))
}

fn find_end(file: &mut File, length: u64) -> Result<(u64, [u8; END_BYTES]), &'static str> {
    let end_offset = length.checked_sub(END_BYTES as u64).ok_or("decoding")?;
    let mut end = [0; END_BYTES];
    read_at(file, end_offset, &mut end)?;
    if end.starts_with(END_MAGIC) && u16_at(&end, 20) == 0 {
        return Ok((end_offset, end));
    }

    // A ZIP comment can place the end record up to 65,535 bytes from this probe.
    let tail_length = length.min(u16::MAX as u64 + END_BYTES as u64) as usize;
    let tail_offset = length - tail_length as u64;
    let mut tail = vec![0; tail_length];
    read_at(file, tail_offset, &mut tail)?;
    for index in (0..=tail_length - END_BYTES).rev() {
        let candidate = &tail[index..index + END_BYTES];
        if candidate.starts_with(END_MAGIC) && usize::from(u16_at(candidate, 20)) == tail_length - index - END_BYTES {
            return Ok((tail_offset + index as u64, candidate.try_into().unwrap()));
        }
    }
    Err("decoding")
}

fn zip64_directory(file: &mut File, end_offset: u64) -> Result<(u64, u64, u64, u64), &'static str> {
    let locator_offset = end_offset.checked_sub(20).ok_or("decoding")?;
    let mut locator = [0; 20];
    read_at(file, locator_offset, &mut locator)?;
    if !locator.starts_with(b"PK\x06\x07") {
        return Err("decoding");
    }
    if u32_at(&locator, 4) != 0 || u32_at(&locator, 16) != 1 {
        return Err("unsupported");
    }
    let record_offset = u64_at(&locator, 8);
    if record_offset.checked_add(56).is_none_or(|end| end > locator_offset) {
        return Err("decoding");
    }
    let mut record = [0; 56];
    read_at(file, record_offset, &mut record)?;
    let record_size = u64_at(&record, 4);
    if !record.starts_with(b"PK\x06\x06") || record_size < 44
        || locator_offset - record_offset - 12 != record_size
    {
        return Err("decoding");
    }
    let count = u64_at(&record, 32);
    if u32_at(&record, 16) != 0 || u32_at(&record, 20) != 0 || u64_at(&record, 24) != count {
        return Err("unsupported");
    }
    Ok((u64_at(&record, 48), u64_at(&record, 40), count, record_offset))
}

fn check_headers(mut bytes: &[u8], count: usize) -> Result<(), &'static str> {
    for _ in 0..count {
        let header = bytes.get(..CENTRAL_HEADER_BYTES).ok_or("decoding")?;
        if !header.starts_with(CENTRAL_MAGIC) {
            return Err("decoding");
        }
        if u16_at(header, 34) != 0 {
            return Err("unsupported");
        }
        let length = CENTRAL_HEADER_BYTES + usize::from(u16_at(header, 28))
            + usize::from(u16_at(header, 30)) + usize::from(u16_at(header, 32));
        bytes = bytes.get(length..).ok_or("decoding")?;
    }
    if !bytes.is_empty() {
        return Err("decoding");
    }
    Ok(())
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap())
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
