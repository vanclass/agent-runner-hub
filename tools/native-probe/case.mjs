// Cases supply readiness and assertions; lifecycle owns all native operations.
// run executes DOM/API actions in the adapter's recorded initial presentation.
// observe executes after verified nonactivating display. A background case must
// stay hidden; displayed cases may be ordered behind the active app at startup.
// Callbacks never authorize desktop input. Windows focus-required cases opt into a
// separate staged build; run receives only the owned PID/HWND, and settle must
// verify input and any submitted authority before native teardown. Use Computer Use.
export class BlockedPrerequisite extends Error {}
export class UnverifiedObservation extends Error {}

export function defineNativeCase(spec) {
  if (!/^[a-zA-Z0-9_-]+$/.test(spec.id ?? '')) throw new TypeError('Case needs a path-safe id');
  if (!['background', 'nonactivating', 'focus-required'].includes(spec.presentation)) {
    throw new TypeError('Choose background, nonactivating or focus-required');
  }
  if (spec.presentation === 'focus-required' && typeof spec.settle !== 'function') {
    throw new TypeError('Focus-required cases need settle(browser) before teardown; input uses Computer Use');
  }
  if (spec.presentation === 'focus-required' && spec.afterRestart) {
    throw new TypeError('Focus-required input binds one owned process/window; restart is unsupported');
  }
  if (typeof spec.ready !== 'function' || typeof spec.run !== 'function') {
    throw new TypeError('Case needs ready(browser) and run(browser)');
  }
  if (spec.presentation === 'nonactivating' && typeof spec.observe !== 'function') {
    throw new TypeError('Displayed cases need observe(browser)');
  }
  return Object.freeze({ ...spec });
}
export function outcome(error) {
  if (!error) return 'passed';
  if (error instanceof BlockedPrerequisite) return 'blocked';
  if (error instanceof UnverifiedObservation) return 'unverified';
  return 'failed';
}
