// Production composers; synthetic native transport, not installed-host acceptance.
import { drop } from './composer-attachments.mjs';

export function registerSlashCommands({ test, expect, transport, configure, create, entry }) {
  async function typedRun(page, fault) {
    await transport(page, undefined, { auto: true, work: true, brief: 'accepted', captureHubLog: true });
    await configure(page);
    await create(page);
    await page.evaluate(fault => {
      const fixture = window.__nativeFixture;
      const host = document.querySelector('.terminal-host');
      const tab = document.querySelector('.runner-row.active').dataset.runnerId;
      let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
      for (; fiber; fiber = fiber.return) {
        const session = fiber.memoizedProps?.session;
        if (session?.view?.id === tab && session.terminal?.element?.parentElement === host) {
          fixture.typedSessionId = session.control.sessionId;
          fixture.typedSession = session;
          break;
        }
      }
      const { run, control, feature } = fixture.sessions.get(fixture.typedSessionId);
      const features = control.features;
      feature.config.current.run_mode = 'issue-run';
      control.observation.commands.push({ id: 'run', text: '/run', visible: true, enabled: true, aliases: [], children: [] });
      const submit = run.submit.bind(run);
      run.submit = async request => {
        if (fault === 'not-sent') {
          run.requests.push(request);
          return { state: 'not-sent', detail: 'Fixture proven unsent' };
        }
        const admission = await submit(request);
        const receipt = features.results.find(r => r.id === admission.id);
        if (fault === 'wrong-generation') return { ...admission, generation: admission.generation + 1 };
        if (fault === 'wrong-request') receipt.reply.run.invocation_request_id--;
        if (fault === 'unknown') receipt.state = 'outcome-unknown';
        if (fault === 'rejected') {
          Object.assign(receipt, { state: 'rejected', reply: { outcome_unknown: false } });
        }
        if (fault === 'held') {
          fixture.typedReceipt = structuredClone(receipt);
          Object.assign(receipt, { state: 'queued', phase: 'queued', reply: undefined });
        }
        return admission;
      };
    }, fault);
    await expect.poll(() => page.evaluate(() => {
      const fixture = window.__nativeFixture;
      const observed = fixture.typedSession.control.snapshot;
      return !fixture.typedSession.control.busy && observed?.observation?.run_mode === 'issue-run'
        && observed.features.run.operations.includes('run.invoke')
        && observed.observation.commands.some(c => c.text === '/run');
    })).toBe(true);
    return page.locator('.runner-composer textarea');
  }
  const requestTrace = page => page.evaluate(() => {
    const fixture = window.__nativeFixture;
    const session = fixture.sessions.get(fixture.typedSessionId);
    return { requests: session.run.requests, staged: session.briefRequests ?? [],
      commands: fixture.commands, writes: fixture.writes };
  });
  const height = input => input.evaluate(node => node.getBoundingClientRect().height);
  const releaseTypedReceipt = page => page.evaluate(() => {
    const f = window.__nativeFixture;
    const results = f.sessions.get(f.typedSessionId).control.features.results;
    Object.assign(results.find(result => result.id === f.typedReceipt.id), f.typedReceipt);
  });

  test('typed Run clears and reopens the focused editor at the matching receipt', async ({ page }) => {
    const input = await typedRun(page, 'held');
    const base = await height(input);
    const args = '  한글 "quoted" tail\t  '.repeat(50);
    await input.fill(' \t/run\t' + args);
    expect(await height(input)).toBeGreaterThan(base);
    await input.press('Enter');
    await expect(input).toHaveAttribute('readonly', '');
    expect(await height(input)).toBeCloseTo(base, 0);
    await input.press('Enter');
    await expect.poll(() => requestTrace(page)).toEqual({
      requests: [{ operation: 'run.invoke', api_version: 1, text: args }], staged: [], commands: [], writes: [],
    });
    await page.evaluate(() => {
      const f = window.__nativeFixture;
      f.emit(f.typedSessionId, '\x1b[?9001l\x1b[?2004l');
      f.sessions.get(f.typedSessionId).control.features.results.push({ ...f.typedReceipt, id: f.typedReceipt.id + 1 });
    });
    await expect(input).toHaveAttribute('readonly', '');
    await expect(input).toHaveValue(' \t/run\t' + args);
    await releaseTypedReceipt(page);
    await expect(input).toHaveValue('');
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await input.press('Control+z');
    await expect(input).toHaveValue('');
    await page.keyboard.insertText('next 한글 draft');
    await page.evaluate(() => {
      const f = window.__nativeFixture;
      f.sessions.get(f.typedSessionId).control.features.results.find(r => r.id === f.typedReceipt.id).reply.run.dispatch_status = 'returned';
    });
    await expect(input).toHaveValue('next 한글 draft');
    await expect.poll(() => requestTrace(page)).toEqual({
      requests: [{ operation: 'run.invoke', api_version: 1, text: args }], staged: [], commands: [], writes: [],
    });
  });

  for (const fault of ['rejected', 'not-sent', 'unknown', 'wrong-generation', 'wrong-request']) {
    test(`typed Run ${fault} preserves the draft and never falls back`, async ({ page }) => {
      const input = await typedRun(page, fault);
      const base = await height(input);
      const text = 'retained 한글 '.repeat(100);
      const draft = '/run ' + text;
      await input.fill(draft);
      expect(await height(input)).toBeGreaterThan(base);
      await input.press('Enter');
      const trace = { requests: [{ operation: 'run.invoke', api_version: 1, text }], staged: [], commands: [], writes: [] };
      await expect.poll(() => requestTrace(page)).toEqual(trace);
      await expect(input).toHaveValue(draft);
      if (fault === 'not-sent' || fault === 'rejected') {
        await expect(input).toBeEditable();
        expect(await height(input)).toBeCloseTo(base, 0);
        await input.fill(draft + 'edited');
        expect(await height(input)).toBeGreaterThan(base);
        await input.press('Control+z');
        await expect(input).toHaveValue(draft);
        await input.press('Control+z');
        await expect(input).toHaveValue('');
      } else {
        await expect(input).toBeDisabled();
        expect(await height(input)).toBeCloseTo(base, 0);
        await input.dispatchEvent('keydown', { key: 'Enter', bubbles: true });
      }
      expect(await requestTrace(page)).toEqual(trace);
    });
  }

  for (const [kind, args] of [['ASCII', 'a'.repeat(4089)], ['multibyte', '한'.repeat(1363)]]) {
    test(`typed Run applies the complete UTF-8 command limit to ${kind} text`, async ({ page }) => {
      const input = await typedRun(page);
      const atLimit = ' \t/run\t' + args;
      const oversized = atLimit + ' ';
      expect(Buffer.byteLength(atLimit)).toBe(4096);
      expect(Buffer.byteLength(oversized)).toBe(4097);
      await input.fill(oversized);
      await input.press('Enter');
      await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      await expect(page.locator('.hub-log-records')).toContainText(
        'Command unsent. Runner slash commands are limited to 4096 UTF-8 bytes. Draft retained.');
      await page.locator('.runner-row .nav-row').click();
      await expect(input).toHaveValue(oversized);
      await expect(input).toBeEditable();
      expect(await requestTrace(page)).toEqual({ requests: [], staged: [], commands: [], writes: [] });

      await input.fill(atLimit);
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect.poll(() => requestTrace(page)).toEqual({
        requests: [{ operation: 'run.invoke', api_version: 1, text: args }], staged: [], commands: [], writes: [],
      });
    });
  }

  test('typed Run keeps independent Runner and Single Entry selections with their drafts', async ({ page }) => {
    const input = await typedRun(page, 'held');
    const activeTabId = () => page.locator('.runner-row.active').getAttribute('data-runner-id');
    const tab = id => page.locator(`.runner-row[data-runner-id="${id}"] .nav-row`);
    const submittingId = await activeTabId();
    await create(page);
    const otherId = await activeTabId();
    expect(otherId).not.toBe(submittingId);
    const single = page.getByRole('button', { name: 'Single Entry', exact: true });
    const editor = page.locator('textarea[data-instruction]');
    const selections = page.locator('.attachment-chip .attachment-open');
    const selectedPaths = () => selections.evaluateAll(items => items.map(item => item.title));
    const owners = [
      { open: tab(otherId), draft: 'Other Runner draft', path: '/fixture/runner-note.txt' },
      { open: single, draft: 'Single Entry draft', path: '/fixture/entry-note.txt' },
    ];
    for (const { open, draft, path } of owners) {
      await open.click();
      await editor.fill(draft);
      await drop(page, [path]);
      await expect.poll(selectedPaths).toEqual([path]);
    }
    await tab(submittingId).click();
    await expect(selections).toHaveCount(0);
    await input.fill('/run one delivery');
    await input.press('Enter');
    await expect(input).toHaveAttribute('readonly', '');
    await drop(page, ['/fixture/ignored-pending-drop.txt']);
    await expect(selections).toHaveCount(0);

    for (const { open, draft, path } of owners) {
      await open.click();
      await expect(editor).toHaveValue(draft);
      await expect.poll(selectedPaths).toEqual([path]);
    }
    await releaseTypedReceipt(page);
    await tab(submittingId).click();
    await expect(input).toHaveValue('');
    await expect(input).toBeEditable();
    await expect(selections).toHaveCount(0);
    for (const { open, draft, path } of owners) {
      await open.click();
      await expect(editor).toHaveValue(draft);
      await expect.poll(selectedPaths).toEqual([path]);
    }
    expect(await requestTrace(page)).toEqual({
      requests: [{ operation: 'run.invoke', api_version: 1, text: 'one delivery' }],
      staged: [], commands: [], writes: [],
    });
    expect(await page.evaluate(() => {
      const f = window.__nativeFixture;
      return {
        references: f.referenceRequests.filter(r => r.request.operation !== 'references.list'),
        otherRuns: [...f.sessions].filter(([id]) => id !== f.typedSessionId).flatMap(([, s]) => s.run.requests),
      };
    })).toEqual({ references: [], otherRuns: [] });
  });

  for (const path of ['Runner', 'Single Entry']) {
    for (const [text, fault] of [
      ['/status', 'completed'], ['/brief  a brief with   spaces  ', 'completed'],
      ['/recover --issue-run-id ir-42', 'completed'], ['/b alias arguments', 'completed'], ['/r --issue-run-id ir-42', 'completed'],
      ['  /status  ', 'completed'], ['\t/brief\t  indented\t body  ', 'completed'],
      ['/brief\targ', 'completed'], ['/project configure', 'completed'],
      ...['\x1c', '\x1d', '\x1e', '\x1f', '\x85', '\v', '\f', '\xa0', '\u2028', '\u2029']
        .map(w => [w + '/brief' + w + 'body', 'completed']),
      ...['\x01', '\x1b', '\x7f', '\x84', '\x86', '\x9f'].map(c => ['/brief' + c + 'body', 'invalid']),
      ['/pc --help', 'completed'], ['/project configure-more', 'invalid'],
      ['/project blocked', 'invalid'], ['prefix /status', 'invalid'], ['/unknown', 'invalid'],
      ['/briefly x', 'invalid'], ['/disabled x', 'invalid'], ['/d x', 'invalid'], ['/brief=x', 'invalid'],
      ['/brief\nsecond', 'invalid'], ['/brief\rsecond', 'invalid'], ['/brief\0arg', 'invalid'],
      ['\ufeff/status', 'invalid'],
      ...['not-sent', 'outcome-unknown', 'transport-error', 'queued', 'disconnect', 'rejected'].map(f => ['/brief  retained  ', f]),
    ]) {
      test(`slash ${path} ${fault} ${JSON.stringify(text)}`, async ({ page }) => {
        await transport(page); await configure(page); await create(page);
        await page.evaluate(fault => {
          const f = window.__nativeFixture;
          for (const { control } of f.sessions.values()) {
            for (const c of control.observation.commands) for (const child of c.children) child.aliases ??= [];
            control.observation.commands.push(...[
              { text: '/brief', aliases: ['/b'], enabled: true },
              { text: '/recover', aliases: ['/r'], enabled: true },
              { text: '/disabled', aliases: ['/d'], enabled: false },
              { text: '/project configure', aliases: ['/pc'], enabled: true },
              { text: '/project blocked', aliases: [], enabled: false },
            ].map(c => ({ id: c.text, visible: true, parent_id: null, children: [], description: '', disabled_reason: '', ...c })));
          }
          const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
          native.invoke = async (command, args) => {
            if (command !== 'runner_command') return invoke(command, args);
            f.commands.push(args);
            if (fault === 'transport-error') throw new Error('Unclassified transport failure');
            if (fault === 'not-sent' || fault === 'outcome-unknown') return { state: fault, detail: 'Fixture ' + fault };
            const control = f.sessions.get(args.id).control;
            control.results = [{ id: 731, command: args.command, state: fault === 'rejected' ? 'rejected'
              : fault === 'completed' ? 'accepted' : 'queued', phase: ['completed', 'rejected'].includes(fault) ? 'completed' : 'queued', code: 'FIXTURE' }];
            return { state: 'submitted', id: 731, generation: control.features?.generation ?? 1 };
          };
        }, fault);
        await page.waitForTimeout(650);
        const input = page.getByRole('textbox', { name: path === 'Runner' ? 'Runner instructions' : 'Single Entry instructions', exact: true });
        if (path === 'Single Entry') await entry(page, text); else await input.fill(text);
        const button = input;
        await input.press('Enter');
        if (path === 'Single Entry') {
          await expect(page.getByRole('main', { name: 'Runner workspace', exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
        }
        if (fault === 'invalid') {
          // Single Entry restores its draft through textarea.value, which normalizes CR to LF.
          await expect(input).toHaveValue(path === 'Single Entry' ? text.replace(/\r\n?/g, '\n') : text);
          expect(await page.evaluate(() => [window.__nativeFixture.commands, window.__nativeFixture.writes])).toEqual([[], []]); return;
        }
        await expect.poll(() => page.evaluate(() => window.__nativeFixture.commands.map(c => c.command))).toEqual([text]);
        if (fault === 'queued' || fault === 'disconnect') {
          await expect(input).toHaveValue(text);
          await expect(input).toBeDisabled();
          await page.evaluate(fault => {
            const c = window.__nativeFixture.sessions.get('pty-1').control;
            if (fault === 'disconnect') c.state = 'disconnected'; else c.results[0].state = 'outcome-unknown';
          }, fault);
          await page.waitForTimeout(650);
        }
        await expect(input).toHaveValue(fault === 'completed' ? '' : text);
        if (['outcome-unknown', 'transport-error', 'queued', 'disconnect'].includes(fault)) {
          await expect(input).toBeDisabled();
          if (path === 'Single Entry') await expect(button).toBeDisabled();
          await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
          if (path === 'Single Entry') await button.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
          await page.waitForTimeout(600);
        } else if (fault !== 'completed') {
          if (path === 'Runner') await expect(input).toBeEnabled();
          else {
            await expect(page.getByRole('button', { name: 'Move unsent instruction to Runner' })).toHaveCount(0);
            await expect(input).toBeEnabled();
            await expect(page.getByRole('alert').filter({ hasText: 'automatic retry' })).toHaveCount(0);
          }
        }
        expect(await page.evaluate(() => [window.__nativeFixture.commands.length, window.__nativeFixture.writes])).toEqual([1, []]);
        if (fault === 'queued') {
          await page.evaluate(() => {
            window.__nativeFixture.sessions.get('pty-1').control.results.push({ id: 732,
              command: '/status', state: 'accepted', phase: 'completed' });
          });
          await page.waitForTimeout(650);
          await expect(input).toBeDisabled();
          await page.evaluate(() => {
            const result = window.__nativeFixture.sessions.get('pty-1').control.results[0];
            result.state = 'rejected'; result.phase = 'completed';
          });
          if (path === 'Runner') await expect(input).toBeEnabled();
          else await expect(input).toBeEnabled();
          await expect(input).toHaveValue(text);
        }
      });
    }
  }
}
