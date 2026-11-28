import type { RunnerObservation } from './runnerControl';
import type { RunnerSessions } from './RunnerSessions';
import { issueUserAction, type WorkAttempt, type WorkObservation } from './runnerWork';
import { selectedNotificationSound, type NotificationCategory, type NotificationSound, type NotificationSoundSelections } from './notificationSounds';

type Outcome = 'workCompleted' | 'workInterrupted';
type Request = { scope: string; keys: string[]; revision?: number };
type TabState = { outcomes: Set<string>; request?: Request };

function workKey(attempt: WorkAttempt, work: WorkObservation) {
  const id = work.work_id;
  return JSON.stringify(id
    ? [id.kind, id.id, id.kind === 'subagent_turn' ? work.execution_id : '']
    : [attempt.identity, work.observation_id]);
}

function userRequest(attempt: WorkAttempt | undefined, observation: RunnerObservation): Request | undefined {
  const work = attempt?.work;
  if (observation.run_mode === 'issue-run') {
    const signal = observation.issue_run_user_action;
    const bound = work?.run_mode === 'issue-run' && (!work.terminal || work.work_id?.id === signal?.issue_run_id);
    const status = issueUserAction(bound ? attempt : undefined, observation);
    if (status === 'unknown' || !signal) return;
    if (status === 'required' && bound && work.terminal) return;
    return { scope: 'issue:' + signal.issue_run_id, revision: signal.state_revision ?? undefined,
      keys: status === 'required' ? signal.requirements.map(r => JSON.stringify([r.kind, r.request_key, r.request_version])) : [] };
  }

  const { attention, execution } = observation;
  if (!attempt || !work || work.run_mode !== observation.run_mode || !work.started_event_id || attempt.uncertain || work.terminal) {
    if (execution.lifecycle_state === 'INTERACTIVE_READY' && !execution.owned_execution_alive
      && !attention.awaiting_user_command_reason && !attention.restart_confirmation_required) return { scope: '', keys: [] };
    return;
  }
  const scope = workKey(attempt, work);
  if (attention.restart_confirmation_required) return { scope, keys: ['restart_confirmation'] };
  const reason = attention.awaiting_user_command_reason;
  if (execution.lifecycle_state === 'AWAITING_USER_COMMAND'
    && ['authentication_recovery', 'model_recovery', 'capacity_exhausted'].includes(reason)) return { scope, keys: [reason] };
  if (work.run_mode === 'task-run' && execution.lifecycle_state === 'REPAIR_EXHAUSTED') return { scope, keys: ['repair_exhausted'] };
  if (attention.account_setup_required) return { scope, keys: ['account_setup'] };
  if (!reason && !attention.foreground_interaction_active && attention.suspension_status === 'inactive') return { scope, keys: [] };
}

function workOutcome(attempt: WorkAttempt, work: WorkObservation,
  abnormalExit: boolean, observation?: RunnerObservation): Outcome | undefined {
  if (!attempt.uncertain) {
    if (work.terminal && work.state === 'succeeded' && work.outcome === 'succeeded') return 'workCompleted';
    if (work.state === 'failed' && work.outcome === 'failed' && (work.terminal || work.owner === 'task_lifecycle')
      || work.terminal && work.state === 'interrupted' && work.outcome === 'interrupted') return 'workInterrupted';
    if (!work.terminal && work.state === 'incomplete' && work.outcome === 'incomplete' && work.run_mode === observation?.run_mode
      && observation.attention.awaiting_user_command_reason === 'interrupt_exec_run_exited'
      && observation.attention.restart_confirmation_required) return 'workInterrupted';
  }
  // Stop marks unresolved attempts uncertain. A numeric abnormal exit can settle a previously started, active Work.
  if (abnormalExit && !work.terminal && ['execution_started', 'active'].includes(work.state)
    && work.outcome === 'pending') return 'workInterrupted';
}

export class HubWorkNotifications {
  private readonly tabs = new Map<string, TabState>();

  constructor(private readonly selections: () => NotificationSoundSelections,
    private readonly play: (sound: NotificationSound) => Promise<boolean>) {}

  private notify(category: NotificationCategory) {
    const sound = selectedNotificationSound(this.selections(), category);
    if (sound !== null) void this.play(sound).catch(() => {});
  }

  subscribe(sessions: Pick<RunnerSessions, 'subscribe' | 'getSnapshot' | 'get'>) {
    const observe = () => {
      const visible = new Set<string>();
      for (const view of sessions.getSnapshot()) {
        const session = sessions.get(view.id);
        if (!session) continue;
        visible.add(view.id);
        if (view.closing || session.control.tabClosing) continue;
        let state = this.tabs.get(view.id);
        if (!state) {
          state = { outcomes: new Set() };
          this.tabs.set(view.id, state);
        }
        const { work, observationFresh, snapshot } = session.control;
        const observation = view.status === 'running' && observationFresh ? snapshot.observation : undefined;
        const current = work.current;
        if (observation) {
          const request = userRequest(current, observation);
          if (request) this.observeRequest(state, request);
        }
        const abnormalExit = view.status === 'exited' && typeof view.exitCode === 'number' && view.exitCode !== 0;
        for (const attempt of work.presentedAttempts) {
          const evidence = attempt.work;
          if (!evidence || !work.hasLiveObservation(attempt) || !work.hasConfirmedStart(attempt)) continue;
          const category = workOutcome(attempt, evidence, abnormalExit && attempt === current, attempt === current ? observation : undefined);
          if (!category) continue;
          const key = category + ':' + workKey(attempt, evidence);
          if (state.outcomes.has(key)) continue;
          state.outcomes.add(key);
          this.notify(category);
        }
      }
      for (const id of this.tabs.keys()) if (!visible.has(id)) this.tabs.delete(id);
    };
    const unsubscribe = sessions.subscribe(observe);
    observe();
    return unsubscribe;
  }

  private observeRequest(state: TabState, request: Request) {
    const previous = state.request?.scope === request.scope ? state.request : undefined;
    if (previous?.revision !== undefined && request.revision !== undefined && request.revision < previous.revision) return;
    state.request = request;
    if (request.keys.some(key => !previous?.keys.includes(key))) this.notify('userRequest');
  }
}
