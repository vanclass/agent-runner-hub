/// <reference types="vite/client" />
import './style.css';

type CreateGame = (container: HTMLElement) => { destroy: (removeCanvas: boolean) => void };
type Provider = { mount?: (container: HTMLElement, createGame?: CreateGame) => void; createGame?: CreateGame };
const providers = import.meta.glob<Provider>('./frameworks/{react.tsx,phaser.ts}', { eager: true });
const app = document.querySelector<HTMLElement>('#app');
const react = providers['./frameworks/react.tsx'];
const phaser = providers['./frameworks/phaser.ts'];

if (!app) throw new Error('Web App requires an #app element.');
if (react?.mount) {
  react.mount(app, phaser?.createGame);
} else {
  const counter = app.querySelector<HTMLButtonElement>('#counter');
  let count = 0;
  counter?.addEventListener('click', () => { counter.textContent = `Count: ${++count}`; });
  if (phaser?.createGame) {
    const container = document.createElement('div');
    container.id = 'game';
    app.append(container);
    const game = phaser.createGame(container);
    import.meta.hot?.dispose(() => game.destroy(true));
  }
}
