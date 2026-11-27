import type { ITheme } from '@xterm/xterm';
import type { HubTheme } from './preferences';

export type TerminalTheme = 'light' | 'dark';
export const terminalThemeChoices = ['follow', 'light', 'dark'] as const;
export type TerminalThemePreference = typeof terminalThemeChoices[number];

export function resolveTerminalTheme(preference: TerminalThemePreference, appTheme: HubTheme): TerminalTheme {
  return preference === 'follow' ? (appTheme === 'black' ? 'dark' : 'light') : preference;
}

export const terminalPalettes = {
  light: {
    foreground: '#23272e', background: '#ffffff', cursor: '#23272e', cursorAccent: '#ffffff',
    selectionBackground: '#c4d9f5', selectionInactiveBackground: '#dce6f3',
    scrollbarSliderBackground: '#8995a5', scrollbarSliderHoverBackground: '#6c798a',
    scrollbarSliderActiveBackground: '#536176',
    black: '#23272e', red: '#a82435', green: '#176137', yellow: '#765507',
    blue: '#2053a0', magenta: '#792e90', cyan: '#00636a', white: '#515b67',
    brightBlack: '#646c79', brightRed: '#bd3345', brightGreen: '#1c7643', brightYellow: '#8c6308',
    brightBlue: '#2769bf', brightMagenta: '#963aab', brightCyan: '#00777d', brightWhite: '#36404e',
  },
  dark: {
    foreground: '#eeeeef', background: '#111214', cursor: '#eeeeef', cursorAccent: '#111214',
    selectionBackground: '#38577f', selectionInactiveBackground: '#2b3c54',
    scrollbarSliderBackground: '#687487', scrollbarSliderHoverBackground: '#8997ab',
    scrollbarSliderActiveBackground: '#a5b3c7',
    black: '#818b9a', red: '#ef7881', green: '#73c98d', yellow: '#dbb05e',
    blue: '#80aaff', magenta: '#cc93ec', cyan: '#64c4ce', white: '#cad2df',
    brightBlack: '#9ba5b4', brightRed: '#ffa1a9', brightGreen: '#a3e6ac', brightYellow: '#f5d58b',
    brightBlue: '#b1ccff', brightMagenta: '#e9b6ff', brightCyan: '#9ae3eb', brightWhite: '#f8fafc',
  },
} satisfies Record<TerminalTheme, ITheme>;
