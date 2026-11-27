import { appTrigger, appItem, openAppMenu, openAppEntry, chooseAppPreference } from './application-menu.mjs';
import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test.use({ locale: 'ko-KR', navigationTimeout: 60_000 });
test.setTimeout(90_000);
const key = 'agent-runner-hub.preferences.v1';
const defaults = { version: 1, language: 'en', theme: 'light', singleEntry: {}, confirmRunnerRemoval: true };
async function seed(page, raw) {
  await page.addInitScript(({ key, raw }) => {
    if (!sessionStorage.getItem('hub-preferences-seeded')) {
      localStorage.setItem(key, raw);
      sessionStorage.setItem('hub-preferences-seeded', 'yes');
    }
  }, { key, raw });
}
test('user language and theme changes restore together in a fresh page', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.getByRole('button', { name: '블랙', exact: true }).click();
  const restored = await context.newPage();
  await restored.goto('/');
  await expect(restored.getByRole('combobox', { name: '언어', exact: true })).toHaveValue('ko');
  await expect(restored.getByRole('button', { name: '블랙', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await restored.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual({ ...defaults, language: 'ko', theme: 'black' });
  await restored.close();
});

test('a missing runtime Korean key falls back to English without breaking other translated controls', async ({ page }) => {
  await page.goto('/tests/fixtures/hub.html');
  await page.locator('[data-runner-id="first"] .nav-row').click();
  await page.evaluate(async () => {
    const { i18n } = await import('/src/hub/i18n.ts');
    delete i18n.getResourceBundle('ko', 'translation').workspace.previewDisconnected;
  });
  await chooseAppPreference(page, 'settings', 'language', 'ko');
  await page.keyboard.press('Escape');
  await expect(page.locator('.empty-note')).toHaveText('No connected process for this preview row.');
  await expect(page.getByRole('textbox', { name: 'Runner 지시문', exact: true })).toBeVisible();
});

test('missing preferences start in English independently of browser language and do not save drafts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('private unsaved path');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await expect(page.getByRole('combobox', { name: /assignment policy/i })).toHaveCount(0);
});
test('saved Korean is ready for the first rendered shell and survives a new page', async ({ page, context }, testInfo) => {
  await seed(page, JSON.stringify({ ...defaults, language: 'ko', theme: 'black' }));
  await page.addInitScript(() => {
    window.__renderedShells = [];
    new MutationObserver(() => {
      const shell = document.querySelector('.toolbar-location');
      if (shell) window.__renderedShells.push({ language: document.documentElement.lang, text: shell.textContent });
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '언어', exact: true })).toHaveValue('ko');
  await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
  expect(await page.evaluate(() => window.__renderedShells.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__renderedShells.every(shell => shell.language === 'ko' && !shell.text.includes('Workspace')))).toBe(true);
  await page.getByRole('combobox', { name: '언어', exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  const next = await context.newPage();
  await next.goto('/');
  await expect(next.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await expect(next.locator('.hub')).toHaveAttribute('data-theme', 'light');
  expect(await next.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(defaults);
  await testInfo.attach('korean-cold-start', { body: await page.screenshot(), contentType: 'image/png' });
  await next.close();
});
for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
  test(language + '/' + theme + ' language changes preserve selection, draft, keyboard access and layout', async ({ page }, testInfo) => {
    await seed(page, JSON.stringify({ ...defaults, language, theme }));
    await page.goto('/tests/fixtures/hub.html');
    await page.locator('[data-runner-id="second"] .nav-row').click();
    const title = await page.locator('[data-runner-id="second"] .runner-name').textContent();
    await chooseAppPreference(page, 'settings', 'language', language === 'en' ? 'ko' : 'en');
    await expect(page.locator('[data-runner-id="second"] .nav-row')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-runner-id="second"] .runner-name')).toHaveText(title);
    await expect(page.locator('.workspace-header')).toHaveCount(0);
    await chooseAppPreference(page, 'settings', 'language', language);
    await page.keyboard.press('Escape');
    const name = language === 'en' ? 'Runner instructions' : 'Runner 지시문';
    await expect(page.getByRole('textbox', { name, exact: true })).toBeDisabled();
    for (const width of [1400, 1000, 760, 626]) {
      await page.setViewportSize({ width, height: width === 626 ? 450 : 700 });
      await expect(page.getByRole('textbox', { name, exact: true })).toBeInViewport();
      await expect(appTrigger(page, 'settings')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await page.locator('.output').boundingBox()).height).toBeGreaterThan(90);
      await testInfo.attach(language + '-' + theme + '-' + width, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    const composer = page.getByRole('textbox', { name: language === 'en' ? 'Single Entry instructions' : 'Single Entry 지시문', exact: true });
    await composer.fill('keep this draft /status 안녕');
    await chooseAppPreference(page, 'settings', 'language', language === 'en' ? 'ko' : 'en');
    await expect(composer).toHaveCount(0);
    await expect(page.locator('.composer textarea')).toHaveValue('keep this draft /status 안녕');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', theme);
    await expect(appItem(page, 'language')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(appTrigger(page, 'settings')).toBeFocused();
  });
}
for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
  test(`application menu keyboard and preview presentation ${language}/${theme}`, async ({ page }, info) => {
    await seed(page, JSON.stringify({ ...defaults, language, theme }));
    await page.goto('/tests/fixtures/hub.html');
    const nav = page.locator('.application-menu');
    const names = language === 'en' ? ['Runner', 'View', 'Settings', 'Help'] : ['러너', '보기', '설정', '도움말'];
    await expect(nav.locator('.application-menu-trigger:visible')).toHaveText(names);
    await appTrigger(page, 'runner').focus();
    await page.keyboard.press('ArrowRight');
    await expect(appTrigger(page, 'view')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(appItem(page, 'theme')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(appItem(page, theme)).toBeFocused();
    await expect(appItem(page, theme)).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(appItem(page, 'theme')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(appTrigger(page, 'view')).toBeFocused();
    await openAppEntry(page, 'help', 'preview');
    const guide = page.locator('.preview-help[open]');
    expect((await guide.boundingBox()).width).toBe(500);
    await info.attach('normal-guide', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(appTrigger(page, 'help')).toBeFocused();
    await page.setViewportSize({ width: 360, height: 540 });
    await expect(nav.locator('.application-menu-trigger:visible')).toHaveCount(1);
    await openAppMenu(page, 'runner');
    const panel = nav.getByRole('menu');
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(360);
    await expect(appItem(page, 'installation').locator('.menu-value')).not.toBeEmpty();
    await info.attach('compact-runner-menu', { body: await page.screenshot(), contentType: 'image/png' });
    const composer = await page.locator('.composer textarea').boundingBox();
    expect(composer.y + composer.height).toBeGreaterThan(box.y + box.height);
    await page.mouse.click(composer.x + 5, composer.y + composer.height - 5);
    await expect(panel).toHaveCount(0);
    await expect(appTrigger(page, 'compact')).toBeFocused();
    await expect(page.locator('.single-entry')).toHaveAttribute('aria-current', 'page');
    await openAppEntry(page, 'help', 'preview');
    await expect(guide.getByRole('heading').first()).toHaveText(language === 'en' ? 'File Preview Guide' : '파일 미리 보기 안내');
    const narrow = await guide.boundingBox();
    expect(narrow.x).toBeGreaterThan(0);
    expect(narrow.x + narrow.width).toBeLessThan(360);
    await info.attach('compact-guide', { body: await page.screenshot(), contentType: 'image/png' });
    await guide.locator('.settings-close').click();
    await expect(appTrigger(page, 'compact')).toBeFocused();
  });

  test('shortcuts settings preserve preferences and accessible capture in ' + language + '/' + theme, async ({ page }, info) => {
    await seed(page, JSON.stringify({ ...defaults, language, theme, singleEntry: { runMode: 'task-run' } }));
    await page.goto('/tests/fixtures/hub.html');
    await openAppEntry(page, 'settings', 'shortcuts');
    const dialog = page.getByRole('dialog'), buttons = dialog.locator('.shortcut-row button');
    await buttons.nth(0).click(); await page.keyboard.press('Alt+Enter');
    await buttons.nth(1).click(); await page.keyboard.press('Alt+Home');
    await buttons.nth(2).click(); await page.keyboard.press('Alt+2');
    await info.attach('shortcuts-' + language + '-' + theme, { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.locator('.composer-actions button').last().click();
    await expect(appTrigger(page, 'settings')).toBeFocused();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    expect(saved).toEqual({ ...defaults, language, theme, singleEntry: { runMode: 'task-run' },
      shortcuts: { assign: 'Alt+Enter', entry: 'Alt+Home', runner: 'Alt+Digit' } });
    await page.reload(); await openAppEntry(page, 'settings', 'shortcuts');
    await expect(buttons.nth(0)).toHaveText('Alt+Enter'); await expect(buttons.nth(1)).toHaveText('Alt+Home');
    await expect(buttons.nth(2)).toContainText('Alt+1, 2, 3');
    await dialog.locator('.composer-actions button').first().click();
    await expect(buttons.nth(1)).toHaveText('Ctrl+Shift+Home');
    await dialog.locator('.composer-actions button').last().click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).shortcuts, key)).toEqual({
      assign: 'Enter', entry: 'Ctrl+Shift+Home', runner: 'Ctrl+Digit' });
  });
}
for (const failure of ['write', 'concurrent', 'read']) {
  test('shortcuts save reports ' + failure + ' failure and protects the original', async ({ page }) => {
    await page.goto('/tests/fixtures/hub.html');
    const raw = JSON.stringify({ ...defaults, theme: 'black' });
    await page.evaluate(({ key, raw, failure }) => {
      localStorage.setItem(key, raw);
      if (failure === 'concurrent') return;
      const method = failure === 'read' ? 'getItem' : 'setItem', original = Storage.prototype[method];
      Storage.prototype[method] = function(name, ...args) {
        if (name === key) throw new DOMException('shortcut fixture denied', 'SecurityError');
        return original.call(this, name, ...args);
      };
    }, { key, raw, failure });
    await openAppEntry(page, 'settings', 'shortcuts');
    await page.locator('.shortcut-row button').first().click(); await page.keyboard.press('Alt+Enter');
    await page.getByRole('button', { name: 'Apply and save' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    if (failure !== 'read') expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  });
}
for (const entry of ['Home', 'Ctrl+Home']) test('retired shortcut ' + entry + ' uses defaults without rewriting unrelated or custom preferences', async ({ page }) => {
  const raw = JSON.stringify({ ...defaults, theme: 'black', singleEntry: { runMode: 'issue-run' },
    shortcuts: { assign: 'Alt+Enter', entry, runner: 'Alt+Digit' } });
  await seed(page, raw);
  await page.goto('/tests/fixtures/hub.html');
  await openAppEntry(page, 'settings', 'shortcuts');
  const buttons = page.locator('.shortcut-row button');
  await expect(buttons.nth(0)).toHaveText('Alt+Enter');
  await expect(buttons.nth(1)).toHaveText('Ctrl+Shift+Home');
  await expect(buttons.nth(2)).toContainText('Alt+1, 2, 3');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  await page.reload();
  await openAppEntry(page, 'settings', 'shortcuts');
  await expect(buttons.nth(1)).toHaveText('Ctrl+Shift+Home');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  await page.getByRole('button', { name: 'Apply and save' }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual({
    ...defaults, theme: 'black', singleEntry: { runMode: 'issue-run' },
    shortcuts: { assign: 'Alt+Enter', entry: 'Ctrl+Shift+Home', runner: 'Alt+Digit' } });
});

for (const shortcuts of [null, 'Home', {}, { assign: 'Home', entry: 'Home', runner: 'Ctrl+Digit' },
  { assign: 'Alt+Enter', entry: 'unsupported', runner: 'Alt+Digit', draft: 'inert' },
  { assign: 'Ctrl+Enter', entry: 'Ctrl+Home', runner: 'Ctrl+Digit' }]) {
  test('unsupported optional shortcuts isolate defaults: ' + JSON.stringify(shortcuts), async ({ page }) => {
    const raw = JSON.stringify({ ...defaults, theme: 'black', shortcuts,
      singleEntry: { initialized: true, runMode: 'issue-run', account: 'bad\u0000name' } });
    await seed(page, raw); await page.goto('/tests/fixtures/hub.html');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
    await expect(page.locator('.preferences-error')).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
    await openAppEntry(page, 'settings', 'shortcuts');
    const buttons = page.locator('.shortcut-row button');
    await expect(buttons.nth(0)).toHaveText(shortcuts?.assign === 'Alt+Enter' ? 'Alt+Enter' : 'Enter');
    await expect(buttons.nth(1)).toHaveText('Ctrl+Shift+Home');
  });
}

test('retention popover validates, cancels and applies through existing preferences', async ({ page }) => {
  await seed(page, JSON.stringify({ ...defaults, hubLogRetentionDays: 14 }));
  await page.goto('/tests/fixtures/hub.html');
  await openAppEntry(page, 'settings', 'retention');
  const editor = page.getByRole('dialog', { name: 'Hub log retention (days)' });
  const days = editor.getByRole('spinbutton');
  await expect(days).toBeFocused();
  await expect(days).toHaveValue('14');
  for (const value of ['', '0', '1.5', '4294967296']) {
    await days.fill(value);
    await days.press('Enter');
    await expect(editor.getByRole('alert')).toBeVisible();
  }
  await days.fill('8');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(appItem(page, 'retention')).toBeFocused();
  await expect(appItem(page, 'retention').locator('.menu-value')).toHaveText('14');
  await appItem(page, 'retention').click();
  await expect(days).toHaveValue('14');
  await days.fill('7');
  await days.press('Enter');
  await expect(appItem(page, 'retention').locator('.menu-value')).toHaveText('7');
  await page.reload();
  await openAppEntry(page, 'settings', 'retention');
  await expect(days).toHaveValue('7');
});

test('current lastVerified-only workspace load freezes context without writing bytes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWorkspace, runnerWorkspaceKey } = await import('/src/hub/RunnerWorkspace.ts');
    const tab = { id: '12345678-1234-1234-1234-123456789abc', name: 'Retained', createdOrder: 2,
      installationRoot: 'C:/verified-installation', launchOnOpen: true,
      lastVerified: { target: { binding_state: 'bound', owner: 'Project', project: 'Previous' },
        runMode: 'issue-run', workflowKind: 'IssueRun' } };
    const raw = JSON.stringify({ version: 1, tabs: [tab] }, null, 2);
    localStorage.setItem(runnerWorkspaceKey, raw);
    const workspace = new RunnerWorkspace(), tabs = workspace.load();
    return { raw, after: localStorage.getItem(runnerWorkspaceKey), tabs, tab, issue: workspace.issue };
  });
  expect(result.after).toBe(result.raw); expect(result.issue).toBe('');
  expect(result.tabs).toEqual([{ ...result.tab, recoveryHint: result.tab.lastVerified }]);
});

const invalid = [
  '{', JSON.stringify({ ...defaults, version: 99 }), JSON.stringify({ ...defaults, language: 'fr' }),
  JSON.stringify({ ...defaults, theme: 'dark' }), JSON.stringify({ ...defaults, language: ['ko'] }),
  JSON.stringify({ ...defaults, singleEntry: { target: { binding_state: 'bound', owner: 'Project', project: 'x', token: 'rejected' } } }),
  JSON.stringify({ ...defaults, token: 'rejected' }),
];
for (const [index, raw] of invalid.entries()) {
  test('invalid preferences ' + index + ' retain their exact original bytes and allow window-local choices', async ({ page }) => {
    await seed(page, raw);
    await page.goto('/');
    await expect(page.locator('.preferences-error')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
    await expect(page.locator('.preferences-error')).toContainText('원본');
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  });
}
test('preference save rejection preserves the prior record and renders a live translated warning', async ({ page }) => {
  const raw = JSON.stringify(defaults);
  await seed(page, raw);
  await page.addInitScript(key => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException('fixture quota reached', 'QuotaExceededError');
      return save.call(this, name, value);
    };
  }, key);
  await page.goto('/');
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await expect(page.locator('.preferences-error')).toContainText('could not be saved');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await expect(page.locator('.preferences-error')).toContainText('저장하지 못했습니다');
  await expect(page.locator('.preferences-error')).toContainText('fixture quota reached');
  await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
});
test('unreadable preferences retain the original and use defaults without touching workspace or installation', async ({ page }) => {
  await page.addInitScript(key => {
    localStorage.setItem(key, '{"version":99}');
    localStorage.setItem('agent-runner-hub.installation', '/saved/installation');
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function(name) {
      if (name === key) throw new DOMException('fixture preferences read denied', 'SecurityError');
      return get.call(this, name);
    };
  }, key);
  await page.goto('/');
  await expect(page.locator('.preferences-error')).toContainText('could not be restored');
  await expect(page.locator('.preferences-error')).toContainText('fixture preferences read denied');
  await expect(page.getByRole('textbox', { name: 'AgentRunner location', exact: true })).toHaveValue('/saved/installation');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
test('a concurrent saved record is retained instead of being overwritten by an older window', async ({ page }) => {
  await page.goto('/');
  const newer = JSON.stringify({ ...defaults, language: 'ko', theme: 'black' });
  await page.evaluate(({ key, newer }) => localStorage.setItem(key, newer), { key, newer });
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await expect(page.locator('.preferences-error')).toContainText('changed in another window');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(newer);
});
