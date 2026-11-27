import { UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { mountedRunner } from './mounted-runner.mjs';

export function observeSession(browser, id) {
  return browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), id);
}

export function correlated(snapshot, connection) {
  if (snapshot.state !== 'ready' || snapshot.features?.generation !== connection.generation)
    throw new UnverifiedObservation('Owned Runner session/generation changed; no replay.');
  return snapshot;
}

export async function observeConnection(browser, connection) {
  return correlated(await observeSession(browser, connection.session), connection);
}

export function workSubmissions(snapshot) {
  return (snapshot.features?.results ?? []).filter(r => r.feature === 'work' && r.operation === 'work.submit');
}

export function workObservations(snapshot) {
  return (snapshot.features?.results ?? []).filter(r => r.feature === 'work')
    .flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
}

export function executionReleased(snapshot) {
  const execution = snapshot.observation?.execution;
  return execution?.lifecycle_state === 'INTERACTIVE_READY'
    && execution.owned_execution_alive === false && execution.workflow_kind === '';
}

export class RunnerObservations {
  constructor(browser) {
    this.browser = browser;
  }

  active() {
    return mountedRunner(this.browser, 'state');
  }

  snapshot(connection) {
    return observeConnection(this.browser, connection);
  }

  // Only the exact, previously bound fixture PTY may be checked for settlement.
  exited(id) {
    return this.browser.execute(async id => {
      try {
        await window.__TAURI_INTERNALS__.invoke('runner_observe', { id });
        return false;
      } catch (error) {
        if (String(error) === 'Unknown or exited PTY') return true;
        throw error;
      }
    }, id);
  }
}
