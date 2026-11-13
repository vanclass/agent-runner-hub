/** Display names only; Runner protocol and persisted mode IDs stay unchanged. */
export function runModeLabel(mode: string): string {
  switch (mode) {
    case 'pure-direct-run': return 'Pure Direct Run';
    case 'direct-run': return 'Direct Run';
    case 'task-run': return 'Task Run';
    case 'issue-run': return 'Issue Run';
    case 'subagent-run': return 'Subagent Run';
    default: return mode;
  }
}
