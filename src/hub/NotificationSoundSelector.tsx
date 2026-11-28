
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useHubTranslation } from './i18n';
import { listNotificationSounds, type NotificationSoundPlayer } from './notificationSoundPlayback';
import type { NotificationSound } from './notificationSounds';
import { useDialogBackdropDismiss } from './useDialogBackdropDismiss';
import './notificationSounds.css';

export function NotificationSoundSelector({ title, saved, player, onSelect, onClose }: {
  title: string; saved: NotificationSound; player: NotificationSoundPlayer;
  onSelect: (sound: NotificationSound) => void; onClose: () => void;
}) {
  const { t } = useHubTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [sounds, setSounds] = useState<NotificationSound[]>([null]);
  const [candidate, setCandidate] = useState(saved);
  const [listing, setListing] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [previewFailed, setPreviewFailed] = useState(false);
  const index = sounds.indexOf(candidate);

  function close() {
    player.stop();
    onClose();
  }
  useDialogBackdropDismiss(dialog, close);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    list.current?.focus();
    return () => {
      player.stop();
      element.close();
    };
  }, [player]);
  useEffect(() => {
    let open = true;
    void listNotificationSounds().then(files => {
      if (!open) return;
      setSounds([null, ...files.sort((a, b) => a.localeCompare(b))]);
      setCandidate(current => current === null || files.includes(current) ? current : null);
      setListing('ready');
    }, () => {
      if (!open) return;
      setCandidate(null);
      setListing('failed');
    });
    return () => { open = false; };
  }, []);
  useLayoutEffect(() => {
    if (index >= 0) list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index, sounds]);

  function audition(sound: NotificationSound) {
    list.current?.focus({ preventScroll: true });
    setCandidate(sound);
    setPreviewFailed(false);
    void player.play(sound).then(played => { if (!played) setPreviewFailed(true); });
  }
  function commit() {
    if (listing === 'loading' || index < 0) return;
    onSelect(candidate);
    close();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.max(0, Math.min(sounds.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      if (index !== next) audition(sounds[next]);
    } else if (event.key === 'Enter' && event.target === list.current) {
      event.preventDefault();
      commit();
    } else if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"], button:not(:disabled)')];
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    }
  }

  return <dialog ref={dialog} className="hub-dialog notification-sound-selector" aria-labelledby={`${id}-title`}
    onKeyDown={onKeyDown} onCancel={event => { event.preventDefault(); close(); }}>
    <h1 id={`${id}-title`}>{title}</h1>
    <div ref={list} className="notification-sound-list" role="listbox" tabIndex={0} aria-labelledby={`${id}-title`}
      aria-activedescendant={index >= 0 ? `${id}-sound-${index}` : undefined} aria-busy={listing === 'loading'}>
      {sounds.map((sound, row) => <div key={sound ?? ''} id={`${id}-sound-${row}`} title={sound ?? undefined}
        role="option" aria-selected={sound === candidate} onClick={() => audition(sound)}>
        {sound ?? t('notificationSounds.silent')}
      </div>)}
    </div>
    <div className="retention-actions notification-sound-actions">
      <span role="status">{listing === 'loading' ? t('notificationSounds.loading') : listing === 'failed'
        ? t('notificationSounds.listFailed') : previewFailed ? t('notificationSounds.previewFailed') : ''}</span>
      <button type="button" onClick={close}>{t('menu.cancel')}</button>
      <button type="button" className="notification-sound-select" onClick={commit}
        disabled={listing === 'loading' || index < 0}>{t('notificationSounds.select')}</button>
    </div>
  </dialog>;
}
