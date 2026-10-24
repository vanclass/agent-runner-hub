import { command } from '../native/process.mjs';

// A broken executable is a prerequisite failure; cancellation keeps its original identity.
export async function probe(file, args, cwd, signal, options) {
  try { return await command(file, args, cwd, signal, options); }
  catch (error) {
    signal.throwIfAborted();
    return { code: 1, stdout: '', stderr: error.message, output: error.message, truncated: false };
  }
}
