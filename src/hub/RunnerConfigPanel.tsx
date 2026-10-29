import { t, tr, msg, useHubTranslation, type MessageKey } from './i18n';
import type { RunnerControl } from './runnerControl';
import type { ConfigSettings } from './runnerConfigContract';
import { entryDefaultsToDesired } from './runnerConfigDefaults';
import type { HubSelections } from './HubSelections';
import './runnerConfig.css';

const fields: Record<keyof ConfigSettings, MessageKey> = { target: 'fields.target', account: 'fields.account',
  model: 'fields.model', service_tier: 'config.tier', run_mode: 'fields.runMode', root: 'config.root' };
const activity = { idle: 'config.idle', inspecting: 'config.inspecting', catalog: 'config.catalog',
  planning: 'config.planning', applying: 'config.applying', verifying: 'config.verifying', closed: 'config.closed' } satisfies Record<string, MessageKey>;
const states = { sending: 'config.sending', queued: 'config.queued', 'pending-interaction': 'config.interaction',
  accepted: 'config.accepted', rejected: 'config.rejected', failure: 'config.failure', 'outcome-unknown': 'config.unknown', 'not-sent': 'config.notSent' } satisfies Record<string, MessageKey>;
const outcomes = { success: 'config.success', rejected: 'config.rejected', cancelled: 'config.cancelled',
  failed: 'config.failure', unknown: 'config.unknown', not_attempted: 'config.notAttempted' } satisfies Record<string, MessageKey>;
const applyStatuses = { applied: 'config.appliedLabel', partial: 'config.partialLabel', rejected: 'config.rejected',
  cancelled: 'config.cancelled', failed: 'config.failure', unknown: 'config.unknown' } satisfies Record<string, MessageKey>;
const codes: Record<string, MessageKey> = {
  CONFIG_REVISION_STALE: 'config.stalePlan', CONFIG_PLAN_MISMATCH: 'config.planMismatch',
  CONFIG_OPTIONS_REVISION_STALE: 'config.optionsStale', CONFIG_STATE_CHANGED: 'config.optionsStale',
  CONFIG_RUNNER_NOT_IDLE: 'config.notIdle', CONFIG_RUNNER_AUTHORITY_BUSY: 'config.notIdle',
  CONFIG_RETAINED_RUN_AUTHORITY: 'config.notIdle', CONFIG_ACCOUNT_INVALID: 'config.identityChanged',
  CONFIG_TARGET_INVALID: 'config.identityChanged', CONFIG_MODEL_INVALID: 'config.invalidCombination',
  CONFIG_REASONING_EFFORT_INVALID: 'config.invalidCombination', CONFIG_SERVICE_TIER_INVALID: 'config.invalidCombination',
  CONFIG_PLAN_NOT_APPLICABLE: 'config.stalePlan', CONFIG_CONFIRMATION_REQUIRED: 'config.confirmation',
  release_context_in_runner_terminal: 'config.confirmation', release_direct_context_in_runner_terminal: 'config.confirmation',
  discard_staged_briefs_in_runner_terminal: 'config.confirmation',
};
const display = (value: unknown) => value === undefined || value === null || value === '' ? '—'
  : typeof value === 'string' ? value : JSON.stringify(value);
function Diagnostic({ code }: { code: string }) { return <span>{codes[code] && `${t(codes[code])} `}<code>{code}</code></span>; }

