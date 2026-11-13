import type { EntryDefaults } from './singleEntry';
import type { DomainDisplay } from './RunnerNavigation';
import { defaultRetentionDays, validRetentionDays } from './HubLog';
import { msg, errorText, type HubText } from './i18n';
import { projectShortcuts, restoreShortcuts, type ShortcutMap } from './shortcuts';

export type HubLanguage = 'en' | 'ko';
export type HubTheme = 'light' | 'black';
export type HubPreferencesValue = { version: 1; language: HubLanguage; theme: HubTheme; singleEntry: EntryDefaults;
  runnerSelections?: Record<string, EntryDefaults>; confirmRunnerRemoval: boolean; shortcuts?: ShortcutMap; domainDisplay?: DomainDisplay; hubLogRetentionDays?: number };
export const hubPreferencesKey = 'agent-runner-hub.preferences.v1';
export const defaultHubPreferences = (): HubPreferencesValue => ({ version: 1, language: 'en', theme: 'light', singleEntry: {}, confirmRunnerRemoval: true });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 256
  && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

// Only the nonsecret selection projection crosses the preferences boundary.
export function projectEntryDefaults(value: unknown): EntryDefaults | undefined {
  if (!object(value) || !keys(value, ['target', 'model', 'account', 'runMode', 'accountIdentity', 'root', 'allocationPolicy', 'initialized'])) return;
  const result: EntryDefaults = {};
  if (value.initialized !== undefined) {
    if (value.initialized !== true) return;
    result.initialized = true;
  }
  if (value.allocationPolicy !== undefined) {
    if (value.allocationPolicy !== 'always-new' && value.allocationPolicy !== 'reuse-idle'
      && value.allocationPolicy !== 'reuse-same-mode') return;
    result.allocationPolicy = value.allocationPolicy;
  }
  if (value.accountIdentity !== undefined) {
    const account = value.accountIdentity;
    if (!object(account) || !keys(account, ['agent_id', 'profile_name']) || !text(account.agent_id) || !text(account.profile_name)) return;
    result.accountIdentity = { agent_id: account.agent_id, profile_name: account.profile_name };
  }
  if (value.root !== undefined) {
    if (typeof value.root !== 'string' || !value.root.trim() || value.root.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.root)) return;
    result.root = value.root;
  }
  if (value.target !== undefined) {
    const target = value.target;
    if (!object(target) || !keys(target, ['binding_state', 'owner', 'project'])
      || !text(target.binding_state) || typeof target.owner !== 'string' || typeof target.project !== 'string'
      || (target.owner !== '' && !text(target.owner)) || (target.project !== '' && !text(target.project))) return;
    result.target = { binding_state: target.binding_state, owner: target.owner, project: target.project };
  }
  if (value.model !== undefined) {
    const model = value.model;
    if (!object(model) || !keys(model, ['model', 'reasoning_effort', 'service_tier'])
      || !text(model.model) || !text(model.reasoning_effort) || !text(model.service_tier)) return;
    result.model = { model: model.model, reasoning_effort: model.reasoning_effort, service_tier: model.service_tier };
  }
  for (const key of ['runMode'] as const) {
    if (value[key] !== undefined) { if (!text(value[key])) return; result[key] = value[key]; }
  }
  // A previously populated saved selection must not become a fresh auto-initialization.
  if (Object.keys(value).length > 0 && (Object.keys(result).length === 0
    || Object.hasOwn(value, 'account') && Object.keys(result).every(key => ['allocationPolicy', 'root'].includes(key))))
    result.initialized = true;
  return result;
}

function projectRunnerSelections(value: unknown): Record<string, EntryDefaults> | undefined {
  if (!object(value)) return;
  const entries: [string, EntryDefaults][] = [];
  for (const [id, candidate] of Object.entries(value)) {
    const selections = projectEntryDefaults(candidate);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !selections) return;
    entries.push([id, selections]);
  }
  return Object.fromEntries(entries);
}

