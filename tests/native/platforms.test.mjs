import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { platformAdapter } from '../../tools/native-probe/owner.mjs';
import { ownedListeners, isolatedEnvironment } from '../../tools/native-probe/platforms/macos.mjs';
import { BlockedPrerequisite } from '../../tools/native-probe/case.mjs';

const listening = (pid = 42, type = 'IPv4', endpoint = '127.0.0.1:1234') =>
  'p' + pid + '\nf9\nt' + type + '\nPTCP\nn' + endpoint + '\nTST=LISTEN\n';
test('macOS dispatch and strict runtime environment remain independent of Windows', () => {
  assert.equal(platformAdapter('darwin').isolatedEnvironment, isolatedEnvironment);
  const env = isolatedEnvironment('/fixture/attempt', 1234, 'nonactivating');
  assert.equal(env.HOME, '/fixture/attempt/user');
  assert.equal(env.CFFIXED_USER_HOME, env.HOME);
  assert.equal(env.TMPDIR, '/fixture/attempt/tmp');
  assert.equal(env.TAURI_WEBDRIVER_PORT, '1234');
  assert.equal(env.HUB_NATIVE_PRESENTATION, 'nonactivating');
  for (const key of ['RUNNER_AUTH_TOKEN', 'APPDATA', 'DYLD_INSERT_LIBRARIES', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']) {
    assert.equal(env[key], undefined);
  }
});
test('macOS listener gate accepts only the exact owned literal IPv4 endpoint', () => {
  assert.deepEqual(ownedListeners('', 42, 1234), []);
  assert.deepEqual(ownedListeners(listening(), 42, 1234), [{ address: '127.0.0.1', port: 1234 }]);
  for (const records of [listening(43), listening(42, 'IPv6'), listening(42, 'IPv4', '*:1234'),
    listening(42, 'IPv4', '127.0.0.1:4321'), listening() + listening(), 'p42\n',
    listening().replace('TST=LISTEN', 'TST=ESTABLISHED')]) {
    assert.throws(() => ownedListeners(records, 42, 1234), BlockedPrerequisite);
  }
});
test('macOS native presentation remains excluded from ordinary production builds', async () => {
  const lib = await fs.readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(all\(feature = "native-webdriver", debug_assertions, target_os = "macos"\)\)\]\s*mod native_automation_macos/);
  const source = await fs.readFile(new URL('../../src-tauri/src/native_automation_macos.rs', import.meta.url), 'utf8');
  assert.match(source, /pthread_main_np/);
  assert.match(source, /c"orderBack:"/);
  assert.doesNotMatch(source, /tauri::command|set_focus\(|\.show\(/);
});