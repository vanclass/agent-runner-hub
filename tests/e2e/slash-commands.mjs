// Production composers; synthetic native transport, not installed-host acceptance.
export function registerSlashCommands({ test, expect, transport, configure, create, entry }) {
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
        const button = page.getByRole('button', { name: path === 'Runner' ? 'Send instruction' : 'Assign instruction', exact: true });
        await button.click();
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
        if (fault === 'not-sent') await expect(page.getByRole('status').filter({ hasText: /unsent/i })).toBeVisible();
        if (['outcome-unknown', 'transport-error', 'queued', 'disconnect'].includes(fault)) {
          await expect(input).toBeDisabled(); await expect(button).toBeDisabled();
          await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
          await button.dispatchEvent('click');
          await page.waitForTimeout(600);
        } else if (fault !== 'completed') {
          if (path === 'Runner') await expect(input).toBeEnabled();
          else {
            await expect(page.getByRole('button', { name: 'Move unsent instruction to Runner' })).toBeVisible();
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
          else await expect(page.getByRole('button', { name: 'Move unsent instruction to Runner' })).toBeVisible();
          await expect(input).toHaveValue(text);
        }
      });
    }
  }
}
