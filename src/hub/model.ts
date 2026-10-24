export type RunnerView = {
  readonly id: string;
  readonly createdOrder: number;
  readonly name: string;
  readonly status: 'idle' | 'running' | 'attention' | 'disconnected' | 'starting' | 'exited' | 'failed';
  readonly canSubmit?: boolean;
  readonly exitCode?: number | null;
  readonly detail?: string;
  readonly draft?: string;
  readonly submitting?: boolean;
};
