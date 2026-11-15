import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';
test.use({ timezoneId: 'Asia/Seoul' });
async function mount(page, count = 450) {
  await page.goto('/');
  await page.evaluate(async count => {
    const resources = performance.getEntriesByType('resource').map(e => e.name);
    const { default: React } = await import(resources.find(u => /\/react\.js\?/.test(u)));
    const { default: { createRoot } } = await import(resources.find(u => /\/react-dom_client\.js\?/.test(u)));
    const { HubLog } = await import('/src/hub/HubLog.ts');
    const { HubLogView } = await import('/src/hub/HubLogView.tsx');
    const { initializeHubLanguage } = await import('/src/hub/i18n.ts'); initializeHubLanguage('en');
    const event = { component: 'task', operation: 'work-started', runner: 'Runner 2', target: 'Project/Example', expected: 'confirmed-outcome', actual: 'started', code: '', nextAction: '' };
    let disk = Array.from({ length: count }, (_, i) => ({ ...event, sequence: i + 1, timestamp: 1 }));
    window.originalBytes = JSON.stringify(disk);
    window.__TAURI_INTERNALS__ = { invoke: async (_, { request }) => {
      if (request.event) disk.push({ ...request.event, sequence: disk.length + 1, timestamp: Date.now() });
      return { records: structuredClone(disk), issue: null };
    } };
    const log = new HubLog(30); await log.start();
    document.getElementById('app').style.display = 'none';
    document.querySelectorAll('dialog[open]').forEach(n => n.close());
    document.querySelectorAll('.hub-log').forEach(n => n.remove());
    const host = document.createElement('div'); host.className = 'hub'; host.style.cssText = 'position:fixed;inset:0;z-index:9999'; document.body.append(host);
    const root = createRoot(host);
    window.renderLog = () => root.render(React.createElement(HubLogView, { log })); window.renderLog();
    window.detachLog = () => root.render(null);
    window.appendLog = async (n = 1, fields = {}) => { for (let i = 0; i < n; i++) await log.record({ ...event, ...fields }); };
    window.diskBytes = () => JSON.stringify(disk.slice(0, count));
    window.failLog = async () => { window.__TAURI_INTERNALS__.invoke = async () => { throw 'HUB_LOG_WRITE_FAILED'; }; await log.record(event); };
  }, count);
  await expect(page.locator('.hub-log-row')).toHaveCount(Math.min(count, 200));
}
const bottom = page => page.locator('.hub-log-records').evaluate(n => n.scrollHeight - n.scrollTop - n.clientHeight <= 2);
test('empty history keeps its empty state and follows its first arriving record', async ({ page }) => {
  await mount(page, 0);
  await expect(page.locator('.hub-log-records')).toContainText('No retained Hub events.');
  await page.evaluate(() => window.appendLog());
  await expect(page.locator('.hub-log-row')).toHaveCount(1);
  expect(await bottom(page)).toBe(true);
});
const anchor = page => page.locator('.hub-log-records').evaluate(n => {
  const row = [...n.querySelectorAll('[data-sequence]')].find(r => r.getBoundingClientRect().bottom > n.getBoundingClientRect().top);
  return { sequence: row.dataset.sequence, y: row.getBoundingClientRect().top };
});
test('bottom following, historical anchor over multiple appends and expansion, re-entry and unchanged stored bytes', async ({ page }) => {
  await mount(page); expect(await bottom(page)).toBe(true);
  await page.evaluate(() => window.appendLog(3)); await expect(page.locator('.hub-log-row')).toHaveCount(203); expect(await bottom(page)).toBe(true);
  await page.locator('.hub-log-records').evaluate(n => { n.scrollTop = 350; n.dispatchEvent(new Event('scroll')); });
  const before = await anchor(page);
  await page.evaluate(() => window.appendLog(5)); await expect(page.locator('.hub-log-row')).toHaveCount(208); expect(await anchor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Show older records' }).click(); await expect(page.locator('.hub-log-row')).toHaveCount(408); expect(await anchor(page)).toEqual(before);
  await page.evaluate(() => window.appendLog(4)); await expect(page.locator('.hub-log-row')).toHaveCount(412); expect(await anchor(page)).toEqual(before);
  await page.locator('.hub-log-records').evaluate(n => { n.scrollTop = n.scrollHeight; n.dispatchEvent(new Event('scroll')); });
  await page.evaluate(() => window.appendLog()); await expect(page.locator('.hub-log-row')).toHaveCount(413); expect(await bottom(page)).toBe(true);
  await page.evaluate(() => window.detachLog()); await expect(page.locator('.hub-log')).toHaveCount(0);
  await page.evaluate(() => window.renderLog()); await expect(page.locator('.hub-log-row')).toHaveCount(200); expect(await bottom(page)).toBe(true);
  expect(await page.evaluate(() => window.diskBytes() === window.originalBytes)).toBe(true);
});
test('localized outcomes, exact local timestamp dates, safe legacy fallback, narrow wrapping and unsaved warning', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const { formatHubRecord, formatHubTimestamp } = await import('/src/hub/HubLog.ts');
    const { initializeHubLanguage } = await import('/src/hub/i18n.ts');
    const base = { component: 'task', operation: 'work-outcome', runner: 'Runner 2', target: '', expected: 'confirmed-outcome', actual: 'succeeded', code: 'SECRET error instructions', nextAction: 'SECRET' };
    const result = {};
    for (const lang of ['en', 'ko']) {
      initializeHubLanguage(lang);
      result[lang] = [base, { ...base, component: 'system', operation: 'spare-prepared' }, { ...base, component: 'settings', operation: 'configuration-apply', actual: 'applied' }, { ...base, actual: 'failed' }, { ...base, actual: 'unknown' }, { ...base, component: 'work', code: 'FAILED' }].map(formatHubRecord);
    }
    result.dates = [new Date(2026, 0, 1, 23, 59, 59).getTime(), new Date(2026, 0, 2, 0, 0, 1).getTime()].map(formatHubTimestamp);
    result.utcBoundary = formatHubTimestamp(Date.UTC(2026, 0, 1, 15, 0, 1));
    initializeHubLanguage('en'); return result;
  });
  expect(result.dates).toEqual(['2026-01-01 23:59:59', '2026-01-02 00:00:01']);
  expect(result.utcBoundary).toBe('2026-01-02 00:00:01');
  expect(result.en.map(r => r.category)).toEqual(['Task', 'System', 'Settings', 'Task', 'Task', 'Task']);
  expect(result.ko.map(r => r.category)).toEqual(['작업', '시스템', '설정', '작업', '작업', '작업']);
  expect(result.en.map(r => r.tone)).toEqual(['success', 'success', 'success', 'failure', 'warning', 'normal']);
  expect(result.en[0].message).toContain('Completed'); expect(result.ko[0].message).toContain('작업 완료');
  expect(result.ko[1].message).toContain('예비 러너 준비됨'); expect(result.ko[2].message).toContain('설정 적용');
  expect(result.en[5].message).toContain('outcome unverified'); expect(JSON.stringify(result)).not.toContain('SECRET');
  await page.evaluate(() => window.appendLog(1, { runner: 'Long Runner '.repeat(20), actual: 'failed', operation: 'work-outcome' }));
  await page.setViewportSize({ width: 360, height: 640 }); await expect(page.locator('.hub-log-row')).toHaveCount(201);
  const style = await page.locator('.hub-log-row').last().evaluate(n => ({ overflow: n.scrollWidth > n.clientWidth, height: n.clientHeight, color: getComputedStyle(n.querySelector('.hub-log-message')).color, category: getComputedStyle(n.querySelector('.hub-log-category')).color }));
  expect(style.overflow).toBe(false); expect(style.height).toBeGreaterThan(36); expect(style.color).not.toBe(style.category);
  await page.evaluate(() => window.failLog()); await expect(page.locator('.hub-log [role="alert"]')).toContainText('HUB_LOG_WRITE_FAILED');
  await expect(page.locator('.hub-log-pending')).toContainText('Not confirmed saved');
});
