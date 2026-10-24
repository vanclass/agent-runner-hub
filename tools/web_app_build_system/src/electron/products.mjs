import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { treeHash } from '../project.mjs';
import { verifyOutput } from '../output.mjs';
import { verifyPortableExecutable } from '../native/products.mjs';
import { readArchive } from '../android/archive.mjs';

const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
async function plainTree(folder) {
  for (const name of await fs.readdir(folder)) {
    const file = path.join(folder, name), stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Electron products cannot contain filesystem indirection.');
    if (stat.isDirectory()) await plainTree(file);
    else if (!stat.isFile() || !stat.size) throw new Error('Electron product is empty or not a file: ' + file);
  }
}
function xmlValue(xml, tag) {
  const value = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1]?.trim();
  return value?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export async function verifyElectronProducts(output, identity) {
  if (identity.target !== 'windows-electron' || !/^[a-z0-9][a-z0-9-]*$/.test(identity.name)
      || !/^\d+\.\d+\.\d+$/.test(identity.version) || !identity.productName || !identity.author || !identity.description) {
    throw new Error('Electron product identity or mandatory Squirrel metadata is incomplete.');
  }
  await plainTree(output);
  const app = path.join(output, 'application'), installer = path.join(output, 'installer');
  const binaryName = identity.name + '.exe', setupName = identity.name + '-' + identity.version + '-Setup.exe';
  const packageFile = path.join(app, 'resources/app/package.json');
  const metadata = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  for (const key of ['name', 'version', 'productName', 'author', 'description']) {
    if (metadata[key] !== identity[key]) throw new Error('Packaged application metadata mismatch: ' + key);
  }
  if (metadata.main !== 'app/main.cjs' || metadata.dependencies?.['electron-squirrel-startup'] !== identity.squirrelVersion) throw new Error('Packaged Electron main/startup dependency metadata is invalid.');
  await verifyOutput(path.join(app, 'resources/app/frontend'), './');
  for (const file of ['resources.pak', 'v8_context_snapshot.bin', 'icudtl.dat', 'resources/app/app/main.cjs', 'resources/app/app/preload.cjs',
    'resources/app/node_modules/electron-squirrel-startup/index.js']) {
    if (!(await fs.stat(path.join(app, file))).size) throw new Error('Incomplete Electron application: ' + file);
  }
  const binary = await fs.readFile(path.join(app, binaryName));
  const executable = await verifyPortableExecutable(path.join(app, binaryName));
  if (!binary.includes(Buffer.from(identity.productName, 'utf16le')) || !binary.includes(Buffer.from(identity.version, 'utf16le'))) throw new Error('Packaged executable version/product identity does not match staged metadata.');
  const names = (await fs.readdir(installer)).sort();
  const packages = names.filter(name => name.toLowerCase() === (identity.name + '-' + identity.version + '-full.nupkg').toLowerCase());
  if (packages.length !== 1 || names.length !== 3 || !names.includes('RELEASES') || !names.includes(setupName)) throw new Error('Expected one versioned Squirrel Setup.exe, full NuGet package and RELEASES file.');
  const setup = await verifyPortableExecutable(path.join(installer, setupName), { installer: true, nsis: false });
  const setupBytes = await fs.readFile(path.join(installer, setupName));
  if (!setupBytes.includes(Buffer.from('Squirrel')) && !setupBytes.includes(Buffer.from('Squirrel', 'utf16le'))) throw new Error('Installer lacks Squirrel.Windows identity.');
  const archiveFile = path.join(installer, packages[0]), archiveBytes = await fs.readFile(archiveFile);
  const releases = (await fs.readFile(path.join(installer, 'RELEASES'), 'utf8')).trim().split(/\r?\n/);
  if (releases.length !== 1) throw new Error('Unexpected Squirrel release count.');
  const release = releases[0].trim().split(/\s+/);
  if (release.length !== 3 || release[0].toLowerCase() !== hash(archiveBytes, 'sha1')
      || release[1] !== packages[0] || Number(release[2]) !== archiveBytes.length) throw new Error('Squirrel RELEASES package identity/integrity mismatch.');
  const archive = await readArchive(archiveFile);
  const specs = [...archive.keys()].filter(name => name.endsWith('.nuspec'));
  if (specs.length !== 1) throw new Error('Squirrel package must contain one NuGet metadata record.');
  const spec = archive.get(specs[0]).content.toString('utf8');
  for (const [tag, expected] of [['id', identity.name], ['version', identity.version], ['authors', identity.author], ['description', identity.description]]) {
    if (xmlValue(spec, tag) !== expected) throw new Error('Squirrel installer package metadata mismatch: ' + tag);
  }
  const packagedBinary = archive.get('lib/net45/' + binaryName)?.content;
  const packagedMetadata = archive.get('lib/net45/resources/app/package.json')?.content;
  if (!packagedBinary?.equals(binary) || !packagedMetadata?.equals(await fs.readFile(packageFile))) throw new Error('Installer package does not contain the verified executable/application identity.');
  const evidence = { schema: 1, ...identity, executable: { path: 'application/' + binaryName, ...executable },
    installer: { path: 'installer/' + setupName, ...setup }, package: { name: packages[0], bytes: archiveBytes.length, sha256: hash(archiveBytes) },
    signatureStatus: 'not-verified', guiVerificationStatus: 'not-verified', installerExecutionStatus: 'not-executed' };
  await fs.writeFile(path.join(output, 'products.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  return treeHash(output);
}
