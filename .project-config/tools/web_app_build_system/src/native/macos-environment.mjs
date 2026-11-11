import { command } from './process.mjs';

export async function macosTools(root, signal) {
  const selected = await command('/usr/bin/xcode-select', ['-p'], root, signal);
  const sdk = await command('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], root, signal);
  const version = await command('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-version'], root, signal);
  const compiler = await command('/usr/bin/xcrun', ['--sdk', 'macosx', 'clang', '--version'], root, signal);
  return { ready: [selected, sdk, version, compiler].every(result => result.code === 0 && result.stdout.trim()),
    xcodeVersion: compiler.stdout.trim(), macosSdk: version.stdout.trim(),
    developerEnvironment: selected.code === 0 && sdk.code === 0
      ? { DEVELOPER_DIR: selected.stdout.trim(), SDKROOT: sdk.stdout.trim() } : {} };
}
