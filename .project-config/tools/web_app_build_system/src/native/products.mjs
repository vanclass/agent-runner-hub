import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { treeHash } from '../project.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyPortableExecutable(file, { installer = false, nsis = installer } = {}) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 512) throw new Error('Missing, empty or indirect Windows product: ' + file);
  const bytes = await fs.readFile(file);
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Windows product has no MZ header: ' + file);
  const offset = bytes.readUInt32LE(0x3c);
  if (offset < 64 || offset + 26 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550) {
    throw new Error('Windows product has no valid PE header: ' + file);
  }
  const machine = bytes.readUInt16LE(offset + 4);
  const optionalSize = bytes.readUInt16LE(offset + 20);
  const characteristics = bytes.readUInt16LE(offset + 22);
  const magic = bytes.readUInt16LE(offset + 24);
  if (optionalSize < 96 || offset + 24 + optionalSize > bytes.length
      || !(characteristics & 2) || characteristics & 0x2000
      || (installer ? ![0x14c, 0x8664].includes(machine) : machine !== 0x8664)
      || (machine === 0x8664 ? magic !== 0x20b : magic !== 0x10b)) {
    throw new Error('Windows product has the wrong executable target/shape: ' + file);
  }
  if (nsis && !bytes.includes(Buffer.from('NullsoftInst'))) throw new Error('Installer is not an NSIS product: ' + file);
  return { bytes: bytes.length, sha256: sha256(bytes), machine };
}

export async function verifyProducts(output, identity) {
  if (identity.target !== 'windows-tauri' || !identity.identifier || !identity.version || !identity.binary || !identity.productName) {
    throw new Error('Native product identity is incomplete.');
  }
  const names = (await fs.readdir(output)).sort();
  const binary = identity.binary + '.exe';
  const installers = names.filter(name => name === `${identity.productName}_${identity.version}_x64-setup.exe`);
  if (installers.length !== 1 || !names.includes(binary) || names.some(name => ![binary, installers[0]].includes(name))) {
    throw new Error('Expected exactly one target executable and one versioned x64 NSIS installer.');
  }
  const executable = await verifyPortableExecutable(path.join(output, binary));
  const installer = await verifyPortableExecutable(path.join(output, installers[0]), { installer: true });
  const evidence = { schema: 1, ...identity, products: {
    executable: { name: binary, ...executable }, installer: { name: installers[0], ...installer } } };
  await fs.writeFile(path.join(output, 'products.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  return treeHash(output);
}
