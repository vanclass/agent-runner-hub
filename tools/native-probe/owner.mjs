import * as windows from './platforms/windows.mjs';
import * as macos from './platforms/macos.mjs';
import { BlockedPrerequisite } from './case.mjs';

export function platformAdapter(platform = process.platform) {
  if (platform === 'win32') return windows;
  if (platform === 'darwin') return macos;
  throw new BlockedPrerequisite('Unsupported native host: ' + platform);
}
// WG1 imports remain supported while selection belongs to the platform boundary.
export function isolatedEnvironment(attempt, port) {
  return platformAdapter().isolatedEnvironment(attempt, port);
}
export function startOwner(...args) {
  return platformAdapter().startOwner(...args);
}
