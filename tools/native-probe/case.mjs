// Cases supply readiness and assertions; lifecycle owns all native operations.
// run executes DOM/API actions in the adapter's recorded initial presentation.
// observe executes after verified nonactivating display. A background case must
// stay hidden; displayed cases may be ordered behind the active app at startup.
// Neither callback authorizes desktop input; focus-required work uses Computer Use.
export class BlockedPrerequisite extends Error {}
export class UnverifiedObservation extends Error {}

export function defineNativeCase(spec) {
  if (!/^[a-zA-Z0-9_-]+$/.test(spec.id ?? '')) throw new TypeError('Case needs a path-safe id');
  if (!['background', 'nonactivating'].includes(spec.presentation)) {
    throw new TypeError('Choose background or nonactivating; focus-required uses Computer Use');
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