export class HubPreferences {
  value = defaultHubPreferences();
  issue: HubText = '';
  private writable = true;
  private committed: string | null = null;
  constructor() {
    try {
      const raw = localStorage.getItem(hubPreferencesKey);
      this.committed = raw;
      if (raw === null) return;
      const value: unknown = JSON.parse(raw);
      if (!object(value) || !keys(value, ['version', 'language', 'theme', 'singleEntry', 'runnerSelections', 'confirmRunnerRemoval', 'shortcuts', 'domainDisplay', 'hubLogRetentionDays']) || value.version !== 1
        || (value.hubLogRetentionDays !== undefined && !validRetentionDays(value.hubLogRetentionDays))
        || (value.domainDisplay !== undefined && !['unified', 'run-mode'].includes(String(value.domainDisplay)))
        || (value.confirmRunnerRemoval !== undefined && typeof value.confirmRunnerRemoval !== 'boolean')
        || (value.language !== 'en' && value.language !== 'ko') || (value.theme !== 'light' && value.theme !== 'black')) {
        this.retainOriginal(); return;
      }
      const singleEntry = projectEntryDefaults(value.singleEntry);
      if (!singleEntry) { this.retainOriginal(); return; }
      const runnerSelections = value.runnerSelections === undefined ? undefined : projectRunnerSelections(value.runnerSelections);
      if (value.runnerSelections !== undefined && !runnerSelections) { this.retainOriginal(); return; }
      const shortcuts = value.shortcuts === undefined ? undefined : restoreShortcuts(value.shortcuts);
      this.value = { version: 1, language: value.language as HubLanguage, theme: value.theme as HubTheme, singleEntry,
        ...(value.hubLogRetentionDays !== undefined ? { hubLogRetentionDays: value.hubLogRetentionDays as number } : {}),
        ...(value.domainDisplay ? { domainDisplay: value.domainDisplay as DomainDisplay } : {}),
        confirmRunnerRemoval: value.confirmRunnerRemoval !== false,
        ...(runnerSelections ? { runnerSelections } : {}), ...(shortcuts ? { shortcuts } : {}) };
    } catch (reason) {
      this.writable = false;
      this.issue = msg('preferences.loadFailed', { diagnostic: errorText(reason) });
    }
  }
  private retainOriginal() { this.writable = false; this.issue = msg('preferences.invalid'); }
  saveRunner(id: string, value: EntryDefaults) {
    this.update({ runnerSelections: { ...this.value.runnerSelections, [id]: value } });
  }
  forgetRunner(id: string) {
    const runnerSelections = { ...this.value.runnerSelections };
    delete runnerSelections[id];
    this.update({ runnerSelections });
  }
  get logRetentionDays() { return this.value.hubLogRetentionDays ?? defaultRetentionDays; }
  update(change: Partial<Pick<HubPreferencesValue, 'language' | 'theme' | 'singleEntry' | 'runnerSelections' | 'confirmRunnerRemoval' | 'shortcuts' | 'domainDisplay' | 'hubLogRetentionDays'>>) {
    if (change.hubLogRetentionDays !== undefined && !validRetentionDays(change.hubLogRetentionDays)) return;
    if (change.domainDisplay !== undefined && !['unified', 'run-mode'].includes(change.domainDisplay)) return;
    const singleEntry = projectEntryDefaults(change.singleEntry ?? this.value.singleEntry);
    if (!singleEntry) return;
    const runnerSelections = change.runnerSelections === undefined ? undefined : projectRunnerSelections(change.runnerSelections);
    if (change.runnerSelections !== undefined && !runnerSelections) return;
    const shortcuts = change.shortcuts === undefined ? this.value.shortcuts : projectShortcuts(change.shortcuts);
    if (change.shortcuts !== undefined && !shortcuts) return;
    this.value = { ...this.value, ...change, singleEntry, ...(runnerSelections ? { runnerSelections } : {}),
      ...(shortcuts ? { shortcuts } : {}) };
    if (!this.writable) return;
    const raw = JSON.stringify(this.value);
    if (raw === this.committed) return;
    try {
      // Do not replace data modified by another window after this store loaded it.
      if (localStorage.getItem(hubPreferencesKey) !== this.committed) { this.retainOriginal(); return; }
      localStorage.setItem(hubPreferencesKey, raw);
      this.committed = raw;
      this.issue = '';
    } catch (reason) { this.issue = msg('preferences.saveFailed', { diagnostic: errorText(reason) }); }
  }
}
