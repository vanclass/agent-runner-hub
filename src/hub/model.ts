import type { HubText } from './i18n';
import type { WorkActivity } from './runnerWork';

export type RunnerView = {
  readonly id: string;
  readonly createdOrder: number;
  readonly name: string;
  readonly status: 'idle' | 'running' | 'attention' | 'disconnected' | 'starting' | 'exited' | 'failed';
  readonly canSubmit?: boolean;
  readonly exitCode?: number | null;
  readonly detail?: HubText;
  readonly draft?: string;
  readonly submitting?: boolean;
  readonly activity?: WorkActivity;
  readonly unreadCompletion?: boolean;
  readonly closing?: boolean;
};
