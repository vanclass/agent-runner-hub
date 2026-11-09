import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from './suite.mjs';
import { rendererProbe } from '../../tests/native/webdriver/probe.mjs';
import { languageCase } from '../../tests/native/webdriver/language.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run test:native:probe [-- --target-dir <absolute Cargo cache>]\nIsolated Windows/macOS native cases with node:test. macOS runtime acceptance requires execution on that host. Focus-required tests use Computer Use.');
} else {
  if (args.length && !(args.length === 2 && args[0] === '--target-dir' && path.isAbsolute(args[1]))) {
    throw new Error('Use --help');
  }
  nativeSuite([rendererProbe, languageCase], {
    root, target: args.length ? path.resolve(args[1]) : path.join(root, 'local/native-probe/target')
  });
}
