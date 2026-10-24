export type RunnerView = {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly createdOrder: number;
  readonly name: string;
  readonly status: 'idle' | 'running' | 'attention' | 'disconnected';
};
