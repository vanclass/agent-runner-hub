import { HubDialog } from './HubDialog';
import { RunnerLocation } from './RunnerLocation';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import { t } from './i18n';
import { validRetentionDays } from './HubLog';
import { allocationOptions, domainOptions } from './applicationChoices';
import type { ApplicationPreferences } from './ApplicationMenu';

export function InstallationDialog({ installation, onVerified, onClose, setup }: Pick<ApplicationPreferences,
  'installation' | 'onVerified'> & {
  onClose: () => void;
  setup?: Pick<ApplicationPreferences, 'theme' | 'onTheme' | 'onLanguage' | 'retentionDays' | 'onRetentionDays'
    | 'domainDisplay' | 'onDomainDisplay' | 'confirmRemoval' | 'onConfirmRemoval'
    | 'allocationPolicy' | 'reuseEditable' | 'onAllocationPolicy'>;
}) {
  return <HubDialog className={setup ? 'installation-setup' : 'installation-dialog'} required={!!setup}
    title={t(setup ? 'setup.title' : 'location.installation')}
    description={t(setup ? 'setup.description' : 'setup.changeHelp')} onClose={onClose}>
    <RunnerLocation installation={installation} required={!!setup} onChange={onVerified} />
    {setup && <SetupPreferences {...setup} />}
  </HubDialog>;
}

function SetupPreferences(props: NonNullable<Parameters<typeof InstallationDialog>[0]['setup']>) {
  return <>
    <div className="app-appearance">
      <LanguagePicker onChange={props.onLanguage} />
      <ThemePicker theme={props.theme} onChange={props.onTheme} />
    </div>
    <label className="setup-preference">{t('hubLog.retention')}
      <input type="number" min="1" max="4294967295" step="1" defaultValue={props.retentionDays}
        onBlur={event => {
          const value = event.currentTarget.valueAsNumber;
          if (validRetentionDays(value)) props.onRetentionDays(value);
          else event.currentTarget.value = String(props.retentionDays);
        }} required />
    </label>
    <label className="setup-preference">{t('sidebar.domainDisplay')}
      <select value={props.domainDisplay} onChange={event => props.onDomainDisplay(event.target.value as typeof props.domainDisplay)}>
        {domainOptions.map(({ value, label }) => <option key={value} value={value}>{t(label)}</option>)}
      </select>
    </label>
    <label className="setup-preference">{t('tabs.confirmPreference')}
      <input type="checkbox" checked={props.confirmRemoval}
        onChange={event => props.onConfirmRemoval(event.target.checked)} />
    </label>
    <label className="setup-preference" title={t('work.allocationHelp')}>{t('work.allocationPolicy')}
      <select value={props.allocationPolicy} disabled={!props.reuseEditable} onChange={event =>
        props.onAllocationPolicy(event.target.value as typeof props.allocationPolicy)}>
        {allocationOptions.map(({ value, label }) => <option key={value} value={value}>{t(label)}</option>)}
      </select>
    </label>
  </>;
}
