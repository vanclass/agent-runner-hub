import fs from 'node:fs/promises';
import path from 'node:path';
import { command } from '../native/process.mjs';
import { verifyPortableExecutable } from '../native/products.mjs';
import { certificates, requireCertificate, signingSelection, windowsEvidence } from './certificates.mjs';

export async function resolveSigning(root, value, signal) {
  const selected = signingSelection(value);
  if (!selected) return null;
  const certificate = requireCertificate(await certificates(root, signal), selected);
  const tools = await windowsEvidence('Tools', root, signal);
  for (const [file, args] of [[tools.signtool, ['sign', '/?']], [tools.extractor, ['i']]]) {
    const result = await command(file, args, root, signal);
    if (result.code !== 0) throw new Error('Signing capability is unavailable: ' + file + '. ' + result.output);
    if (file === tools.extractor && !/\bnsis\b/i.test(result.stdout || '')) {
      throw new Error('7-Zip has no NSIS extraction capability. Install its matching 7z.dll alongside 7z.exe, or select a complete 7-Zip installation.');
    }
  }
  return { ...selected, certificate, ...tools };
}

export function signingOverride(signing) {
  return { certificateThumbprint: signing?.thumbprint || null, digestAlgorithm: 'sha256',
    timestampUrl: signing?.timestampUrl || null, tsp: Boolean(signing), signCommand: null };
}

export async function verifySignature(file, signing, signal) {
  const proof = await windowsEvidence('Verify', path.dirname(file), signal, { file });
  if (proof.thumbprint !== signing.thumbprint || proof.subject !== signing.certificate.subject
      || proof.cryptographicSignature !== 'verified' || proof.peDigest !== 'sha256-verified'
      || proof.timestamp !== 'rfc3161-sha256-verified' || !Number.isFinite(Date.parse(proof.timestampTime))) {
    throw new Error('Signature, signer identity or RFC 3161 timestamp mismatch: ' + path.basename(file));
  }
  return proof;
}

export async function signProducts(output, signing, binary, installer, signal, workspace) {
  const executable = path.join(output, binary);
  const result = await command(signing.signtool, ['sign', '/s', 'My', '/sha1', signing.thumbprint,
    '/fd', 'sha256', '/tr', signing.timestampUrl, '/td', 'sha256', executable], output, signal);
  if (result.code !== 0) throw new Error('Application signing/timestamp failed: ' + result.output + '. No unsigned fallback.');
  const applicationProof = await verifySignature(executable, signing, signal);
  const installerProof = await verifySignature(path.join(output, installer), signing, signal);
  const extracted = path.join(workspace, 'signed-payload');
  await fs.mkdir(extracted);
  const unpacked = await command(signing.extractor, ['x', '-y', '-o' + extracted, path.join(output, installer)], workspace, signal);
  if (unpacked.code !== 0) throw new Error('Signed NSIS payload extraction failed: ' + unpacked.output);
  const matches = [];
  async function find(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Indirect installer payload is unsupported.');
      if (entry.isDirectory()) await find(file);
      else if (entry.isFile() && entry.name.toLowerCase() === binary.toLowerCase()) matches.push(file);
    }
  }
  await find(extracted);
  if (matches.length !== 1) throw new Error('Expected exactly one signed application in the NSIS payload.');
  const payloadProof = await verifySignature(matches[0], signing, signal);
  const payloadIntegrity = await verifyPortableExecutable(matches[0]);
  // NSIS-specific binary patching can make the payload differ from the standalone EXE.
  return { status: 'signed-verified', certificate: signing.certificate,
    timestampUrl: signing.timestampUrl, publicCaTrust: 'not-verified',
    executable: applicationProof, installer: installerProof,
    embeddedApplication: { ...payloadProof, ...payloadIntegrity } };
}
