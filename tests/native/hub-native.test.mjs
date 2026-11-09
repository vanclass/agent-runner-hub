import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the entry point with deterministic native boundaries, without launching a desktop.
const source = (await fs.readFile(new URL('../../tools/hub-native.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', '"file:///fixture/tools/hub-native.mjs"');
const root = path.resolve('fixture');
async function invoke(args, { failBuild = false, badMetadata = false, redirectedDefault = false, missingExecutable = false, invalidTarget = false } = {}) {
  const calls = [], errors = [], logs = [], removed = [];
  const proc = { argv: ['node', 'hub-native', ...args], platform: 'win32', execPath: 'node',
    on() {}, removeListener() {}, exitCode: 0 };
  let target;
  const context = vm.createContext({ path, URL, AbortController, process: proc,
    console: { log: value => logs.push(value), error: value => errors.push(value) },
    fileURLToPath: () => root, randomUUID: () => 'attempt', targetTriple: 'x86_64-pc-windows-msvc',
    fs: { realpath: async value => redirectedDefault && value === path.join(root, 'local/hub-native/target') ? path.resolve('external') : value,
      mkdir: async () => { if (invalidTarget) throw new Error('EEXIST: target is a file'); },
      access: async value => { if (missingExecutable) throw new Error('missing executable'); calls.push(['access', value]); },
      rm: async value => removed.push(value), rmdir: async () => {} },
    withBuildOwnership: async (_root, _cache, _signal, _stage, work) => work(),
    inspectNative: async () => ({ cargo: 'cargo', cli: 'tauri', web: { cli: 'npm' } }),
    prepareNative: async (_root, env) => env,
    npm: async () => 0, stageBackend: async () => ({ build: { features: ['desktop'] } }),
    ownedOverride: () => ({}),
    prepareCargo: async (_environment, _backend, value) => { target = value; return { CARGO_TARGET_DIR: value }; },
    command: async (executable, argv, cwd, signal, options) => {
      calls.push([executable, argv, options.env]);
      if (argv[0] === 'metadata') return { code: 0, stdout: JSON.stringify({ target_directory: badMetadata ? root : target }) };
      return { code: failBuild ? 1 : 0 };
    } });
  await new vm.Script('(async () => {' + source + '})()').runInContext(context);
  return { calls, errors, logs, removed, code: proc.exitCode, target };
}

test('build and test default to checkout output and propagate it to every Cargo consumer', async () => {
  for (const action of ['build', 'test']) {
    const result = await invoke([action]);
    assert.equal(result.code, 0);
    assert.equal(result.target, path.join(root, 'local/hub-native/target'));
    for (const call of result.calls.filter(call => call[0] !== 'access')) {
      assert.equal(call[2].CARGO_TARGET_DIR, result.target);
      if (call[1][0] !== 'metadata') assert.ok(call[1].includes('x86_64-pc-windows-msvc'));
    }
    if (action === 'build') assert.ok(result.calls.some(call => call[0] === 'access' && call[1] === path.join(result.target, 'x86_64-pc-windows-msvc/debug/web-app-native.exe')));
    assert.deepEqual(result.removed, [path.join(root, 'temp/hub-native/attempt')]);
  }
});

test('absolute explicit target overrides the default for both actions', async () => {
  for (const action of ['build', 'test']) {
    const result = await invoke([action, '--target-dir', path.resolve('short cargo')]);
    assert.equal(result.code, 0);
    assert.equal(result.target, path.resolve('short cargo'));
  }
});

test('focused Rust selection reaches only Cargo test and preserves target options', async () => {
  for (const [flag, value, expected] of [
    ['--test-filter', 'session_config_tests', ['--lib', 'session_config_tests']],
    ['--integration-test', 'control_handles', ['--test', 'control_handles']]
  ]) {
    const result = await invoke(['test', flag, value, '--target-dir', path.resolve('short cargo')]);
    assert.equal(result.code, 0);
    const tested = result.calls.find(call => call[1][0] === 'test');
    assert.deepEqual(Array.from(tested[1].slice(-2)), expected);
    assert.ok(!result.calls.find(call => call[1][0] === 'check')[1].includes(value));
  }
  for (const args of [['build', '--test-filter', 'x'], ['test', '--test-filter'],
    ['test', '--integration-test', '--ignored'], ['test', '--test-filter', 'one', '--test-filter', 'two']]) {
    const result = await invoke(args);
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
  }
});

test('invalid arguments fail before native work; help stays available', async () => {
  for (const args of [[], ['invalid'], ['build', '--target-dir'], ['test', '--target-dir', 'relative'],
    ['build', '--other', root], ['build', '--target-dir', root, 'extra']]) {
    const result = await invoke(args);
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
  }
  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.logs.join(''), /local\/hub-native\/target/);
  const invalid = await invoke(['build', '--target-dir', path.resolve('file')], { invalidTarget: true });
  assert.equal(invalid.code, 1);
  assert.equal(invalid.calls.length, 0);
});

test('failed build and wrong metadata never announce an executable and clean staging', async () => {
  for (const options of [{ failBuild: true }, { badMetadata: true }, { missingExecutable: true }]) {
    const result = await invoke(['build'], options);
    assert.equal(result.code, 1);
    assert.equal(result.calls.some(call => call[0] === 'access'), false);
    assert.equal(result.logs.some(log => log.includes('Executable ready')), false);
    assert.deepEqual(result.removed, [path.join(root, 'temp/hub-native/attempt')]);
  }
});

test('default rejects filesystem redirection while explicit overrides keep their existing behavior', async () => {
  const rejected = await invoke(['build'], { redirectedDefault: true });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.calls.length, 0);
  const explicit = await invoke(['build', '--target-dir', path.resolve('short')], { redirectedDefault: true });
  assert.equal(explicit.code, 0);
});
