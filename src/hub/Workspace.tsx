import { useHubTranslation, t } from './i18n';
import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal, type FailureActions } from './RunnerTerminal';
import { HubLogView } from './HubLogView';
import type { HubLog } from './HubLog';
import { RunnerComposer } from './RunnerComposer';
import { RunnerImagePreviews } from './RunnerImagePreviews';
import { RunnerQuickSettings } from './RunnerQuickSettings';
import type { RunnerInstallation } from './runnerInstallation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer } from './SingleEntryComposer';
import { HubActivity } from './HubActivity';
import type { HubSelections } from './HubSelections';

export function Workspace({ runner, session, installation, entry, onSelectRunner, hubLog, selections,
  fileDropActive = false, fileDropUnavailable = false, failureActions }: {
  runner?: RunnerView; session?: RunnerSession;
  installation: RunnerInstallation | null;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
  hubLog: HubLog;
  selections?: HubSelections;
  fileDropActive?: boolean; fileDropUnavailable?: boolean;
  failureActions?: FailureActions;
}) {
  useHubTranslation();
  const singleEntry = !runner;
  return <main className={`workspace${fileDropActive ? ' attachment-drop-active' : ''}`} aria-label={singleEntry ? t('workspace.singleLabel') : t('workspace.runnerLabel')}>
    {fileDropActive && <div className="attachment-drop-hint" role="status">
      {t(singleEntry ? 'attachments.dropEntry' : 'attachments.dropRunner')}
    </div>}
    {fileDropUnavailable && <p className="attachment-drop-hint" role="alert">{t('attachments.fallback')}</p>}
    <section className="output" aria-label={t('workspace.outputLabel')}>
      {singleEntry && <HubLogView log={hubLog} />}
      {session ? <RunnerTerminal session={session} failureActions={failureActions} /> : !singleEntry && <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">›_</div>
        <h2>{t('workspace.connection')}</h2>
        <p>{t('workspace.noStream')}</p>
        <span className="empty-note">{t('workspace.previewDisconnected')}</span>
      </div>}
    </section>
    {session && !singleEntry && <RunnerQuickSettings key={session.control.sessionId ?? session.view.id} session={session} />}
    {session && <div className="workspace-context">
      <RunnerImagePreviews images={session.control.images} />
    </div>}
    {session ? <RunnerComposer session={session} /> : singleEntry ? <SingleEntryComposer entry={entry}
      location={installation?.root} onSelectRunner={onSelectRunner} /> : <section className="composer-area" aria-label={t('composer.label')}>
        <div className="composer"><textarea aria-label={t('composer.runnerInstructions')} disabled rows={3} />
        </div><p className="composer-note">{t('workspace.attachmentsUnavailable')}</p></section>}
    <HubActivity selections={singleEntry ? entry.selections : selections} config={singleEntry ? undefined : session?.control.config} />
  </main>;
}
