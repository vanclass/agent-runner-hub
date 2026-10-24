import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type CreateGame = (container: HTMLElement) => { destroy: (removeCanvas: boolean) => void };

function GameCanvas({ createGame }: { createGame: CreateGame }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const game = createGame(container.current);
    return () => game.destroy(true);
  }, [createGame]);
  return <div id="game" ref={container} />;
}

function App({ createGame }: { createGame?: CreateGame }) {
  const [count, setCount] = useState(0);
  const [showGame, setShowGame] = useState(true);
  return <>
    <p className="eyebrow">YOUR NEXT IDEA STARTS HERE</p>
    <h1>Web App</h1>
    <p>Built with TypeScript + Vite + React{createGame ? ' + Phaser' : ''}.</p>
    <button id="counter" onClick={() => setCount(value => value + 1)}>Count: {count}</button>
    {createGame && <>
      <button id="toggle-game" onClick={() => setShowGame(value => !value)}>
        {showGame ? 'Hide game' : 'Show game'}
      </button>
      {showGame && <GameCanvas createGame={createGame} />}
    </>}
    <p className="hint">Edit src/frameworks/react.tsx and watch your changes appear.</p>
  </>;
}

export function mount(container: HTMLElement, createGame?: CreateGame) {
  const root = createRoot(container);
  root.render(<StrictMode><App createGame={createGame} /></StrictMode>);
  import.meta.hot?.dispose(() => root.unmount());
}
