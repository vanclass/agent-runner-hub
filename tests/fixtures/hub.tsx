import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Hub } from '../../src/hub/Hub';
import type { RunnerView } from '../../src/hub/model';
import '../../src/style.css';

// Shell-only fixture: simulated verification, with no process or native picker acceptance.
Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
  invoke: async (command: string) => {
    if (command === 'runner_resolve') return { root: '/fixture/install', python: '/fixture/python' };
    throw new Error('Shell fixture has no native process');
  },
} });
localStorage.setItem('agent-runner-hub.installation', '/fixture/install');

const runners: readonly RunnerView[] = Object.freeze([
  Object.freeze({ id: 'second', projectId: 'project-b', sessionId: 'session-b', createdOrder: 2,
    name: 'A very long Runner name that must remain intact when truncated in the sidebar', status: 'running' as const }),
  Object.freeze({ id: 'first', projectId: 'project-a', sessionId: 'session-a', createdOrder: 1,
    name: 'Plan the desktop shell', status: 'idle' as const }),
  Object.freeze({ id: 'third', projectId: 'project-c', sessionId: 'session-c', createdOrder: 3,
    name: 'Review the changes', status: 'attention' as const }),
  ...Array.from({ length: 20 }, (_, index): RunnerView => Object.freeze({ id: `extra-${index}`,
    projectId: `project-${index}`, sessionId: `session-${index}`, createdOrder: index + 4,
    name: `Additional Runner ${index + 1}`, status: 'disconnected' })),
]);
createRoot(document.getElementById('app')!).render(<StrictMode><Hub initialRunners={runners} /></StrictMode>);
