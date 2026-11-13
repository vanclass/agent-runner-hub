// Browser transport simulation; all input/state owners and React surfaces are production code.
export function registerRunnerInteractions({ test, expect, transport, configure, create, generatedFixture }) {
  const panel = page => page.getByRole('region', { name: 'Runner interaction', exact: true });
  async function ready(page, kind = 'selection', options = {}) {
    await transport(page, undefined, { work: true, auto: true, ...options }); await configure(page); await create(page);
    await page.evaluate(kind => {
      const fixture = window.__nativeFixture, session = fixture.sessions.get('pty-1');
      const features = session.control.features;
      features.interaction = { version: 1, operations: ['interaction.observe', 'interaction.respond'],
        dispatch_boundary: 'foreground_input', automatic_replay: false, lifetime: 'current_owner' };
      const makeView = (kind, revision) => ({ state: 'active', interaction_id: revision, kind,
        prompt: kind === 'confirmation' ? 'Approve canonical change?' : kind === 'text' ? 'Exact Unicode text' : 'Canonical selection',
        context: 'Canonical context', actions: [kind === 'confirmation' ? 'confirm' : kind === 'text' ? 'text' : 'select', 'back', 'cancel'],
        text_input: kind === 'text' ? { required: true, multiline: false } : null,
        choices: kind === 'text' ? [] : [
          { choice_id: 'yes', label: 'Approve explicitly', description: 'Canonical action', enabled: true, disabled_reason: '' },
          { choice_id: 'no', label: 'Reject explicitly', description: 'No approval', enabled: true, disabled_reason: '' },
          { choice_id: 'blocked', label: 'Disabled choice', description: '', enabled: false, disabled_reason: 'Canonical disabled reason' }],
        ...(kind === 'confirmation' ? { consequences: [{ text: 'Changes the canonical target', role: 'warning', details: ['Requires explicit consent'] }] } : {}) });
      window.__interactionFixture = { view: kind === 'none' ? { state: 'none' } : makeView(kind, 'revision-1'), requests: [], fault: '', next: 9000, makeView };
      session.control.observation.attention.foreground_interaction_active = kind !== 'none';
      session.control.results = kind === 'none' ? [] : [{ id: 8000, command: '/target', state: 'pending-interaction' }];
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command !== 'runner_feature' || args.request.feature !== 'interaction') return invoke(command, args);
        const f = window.__interactionFixture, request = args.request.request, id = ++f.next;
        f.requests.push({ session: args.id, ...structuredClone(request) });
        const responding = request.operation === 'interaction.respond';
        const rejected = responding && ['stale', 'owner'].includes(f.fault);
        const unknown = responding && f.fault === 'unknown';
        if (responding && !rejected && !unknown) f.view = { state: 'none' };
        if (rejected) f.view = { state: 'unsupported', code: 'INTERACTION_MULTI_SELECTION_UNSUPPORTED' };
        if (responding && f.hold) await new Promise(resolve => { f.release = resolve; });
        features.results.push({ id, feature: 'interaction', operation: request.operation,
          state: unknown ? 'outcome-unknown' : rejected ? 'rejected' : 'accepted', phase: 'completed', admission: 'queued',
          code: rejected ? 'STALE_INTERACTION' : null,
          reply: { api_version: 1, interaction: structuredClone(f.view), ...(responding ? {
            input_status: unknown ? 'unknown' : rejected ? 'not_accepted' : 'accepted', outcome_unknown: unknown,
            effect_status: unknown ? 'unknown' : 'awaiting_command_owner', interaction_status: request.action === 'cancel' ? 'cancelled' : 'completed' } : {}) } });
        if (f.delay) await new Promise(resolve => setTimeout(resolve, f.delay));
        return { state: 'submitted', id, generation: features.generation };
      };
    }, kind);
    if (kind === 'none') await expect(panel(page)).toHaveCount(0);
    else await expect(panel(page).getByRole('heading', { level: 4 })).toBeVisible();
  }
  test('subagent registered role selection delivers instruction and renders canonical result', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const f = window.__interactionFixture;
      f.view.prompt = 'Registered role';
      f.view.choices = [{ choice_id: 'interpreter', label: 'Interpreter', description: 'Registered Runner role', enabled: true, disabled_reason: '' }];
    });
    await panel(page).getByRole('button', { name: 'Interpreter', exact: true }).click();
    await expect(panel(page)).toContainText('Input accepted.');
    await page.evaluate(() => {
      const s = window.__nativeFixture.sessions.get('pty-1');
      s.control.observation.attention.foreground_interaction_active = false; s.control.results = [];
    });
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('subagent-run'));
    const input = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await expect(input).toBeEnabled(); await input.fill('exact subagent instruction'); await input.press('Enter');
    await expect.poll(() => page.evaluate(() => {
      const s = window.__nativeFixture.sessions.get('pty-1');
      return { mode: s.feature.config.current.run_mode, requests: s.feature.requests,
        result: s.feature.features.results.filter(r => r.feature === 'work'), status: document.querySelector('.runner-work-status')?.textContent };
    }), { timeout: 30000 }).toMatchObject({ status: expect.stringContaining('Verified start event') });
    await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      f.mode = 'dispatch'; Object.assign(f.work, { state: 'succeeded', terminal: true, outcome: 'succeeded',
        event_id: f.work.event_id + 1, result: { answer: 'accepted subagent answer' },
        work_id: { ...f.work.work_id, role_id: 'interpreter' } });
      f.observations.set(f.work.observation_id, structuredClone(f.work));
    });
    await expect(page.locator('.runner-work-status pre')).toContainText('accepted subagent answer');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit')))
      .toEqual([{ operation: 'work.submit', api_version: 1, instruction: 'exact subagent instruction' }]);
  });
  for (const height of [550, 800]) test(`automatic observation keeps workspace stable at ${height}`, async ({ page }, info) => {
    await ready(page, 'none', generatedFixture());
    await expect(page.locator('.generated-image-preview img')).toBeVisible();
    await page.setViewportSize({ width: 1280, height });
    await page.waitForTimeout(150); // Allow the actual viewport resize debounce to settle before polling measurements.
    await page.evaluate(() => { window.__interactionFixture.delay = 200; });
    const samples = await page.evaluate(async () => {
      const samples = [], until = performance.now() + 4200;
      while (performance.now() < until) {
        samples.push({ pending: !!document.querySelector('.runner-interaction')?.textContent.includes('receipt'),
          boxes: ['.terminal-host', '.generated-image-preview', '.runner-interaction', '.composer-area'].map(selector => {
            const { x, y, width, height } = document.querySelector(selector)?.getBoundingClientRect() ?? {};
            return { x, y, width, height };
          }), resizes: window.__nativeFixture.resizes.length });
        await new Promise(requestAnimationFrame);
      }
      return samples;
    });
    await info.attach('polling-rectangles', { body: JSON.stringify(samples), contentType: 'application/json' });
    console.log('polling rectangles', height, JSON.stringify([samples[0], samples.find(s => s.pending)]));
    expect(await page.evaluate(() => window.__interactionFixture.requests.length)).toBeGreaterThan(3);
    expect(samples.some(s => s.pending)).toBe(false);
    for (const sample of samples) expect(sample.boxes).toEqual(samples[0].boxes);
    expect(samples.at(-1).resizes).toBe(samples[0].resizes);
    await info.attach('stable-workspace', { body: await page.screenshot(), contentType: 'image/png' });
    await page.setViewportSize({ width: 900, height: height + 100 });
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.resizes.length)).toBeGreaterThan(samples.at(-1).resizes);
    await expect(page.locator('.generated-image-preview img')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const f = window.__interactionFixture;
      f.view = f.makeView('text', 'visible-after-idle');
    });
    await expect(panel(page).getByRole('textbox')).toBeVisible();
    await panel(page).getByRole('textbox').fill('draft survives polling');
    await expect.poll(() => page.evaluate(() => window.__interactionFixture.requests.length)).toBeGreaterThan(10);
    await expect(panel(page).getByRole('textbox')).toHaveValue('draft survives polling');
    await page.evaluate(() => { window.__interactionFixture.view = { state: 'none' }; });
    await expect(panel(page)).toHaveCount(0);
    await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  });
  for (const [kind, label, action, choice] of [['selection', 'Approve explicitly', 'select', 'yes'],
    ['confirmation', 'Approve explicitly', 'confirm', 'yes'], ['confirmation', 'Reject explicitly', 'confirm', 'no']]) {
    test(`structured interaction ${kind} explicit ${choice} while command remains pending`, async ({ page }, info) => {
      await ready(page, kind);
      expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond'))).toEqual([]);
      await expect(panel(page).getByRole('button', { name: 'Disabled choice', exact: true })).toBeDisabled();
      if (kind === 'confirmation') await expect(panel(page)).toContainText('Requires explicit consent');
      await page.evaluate(() => { window.__interactionFixture.hold = true; });
      await panel(page).getByRole('button', { name: label, exact: true }).click();
      await expect(panel(page).getByText('Waiting for the authenticated interaction receipt…', { exact: true })).toBeVisible();
      await page.evaluate(() => window.__interactionFixture.release());
      await expect(panel(page)).toContainText('Input accepted.');
      const result = await page.evaluate(() => ({ requests: window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond'),
        command: window.__nativeFixture.sessions.get('pty-1').control.results[0], writes: window.__nativeFixture.writes }));
      expect(result.requests).toEqual([{ session: 'pty-1', operation: 'interaction.respond', api_version: 1, interaction_id: 'revision-1', action, choice_id: choice }]);
      expect(result.command.state).toBe('pending-interaction'); expect(result.writes).toEqual([]);
      await info.attach('structured-input', { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
  for (const action of ['text', 'back', 'cancel']) {
    test(`structured interaction ${action} uses exact observation`, async ({ page }) => {
      await ready(page, action === 'text' ? 'text' : 'selection');
      const text = '  안녕 世界 🌍  ';
      if (action === 'text') { await panel(page).getByRole('textbox').fill(text); await panel(page).getByRole('button', { name: 'Submit response', exact: true }).click(); }
      else await panel(page).getByRole('button', { name: action === 'back' ? 'Back' : 'Cancel', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond').length)).toBe(1);
      const request = await page.evaluate(() => window.__interactionFixture.requests.find(r => r.operation === 'interaction.respond'));
      expect(request.action).toBe(action); expect(request.interaction_id).toBe('revision-1');
      if (action === 'text') expect(request.text).toBe(text);
      else { expect(request).not.toHaveProperty('text'); expect(request).not.toHaveProperty('choice_id'); }
    });
  }
  test('structured interaction text keeps draft focus across automatic observations', async ({ page }) => {
    await ready(page, 'text');
    const input = panel(page).getByRole('textbox');
    await input.fill('draft');
    const before = await page.evaluate(() => window.__interactionFixture.requests.length);
    await expect.poll(() => page.evaluate(() => window.__interactionFixture.requests.length)).toBeGreaterThan(before + 3);
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await page.keyboard.type(' across polling', { delay: 120 });
    await expect(input).toHaveValue('draft across polling');
    expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond'))).toEqual([]);
    await panel(page).getByRole('button', { name: 'Submit response', exact: true }).click();
    await expect(panel(page)).toContainText('Input accepted.');
    expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond'))).toHaveLength(1);
  });
  test('structured interaction uncertain text revision cannot be edited or replayed', async ({ page }) => {
    await ready(page, 'text');
    await panel(page).getByRole('textbox').fill('one explicit response');
    await page.evaluate(() => { window.__interactionFixture.fault = 'unknown'; });
    await panel(page).getByRole('button', { name: 'Submit response', exact: true }).click();
    await expect(panel(page)).toContainText('uncertain');
    await expect(panel(page).getByRole('textbox')).toBeDisabled();
    await expect(panel(page).locator('button:enabled')).toHaveCount(0);
    expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond'))).toHaveLength(1);
  });
  for (const fault of ['stale', 'owner', 'unknown']) {
    test(`structured interaction ${fault} blocks replay and terminal fallback`, async ({ page }) => {
      await ready(page);
      await page.evaluate(fault => { window.__interactionFixture.fault = fault; }, fault);
      await panel(page).getByRole('button', { name: 'Approve explicitly', exact: true }).click();
      await expect(panel(page)).toContainText(fault === 'unknown' ? 'uncertain' : 'Input rejected');
      await expect(panel(page).locator('button:enabled')).toHaveCount(0);
      expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond').length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    });
  }
  test('structured interaction generation change invalidates a pending response without replay', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === 'runner_feature' && args.request.request.operation === 'interaction.respond') {
          window.__nativeFixture.sessions.get('pty-1').control.features.generation++;
          return { ...result, generation: result.generation + 1 };
        }
        return result;
      };
    });
    await panel(page).getByRole('button', { name: 'Approve explicitly', exact: true }).click();
    await expect(panel(page)).toContainText('session changed');
    await expect(panel(page).getByRole('button')).toHaveCount(0);
    expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond').length)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
  test('structured interaction tab switching and exit never retarget responses', async ({ page }) => {
    await ready(page, 'text');
    await panel(page).getByRole('textbox').fill('unsent private reply');
    await create(page);
    await expect(panel(page)).toContainText('unsupported');
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(panel(page).getByRole('textbox')).toHaveValue('');
    await panel(page).getByRole('textbox').fill('exact owning reply');
    await panel(page).getByRole('button', { name: 'Submit response', exact: true }).click();
    await expect(panel(page)).toContainText('Input accepted.');
    expect(await page.evaluate(() => window.__interactionFixture.requests.filter(r => r.operation === 'interaction.respond')))
      .toEqual([{ session: 'pty-1', operation: 'interaction.respond', api_version: 1, interaction_id: 'revision-1', action: 'text', text: 'exact owning reply' }]);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 0));
    await expect(panel(page)).toContainText('disconnected');
    await expect(panel(page).getByRole('textbox')).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
  test('terminal read-only origin boundary preserves internal replies and browser navigation', async ({ page }) => {
    await ready(page);
    const input = page.locator('.terminal-host textarea');
    await expect(input).toHaveAttribute('readonly', '');
    await input.focus();
    for (const key of ['a', 'Enter', 'Control+c', 'Control+v', 'Shift+Enter']) await page.keyboard.press(key);
    await input.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { data: '世', bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { data: '\x1b[0n', bubbles: true, inputType: 'insertCompositionText' }));
      el.dispatchEvent(new CompositionEvent('compositionend', { data: '世界', bubbles: true }));
      const data = new DataTransfer(); data.setData('text/plain', '\x1b[0n');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b[5n\x1b[?9001$p\r\nINTERNAL-REPLIES\r\n'));
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))).join(''))).toContain('\x1b[0n');
    expect(await page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))).join(''))).toContain('\x1b[?9001;1$y');
    await page.getByRole('textbox', { name: 'Search terminal', exact: true }).fill('INTERNAL-REPLIES');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const beforeCopy = await page.evaluate(() => window.__nativeFixture.writes.length);
    await input.focus();
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('INTERNAL-REPLIES');
    expect(await page.evaluate(() => window.__nativeFixture.writes.length)).toBe(beforeCopy);
    await page.keyboard.press('Control+Home');
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toBeVisible();
  });
}
