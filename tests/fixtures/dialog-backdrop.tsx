import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDialogBackdropDismiss } from '../../src/hub/useDialogBackdropDismiss';

function CallbackFixture() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState('original');
  const [calls, setCalls] = useState<string[]>([]);
  useDialogBackdropDismiss(dialog, () => {
    setCalls(previous => [...previous, version]);
    dialog.current?.close();
  });
  useEffect(() => {
    dialog.current!.showModal();
    return () => dialog.current!.close();
  }, []);
  useEffect(() => { dialog.current!.dataset.callbackReady = version; }, [version]);
  return <>
    <output aria-label="Dismissal calls">{JSON.stringify(calls)}</output>
    <dialog ref={dialog} aria-label="Callback fixture">
      <button onClick={() => setVersion('replacement')}>Replace callback</button>
    </dialog>
  </>;
}

createRoot(document.getElementById('app')!).render(<StrictMode><CallbackFixture /></StrictMode>);
