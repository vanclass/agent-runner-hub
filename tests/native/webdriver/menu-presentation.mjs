import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { HubActions } from './hub-actions.mjs';
import { readyInstalledHub } from './runner-flow.mjs';

const formats = JSON.parse(readFileSync(new URL('../../../src-tauri/src/preview_formats.json', import.meta.url), 'utf8'));

export const menuPresentation = runnerRoot => defineNativeCase({
  id: 'menu-presentation', presentation: 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const { settings } = new HubActions(browser);
    await settings.setTheme('black');
    await settings.edit('language', 'ko');
    return { theme: 'black', language: 'ko', interaction: 'scripted DOM clicks in the owned WebView' };
  },
  async observe(browser) {
    const hub = new HubActions(browser);
    const { settings, dom } = hub;
    await settings.openMenu('runner');
    const menu = await browser.execute(() => {
      const installation = document.querySelector('[data-menu-item="installation"]');
      const bounds = document.querySelector('.application-menu-panel').getBoundingClientRect();
      return {
        labels: [...document.querySelectorAll('[data-menu-trigger]')].filter(button => button.offsetWidth)
          .map(button => button.textContent.trim()),
        installation: installation.title,
        shownPath: installation.querySelector('.menu-value').textContent,
        active: document.activeElement === installation,
        fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        itemHeight: installation.getBoundingClientRect().height,
      };
    });
    assert.deepEqual(menu.labels, ['러너', '보기', '설정', '도움말']);
    assert.equal(menu.installation, (await hub.installationState()).saved);
    assert.ok(menu.shownPath && menu.active && menu.fits, JSON.stringify(menu));
    assert.ok(menu.itemHeight >= 32 && menu.itemHeight <= 36);
    await dom.click('.application-menu-shield');
    await settings.openMenu('help');
    await dom.click('[data-menu-item="preview"]');
    const guide = await browser.execute(() => {
      const dialog = document.querySelector('.preview-help[open]');
      const bounds = dialog.getBoundingClientRect();
      return { visible: document.visibilityState, theme: document.querySelector('.hub').dataset.theme,
        title: dialog.querySelector('h1').textContent, width: bounds.width,
        fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        tags: [...dialog.querySelectorAll('.preview-format-tags')].map(list => [...list.children].map(tag => tag.textContent)) };
    });
    assert.equal(guide.visible, 'visible');
    assert.equal(guide.theme, 'black');
    assert.equal(guide.title, '파일 미리 보기 안내');
    assert.ok(guide.fits && guide.width >= 460 && guide.width <= 520);
    assert.deepEqual(guide.tags, ['image', 'text', 'pdf'].map(category => formats.filter(format => format.category === category)
      .flatMap(({ extensions, filenames }) => [...(extensions ?? []).map(ext => '.' + ext), ...(filenames ?? [])])));
    return { menu, guide };
  }
});
