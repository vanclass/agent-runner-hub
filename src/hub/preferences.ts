import type { EntryDefaults } from './singleEntry';
import { msg, errorText, type HubText } from './i18n';

export type HubLanguage = 'en' | 'ko';
export type HubTheme = 'light' | 'black';
export type HubPreferencesValue = { version: 1; language: HubLanguage; theme: HubTheme; singleEntry: EntryDefaults };
export const hubPreferencesKey = 'agent-runner-hub.preferences.v1';
export const defaultHubPreferences = (): HubPreferencesValue => ({ version: 1, language: 'en', theme: 'light', singleEntry: {} });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 256
  && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

// Only the nonsecret selection projection crosses the preferences boundary.
export function projectEntryDefaults(value: unknown): EntryDefaults | undefined {
  if (!object(value) || !keys(value, ['target', 'model', 'account', 'runMode', 'accountIdentity', 'root', 'allocationPolicy'])) return;
  const result: EntryDefaults = {};
  if (value.allocationPolicy !== undefined) {
    if (value.allocationPolicy !== 'always-new' && value.allocationPolicy !== 'reuse-idle') return;
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
  for (const key of ['account', 'runMode'] as const) {
    if (value[key] !== undefined) { if (!text(value[key])) return; result[key] = value[key]; }
  }
  return result;
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
      if (!object(value) || !keys(value, ['version', 'language', 'theme', 'singleEntry']) || value.version !== 1
        || (value.language !== 'en' && value.language !== 'ko') || (value.theme !== 'light' && value.theme !== 'black')) {
        this.retainOriginal(); return;
      }
      const singleEntry = projectEntryDefaults(value.singleEntry);
      if (!singleEntry) { this.retainOriginal(); return; }
      this.value = { version: 1, language: value.language as HubLanguage, theme: value.theme as HubTheme, singleEntry };
    } catch (reason) {
      this.writable = false;
      this.issue = msg('preferences.loadFailed', { diagnostic: errorText(reason) });
    }
  }
  private retainOriginal() { this.writable = false; this.issue = msg('preferences.invalid'); }
  update(change: Partial<Pick<HubPreferencesValue, 'language' | 'theme' | 'singleEntry'>>) {
    const singleEntry = projectEntryDefaults(change.singleEntry ?? this.value.singleEntry);
    if (!singleEntry) return;
    this.value = { ...this.value, ...change, singleEntry };
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
