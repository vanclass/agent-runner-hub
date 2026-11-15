import { t, useHubTranslation, type MessageKey } from './i18n';
import type { HubSelections } from './HubSelections';
import type { RunnerConfigService } from './RunnerConfigService';
import { isPlan } from './runnerConfigContract';
import './hubActivity.css';

type SelectionActivity = Pick<HubSelections, 'loadingOptions' | 'detail'>;
type ConfigActivity = Pick<RunnerConfigService, 'activity' | 'busy' | 'presentedProgress' | 'presentedRequests' | 'presentedApplications' | 'presentedError' | 'plan'>;

export function hubActivityKey(selections?: SelectionActivity, config?: ConfigActivity): MessageKey | undefined {
  const progress = config?.presentedProgress;
  if (config?.busy) {
    if (progress && progress.phase !== 'completed') {
      if (progress.state === 'queued' || progress.state === 'accepted') return 'activity.queued';
      if (progress.state === 'pending-interaction') return 'activity.interaction';
      if (progress.state === 'sending') return 'activity.sending';
    }
    switch (config.activity) {
      case 'inspecting': return 'activity.inspecting';
      case 'catalog': return 'activity.catalog';
      case 'planning': return 'activity.planning';
      case 'applying': return 'activity.applying';
      case 'verifying': return 'activity.verifying';
    }
  }
  if (selections?.loadingOptions) return 'activity.options';
  const planReceipt = config?.presentedRequests?.filter(r => r.operation === 'session_config.plan').at(-1);
  const plan = config?.plan ?? (planReceipt?.phase === 'completed' && isPlan(planReceipt.reply) ? planReceipt.reply : undefined);
  if (plan?.plan_status === 'confirmation_required') return 'activity.interaction';
  if (plan?.plan_status === 'invalid') return 'activity.rejected';
  const application = config?.presentedApplications.at(-1);
  if (application) {
    const { receipt, result, verification } = application;
    if (receipt.state === 'not-sent') return 'activity.notSent';
    if (receipt.state === 'rejected' || receipt.admission === 'rejected') return 'activity.rejected';
    if (receipt.state === 'failure' && !result) return 'activity.failure';
    if (verification === 'unknown' || result?.outcome_unknown || result?.apply_status === 'unknown') return 'activity.unknown';
    if (result?.apply_status === 'partial') return 'activity.partial';
    if (result?.apply_status === 'rejected') return 'activity.rejected';
    if (result?.apply_status === 'failed' || result?.apply_status === 'cancelled') return 'activity.failure';
    if (verification === 'unavailable' || result?.inspection_unavailable) return 'activity.finalUnavailable';
    if (result?.apply_status === 'applied' && verification === 'verified') return 'activity.success';
    return 'activity.verifying';
  }
  if (selections?.detail) {
    const key = typeof selections.detail === 'string' ? '' : selections.detail.key;
    switch (key) {
      case 'config.chooseTarget': return 'activity.chooseTarget';
      case 'config.defaultsUnresolved': return 'activity.defaultsUnresolved';
      case 'config.incomplete': return 'activity.incomplete';
      case 'config.unsupported': return 'activity.unsupported';
      default: return 'activity.inspectionFailed';
    }
  }
  if (config?.presentedError) {
    if (progress?.state === 'not-sent') return 'activity.notSent';
    if (progress?.state === 'rejected') return 'activity.rejected';
    if (progress?.state === 'outcome-unknown') return 'activity.unknown';
    return 'activity.failure';
  }
  return undefined;
}

export function HubActivity({ selections, config }: { selections?: SelectionActivity; config?: ConfigActivity }) {
  useHubTranslation();
  const key = hubActivityKey(selections, config);
  return <div className="hub-activity" role="status" aria-live="polite" aria-atomic="true">
    {key && <span className="hub-activity-message">{t('activity.label')} {t(key)}</span>}
  </div>;
}
