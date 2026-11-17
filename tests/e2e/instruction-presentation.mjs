const instruction = '개구리 이미지를 보여줄래?';
import { drop } from './composer-attachments.mjs';
export function registerInstructionPresentation({ test, expect, transport, configure, create }) {
  const entries = page => page.locator('.runner-instruction');
  const composer = page => page.getByRole('textbox', { name: 'Runner instructions', exact: true });
  const send = async page => {
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toBeEnabled();
    await composer(page).press('Enter');
  };
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options }); await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
  }
  test('instruction presentation counts reference receipts independently of repeated files output', async ({ page }) => {
    await ready(page); await create(page);
    await drop(page, ['/fixture/image.png']);
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '/files\r\n'.repeat(7)));
    await composer(page).fill(instruction); await send(page);
    await expect(composer(page)).toHaveValue('', { timeout: 35000 });
    await expect(entries(page)).toHaveCount(0);
    const evidence = await page.evaluate(() => {
      const n = window.__nativeFixture, s = n.sessions.get('pty-1');
      return { requests: n.referenceRequests.filter(r => r.request.operation === 'references.register'),
        receipts: s.control.references.results.filter(r => r.state === 'registered'), inventory: s.items,
        delivered: n.deliveredSets, writes: n.writes, commands: n.commands };
    });
    expect(evidence.requests).toHaveLength(1); expect(evidence.receipts).toHaveLength(1);
    expect(evidence.receipts[0].registrationStatus).toBe('registered'); expect(evidence.inventory).toHaveLength(1);
    const stable = evidence.receipts[0].reference.reference_id;
    expect(evidence.inventory[0].reference_id).toBe(stable); expect(evidence.delivered[0].ids).toEqual([stable]);
    expect(evidence.writes).toEqual([]); expect(evidence.commands).toEqual([]);
    expect((await page.locator('.xterm-rows').innerText()).match(/\/files/g)).toHaveLength(7);
  });
  for (const outcome of ['accepted', 'rejected', 'outcome-unknown']) {
    test(`instruction presentation keeps seven pre-readiness output lines separate from authenticated /files ${outcome}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true });
      await page.addInitScript(() => {
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = async (command, args) => {
          const result = await invoke(command, args);
          if (command === 'pty_open') {
            const control = window.__nativeFixture.sessions.get(result).control;
            control.state = 'connecting';
            for (const command of control.observation.commands) for (const child of command.children) child.aliases ??= [];
            window.__nativeFixture.emit(result, '/files\r\n'.repeat(7) + '\x1b[?9001$p\x1b[5n');
          }
          if (command === 'runner_command') {
            window.__nativeFixture.sessions.get(args.id).control.results[0].phase = 'queued';
          }
          return result;
        };
      });
      await configure(page);
      const preparedIds = await page.evaluate(() => [...window.__nativeFixture.sessions.keys()]);
      await create(page);
      await expect.poll(() => page.locator('.xterm-rows').textContent()).toContain('/files');
      expect((await page.locator('.xterm-rows').textContent()).match(/\/files/g)).toHaveLength(7);
      const createdIds = await page.evaluate(prepared => [...window.__nativeFixture.sessions.keys()]
        .filter(id => !prepared.includes(id)), preparedIds);
      expect(createdIds).toHaveLength(1);
      const [sessionId] = createdIds;
      const before = await page.evaluate(() => ({ writes: window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))),
        commands: window.__nativeFixture.commands, references: window.__nativeFixture.referenceRequests,
        work: [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests) }));
      expect(before.writes.length).toBeGreaterThan(0);
      expect(before.writes.every(s => /^\x1b\[(?:\?9001;[12]\$y|0n)$/.test(s))).toBe(true);
      expect(before.commands).toEqual([]); expect(before.references).toEqual([]); expect(before.work).toEqual([]);
      await page.evaluate(id => { window.__nativeFixture.sessions.get(id).control.state = 'ready'; }, sessionId);
      await page.waitForFunction(id => JSON.parse(window.__nativeFixture.observed.get(id) || '{}').state === 'ready', sessionId);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })
        .getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      await expect(composer(page)).toBeEnabled(); await composer(page).fill('/files'); await send(page);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.commands))
        .toEqual([{ id: sessionId, command: '/files' }]);
      await expect(composer(page)).toHaveValue('/files'); await expect(composer(page)).toBeDisabled();
      if (outcome === 'accepted') {
        await page.evaluate(id => { window.__nativeFixture.sessions.get(id).control.results[0].state = 'accepted'; }, sessionId);
        await page.waitForTimeout(650);
        await expect(composer(page)).toHaveValue('/files');
      }
      await page.evaluate(({ sessionId, outcome }) => {
        const result = window.__nativeFixture.sessions.get(sessionId).control.results[0];
        Object.assign(result, { state: outcome, phase: 'completed' });
      }, { sessionId, outcome });
      await expect(composer(page)).toHaveValue(outcome === 'accepted' ? '' : '/files');
      if (outcome === 'outcome-unknown') {
        await expect(composer(page)).toBeDisabled();
        await composer(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
        await composer(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true });
      } else await expect(composer(page)).toBeEnabled();
      await page.waitForTimeout(650);
      await expect(composer(page)).toHaveValue(outcome === 'accepted' ? '' : '/files');
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: sessionId, command: '/files' }]);
      const afterWrites = await page.evaluate(() => window.__nativeFixture.writes
        .map(w => new TextDecoder().decode(new Uint8Array(w.bytes))));
      expect(afterWrites).toEqual(before.writes);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()]
        .flatMap(s => s.feature.requests).filter(r => r.operation !== 'work.list'))).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toEqual([]); await expect(entries(page)).toHaveCount(0);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()]
        .flatMap(s => s.control.references.results))).toEqual([]);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.items))).toEqual([]);
      expect((await page.locator('.xterm-rows').textContent()).match(/\/files/g)).toHaveLength(7);
    });
  }
}
