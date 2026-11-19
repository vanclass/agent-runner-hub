import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';
import { spawnSync } from 'node:child_process';

test('TaskRun generated boundary agrees with canonical Runner parser', async ({ page }) => {
  test.skip(!process.env.RUNNER_SOURCE_ROOT || !process.env.RUNNER_PYTHON, 'Requires the available Runner source and Python environment');
  await page.goto('/');
  const cases = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { prepareTaskRunInstruction } = await import('/src/hub/runnerSubmission.ts');
    const { service } = createConfigHarness(); await service.inspect();
    return ['Task: Fix the login error\nPriority: High', 'Owner: body', 'Project: body', 'Reasoning: HIGH',
      'Other: value', '- Owner: body', '* Project: body', 'Task:',
      ' \n\tTask: 안녕 🌍  \nPriority: High\n', ' \r\n  Task: 안녕 🌍\r\nPriority: High\r\n', 'Goal\n안녕'].map(body => ({
      body, prepared: prepareTaskRunInstruction(body, { binding_state: 'bound', owner: 'Workspace', project: '' }, service.catalog),
    }));
  });
  const script = `import json, sys\nfrom runner.session.target import parse_target_block_from_text\nfor case in json.load(sys.stdin):\n t = parse_target_block_from_text(case['prepared'], source_path='hub-integration')\n eol = '\\r\\n' if '\\r\\n' in case['body'] else '\\n'\n expected = case['body'] if case['body'].startswith('Goal') else 'Goal' + eol + case['body']\n assert t.instruction_text.encode('utf-8') == expected.encode('utf-8')\n assert (t.owner, t.project, t.reasoning) == ('Workspace', 'codex_workspace', None)\nprint('canonical parser cases:', len(json.loads(sys.argv[1])))`;
  const result = spawnSync(process.env.RUNNER_PYTHON, ['-c', script, JSON.stringify(cases)], {
    input: JSON.stringify(cases), encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PYTHONPATH: process.env.RUNNER_SOURCE_ROOT, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('canonical parser cases: 11');
});

test('TaskRun complete identity needs no defaults; ambiguous defaults reject and Workspace is canonical', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { prepareTaskRunInstruction: prepare } = await import('/src/hub/runnerSubmission.ts');
    const { service } = createConfigHarness(); await service.inspect();
    const complete = '\n\ufeffTarget\r\n Owner : Project \r\nProject: Explicit\r\nGoal\r\nTarget\r\nOwner: body';
    const explicit = prepare(complete, undefined, service.catalog);
    const target = { binding_state: 'bound', owner: 'Workspace', project: '' };
    const workspace = prepare('Goal\n안녕', target, service.catalog);
    const bare = prepare('Target', target, service.catalog);
    service.catalog.options.targets.push({ ...service.catalog.options.targets[0] });
    let ambiguous = false; try { prepare('Goal', target, service.catalog); } catch { ambiguous = true; }
    return { complete, explicit, workspace, bare, ambiguous };
  });
  expect(result.explicit).toBe(result.complete);
  expect(result.workspace).toBe('Target\nOwner: Workspace\nProject: codex_workspace\n\nGoal\n안녕');
  expect(result.bare).toBe('Target\nOwner: Workspace\nProject: codex_workspace\n');
  expect(result.ambiguous).toBe(true);
});

test('TaskRun exact text and instruction-owned configuration', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { submitConfiguredWork } = await import('/src/hub/runnerSubmission.ts');
    const complete = 'Target\r\nOwner: Project\r\nProject: Explicit\r\nReasoning: max\r\nGoal\r\n안녕 🌍';
    const partial = 'Target\nOwner: Project\nGoal\nProject: body';
    const bodies = ['Task: Fix the login error\nPriority: High', 'Owner: body', 'Project: body',
      'Reasoning: HIGH', 'Other: value', '- Owner: body', '* Project: body', 'Task:',
      '  \n\tTask: 안녕 🌍  \nPriority: High\n', ' \r\n  Task: 안녕 🌍\r\nPriority: High\r\n'];
    const cases = [...bodies.map(text => {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      return [text, `Target${eol}Owner: Project${eol}Project: Exact${eol}${eol}Goal${eol}${text}`];
    }), [complete, complete], [partial, partial.replace('Target\n', 'Target\nProject: Exact\n')],
      ['Target\n* Project: Explicit\nGoal', 'Target\nOwner: Project\n* Project: Explicit\nGoal'],
      ['Goal\r\nTarget\r\nOwner: body', 'Target\r\nOwner: Project\r\nProject: Exact\r\n\r\nGoal\r\nTarget\r\nOwner: body'],
      ...['minimum', 'low', 'medium', 'high', 'xhigh', 'max'].map(g => {
        const text = `\n\ufeffTarget\n- OWNER : Project\n* Project: Explicit\nReasoning: ${g}\nOther: retained\nGoal\nReasoning: body`; return [text, text]; }),
      ...['Owner: Project\nOwner: Project', 'Owner:', 'Reasoning: HIGH', 'Reasoning: high\nReasoning: low', 'Owner: Unknown', 'Other:'].map(s => {
        const text = `Target\n${s}\nGoal\n안녕`; return [text, text]; })];
    const results = [];
    for (const runMode of ['task-run', undefined]) for (const [instruction, expected] of cases) {
      const { fixture, service } = createConfigHarness(); const sent = []; let admissions = 0;
      const work = { supports: () => true, blocked: false, busy: false, submit: async text => { sent.push(text); return {}; } };
      await submitConfiguredWork(service, work, { accountIdentity: fixture.current.account, runMode,
        target: { binding_state: 'bound', owner: 'Project', project: 'Exact' },
        model: { model: 'missing', reasoning_effort: 'high', service_tier: 'fast' } }, instruction, async () => { admissions++; });
      results.push({ expected, sent, admissions, runMode, current: fixture.current,
        plans: fixture.requests.filter(r => r.operation === 'session_config.plan').map(r => r.desired),
        applies: fixture.requests.filter(r => r.operation === 'session_config.apply').length });
    }
    for (const target of [undefined, { binding_state: 'unset', owner: '', project: '' }, { binding_state: 'bound', owner: 'Project', project: 'Missing' }]) {
      const { fixture, service } = createConfigHarness(); let submitted = false, admitted = false, rejected = false;
      try { await submitConfiguredWork(service, { supports: () => true, blocked: false, busy: false, submit: async () => { submitted = true; } },
        { accountIdentity: fixture.current.account, runMode: 'task-run', target }, 'original draft', async () => { admitted = true; }); }
      catch { rejected = true; }
      results.push({ submitted, admitted, rejected });
    }
    return results;
  });
  for (const result of results) {
    if ('rejected' in result) { expect(result).toEqual({ submitted: false, admitted: false, rejected: true }); continue; }
    expect(result.sent).toEqual([result.expected]); expect(result.admissions).toBe(1);
    expect(result.plans).toEqual([{ account: { agent_id: 'codex', profile_name: 'first' }, ...(result.runMode ? { run_mode: result.runMode } : {}) }]);
    expect(result.applies).toBe(0); expect(result.current.target).toBe('workspace');
    expect(result.current.model).toEqual({ id: 'm0', reasoning_effort: 'medium' });
  }
});
