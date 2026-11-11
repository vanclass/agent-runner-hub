import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// CRC and directory/local-header agreement are checked before products or tools are consumed.
export async function readArchive(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 512 * 1024 * 1024) {
    throw new Error('Expected a nonempty plain ZIP archive of at most 512 MiB: ' + file);
  }
  const bytes = await fs.readFile(file);
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && (bytes.readUInt32LE(end) !== 0x06054b50
      || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < minimum) throw new Error('ZIP end directory is missing or incomplete: ' + file);
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
      || bytes.readUInt16LE(end + 8) !== count || count === 65535 || start + size !== end) {
    throw new Error('Unsupported multipart/ZIP64 or incomplete archive: ' + file);
  }
  const entries = new Map();
  Object.defineProperty(entries, 'directoryOffset', { value: start });
  let cursor = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), packed = bytes.readUInt32LE(cursor + 20);
    const length = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (next > end) throw new Error('Truncated ZIP entry.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    const local = bytes.readUInt32LE(cursor + 42);
    if (!name || name.includes('\\') || name.includes('\0') || name.includes('\ufffd')
        || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')
        || name.split('/').includes('.') || entries.has(name) || (mode & 0xf000) === 0xa000) {
      throw new Error('Unsafe or duplicate ZIP entry: ' + name);
    }
    if (flags & 1 || ![0, 8].includes(method) || length > 512 * 1024 * 1024
        || (total += length) > 1024 * 1024 * 1024 || local + 30 > start
        || bytes.readUInt32LE(local) !== 0x04034b50
        || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) {
      throw new Error('Unsupported or corrupt ZIP entry: ' + name);
    }
    const localNameLength = bytes.readUInt16LE(local + 26);
    const data = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (!bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes) || data + packed > start) {
      throw new Error('ZIP local/directory identity mismatch: ' + name);
    }
    const compressed = bytes.subarray(data, data + packed);
    const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, length) });
    if (content.length !== length || crc32(content) !== crc) throw new Error('ZIP integrity check failed: ' + name);
    entries.set(name, { content, mode });
    cursor = next;
  }
  if (cursor !== end || !entries.size) throw new Error('ZIP directory size/count mismatch.');
  return entries;
}

export async function extractTools(file, destination) {
  const entries = await readArchive(file);
  await fs.mkdir(destination);
  for (const [name, { content, mode }] of entries) {
    if (!name.startsWith('cmdline-tools/')) throw new Error('Unexpected command-line tools archive root: ' + name);
    const relative = name.slice('cmdline-tools/'.length);
    if (!relative) continue;
    const output = path.join(destination, relative);
    if (name.endsWith('/')) await fs.mkdir(output, { recursive: true });
    else {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, content, { flag: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 });
    }
  }
}
