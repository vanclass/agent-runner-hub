import { useHubTranslation, t } from './i18n';
import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { HubLogView } from './HubLogView';
import type { HubLog } from './HubLog';
import { RunnerComposer } from './RunnerComposer';
import { RunnerInteractionPanel } from './RunnerInteractionPanel';
import { RunnerImagePreviews } from './RunnerImagePreviews';
import type { RunnerInstallation } from './runnerInstallation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer } from './SingleEntryComposer';

export function Workspace({ runner, session, theme, installation, entry, onSelectRunner, hubLog }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
  hubLog: HubLog;
}) {
  useHubTranslation();
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? t('workspace.singleLabel') : t('workspace.runnerLabel')}>
    <section className="output" aria-label={t('workspace.outputLabel')}>
      {singleEntry && <HubLogView log={hubLog} />}
      {session ? <RunnerTerminal session={session} theme={theme} /> : !singleEntry && <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">›_</div>
        <h2>{t('workspace.connection')}</h2>
        <p>{t('workspace.noStream')}</p>
        <span className="empty-note">{t('workspace.previewDisconnected')}</span>
      </div>}
    </section>
    {session && <div className="workspace-context">
      <RunnerImagePreviews images={session.control.images} />
    </div>}
    {session && !runner?.closing && <RunnerInteractionPanel key={session.view.id} interaction={session.control.interaction}
      results={session.control.snapshot.results} />}
    {session ? <RunnerComposer session={session} /> : singleEntry ? <SingleEntryComposer entry={entry}
      location={installation?.root} onSelectRunner={onSelectRunner} /> : <section className="composer-area" aria-label={t('composer.label')}>
        <div className="composer"><textarea aria-label={t('composer.runnerInstructions')} disabled rows={3} />
        </div><p className="composer-note">{t('workspace.attachmentsUnavailable')}</p></section>}
  </main>;
}
