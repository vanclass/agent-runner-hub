
import type { MessageKey } from './i18n';

type NotificationSoundCategory = { id: string; label: MessageKey; defaultSound: string };

export const notificationSoundCategories = [
  { id: 'userRequest', label: 'notificationSounds.userRequest', defaultSound: 'user-request.wav' },
  { id: 'workCompleted', label: 'notificationSounds.workCompleted', defaultSound: 'work-completed.wav' },
  { id: 'workInterrupted', label: 'notificationSounds.workInterrupted', defaultSound: 'work-interrupted.wav' },
] as const satisfies readonly NotificationSoundCategory[];

export type NotificationCategory = typeof notificationSoundCategories[number]['id'];
export type NotificationSound = string | null;
export type NotificationSoundSelections = Partial<Record<NotificationCategory, NotificationSound>>;

export function selectedNotificationSound(selections: NotificationSoundSelections, category: NotificationCategory) {
  const saved = selections[category];
  return saved === undefined ? notificationSoundCategories.find(item => item.id === category)!.defaultSound : saved;
}

export function validNotificationSound(value: unknown): value is NotificationSound {
  return value === null || (typeof value === 'string' && /\.(wav|mp3)$/i.test(value)
    && !/[\\/:\u0000-\u001f\u007f]/.test(value));
}

export function restoreNotificationSounds(value: unknown): NotificationSoundSelections {
  const selections: NotificationSoundSelections = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return selections;
  const record = value as Record<string, unknown>;
  for (const { id } of notificationSoundCategories) {
    const sound = record[id];
    if (validNotificationSound(sound)) selections[id] = sound;
  }
  return selections;
}
