import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.use({ locale: 'ko-KR', navigationTimeout: 60_000 });
test.setTimeout(90_000);
const key = 'agent-runner-hub.preferences.v1';
const defaults = { version: 1, language: 'en', theme: 'light', singleEntry: {} };
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
    delete i18n.getResourceBundle('ko', 'translation').composer.send;
  });
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeVisible();
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
    const title = await page.getByRole('heading', { level: 1 }).textContent();
    await page.getByRole('button', { name: language === 'en' ? 'App settings' : '앱 설정', exact: true }).click();
    const languagePicker = page.locator('.language-picker select');
    await languagePicker.selectOption(language === 'en' ? 'ko' : 'en');
    await expect(page.locator('[data-runner-id="second"] .nav-row')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.workspace h1')).toHaveText(title);
    await languagePicker.selectOption(language);
    await page.keyboard.press('Escape');
    const name = language === 'en' ? 'Runner instructions' : 'Runner 지시문';
    await expect(page.getByRole('textbox', { name, exact: true })).toBeDisabled();
    for (const width of [1400, 1000, 760, 626]) {
      await page.setViewportSize({ width, height: width === 626 ? 450 : 700 });
      await expect(page.getByRole('button', { name: language === 'en' ? 'Send instruction' : '지시문 전송', exact: true })).toBeInViewport();
      await expect(page.locator('.app-settings-trigger')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await page.locator('.output').boundingBox()).height).toBeGreaterThan(90);
      await testInfo.attach(language + '-' + theme + '-' + width, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    const composer = page.getByRole('textbox', { name: language === 'en' ? 'Single Entry instructions' : 'Single Entry 지시문', exact: true });
    await composer.fill('keep this draft /status 안녕');
    await page.locator('.app-settings-trigger').click();
    await languagePicker.selectOption(language === 'en' ? 'ko' : 'en');
    await expect(composer).toHaveCount(0);
    await expect(page.locator('.composer textarea')).toHaveValue('keep this draft /status 안녕');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', theme);
    await languagePicker.focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('.app-appearance') !== null)).toBe(true);
  });
}
const invalid = [
  '{', JSON.stringify({ ...defaults, version: 99 }), JSON.stringify({ ...defaults, language: 'fr' }),
  JSON.stringify({ ...defaults, theme: 'dark' }), JSON.stringify({ ...defaults, language: ['ko'] }),
  JSON.stringify({ ...defaults, singleEntry: { account: 'bad\u0000name' } }),
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
