
import { useState } from 'react';
import { useHubTranslation } from './i18n';
import { MenuItem, MenuPanel } from './MenuPanel';
import { NotificationSoundSelector } from './NotificationSoundSelector';
import { openNotificationSoundFolder, type NotificationSoundPlayer } from './notificationSoundPlayback';
import {
  notificationSoundCategories, selectedNotificationSound, type NotificationCategory,
  type NotificationSound, type NotificationSoundSelections,
} from './notificationSounds';

export type NotificationSoundSettingsProps = {
  selections: NotificationSoundSelections;
  player: NotificationSoundPlayer;
  onSave: (category: NotificationCategory, sound: NotificationSound) => void;
};

export function NotificationSoundSettings({ selections, player, onSave, onBack }: NotificationSoundSettingsProps & {
  onBack: () => void;
}) {
  const { t } = useHubTranslation();
  const [category, setCategory] = useState<typeof notificationSoundCategories[number]>();
  const [folderFailed, setFolderFailed] = useState(false);

  async function openFolder() {
    setFolderFailed(false);
    try { await openNotificationSoundFolder(); }
    catch { setFolderFailed(true); }
  }

  return <>
    <MenuPanel label={t('notificationSounds.title')}>
      <MenuItem id="back" label={t('menu.back')} icon="‹" onSelect={onBack} />
      {notificationSoundCategories.map(item => {
        const sound = selectedNotificationSound(selections, item.id);
        return <MenuItem key={item.id} id={item.id} label={t(item.label)} value={sound ?? t('notificationSounds.silent')}
          title={sound ?? undefined} dialog onSelect={() => setCategory(item)} />;
      })}
      <MenuItem id="open-sound-folder" label={t('notificationSounds.openFolder')} icon="⌂" onSelect={() => { void openFolder(); }} />
      {folderFailed && <div role="status" className="notification-sound-menu-status">{t('notificationSounds.folderFailed')}</div>}
    </MenuPanel>
    {category && <NotificationSoundSelector title={t('notificationSounds.selectorTitle', { category: t(category.label) })}
      saved={selectedNotificationSound(selections, category.id)} player={player}
      onSelect={sound => onSave(category.id, sound)} onClose={() => setCategory(undefined)} />}
  </>;
}
