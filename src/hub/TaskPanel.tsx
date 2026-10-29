import { useEffect, useRef, useState } from 'react';
import { useHubTranslation } from './i18n';
import type { RunnerControl } from './runnerControl';
import type { SingleEntry } from './singleEntry';
import { SingleEntrySettings, HubSelectionSettings } from './SingleEntryComposer';
import type { HubSelections } from './HubSelections';
import { RunnerConfigPanel } from './RunnerConfigPanel';
import './taskPanel.css';

/** Presentation only: preferences and each Runner retain their own settings state. */
export function TaskPanel({ entry, control, scope, selections }: {
  entry: SingleEntry; control?: RunnerControl; scope: string; selections?: HubSelections;
}) {
  const { t } = useHubTranslation();
  const [collapsed, setCollapsed] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const resize = () => {
      if (media.matches && panel.current?.contains(document.activeElement)) toggle.current?.focus();
      setCollapsed(media.matches);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  return <aside ref={panel} className={`task-panel${collapsed ? ' collapsed' : ''}`} aria-label={t('panel.title')}>
    <button ref={toggle} type="button" className="task-panel-toggle" aria-expanded={!collapsed}
      aria-controls="task-panel-body" onClick={() => setCollapsed(value => !value)}>
      <span aria-hidden="true">{collapsed ? '‹' : '›'}</span><span>{t('panel.title')}</span>
    </button>
    <div id="task-panel-body" className="task-panel-body" hidden={collapsed}>
      <div key={scope}>
        {control ? <>{selections && <HubSelectionSettings entry={selections} />}<RunnerConfigPanel control={control} /></>
          : scope === 'single-entry' ? <SingleEntrySettings entry={entry} /> : <p>{t('common.notConnected')}</p>}
      </div>
    </div>
  </aside>;
}
