import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Hub } from '../hub/Hub';

type CreateGame = (container: HTMLElement) => { destroy: (removeCanvas: boolean) => void };

export function mount(container: HTMLElement, _createGame?: CreateGame) {
  const root = createRoot(container);
  root.render(<StrictMode><Hub /></StrictMode>);
  import.meta.hot?.dispose(() => root.unmount());
}
