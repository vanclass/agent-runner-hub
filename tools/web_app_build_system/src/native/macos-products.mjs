import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './process.mjs';
import { treeHash } from '../project.mjs';

export async function copyMacProducts(release, output) {
  const apps = (await fs.readdir(path.join(release, 'bundle/macos'))).filter(name => name.endsWith('.app'));
  const images = (await fs.readdir(path.join(release, 'bundle/dmg'))).filter(name => name.endsWith('.dmg'));
  if (apps.length !== 1 || images.length !== 1) throw new Error('Expected one newly generated app and dmg in the native target output.');
  await fs.mkdir(output);
  await fs.cp(path.join(release, 'bundle/macos', apps[0]), path.join(output, apps[0]), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  await fs.copyFile(path.join(release, 'bundle/dmg', images[0]), path.join(output, images[0]), fs.constants.COPYFILE_EXCL);
}

export async function verifyMacProducts(output, identity, signal) {
  const names = await fs.readdir(output);
  const app = names.filter(name => name.endsWith('.app'));
  const dmg = names.filter(name => name.endsWith('.dmg'));
  if (names.length !== 2 || app.length !== 1 || dmg.length !== 1) throw new Error('Expected exactly one macOS app and dmg.');
  const bundle = path.join(output, app[0]);
  async function plain(folder) {
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Custom app symlinks require a product verification integration: ' + file);
      if (stat.isDirectory()) await plain(file);
      else if (!stat.isFile() || !stat.size) throw new Error('Empty or unsupported app product: ' + file);
    }
  }
  await plain(bundle);
  for (const [key, expected] of Object.entries({ CFBundleIdentifier: identity.identifier,
    CFBundleShortVersionString: identity.version, CFBundleExecutable: identity.binary })) {
    const value = await command('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(bundle, 'Contents/Info.plist')], output, signal);
    if (value.code !== 0 || value.stdout.trim() !== expected) throw new Error('macOS app identity mismatch: ' + key);
  }
  const executable = path.join(bundle, 'Contents/MacOS', identity.binary);
  const stat = await fs.lstat(executable), bytes = await fs.readFile(executable);
  const cpu = identity.targetTriple === 'aarch64-apple-darwin' ? 0x100000c : 0x1000007;
  if (!stat.isFile() || !(stat.mode & 0o111) || bytes.length < 32
      || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu || bytes.readUInt32LE(12) !== 2) {
    throw new Error('Expected executable native Mach-O for ' + identity.targetTriple);
  }
  const image = path.join(output, dmg[0]), imageStat = await fs.lstat(image);
  if (!imageStat.isFile() || imageStat.isSymbolicLink() || imageStat.size < 512) throw new Error('Missing or invalid dmg.');
  const verified = await command('/usr/bin/hdiutil', ['verify', image], output, signal);
  if (verified.code !== 0) throw new Error('Disk image integrity verification failed: ' + verified.output);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const evidence = { schema: 1, ...identity, products: {
    application: { name: app[0], sha256: await treeHash(bundle), machine: cpu },
    diskImage: { name: dmg[0], bytes: imageStat.size, sha256: digest(await fs.readFile(image)) } } };
  await fs.writeFile(path.join(output, 'products.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  return treeHash(output);
}
