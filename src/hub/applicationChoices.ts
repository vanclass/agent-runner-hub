export const domainOptions = [
  { value: 'unified', label: 'sidebar.unified' },
  { value: 'run-mode', label: 'sidebar.byMode' },
] as const;

export const allocationOptions = [
  { value: 'always-new', label: 'work.alwaysNew' },
  { value: 'reuse-same-mode', label: 'work.reuseSameMode' },
  { value: 'reuse-idle', label: 'work.reuseIdle' },
] as const;
