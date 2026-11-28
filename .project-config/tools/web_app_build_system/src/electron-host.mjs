import { runtimeEnabled } from './runtime-selection.mjs';

export const supportsElectronPackaging = process.platform === 'win32' && process.arch === 'x64';

export async function electronHostBlocker(root) {
  if (!await runtimeEnabled(root, 'Electron', true)) return { enabled: false, ready: false, preparable: false,
    hints: ['Select and Apply both Web App > Runtimes > Electron and Tools > Web App Build System.'] };
  if (!supportsElectronPackaging) return { enabled: true, ready: false, preparable: false,
    verificationStatus: 'unavailable', hints: ['Windows x64 host required for Electron Forge / Squirrel.Windows packaging.'] };
  return null;
}
