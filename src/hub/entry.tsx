import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../style.css';
import { Hub } from './Hub';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Web App requires an #app element.');

const root = createRoot(app);
root.render(<StrictMode><Hub /></StrictMode>);
import.meta.hot?.dispose(() => root.unmount());
