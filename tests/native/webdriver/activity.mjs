import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, readyInstalledHub, ownedConnection, stopWatching } from './runner-flow.mjs';

export function assertSupportedStartup(messages) {
  assert.ok(!messages.includes('Hub 이 Runner는 설정 조회를 지원하지 않습니다.'), JSON.stringify(messages));
}

async function geometry(browser) {
  return browser.execute(() => {
    const line = document.querySelector('.hub-activity');
    const text = line.querySelector('.hub-activity-message');
    const composer = document.querySelector('.workspace .composer');
    const rect = node => {
      const { left, top, width, height } = node.getBoundingClientRect();
      return { left, top, width, height };
    };
    return { viewport: innerWidth, text: line.textContent, line: rect(line),
      sentence: text && rect(text), composer: rect(composer),
      readable: !!text && text.scrollWidth <= text.clientWidth,
      live: line.getAttribute('aria-live'), atomic: line.getAttribute('aria-atomic'),
      wrap: getComputedStyle(line).whiteSpace,
      context: document.querySelector('.runner-row.active') ? 'runner' : 'single-entry' };
  });
}

export function activityCase(runnerRoot, windowWidth) {
  return defineNativeCase({
    id: 'activity-' + windowWidth, presentation: 'nonactivating', windowWidth,
    async ready(browser) {
      if (process.platform !== 'win32') throw new BlockedPrerequisite('This responsive native observation requires the Windows owned placement adapter.');
      await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.language-picker select')),
        { timeout: startupMs });
      await changeValue(browser, '.language-picker select', 'ko');
      await browser.execute(() => {
        window.__startupActivity = [];
        const record = () => {
          const text = document.querySelector('.hub-activity')?.textContent;
          if (text && window.__startupActivity.at(-1) !== text) window.__startupActivity.push(text);
        };
        new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
        record();
      });
      await readyInstalledHub(browser, runnerRoot);
    },
    async run(browser) {
      await ownedConnection(browser, runnerRoot);
      // Observe normal capability discovery without an additional inspection request.
      await browser.waitUntil(async () => browser.execute(() =>
        document.querySelector('.hub-activity').textContent === 'Hub 프로젝트 또는 대상을 선택하세요.'),
      { timeout: startupMs, timeoutMsg: 'Single Entry active target guidance was not observed' });
      const startupActivity = await browser.execute(() => window.__startupActivity);
      assertSupportedStartup(startupActivity);
      assert.ok(startupActivity.includes('Hub 실행 옵션을 불러오는 중…'),
        'Capability-discovery option loading must be observed: ' + JSON.stringify(startupActivity));
      return { singleEntry: await geometry(browser), startupActivity,
        startupCoverage: 'Observer installed before explicit Runner installation selection; earlier renderer startup is unverified.',
        method: 'actual installed Runner capability discovery and existing Hub selection UI; no additional inspection, work or configuration apply' };
    },
    async observe(browser) {
      const rows = [];
      rows.push(await geometry(browser));
      await browser.execute(() => document.querySelector('.add-runner').click());
      await browser.waitUntil(async () => browser.execute(() =>
        !!document.querySelector('.runner-row.active') &&
        document.querySelector('.hub-activity').textContent === 'Hub 프로젝트 또는 대상을 선택하세요.'),
      { timeout: startupMs, timeoutMsg: 'Runner-tab active target guidance was not observed' });
      rows.push(await geometry(browser));
      await browser.execute(() => document.querySelector('.single-entry').click());
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-row.active')),
        { timeout: startupMs });
      rows.push(await geometry(browser));
      for (const row of rows) {
        assert.equal(row.text, 'Hub 프로젝트 또는 대상을 선택하세요.');
        assert.ok(Math.abs(row.sentence.left - row.composer.left) < 1, JSON.stringify(row));
        assert.equal(row.readable, true, JSON.stringify(row));
        assert.equal(row.line.height, 22);
        assert.equal(row.wrap, 'nowrap');
        assert.equal(row.live, 'polite'); assert.equal(row.atomic, 'true');
      }
      assert.deepEqual(rows[0].composer, rows[2].composer, 'Context roundtrip must preserve composer geometry');
      assert.deepEqual(rows[0].line, rows[2].line, 'Context roundtrip must preserve reserved footer geometry');
      await stopWatching(browser);
      return { rows, independentContexts: true, verifiedApplication: 'not exercised; no apply control in current UI' };
    }
  });
}
