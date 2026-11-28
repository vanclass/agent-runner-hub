
import { invoke, isTauri } from '@tauri-apps/api/core';
import { notificationSoundCategories, type NotificationSound } from './notificationSounds';

const bundled = import.meta.glob<string>('../../src-tauri/src/notification_sounds/*.wav', {
  eager: true, import: 'default', query: '?url',
});

export async function listNotificationSounds(): Promise<string[]> {
  return isTauri() ? invoke('list_notification_sounds') : notificationSoundCategories.map(category => category.defaultSound);
}

export async function openNotificationSoundFolder(): Promise<void> {
  await invoke('open_notification_sound_folder');
}

async function readSound(name: string): Promise<ArrayBuffer> {
  if (isTauri()) return invoke('read_notification_sound', { name });
  const url = bundled[`../../src-tauri/src/notification_sounds/${name}`];
  if (!url) throw new Error('Sound unavailable');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Sound unavailable');
  return response.arrayBuffer();
}

export class NotificationSoundPlayer {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private playback = 0;

  stop() {
    ++this.playback;
    const source = this.source;
    this.source = undefined;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
  }

  async play(sound: NotificationSound): Promise<boolean> {
    this.stop();
    if (sound === null) return true;
    const playback = this.playback;
    try {
      const context = this.context ??= new AudioContext();
      const [, bytes] = await Promise.all([context.resume(), readSound(sound)]);
      if (playback !== this.playback) return true;
      const buffer = await context.decodeAudioData(bytes);
      if (playback !== this.playback) return true;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        if (this.source === source) this.source = undefined;
      };
      try { source.start(); }
      catch (error) { source.disconnect(); throw error; }
      this.source = source;
      return true;
    } catch {
      return playback !== this.playback;
    }
  }
}
