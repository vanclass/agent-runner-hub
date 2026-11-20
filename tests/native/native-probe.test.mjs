import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isolatedEnvironment, startOwner } from '../../tools/native-probe/owner.mjs';
import { isolatedEnvironment as windowsEnvironment } from '../../tools/native-probe/platforms/windows.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('Windows focus mode is explicit and never inherited by ordinary cases', { skip: process.platform !== 'win32' }, () => {
  const prior = process.env.HUB_NATIVE_PRESENTATION;
  process.env.HUB_NATIVE_PRESENTATION = 'focus-required';
  try {
    for (const mode of [undefined, 'background', 'nonactivating']) {
      assert.equal(windowsEnvironment(root, 32123, mode).HUB_NATIVE_PRESENTATION, undefined);
    }
    assert.equal(windowsEnvironment(root, 32123, 'focus-required').HUB_NATIVE_PRESENTATION, 'focus-required');
  } finally {
    if (prior === undefined) delete process.env.HUB_NATIVE_PRESENTATION;
    else process.env.HUB_NATIVE_PRESENTATION = prior;
  }
});
test('runtime allowlist excludes inherited Runner credentials and WebView debug overrides', { skip: process.platform !== 'win32' }, () => {
  const prior = process.env.RUNNER_AUTH_TOKEN;
  process.env.RUNNER_AUTH_TOKEN = 'fixture-secret';
  try {
    const folder = path.join(root, 'temp/native-probe/environment-fixture');
    const env = isolatedEnvironment(folder, 32123);
    assert.equal(env.RUNNER_AUTH_TOKEN, undefined);
    assert.equal(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, undefined);
    assert.equal(env.CARGO_HOME, undefined);
    assert.equal(env.TAURI_WEBDRIVER_PORT, '32123');
    assert.ok(Object.values(env).every(value => !value.includes('fixture-secret')));
    for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'WEBVIEW2_USER_DATA_FOLDER']) {
      assert.ok(env[key].startsWith(folder + path.sep));
    }
  } finally {
    if (prior === undefined) delete process.env.RUNNER_AUTH_TOKEN;
    else process.env.RUNNER_AUTH_TOKEN = prior;
  }
});

test('Windows normal-home opt-in retains application isolation and the runtime allowlist', { skip: process.platform !== 'win32' }, () => {
  const folder = path.join(root, 'temp/native-probe/environment-fixture');
  const ordinary = windowsEnvironment(folder, 32123);
  const optedIn = windowsEnvironment(folder, 32123, 'focus-required', { preserveUserHome: true });
  assert.equal(ordinary.USERPROFILE, path.join(folder, 'user'));
  assert.equal(optedIn.USERPROFILE, process.env.USERPROFILE);
  assert.notEqual(optedIn.USERPROFILE, ordinary.USERPROFILE);
  assert.equal(ordinary.PATH, path.join(process.env.SystemRoot, 'System32'));
  assert.equal(optedIn.PATH, process.env.PATH);
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'WEBVIEW2_USER_DATA_FOLDER']) {
    assert.equal(optedIn[key], ordinary[key]);
    assert.ok(optedIn[key].startsWith(folder + path.sep));
  }
  assert.equal(optedIn.ProgramData, process.env.ProgramData);
  assert.equal(ordinary.ProgramData, undefined);
  assert.deepEqual(Object.keys(optedIn).sort(), [...Object.keys(ordinary), 'ProgramData', 'HUB_NATIVE_PRESENTATION'].sort());
  assert.equal(optedIn.HOME, undefined);
  assert.equal(optedIn.RUNNER_AUTH_TOKEN, undefined);
  assert.equal(optedIn.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, undefined);
});

test('native owner reports failed process creation without adopting another Hub', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const parent = path.join(root, 'temp/native-probe');
  await fs.mkdir(parent, { recursive: true });
  const attempt = await fs.mkdtemp(path.join(parent, 'creation-failure-'));
  try {
    await assert.rejects(startOwner(root, path.join(attempt, 'does-not-exist.exe'),
      attempt, 32123, 10_000), /Native owner process-creation:/);
  } finally { await fs.rm(attempt, { recursive: true }); }
});
