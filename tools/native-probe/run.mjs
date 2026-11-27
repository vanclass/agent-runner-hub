import { runProbe } from './hub.mjs';

await runProbe(process.argv.slice(2), { smoke: true });
