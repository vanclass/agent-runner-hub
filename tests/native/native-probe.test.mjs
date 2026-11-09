import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isolatedEnvironment, startOwner } from '../../tools/native-probe/owner.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
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

test('native owner reports failed process creation without adopting another Hub', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const parent = path.join(root, 'temp/native-probe');
  await fs.mkdir(parent, { recursive: true });
  const attempt = await fs.mkdtemp(path.join(parent, 'creation-failure-'));
  try {
    await assert.rejects(startOwner(root, path.join(attempt, 'does-not-exist.exe'),
      attempt, 32123, 10_000), /Native owner process-creation:/);
  } finally { await fs.rm(attempt, { recursive: true }); }
});