export function RunnerConfigPanel({ control, hubSelections }: {
  control: Pick<RunnerControl, 'config' | 'snapshot'> & { assignmentLocked?: boolean };
  hubSelections: HubSelections;
}) {
  useHubTranslation();
  const service = control.config, actual = service.actual, catalog = service.catalog;
  const current = actual?.current;
  const connected = control.snapshot.state === 'ready';
  const plan = service.plan;
  const mapped = catalog ? entryDefaultsToDesired(hubSelections.defaults, catalog) : undefined;
  async function planRequested() {
    const requested = hubSelections.defaults;
    service.resetDraft();
    await hubSelections.inspectOptions();
    if (requested !== hubSelections.defaults || !hubSelections.catalog) return;
    const mapped = entryDefaultsToDesired(requested, hubSelections.catalog);
    if (mapped.unresolved.length) {
      service.error = msg('config.defaultsUnresolved', { fields: mapped.unresolved.join(', ') });
      return;
    }
    service.setDraft(mapped.desired);
    await service.createPlan();
  }
  return <details className="runner-config" open>
    <summary>{t('config.title')}</summary>
    {!service.supports('inspect') && <p role="status">{connected ? t('config.unsupported') : t('config.notReady')} {t('config.terminalHelp')}</p>}
    <div className="config-actions">
      <button type="button" disabled={!service.supports('inspect') || service.busy || control.assignmentLocked}
        onClick={() => void hubSelections.inspectOptions()}>{t('config.inspect')}</button>
      <button type="button" disabled={!current || service.busy || !connected || control.assignmentLocked} onClick={() => service.resetDraft()}>{t('config.reset')}</button>
    </div>
    <p className="config-progress" role="status" aria-live="polite" aria-busy={service.busy}>
      {t(activity[service.activity])}{service.busy && service.progress && <> · {t(states[service.progress.state])}</>}
    </p>
    {service.error && <p role="alert" className="runner-error">{tr(service.error)}</p>}
    {hubSelections && !!mapped?.unresolved.length &&
      <p role="status">{t('config.defaultsUnresolved', { fields: mapped.unresolved.join(', ') })}</p>}
    {current && <>
      <details className="config-verified"><summary>{t('config.actual')}</summary>
      <dl className="config-current">{Object.entries(fields).map(([field, key]) => <div key={field}>
        <dt>{t(key)}</dt><dd>{display(current[field as keyof ConfigSettings])}</dd></div>)}</dl>
      <p>{t('config.effective', { model: actual.effective.model, effort: actual.effective.reasoning_effort,
        tier: actual.effective.service_tier })}</p>
      <p>{t('config.next', { model: actual.effective.next_model, effort: actual.effective.next_reasoning_effort,
        tier: actual.effective.next_service_tier })}</p>
      {actual.setup_required && <p className="runner-error">{t('config.setupRequired')}</p>}
      {!!actual.constraints.length && <ul>{actual.constraints.map(code => <li key={code}><Diagnostic code={code} /></li>)}</ul>}
      </details>
      {!catalog && <p>{t('config.incomplete')} {t('config.terminalHelp')}</p>}
    </>}
    <div className="config-actions"><button type="button" disabled={service.busy || !connected || control.assignmentLocked || !service.supports('plan')}
      onClick={() => void planRequested()}>{t('config.plan')}</button></div>
    {plan && <section className="config-plan" aria-label={t('config.planResult')}>
      <h3>{t(plan.plan_status === 'ready' ? 'config.ready' : plan.plan_status === 'invalid' ? 'config.invalid' : 'config.confirmation')}</h3>
      <p>{t('config.planHelp')}</p>
      <dl>{Object.entries(plan.changes).map(([field, change]) => change && <div key={field}><dt>{t(fields[field as keyof ConfigSettings])}</dt>
        <dd>{display(change.from)} → {display(change.to)}</dd></div>)}</dl>
      {Object.keys(plan.changes).length === 0 && <p>{t('config.noChanges')}</p>}
      {[...plan.errors, ...plan.required_confirmations].map((code, i) => <p key={`${i}/${code}`}><Diagnostic code={code} /></p>)}
      <details><summary>{t('config.impact')}</summary><pre>{JSON.stringify(plan.impact, null, 2)}</pre></details>
      <button type="button" disabled={!service.canApply || control.assignmentLocked} onClick={() => void service.apply()}>{t('config.apply')}</button>
    </section>}
    {service.applications.map((application, index) => <section className="config-receipt" key={index} aria-label={t('config.receipts')}>
      <h3>{t('config.receipts')} · {t(application.result ? applyStatuses[application.result.apply_status] : states[application.receipt.state])}</h3>
      {application.result && <>
        <p>{t(application.result.apply_status === 'applied' ? 'config.applied' : application.result.apply_status === 'partial'
          ? 'config.partial' : application.result.apply_status === 'cancelled' ? 'config.cancelled'
            : application.result.apply_status === 'unknown' ? 'config.unknown' : application.result.apply_status === 'rejected' ? 'config.rejected' : 'config.failure')}</p>
        <ul>{application.result.results.map(r => <li key={r.setting}>{t(fields[r.setting])}: {t(outcomes[r.outcome])}
          {r.committed && <> · {display(r.committed)}</>}{r.code && <> · <Diagnostic code={r.code} /></>}
          {r.codes?.map(code => <Diagnostic key={code} code={code} />)}</li>)}</ul>
        {application.result.code && <p><Diagnostic code={application.result.code} /></p>}
        {application.result.inspection_unavailable && <p>{t('config.ownerInspectUnavailable')}</p>}
      </>}
      <p>{t(application.verification === 'verified' ? 'config.verified' : application.verification === 'pending'
        ? 'config.verifying' : application.verification === 'unknown' ? 'config.receiptUnknown' : 'config.finalUnavailable')}</p>
    </section>)}
  </details>;
}
