import fs from 'node:fs/promises';
import ts from 'typescript';

// Reuse the application's public response validators without copying protocol rules.
const source = await fs.readFile(new URL('../../../src/hub/runnerConfigContract.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
export const { isTestSelection, isInspection, sameInstallation } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
