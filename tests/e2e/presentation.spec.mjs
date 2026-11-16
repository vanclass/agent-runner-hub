import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test('a later gap preserves a preceding record continued from an earlier page', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PresentationState } = await import('/src/hub/RunnerPresentation.ts');
    const state = new PresentationState();
    state.subscribe({ stream_id: 's', subscription_id: 'u', snapshot_sequence: 0, first_sequence: 1, activities: [], closed: false });
    const event = (sequence, text, start_offset, final_fragment) => ({ sequence, type: 'log', record_id: 1, text,
      spans: [{ text, style: '' }], start_offset, end_offset: start_offset + text.length,
      final_fragment, terminate_line: true, line_ending: 'ensure' });
    const base = { stream_id: 's', subscription_id: 'u', through_sequence: 3, missing_range: null, closed: false };
    state.page({ ...base, events: [event(1, 'first', 0, false)], next_sequence: 1, caught_up: false, coverage: 'complete' });
    state.page({ ...base, events: [event(2, 'second', 5, true), { type: 'gap', sequence: 3, reason: 'record_limit' }],
      next_sequence: 3, caught_up: true, coverage: 'incomplete' });
    return { text: state.records.map(r => r.text).join(''), incomplete: state.incomplete };
  });
  expect(result).toEqual({ text: 'firstsecond\n', incomplete: true });
});

test('verified generation replacement discards the old cursor', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerPresentation } = await import('/src/hub/RunnerPresentation.ts');
    const requests = [];
    const runner = new RunnerPresentation(() => {}, async (id, generation, request) => {
      requests.push({ generation, ...request });
      if (request.operation === 'presentation.subscribe') return { stream_id: 's' + generation, subscription_id: 'u' + generation,
        snapshot_sequence: 0, first_sequence: 1, activities: [], closed: false };
      return { stream_id: 's' + generation, subscription_id: 'u' + generation, events: [], next_sequence: 0,
        through_sequence: 0, caught_up: true, coverage: 'complete', missing_range: null, closed: false };
    }, 10);
    runner.observe('session', true, true, 1, false);
    while (!runner.state.caughtUp) await new Promise(r => setTimeout(r, 5));
    const old = runner.state;
    old.records.push({ id: 99, text: 'retained\n', spans: [{ text: 'retained\n', style: '' }] });
    runner.observe('session', true, true, 2, false);
    while (!runner.state.caughtUp) await new Promise(r => setTimeout(r, 5));
    runner.observe('session', true, false, 2, false);
    const lost = runner.state.mode;
    await runner.stop();
    return { reads: requests.filter(r => r.operation === 'presentation.read'), changed: old !== runner.state, lost,
      retained: runner.state.records.map(r => r.text).join('') };
  });
  expect(result.changed).toBe(true);
  expect(result.lost).toBe('failed');
  expect(result.retained).toBe('retained\n');
  expect(result.reads.some(r => r.generation === 2 && r.after_sequence === 0)).toBe(true);
});

test('unsupported control retains terminal fallback', async ({ page }) => {
  await page.goto('/');
  const mode = await page.evaluate(async () => {
    const { RunnerPresentation } = await import('/src/hub/RunnerPresentation.ts');
    const unsupported = new RunnerPresentation(() => {});
    await unsupported.stop();
    return unsupported.state.mode;
  });
  expect(mode).toBe('unsupported');
});

test('semantic state assembles Unicode fragments, formatting, blank lines and line endings', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PresentationState } = await import('/src/hub/RunnerPresentation.ts');
    const state = new PresentationState();
    state.subscribe({ stream_id: 's', subscription_id: 'u', snapshot_sequence: 0, first_sequence: 1, activities: [], closed: false });
    const log = (sequence, record_id, text, start_offset, final_fragment, ending = 'ensure') => ({ sequence, type: 'log',
      record_id, text, spans: text ? [{ text, style: 'class:presentation-heading' }] : [], start_offset,
      end_offset: start_offset + Array.from(text).length, final_fragment, terminate_line: true, line_ending: ending });
    const put = (events, next, caught_up) => state.page({ stream_id: 's', subscription_id: 'u', events, next_sequence: next,
      through_sequence: 5, caught_up, coverage: 'complete', missing_range: null, closed: false });
    put([log(1, 1, '안녕🐸', 0, false)], 1, false);
    const partial = state.records.length;
    put([log(2, 1, ' world\n', 3, true), log(3, 2, '', 0, true), log(4, 3, '\n', 0, true, 'append'),
      log(5, 4, 'done', 0, true)], 5, true);
    return { partial, text: state.records.map(r => r.text).join(''), style: state.records[0].spans[0].style,
      cursor: state.cursor, incomplete: state.incomplete };
  });
  expect(result).toEqual({ partial: 0, text: '안녕🐸 world\n\n\n\ndone\n', style: 'class:presentation-heading', cursor: 5, incomplete: false });
});

