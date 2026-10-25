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

export class RunnerWorkspace {
  issue = '';
  private writable = true;
  private committed?: string;
  load(): RunnerTabRecord[] {
    try {
      const raw = localStorage.getItem(runnerWorkspaceKey);
      if (raw === null) return [];
      const value: unknown = JSON.parse(raw);
      if (!object(value) || value.version !== 1 || !Array.isArray(value.tabs)) throw new Error('Unsupported or malformed workspace schema');
      const ids = new Set<string>(), orders = new Set<number>();
      const tabs: RunnerTabRecord[] = [];
      value.tabs.forEach((candidate, index) => {
        const tab = record(candidate);
        if (!tab || ids.has(tab.id.toLowerCase()) || orders.has(tab.createdOrder)) {
          this.issue += ` Saved tab ${index + 1} has invalid or duplicate metadata and was skipped.`;
          return;
        }
        // Freeze the prior process's context before any replacement observations can arrive.
        // Older version-1 tabs have only lastVerified; an existing hint always wins.
        const recoveryHint = tab.recoveryHint ?? tab.lastVerified;
        ids.add(tab.id.toLowerCase()); orders.add(tab.createdOrder);
        tabs.push({ ...tab, ...(recoveryHint ? { recoveryHint } : {}) });
      });
      return tabs.sort((a, b) => a.createdOrder - b.createdOrder);
    } catch (reason) {
      this.writable = false;
      this.issue = `Workspace restoration unavailable: ${String(reason)}. Saved data was retained.`;
      return [];
    }
  }
  save(tabs: readonly RunnerTabRecord[]) {
    if (!this.writable) return;
    const projected = tabs.map(tab => record(tab));
    if (projected.some(tab => !tab)) {
      this.issue = 'Workspace save failed: invalid tab metadata. The last committed layout is retained.';
      return;
    }
    const raw = JSON.stringify({ version: 1, tabs: projected });
    if (raw === this.committed) return;
    try {
      // One atomic storage replacement leaves the previous committed layout intact on failure.
      localStorage.setItem(runnerWorkspaceKey, raw);
      this.committed = raw;
      if (this.issue.startsWith('Workspace save failed:')) this.issue = '';
    } catch (reason) { this.issue = `Workspace save failed: ${String(reason)}. The last committed layout is retained.`; }
  }
}
