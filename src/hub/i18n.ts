import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';
import ko from './locales/ko.json';

type LeafKeys<T, P extends string = ''> = { [K in keyof T & string]:
  T[K] extends string ? `${P}${K}` : LeafKeys<T[K], `${P}${K}.`> }[keyof T & string];
export type MessageKey = LeafKeys<typeof en>;
export type HubText = string | { key: MessageKey; values?: Record<string, HubText | number | undefined> };
export const i18n = i18next.createInstance();
i18n.use(initReactI18next);
export function initializeHubLanguage(language: 'en' | 'ko') {
  if (!i18n.isInitialized) {
    void i18n.init({ resources: { en: { translation: en }, ko: { translation: ko } },
      lng: language, fallbackLng: 'en', supportedLngs: ['en', 'ko'], initAsync: false,
      interpolation: { escapeValue: false }, returnNull: false });
  } else if (i18n.language !== language) void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  document.documentElement.dir = 'ltr';
}
export const msg = (key: MessageKey, values?: Record<string, HubText | number | undefined>): HubText => ({ key, values });
export function tr(value: HubText | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const values = Object.fromEntries(Object.entries(value.values ?? {}).map(([key, item]) =>
    [key, typeof item === 'number' ? item : tr(item)]));
  return String(i18n.t(value.key, values));
}
export const t = (key: MessageKey, values?: Record<string, HubText | number | undefined>) => tr(msg(key, values));
export function useHubTranslation() { useTranslation(undefined, { i18n }); return { t, tr }; }
export class HubError extends Error {
  constructor(readonly text: HubText) { super(tr(text)); this.name = 'HubError'; }
}
export function errorText(reason: unknown): HubText {
  if (reason instanceof HubError) return reason.text;
  if (reason && typeof reason === 'object' && 'detail' in reason && typeof reason.detail === 'string') return reason.detail;
  return String(reason);
}