test('Activity snapshot applies at its boundary and later replace and retire do not append logs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PresentationState } = await import('/src/hub/RunnerPresentation.ts');
    const state = new PresentationState();
    const activity = (text, sequence) => ({ type: 'activity', activity_id: 'work', action: 'replace', text, spans: [{ text, style: '' }], sequence });
    state.subscribe({ stream_id: 's', subscription_id: 'u', snapshot_sequence: 2, first_sequence: 1, activities: [activity('snapshot', 2)], closed: false });
    const put = (events, next) => state.page({ stream_id: 's', subscription_id: 'u', events, next_sequence: next,
      through_sequence: 4, caught_up: next === 4, coverage: 'complete', missing_range: null, closed: false });
    put([activity('old', 1)], 1); const before = [...state.activities.values()];
    put([activity('snapshot', 2)], 2); const snapshot = [...state.activities.values()][0].text;
    put([activity('new', 3)], 3); const current = [...state.activities.values()][0].text;
    put([{ type: 'activity', sequence: 4, activity_id: 'work', action: 'retire' }], 4);
    return { before, snapshot, current, count: state.activities.size, logs: state.records.length };
  });
  expect(result).toEqual({ before: [], snapshot: 'snapshot', current: 'new', count: 0, logs: 0 });
});

test('missing ranges, gaps, truncated fragments, closed streams and foreign streams stay explicit', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PresentationState } = await import('/src/hub/RunnerPresentation.ts');
    const state = new PresentationState();
    state.subscribe({ stream_id: 's', subscription_id: 'u', snapshot_sequence: 6, first_sequence: 3, activities: [], closed: false });
    const page = { stream_id: 's', subscription_id: 'u', events: [{ type: 'gap', sequence: 3, reason: 'record_limit' },
      { type: 'log', sequence: 4, record_id: 1, text: 'lost', spans: [{ text: 'lost', style: '' }], start_offset: 4, end_offset: 8,
        final_fragment: true, terminate_line: true, line_ending: 'ensure' }], next_sequence: 4,
      through_sequence: 6, caught_up: false, coverage: 'incomplete', missing_range: [1, 2], closed: false };
    state.page(page);
    let foreign = '';
    try { state.page({ ...page, stream_id: 'other' }); } catch (error) { foreign = error.message; }
    state.page({ ...page, events: [], next_sequence: 6, caught_up: true, missing_range: [5, 6], closed: true });
    return { cursor: state.cursor, issues: [...state.issues], foreign, mode: state.mode, records: state.records };
  });
  expect(result.cursor).toBe(6); expect(result.issues.join(' ')).toContain('record_limit');
  expect(result.issues.join(' ')).toContain('missing fragment'); expect(result.foreign).toContain('identity changed');
  expect(result.mode).toBe('closed'); expect(result.records).toEqual([]);
});

test('presentation pump paginates independently, releases once, and never retries an uncertain request', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerPresentation } = await import('/src/hub/RunnerPresentation.ts');
    const calls = [];
    const presentation = new RunnerPresentation(() => {}, async (id, generation, request) => {
      calls.push({ id, generation, ...request });
      if (request.operation.endsWith('subscribe') && !request.operation.endsWith('unsubscribe'))
        return { stream_id: 's', subscription_id: 'u', snapshot_sequence: 0, first_sequence: 1, activities: [], closed: false };
      if (request.operation.endsWith('unsubscribe')) return { unsubscribed: true };
      const next = request.after_sequence + 1;
      return { stream_id: 's', subscription_id: 'u', events: [{ type: 'gap', reason: 'fixture', sequence: next }],
        next_sequence: next, through_sequence: 2, caught_up: next === 2, coverage: 'incomplete', missing_range: null, closed: next === 2 };
    }, 10);
    presentation.observe('native', true, true, 7, false);
    while (presentation.state.mode !== 'closed') await new Promise(r => setTimeout(r, 10));
    await Promise.all([presentation.stop(), presentation.stop()]);
    const failedCalls = [];
    const failed = new RunnerPresentation(() => {}, async (...args) => { failedCalls.push(args); throw new Error('lost reply'); }, 10);
    failed.observe('native', true, true, 8, false);
    await new Promise(r => setTimeout(r, 50));
    const mode = failed.state.mode; await failed.stop();
    return { calls, failedCount: failedCalls.length, mode };
  });
  expect(result.calls.map(c => c.operation)).toEqual(['presentation.subscribe', 'presentation.read', 'presentation.read', 'presentation.unsubscribe']);
  expect(result.calls.filter(c => c.operation === 'presentation.read').map(c => c.after_sequence)).toEqual([0, 1]);
  expect(result.calls.every(c => c.id === 'native' && c.generation === 7)).toBe(true);
  expect(result.failedCount).toBe(1); expect(result.mode).toBe('failed');
});
