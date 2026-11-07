import { msg, errorText, HubError, type HubText } from './i18n';
import { emptyPresentation, type NavigationPresentation } from './RunnerNavigation';
import { runModes } from './runnerWork';
export type VerifiedContext = {
  target: { binding_state: string; owner: string; project: string };
  runMode: string;
  workflowKind: string;
};
export type RunnerTabRecord = {
  id: string;
  name: string;
  createdOrder: number;
  installationRoot: string;
  launchOnOpen: boolean;
  lastVerified?: VerifiedContext;
  recoveryHint?: VerifiedContext;
};
export const runnerWorkspaceKey = 'agent-runner-hub.workspace.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown): value is string => typeof value === 'string'
  && !/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function context(value: unknown): VerifiedContext | undefined {
  if (!object(value) || !object(value.target)) return;
  const { binding_state, owner, project } = value.target;
  if (![binding_state, owner, project, value.runMode, value.workflowKind].every(text)) return;
  return { target: { binding_state, owner, project }, runMode: value.runMode, workflowKind: value.workflowKind } as VerifiedContext;
}
function record(value: unknown): RunnerTabRecord | undefined {
  if (!object(value) || !text(value.id) || !uuid.test(value.id) || !text(value.name) || !value.name.trim()
    || !Number.isSafeInteger(value.createdOrder) || (value.createdOrder as number) < 1
    || !text(value.installationRoot) || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(value.installationRoot)
    || typeof value.launchOnOpen !== 'boolean') return;
  const lastVerified = value.lastVerified === undefined ? undefined : context(value.lastVerified);
  if (value.lastVerified !== undefined && !lastVerified) return;
  const recoveryHint = value.recoveryHint === undefined ? undefined : context(value.recoveryHint);
  if (value.recoveryHint !== undefined && !recoveryHint) return;
  // Explicit projection: process/control identities, drafts and instructions never cross this boundary.
  return { id: value.id, name: value.name, createdOrder: value.createdOrder as number,
    installationRoot: value.installationRoot, launchOnOpen: value.launchOnOpen,
    ...(lastVerified ? { lastVerified } : {}), ...(recoveryHint ? { recoveryHint } : {}) };
}

function presentation(value: unknown, tabs: readonly RunnerTabRecord[]): NavigationPresentation | undefined {
  if (!object(value) || Object.keys(value).some(k => !['executedModes', 'order', 'affinities'].includes(k))
    || !Array.isArray(value.executedModes) || !Array.isArray(value.order) || !object(value.affinities)
    || value.executedModes.some(m => !runModes.includes(m))
    || new Set(value.executedModes).size !== value.executedModes.length
    || value.order.some(id => typeof id !== 'string' || !uuid.test(id))
    || new Set(value.order).size !== value.order.length) return;
  const ids = new Set(tabs.map(tab => tab.id));
  const affinities: NavigationPresentation['affinities'] = {};
  for (const [id, mode] of Object.entries(value.affinities)) {
    if (!uuid.test(id) || !runModes.includes(mode as typeof runModes[number])) return;
    if (ids.has(id)) affinities[id] = mode as typeof runModes[number];
  }
  return { executedModes: [...value.executedModes], order: value.order.filter(id => ids.has(id)), affinities };
}

export class RunnerWorkspace {
  presentation = emptyPresentation();
  issue: HubText = '';
  private saveFailed = false;
  private writable = true;
  private committed?: string;
  load(): RunnerTabRecord[] {
    try {
      const raw = localStorage.getItem(runnerWorkspaceKey);
      if (raw === null) return [];
      const value: unknown = JSON.parse(raw);
      if (!object(value) || value.version !== 1 || !Array.isArray(value.tabs)) throw new HubError(msg('runtime.workspace.unsupported'));
      const ids = new Set<string>(), orders = new Set<number>();
      const tabs: RunnerTabRecord[] = [];
      value.tabs.forEach((candidate, index) => {
        const tab = record(candidate);
        if (!tab || ids.has(tab.id.toLowerCase()) || orders.has(tab.createdOrder)) {
          this.issue = msg('runtime.workspace.skipped', { previous: this.issue, index: index + 1 });
          return;
        }
        // Freeze the prior process's context before any replacement observations can arrive.
        // Current producers can write only lastVerified; an existing hint always wins.
        const recoveryHint = tab.recoveryHint ?? tab.lastVerified;
        ids.add(tab.id.toLowerCase()); orders.add(tab.createdOrder);
        tabs.push({ ...tab, ...(recoveryHint ? { recoveryHint } : {}) });
      });
      if (value.presentation !== undefined) {
        const projected = presentation(value.presentation, tabs);
        if (!projected) throw new HubError(msg('runtime.workspace.unsupported'));
        this.presentation = projected;
      }
      return tabs.sort((a, b) => a.createdOrder - b.createdOrder);
    } catch (reason) {
      this.writable = false;
      this.issue = msg('runtime.workspace.loadFailed', { diagnostic: errorText(reason) });
      return [];
    }
  }
  save(tabs: readonly RunnerTabRecord[], navigation = this.presentation) {
    if (!this.writable) return false;
    const projected = tabs.map(tab => record(tab));
    if (projected.some(tab => !tab)) {
      this.saveFailed = true;
      this.issue = msg('runtime.workspace.invalidTabSave');
      return false;
    }
    const metadata = presentation(navigation, tabs);
    if (!metadata) return false;
    const raw = JSON.stringify({ version: 1, tabs: projected, presentation: metadata });
    if (raw === this.committed) return true;
    try {
      // One atomic storage replacement leaves the previous committed layout intact on failure.
      localStorage.setItem(runnerWorkspaceKey, raw);
      this.presentation = metadata;
      this.committed = raw;
      if (this.saveFailed) { this.issue = ''; this.saveFailed = false; }
      return true;
    } catch (reason) {
      this.saveFailed = true;
      this.issue = msg('runtime.workspace.saveFailed', { diagnostic: errorText(reason) });
      return false;
    }
  }
}
