import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readArchive } from './archive.mjs';
import { command } from '../native/process.mjs';
import { treeHash } from '../project.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function requireEntry(entries, name) {
  const value = entries.get(name)?.content;
  if (!value?.length) throw new Error('Missing/empty Android archive entry: ' + name);
  return value;
}
function verifyDex(bytes) {
  if (bytes.length < 112 || !/^dex\n\d{3}\0/.test(bytes.subarray(0, 8).toString('ascii'))) {
    throw new Error('Android DEX output is invalid.');
  }
}
function verifyLibrary(bytes) {
  if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2
      || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) throw new Error('Expected an arm64 Android ELF library.');
}

export async function verifyAndroidProducts(output, identity, environment, signal) {
  const products = {};
  const names = await fs.readdir(output);
  if (names.length !== 2 || names.filter(name => name.endsWith('.apk')).length !== 1
      || names.filter(name => name.endsWith('.aab')).length !== 1) {
    throw new Error('Expected exactly one fresh APK and one AAB before Android publication.');
  }
  for (const name of names.sort()) {
    const file = path.join(output, name), bundle = name.endsWith('.aab');
    const entries = await readArchive(file);
    for (const entry of entries.keys()) if (/^META-INF\/.*\.(RSA|DSA|EC|SF)$/i.test(entry)) {
      throw new Error('Unexpected signed distribution product; this adapter publishes unsigned local/test artifacts only.');
    }
    const library = (bundle ? 'base/' : '') + 'lib/arm64-v8a/lib' + identity.library + '.so';
    JSON.parse(requireEntry(entries, (bundle ? 'base/' : '') + 'assets/tauri.conf.json').toString('utf8'));
    verifyLibrary(requireEntry(entries, library));
    verifyDex(requireEntry(entries, bundle ? 'base/dex/classes.dex' : 'classes.dex'));
    let actual;
    if (bundle) {
      requireEntry(entries, 'BundleConfig.pb');
      requireEntry(entries, 'base/resources.pb');
      requireEntry(entries, 'base/manifest/AndroidManifest.xml');
      const validation = await command(environment.jdk.java, ['-jar', environment.verifier.file,
        'validate', '--bundle=' + file], output, signal);
      if (validation.code !== 0) throw new Error('AAB bundletool validation failed: ' + validation.output);
      const manifest = await command(environment.jdk.java, ['-jar', environment.verifier.file,
        'dump', 'manifest', '--bundle=' + file, '--module=base'], output, signal);
      if (manifest.code !== 0 || manifest.truncated) throw new Error('AAB package identity verification is unavailable: ' + manifest.output);
      actual = { identifier: manifest.stdout.match(/\bpackage="([^"]+)"/)?.[1],
        version: manifest.stdout.match(/\bandroid:versionName="([^"]+)"/)?.[1],
        versionCode: Number(manifest.stdout.match(/\bandroid:versionCode="(\d+)"/)?.[1]) };
    } else {
      const manifest = requireEntry(entries, 'AndroidManifest.xml');
      if (manifest.length < 8 || manifest.readUInt16LE(0) !== 3) throw new Error('APK compiled manifest is invalid.');
      requireEntry(entries, 'resources.arsc');
      const result = await command(environment.sdk.aapt2, ['dump', 'badging', file], output, signal);
      if (result.code !== 0 || result.truncated) throw new Error('APK package identity verification via selected aapt2 failed: ' + result.output);
      const match = result.stdout.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
      if (!match || Number(match[2]) < 1) throw new Error('APK package/version identity is unavailable.');
      actual = { identifier: match[1], version: match[3], versionCode: Number(match[2]) };
      const bytes = await fs.readFile(file);
      const signingMagic = bytes.subarray(entries.directoryOffset - 16, entries.directoryOffset);
      if (signingMagic.equals(Buffer.from('APK Sig Block 42'))) throw new Error('Unexpected APK signing block in unsigned local/test output.');
    }
    if (actual.identifier !== identity.identifier || actual.version !== identity.version
        || !Number.isSafeInteger(actual.versionCode) || actual.versionCode < 1) {
      throw new Error('Android package identity/version mismatch in ' + name + '. Earlier products are preserved.');
    }
    const bytes = await fs.readFile(file);
    products[bundle ? 'aab' : 'apk'] = { name, size: bytes.length, sha256: hash(bytes), identifier: actual.identifier,
      version: actual.version, versionCode: actual.versionCode, archiveVerification: 'crc-and-structure-verified', abi: 'arm64-v8a' };
  }
  if (products.apk.versionCode !== products.aab.versionCode) throw new Error('APK/AAB versionCode mismatch; no incomplete product set is published.');
  const proof = { schema: 1, target: 'android-tauri', identifier: identity.identifier, productName: identity.productName,
    version: identity.version, library: identity.library, nativeLock: identity.nativeLock, versions: environment.versions,
    products, distribution: 'unsigned-local-test', storeReady: false, signatureStatus: 'unsigned',
    deviceVerificationStatus: 'not-verified', emulatorVerificationStatus: 'not-verified' };
  await fs.writeFile(path.join(output, 'products.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  for (const product of Object.values(products)) {
    const bytes = await fs.readFile(path.join(output, product.name));
    if (bytes.length !== product.size || hash(bytes) !== product.sha256) throw new Error('Android product integrity changed during verification.');
  }
  return treeHash(output);
}
