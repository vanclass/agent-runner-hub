export function registerRunnerRestarts({ test, expect, transport, configure, create }) {
  // Production Hub orchestration with a simulated native transport, never native acceptance.
  async function owner(page, count = 1) {
    await transport(page, undefined, { auto: true, work: true, workDiscovery: true });
    await page.goto('/');
    await page.evaluate(async count => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = window.__restartOwner = new RunnerSessions();
      window.__originals = [];
      for (let i = 0; i < count; i++) {
        const { session, launched } = owner.create('/fixture/install');
        await launched; await session.control.fresh(); await session.references.verifyAssignment();
        window.__originals.push(session);
      }
    }, count);
  }
  const snapshot = page => page.evaluate(() => window.__restartOwner.restarts.snapshot);
  const cleanup = page => page.evaluate(() => window.__restartOwner.dispose());
  async function replacement(page, path, mode = 'connecting') {
    await owner(page, path === 'speculative' ? 0 : 1);
    if (path === 'speculative') {
      await page.evaluate(() => window.__restartOwner.setInstallation({ root: '/fixture/install', python: '/fixture/python' }));
      await expect.poll(() => page.evaluate(() => window.__restartOwner.spareSnapshot.state)).toBe('ready');
    } else if (path === 'hidden') {
      await page.evaluate(() => window.__restartOwner.close(window.__originals[0].view.id));
      await expect.poll(() => page.evaluate(() => window.__originals[0].reusableIdle)).toBe(true);
    }
    await page.evaluate(mode => {
      window.__replacementMode = mode;
      window.__replacementObservations = 0;
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (args.id === 'pty-2' && command === 'runner_observe') {
          window.__replacementObservations++;
          if (window.__replacementMode !== 'ready') return { state: window.__replacementMode, results: [] };
        }
        if (args.id === 'pty-2' && command === 'pty_resize' && window.__replacementMode === 'post-open')
          throw new Error('replacement initialization failed');
        return invoke(command, args);
      };
      window.__restartOwner.restartAll();
    }, mode);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  }

  test('global restart unchanged eligible pending target cannot feed its own microtask loop', async ({ page }) => {
    await owner(page, 0);
    const result = await page.evaluate(async () => {
      const { RunnerRestarts } = await import('/src/hub/RunnerRestarts.ts');
      let calls = 0, ready = true;
      const r = new RunnerRestarts(() => r.observe());
      r.request([{ name: 'eligible', ready: () => ready, restart: async () => {
        if (++calls === 8) r.dispose(); // Bound the regression probe even on the broken scheduler.
        return 'pending';
      } }]);
      const flush = () => new Promise(resolve => setTimeout(resolve, 0));
      await flush();
      for (let i = 0; i < 20; i++) r.observe();
      await flush(); const unchanged = calls;
      ready = false; r.observe(); await flush();
      ready = true; r.observe(); await flush();
      r.dispose(); return { unchanged, transitioned: calls };
    });
    expect(result).toEqual({ unchanged: 1, transitioned: 2 });
    await cleanup(page);
  });

  for (const path of ['visible', 'hidden', 'speculative']) {
    test(`global restart ${path} replacement awaits authenticated readiness after PTY open`, async ({ page }) => {
      await replacement(page, path);
      await expect.poll(() => page.evaluate(() => window.__replacementObservations)).toBeGreaterThan(1);
      expect((await snapshot(page)).restarted).toBe(0);
      expect((await snapshot(page)).running).toBe(1);
      expect(await page.evaluate(() => window.__restartOwner.restartAll())).toBe(false);
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
      await page.evaluate(() => { window.__replacementMode = 'ready'; });
      await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
      await cleanup(page);
    });
  }

  test('global restart stale authenticated observations await recovery without losing the batch', async ({ page }) => {
    await owner(page);
    await page.evaluate(async () => {
      const s = window.__originals[0], f = window.__nativeFixture.sessions.get('pty-1');
      f.control.age = 3000; await s.control.fresh().catch(() => {});
      window.__restartOwner.restartAll();
    });
    expect((await snapshot(page)).pending).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.age = 0; });
    await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
    await cleanup(page);
  });

  for (const fault of ['work.list', 'references.list', 'transient']) {
    test(`global restart bounds ${fault} revalidation and recovers the original batch`, async ({ page }) => {
      await owner(page);
      await page.evaluate(fault => {
        const s = window.__originals[0], verify = s.verifyRestart.bind(s);
        s.control.work.suspendDiscovery();
        window.__verificationCount = 0; window.__inspectionFailed = true;
        s.verifyRestart = async () => {
          window.__verificationCount++;
          if (fault === 'transient' && window.__inspectionFailed) throw new Error('transient verification');
          return verify();
        };
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = async (command, args) => {
          const op = command === 'runner_feature' ? args.request.request.operation : args.request?.operation;
          if (window.__inspectionFailed && args.id === 'pty-1' && op === fault) {
            if (fault !== 'work.list') throw new Error('inspection unavailable');
            const admission = await invoke(command, args);
            const fixture = window.__nativeFixture.sessions.get(args.id).feature;
            Object.assign(fixture.features.results.find(r => r.id === admission.id),
              { state: 'failure', phase: 'completed', reply: null, code: 'INSPECTION_UNAVAILABLE' });
            return admission;
          }
          return invoke(command, args);
        };
        window.__restartOwner.restartAll();
      }, fault);
      await expect.poll(async () => (await snapshot(page)).pending === 1
        && await page.evaluate(() => window.__verificationCount === 1)).toBe(true);
      await page.waitForTimeout(1800);
      expect(await page.evaluate(() => window.__verificationCount)).toBe(1);
      expect((await snapshot(page)).pending).toBe(1);
      expect(await page.evaluate(() => window.__originals[0].restartReady)).toBe(true);
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
      await page.evaluate(() => { window.__inspectionFailed = false; });
      await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
      expect(await page.evaluate(() => window.__verificationCount)).toBe(2);
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
      await cleanup(page);
    });
  }

  for (const path of ['visible', 'hidden', 'speculative']) {
    for (const failure of ['disconnected', 'post-open']) {
      test(`global restart ${path} replacement retains ${failure} failure without success`, async ({ page }) => {
        await replacement(page, path, failure);
        await expect.poll(async () => (await snapshot(page)).failed).toBe(1);
        expect((await snapshot(page)).restarted).toBe(0);
        expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
        expect(await page.evaluate(() => window.__restartOwner.failures.length)).toBeGreaterThan(0);
        if (path !== 'speculative') expect(await page.evaluate(() => {
          const o = window.__restartOwner;
          return o.failures.some(f => o.getFailure(f.id) === window.__originals[0]);
        })).toBe(true);
        if (path === 'speculative') {
          const detail = await page.evaluate(() => window.__restartOwner.dispose().then(() => '', reason => reason.message));
          expect(detail).toContain('cleanup');
        } else await cleanup(page);
      });
    }
  }

  test('global restart unresolved native inventory stays single flight and the UI stays responsive', async ({ page }) => {
    await owner(page);
    await page.evaluate(() => {
      window.__inventoryRequests = 0;
      window.__originals[0].control.work.suspendDiscovery();
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'runner_feature' && args.request.request.operation === 'work.list') {
          window.__inventoryRequests++;
          await new Promise(resolve => { window.__releaseInventory = resolve; });
        }
        return invoke(command, args);
      };
      window.__restartOwner.restartAll();
    });
    await expect.poll(() => page.evaluate(() => window.__inventoryRequests)).toBe(1);
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() => [window.__inventoryRequests, window.__restartOwner.restartAll()])).toEqual([1, false]);
    expect((await snapshot(page)).running).toBe(1);
    await page.evaluate(() => window.__releaseInventory());
    await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
    await cleanup(page);
  });

  test('global restart unknown inventory admission waits for authenticated inspection recovery', async ({ page }) => {
    await owner(page);
    await page.evaluate(() => {
      window.__inventoryRequests = 0; window.__inspectionFailed = true;
      window.__originals[0].control.work.suspendDiscovery();
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'runner_feature' && args.request.request.operation === 'work.list') {
          window.__inventoryRequests++;
          if (window.__inspectionFailed) throw new Error('unknown native admission');
        }
        return invoke(command, args);
      };
      window.__restartOwner.restartAll();
    });
    await expect.poll(async () => (await snapshot(page)).pending === 1
      && await page.evaluate(() => window.__inventoryRequests === 1)).toBe(true);
    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => window.__inventoryRequests)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await page.evaluate(async () => { window.__inspectionFailed = false; await window.__originals[0].control.work.refreshInventory(); });
    await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
    await cleanup(page);
  });

  for (const path of ['visible', 'hidden', 'speculative']) {
    test(`global restart ${path} pending replacement is revoked by shutdown`, async ({ page }) => {
      await replacement(page, path);
      await expect.poll(() => page.evaluate(() => window.__replacementObservations)).toBeGreaterThan(0);
      await cleanup(page);
      expect((await snapshot(page)).restarted).toBe(0);
      expect((await snapshot(page)).removed).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
    });
  }

  for (const path of ['visible', 'speculative']) {
    test(`global restart ${path} replacement revocation cannot report delayed success`, async ({ page }) => {
      await replacement(page, path);
      await expect.poll(() => page.evaluate(() => window.__replacementObservations)).toBeGreaterThan(0);
      await page.evaluate(path => {
        const o = window.__restartOwner;
        if (path === 'visible') o.close(window.__originals[0].view.id);
        else o.setInstallation(null);
        window.__replacementMode = 'ready';
      }, path);
      await expect.poll(async () => (await snapshot(page)).removed).toBe(1);
      expect((await snapshot(page)).restarted).toBe(0);
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
      await cleanup(page);
    });
  }

  test('global restart captures visible hidden and speculative owners once and preserves identity and settings', async ({ page }) => {
    await owner(page, 3);
    await page.evaluate(async () => {
      const o = window.__restartOwner, [a, b, hidden] = window.__originals;
      a.rename('Kept name');
      a.setDraft('safe unsent Hub draft');
      o.getSelections(a.view.id).setDefault('allocationPolicy', 'always-new');
      window.__beforeTabs = o.getSnapshot().map(s => ({ id: s.id, name: s.name, createdOrder: s.createdOrder }));
      o.close(hidden.view.id);
      o.setInstallation({ root: '/fixture/install', python: '/fixture/python' });
    });
    await expect.poll(() => page.evaluate(() => window.__restartOwner.spareSnapshot.state)).toBe('ready');
    await expect.poll(() => page.evaluate(() => window.__originals[2].reusableIdle)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__restartOwner.getSelections(window.__beforeTabs[0].id).initialized)).toBe(true);
    await page.evaluate(() => {
      window.__beforeDefaults = structuredClone(window.__restartOwner.getSelections(window.__beforeTabs[0].id).defaults);
    });
    expect(await page.evaluate(() => [window.__restartOwner.restartAll(), window.__restartOwner.restartAll()])).toEqual([true, false]);
    await expect.poll(async () => (await snapshot(page)).restarted).toBe(4);
    const result = await page.evaluate(() => {
      const o = window.__restartOwner, f = window.__nativeFixture;
      return { tabs: o.getSnapshot().map(s => ({ id: s.id, name: s.name, createdOrder: s.createdOrder })),
        before: window.__beforeTabs.slice(0, 2), defaults: o.getSelections(window.__beforeTabs[0].id).defaults,
        beforeDefaults: window.__beforeDefaults, draft: o.get(window.__beforeTabs[0].id).view.draft,
        count: f.count(), closed: f.closed, spare: o.spareSnapshot.state,
        persisted: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs.map(t => t.id) };
    });
    expect(result.tabs).toEqual(result.before);
    expect(result.defaults).toEqual(result.beforeDefaults);
    expect(result.draft).toBe('safe unsent Hub draft');
    expect(result.persisted).toEqual(result.tabs.map(t => t.id));
    expect(result.count).toBe(8); expect(new Set(result.closed).size).toBe(4);
    expect([...result.closed].sort()).toEqual(['pty-1', 'pty-2', 'pty-3', 'pty-4']);
    await expect.poll(() => page.evaluate(() => window.__restartOwner.spareSnapshot.state)).toBe('ready');
    const reused = await page.evaluate(async () => {
      const o = window.__restartOwner, allocated = o.allocate('/fixture/install');
      await allocated.launched;
      return { native: allocated.session.control.sessionId, count: window.__nativeFixture.count(), tabs: o.getSnapshot().length };
    });
    expect(reused.count).toBe(8); expect(reused.tabs).toBe(3);
    expect(['pty-1', 'pty-2', 'pty-3', 'pty-4']).not.toContain(reused.native);
    await cleanup(page);
    expect(await page.evaluate(() => [...new Set(window.__nativeFixture.closed)].length)).toBe(8);
  });

  for (const failure of ['cleanup', 'launch', 'post-open']) {
    test(`global restart speculative owner retains ${failure} failure resources without success`, async ({ page }) => {
      await owner(page, 0);
      await page.evaluate(() => window.__restartOwner.setInstallation({ root: '/fixture/install', python: '/fixture/python' }));
      await expect.poll(() => page.evaluate(() => window.__restartOwner.spareSnapshot.state)).toBe('ready');
      await page.evaluate(failure => {
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        window.__restoreInvoke = () => { native.invoke = invoke; };
        native.invoke = async (command, args) => {
          if (failure === 'cleanup' && command === 'pty_close' && args.id === 'pty-1') throw new Error('owned spare cleanup failure');
          if (failure === 'post-open' && command === 'pty_resize' && args.id === 'pty-2') throw new Error('replacement initialization failed');
          return invoke(command, args);
        };
        if (failure === 'launch') window.__nativeFixture.failNext();
        window.__restartOwner.restartAll();
      }, failure);
      await expect.poll(async () => (await snapshot(page)).failed).toBe(1);
      expect((await snapshot(page)).restarted).toBe(0);
      expect(await page.evaluate(() => window.__restartOwner.failures.length)).toBe(failure === 'cleanup' ? 1 : 2);
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(failure === 'cleanup' ? [] : ['pty-1']);
      const shutdown = await page.evaluate(async () => {
        window.__restoreInvoke();
        try { await window.__restartOwner.dispose(); return ''; }
        catch (reason) { return reason.message; }
      });
      // Retained, unconfirmed cleanup must remain a reported shutdown failure too.
      expect(shutdown).toContain('cleanup');
    });
  }

  for (const mode of ['direct-run', 'task-run', 'issue-run']) {
    test(`global restart waits for authoritative whole ${mode} settlement and safe release`, async ({ page }) => {
      await owner(page);
      await page.evaluate(async mode => {
        const s = window.__originals[0], f = window.__nativeFixture.sessions.get(s.control.sessionId);
        f.feature.config.current.run_mode = mode;
        await s.control.fresh(); await s.control.work.submit('one original work');
        Object.assign(f.control.observation.execution, { owned_execution_alive: true, workflow_kind: mode });
        await s.control.fresh(); window.__restartOwner.restartAll();
      }, mode);
      expect((await snapshot(page)).pending).toBe(1);
      await page.evaluate(async () => {
        const s = window.__originals[0], f = window.__nativeFixture.sessions.get(s.control.sessionId);
        // An intermediate Turn / TaskRun / IssueRun completion cannot settle the outer Work observation.
        f.control.observation.execution = { lifecycle_state: 'INTERACTIVE_READY', owned_execution_alive: false, workflow_kind: '' };
        await s.control.fresh(); await s.control.work.refreshInventory();
      });
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
      expect((await snapshot(page)).pending).toBe(1);
      await page.evaluate(async () => {
        const s = window.__originals[0], f = window.__nativeFixture.sessions.get(s.control.sessionId);
        f.feature.mode = 'succeeded';
        // Work completion alone is also insufficient while Runner still retains the workflow.
        f.control.observation.execution.workflow_kind = 'retained-work';
        await s.control.work.refreshStatus(); await s.control.fresh();
      });
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
      await page.evaluate(async () => {
        const s = window.__originals[0], f = window.__nativeFixture.sessions.get(s.control.sessionId);
        f.control.observation.execution.workflow_kind = '';
        await s.control.fresh();
      });
      await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-2').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(0);
      await cleanup(page);
    });
  }

  for (const reason of ['suspended', 'confirmation', 'unknown', 'attachment', 'config-unknown', 'work-unknown', 'incomplete', 'input-unknown', 'reference-unknown']) {
    test(`global restart keeps ${reason} pending while independent idle neighbor restarts`, async ({ page }) => {
      await owner(page, 2);
      await page.evaluate(async reason => {
        const s = window.__originals[0], f = window.__nativeFixture.sessions.get(s.control.sessionId);
        if (reason === 'suspended') f.control.observation.attention.suspension_status = 'suspended';
        if (reason === 'confirmation') f.control.observation.attention.restart_confirmation_required = true;
        if (reason === 'unknown') f.control.observation.execution.lifecycle_state = 'UNKNOWN';
        if (reason === 'attachment') s.references.select(['/fixture/unsent.png']);
        if (reason === 'config-unknown') s.control.config.applications.push({ verification: 'unknown' });
        if (reason === 'work-unknown') { f.feature.mode = 'unknown'; await s.control.work.submit('uncertain original'); }
        if (reason === 'incomplete') {
          const { terminalWork } = await import('/tests/fixtures/work.ts');
          f.feature.observations.set('terminal:1', terminalWork(1, 1, { terminal: true, state: 'incomplete', outcome: 'incomplete' }));
          await s.control.work.refreshInventory();
        }
        if (reason === 'input-unknown') {
          f.control.observation.attention.foreground_interaction_active = true;
          await s.control.fresh(); s.setDraft('unsent answer'); window.__nativeFixture.failWrite();
          try { await s.submit(); } catch {}
        }
        if (reason === 'reference-unknown') f.control.references.results.push({ id: 100, operation: 'references.register', state: 'outcome-unknown' });
        await s.control.fresh(); window.__restartOwner.restartAll();
      }, reason);
      await expect.poll(async () => (await snapshot(page)).restarted).toBe(1);
      expect((await snapshot(page)).pending).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-2']);
      expect(await page.evaluate(() => window.__restartOwner.restartAll())).toBe(false);
      if (reason === 'attachment') expect(await page.evaluate(() => window.__originals[0].references.paths)).toEqual(['/fixture/unsent.png']);
      await cleanup(page);
    });
  }

  test('global restart joins exact exit settlement before launch and handles concurrent removal once', async ({ page }) => {
    await owner(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      window.__closeCount = 0;
      native.invoke = async (command, args) => {
        if (command === 'pty_close' && args.id === 'pty-1') {
          window.__closeCount++;
          // A close acknowledgement is not an exit event.
          return;
        }
        return invoke(command, args);
      };
      window.__restartOwner.restartAll();
    });
    await expect.poll(() => page.evaluate(() => window.__closeCount)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
    await page.evaluate(() => {
      const o = window.__restartOwner, s = window.__originals[0];
      o.close(s.view.id); window.__nativeFixture.exit('pty-1', 0);
    });
    await expect.poll(async () => (await snapshot(page)).removed).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
    expect(await page.evaluate(() => window.__closeCount)).toBe(1);
    await cleanup(page);
  });

  test('global restart retains failed cleanup resources and original logs without replacement', async ({ page }) => {
    await owner(page);
    await page.evaluate(async () => {
      const s = window.__originals[0];
      await new Promise(resolve => s.terminal.write('ORIGINAL_FAILURE_LOG\r\n', resolve));
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'pty_close' && args.id === 'pty-1') throw new Error('fixture owned cleanup failed');
        return invoke(command, args);
      };
      window.__restartOwner.restartAll();
    });
    await expect.poll(async () => (await snapshot(page)).failed).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
    const retained = await page.evaluate(() => {
      const o = window.__restartOwner, failure = o.failures[0], s = o.getFailure(failure.id);
      return { same: s === window.__originals[0], detail: s.view.detail,
        log: Array.from({ length: s.terminal.buffer.active.length }, (_, i) => s.terminal.buffer.active.getLine(i).translateToString()).join('\n') };
    });
    expect(retained.same).toBe(true); expect(retained.detail).toContain('cleanup failed');
    expect(retained.log).toContain('ORIGINAL_FAILURE_LOG');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 0));
    await cleanup(page);
  });

  test('global restart reports replacement launch failure and preserves original logs', async ({ page }) => {
    await owner(page);
    await page.evaluate(async () => {
      const s = window.__originals[0];
      await new Promise(resolve => s.terminal.write('RETAIN_LAUNCH_FAILURE_LOG\r\n', resolve));
      window.__nativeFixture.failNext(); window.__restartOwner.restartAll();
    });
    await expect.poll(async () => (await snapshot(page)).failed).toBe(1);
    expect((await snapshot(page)).restarted).toBe(0);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
    const retained = await page.evaluate(() => {
      const o = window.__restartOwner, s = o.getFailure(o.failures[0].id);
      return { same: s === window.__originals[0], status: o.getSnapshot()[0].status,
        log: Array.from({ length: s.terminal.buffer.active.length }, (_, i) => s.terminal.buffer.active.getLine(i).translateToString()).join('\n') };
    });
    expect(retained.same).toBe(true); expect(retained.status).toBe('failed');
    expect(retained.log).toContain('RETAIN_LAUNCH_FAILURE_LOG');
    await cleanup(page);
  });

  test('global restart unconfirmed exit keeps original log resources and never launches a replacement', async ({ page }) => {
    await owner(page); await page.clock.install();
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => command === 'pty_close' && args.id === 'pty-1' ? undefined : invoke(command, args);
      window.__restartOwner.restartAll();
    });
    await expect.poll(() => page.evaluate(() => window.__originals[0].view.closing)).toBe(true);
    await page.clock.runFor(11000);
    await expect.poll(async () => (await snapshot(page)).failed).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
    expect(await page.evaluate(() => window.__restartOwner.getFailure(window.__restartOwner.failures[0].id) === window.__originals[0])).toBe(true);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 0)); await cleanup(page);
  });

  test('global restart success preserves the selected tab and requested settings without replay', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    const id = await page.locator('.runner-row').getAttribute('data-runner-id');
    const before = await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).inputValue();
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('keep unsent');
    await page.locator('.single-entry').click();
    await page.getByRole('button', { name: 'Restart all Runners', exact: true }).click();
    await page.locator(`[data-runner-id="${id}"] .nav-row`).click();
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed.includes('pty-1'))).toBe(true);
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await expect(page.locator(`[data-runner-id="${id}"] .nav-row`)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('keep unsent');
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toHaveValue(before);
    await page.locator('.single-entry').click();
    await expect(page.getByRole('button', { name: 'Restart all Runners', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature?.requests ?? []).filter(r => r.operation === 'work.submit').length)).toBe(0);
  });

  test('global restart retains restored recovery provenance until Runner confirms historical recovery', async ({ page }) => {
    await owner(page);
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      await window.__restartOwner.dispose();
      const o = window.__restartOwner = new RunnerSessions();
      o.setInstallation({ root: '/fixture/install', python: '/fixture/python' });
      const id = o.getSnapshot()[0].id, s = o.get(id);
      await s.control.fresh();
      window.__restoredTab = { id, context: structuredClone(s.previousContext) };
    });
    await expect.poll(() => page.evaluate(() => window.__restartOwner.get(window.__restoredTab.id).restartReady)).toBe(true);
    await page.evaluate(() => window.__restartOwner.restartAll());
    await expect.poll(async () => (await snapshot(page)).restarted).toBe(2);
    expect(await page.evaluate(() => {
      const s = window.__restartOwner.get(window.__restoredTab.id);
      return { restored: s.restored, context: s.previousContext };
    })).toEqual(await page.evaluate(() => ({ restored: true, context: window.__restoredTab.context })));
    await cleanup(page);
  });

  for (const language of ['en', 'ko']) for (const theme of ['Light', 'Black']) {
    test(`global restart action is Single Entry right-panel only and preserves drafts ${language} ${theme}`, async ({ page }, info) => {
      await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
      const id = await page.locator('.runner-row').getAttribute('data-runner-id');
      await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('retained per-tab draft');
      await page.getByRole('button', { name: 'Attach file', exact: true }).click();
      await page.locator('.app-settings-trigger').click();
      await page.getByRole('button', { name: theme, exact: true }).click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.keyboard.press('Escape');
      const label = language === 'ko' ? '전체 러너 재시작' : 'Restart all Runners';
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      await page.locator('.single-entry').click();
      // Use the production composer selector so localization of its accessible name remains independently checked.
      await page.locator('.workspace textarea').fill('retained Single Entry draft');
      const action = page.getByRole('button', { name: label, exact: true });
      await expect(action).toHaveCount(1); await expect(page.locator('.task-panel').getByRole('button', { name: label, exact: true })).toBeVisible();
      await action.click(); await expect(action).toBeDisabled();
      await expect(page.locator('.task-panel [role=status]').filter({ hasText: language === 'ko' ? '대기 1' : 'pending 1' })).toBeVisible();
      await expect(page.locator('.task-panel [role=status]').filter({ hasText: language === 'ko' ? '대기 1' : 'pending 1' })).toBeInViewport();
      await expect(page.locator('.workspace textarea')).toHaveValue('retained Single Entry draft');
      await info.attach('restart-pending', { body: await page.screenshot(), contentType: 'image/png' });
      await page.locator(`[data-runner-id="${id}"] .nav-row`).click();
      await expect(page.locator('.composer-area textarea')).toHaveValue('retained per-tab draft');
      await expect(page.locator('.attachment-chip')).toContainText('/fixture/image.png');
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      await page.reload();
      await page.locator('.single-entry').click();
      await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
      // Explicit restart intent is never persisted or restored.
      expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1'))).includes('restart'))).toBe(false);
    });
  }
}
