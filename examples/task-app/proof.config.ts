// E2E-only configuration. The installed CLI owns this browser and its real bridge.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import config from './moments.config.js';
import { taskJourney, taskTitle } from './journey.js';
import type { JourneyContext } from '@alpine/moments';

const scenario = process.env.TASK_APP_SCENARIO || 'manual';
const evidence = process.env.TASK_APP_EVIDENCE!;
let controlsLaunched = false;
type ProofRun = {
  context: JourneyContext;
  tracePath: string;
  startTrace(): Promise<void>;
  stopTrace(): Promise<void>;
};
let latestRun: ProofRun | undefined;
type ProofWindow = typeof window & { proofBridge?: NonNullable<typeof window.moments>; proofCommandCount?: number;
  proofRevisionRace?: { checked: boolean; before?: number; after?: number; submitted: number } };
await mkdir(evidence, { recursive: true });
const journey = { ...taskJourney, create(context: JourneyContext) {
  const driver = taskJourney.create(context);
  const { page, baseURL, runRef } = context;
  let launched = false, faulted = false;
  let traceStarted = false;
  const proofRun: ProofRun = {
    context,
    tracePath: join(evidence, scenario === 'controls' ? `trace-${runRef}.zip` : 'trace.zip'),
    async startTrace() {
      if (traceStarted) return;
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
      traceStarted = true;
    },
    async stopTrace() {
      if (!traceStarted) return;
      await page.context().tracing.stop({ path: proofRun.tracePath });
      traceStarted = false;
    }
  };
  latestRun = proofRun;
  async function fault(fail: boolean) {
    const response = await page.request.post(`${baseURL}/api/proof/fault`, { data: { runRef, fail } });
    assert.equal(response.status(), 200);
  }
  async function state(owner = proofRun, requestedRunRef = owner.context.runRef) {
    const response = await owner.context.page.request.get(`${owner.context.baseURL}/api/tasks?runRef=${encodeURIComponent(requestedRunRef)}`);
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function settled(activity = 'ready', checkpoint?: string, owner = proofRun) {
    await expect.poll(async () => {
      const view = await owner.context.page.evaluate(() => window.moments?.read());
      return view?.activity === activity && (!checkpoint || view.lastVerified?.checkpointId === checkpoint);
    }, { timeout: 15000 }).toBe(true);
  }
  async function panelButton(name: string, owner = proofRun) {
    const button = owner.context.page.getByRole('complementary', { name: 'Moments', exact: true }).getByRole('button', { name, exact: true });
    await button.waitFor();
    await button.click();
  }
  async function exercise() {
    const assertions: string[] = [];
    const runRefs = [runRef];
    const proofRuns = [proofRun];
    let activeRun = proofRun;
    try {
      await proofRun.startTrace();
      await settled('ready', 'draft');
      await panelButton('Collapse');
      await panelButton('Show Moments');
      assertions.push('Connected panel collapses and reopens through native controls');
      if (scenario === 'manual') {
        await page.getByLabel('Task title', { exact: true }).fill(taskTitle(runRef));
        await page.getByRole('button', { name: 'Create task', exact: true }).click();
        await page.getByRole('button', { name: 'Complete task', exact: true }).waitFor();
        assert.equal((await state()).length, 1);
        await panelButton('Continue');
        await settled('ready', 'created');
        assert.equal((await state()).length, 1);
        assertions.push('Continue adopts manual creation without submitting a duplicate');
        await page.getByRole('button', { name: 'Complete task', exact: true }).click();
        await page.getByRole('status').filter({ hasText: /^Completed$/ }).waitFor();
        await panelButton('Continue');
        await settled('ready', 'completed');
        const tasks = await state();
        assert.equal(tasks.length, 1); assert.equal(tasks[0].completed, true);
        assertions.push('Continue adopts manual completion verified by independent backend read');
      } else if (scenario === 'retry') {
        await panelButton('Continue');
        await settled('needs-attention');
        let view = await page.evaluate(() => window.moments!.read());
        assert.equal(view.failure?.stage, 'verify'); assert.equal(view.failure?.checkpointId, 'created');
        assert.equal(view.lastVerified?.checkpointId, 'draft');
        assert.equal((await state()).length, 1);
        await fault(false);
        await panelButton('Check this state');
        await settled('ready', 'created');
        assert.equal((await state()).length, 1);
        view = await page.evaluate(() => window.moments!.read());
        assert.equal(view.failure, undefined);
        assertions.push('Destination verification failure is recoverable through Check without repeating create');
      } else if (scenario === 'controls') {
        const panel = page.getByRole('complementary', { name: 'Moments', exact: true });
        const confirmation = panel.getByRole('group', { name: 'Confirm fresh run' });
        const checkpoint = panel.getByLabel('Checkpoint', { exact: true });
        await page.setViewportSize({ width: 360, height: 740 });
        await panel.getByText('Checkpoint and playback', { exact: true }).click();
        const dimensions = await panel.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const content = element.querySelector('section')!;
          return { left: rect.left, right: rect.right, viewport: innerWidth, width: content.clientWidth, scroll: content.scrollWidth };
        });
        assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.viewport);
        assert.ok(dimensions.scroll <= dimensions.width, 'Panel has no horizontal overflow at 360px');
        const hostStyle = await page.getByRole('button', { name: 'Create task', exact: true }).evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, radius: style.borderRadius, padding: style.padding, color: style.color };
        });
        assert.deepEqual(hostStyle, { background: 'rgb(37, 79, 57)', radius: '6px', padding: '12px 16px', color: 'rgb(255, 255, 255)' });
        assertions.push('At 360px panel stays within viewport without horizontal overflow; host task button retains its application styles');
        await panel.getByRole('button', { name: 'Collapse', exact: true }).focus();
        await page.keyboard.press('Escape');
        assert.equal(await panel.getByRole('button', { name: 'Show Moments', exact: true }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Alt+Shift+M');
        await panel.getByRole('button', { name: 'Collapse', exact: true }).waitFor();
        assert.equal(await panel.getByRole('button', { name: 'Collapse', exact: true }).evaluate(element => element === document.activeElement), true);
        assertions.push('Escape collapses and focuses launcher; Alt+Shift+M reopens and focuses collapse control');

        async function disconnectedControls() {
          for (const name of ['Continue', 'Check this state', 'End session']) assert.equal(await panel.getByRole('button', { name, exact: true }).isDisabled(), true);
        }
        // Literal browser programs bypass TypeScript's keepNames transform for
        // nested bridge methods; their behavior remains entirely browser-local.
        await page.evaluate(`(() => {
          const proof = window;
          proof.proofBridge = window.moments; proof.proofCommandCount = 0;
          const original = proof.proofBridge;
          window.moments = { ...original, packageVersion: 'proof-incompatible',
            command(request) { proof.proofCommandCount++; return original.command(request); } };
        })()`);
        await panel.getByText(/Moments versions do not match/).waitFor();
        await disconnectedControls();
        await page.evaluate(`(() => {
          const proof = window, original = proof.proofBridge;
          window.moments = { ...original, read: async () => { throw Error('Proof connection interruption'); },
            command(request) { proof.proofCommandCount++; return original.command(request); } };
        })()`);
        await panel.getByText(/Runner connection interrupted/).waitFor();
        await disconnectedControls();
        await page.evaluate(`(() => {
          const proof = window, original = proof.proofBridge;
          window.moments = { ...original, command(request) { proof.proofCommandCount++; return original.command(request); } };
        })()`);
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.moments-package button[aria-expanded="true"]')?.disabled
          && ![...document.querySelectorAll<HTMLButtonElement>('.moments-package button')].find(button => button.textContent === 'Continue')?.disabled);
        assert.equal(await page.evaluate(() => (window as ProofWindow).proofCommandCount), 0);
        assert.equal((await state()).length, 0);
        await page.evaluate(() => { const proof = window as ProofWindow; window.moments = proof.proofBridge; });
        assertions.push('Version mismatch and connection interruption disable commands; reconnect submits no commands and creates no task');

        await panel.getByText('Checkpoint and playback', { exact: true }).click();
        await panel.getByLabel('Playback pace', { exact: true }).selectOption('demo');
        await panelButton('Play journey');
        await expect.poll(async () => {
          const view = await page.evaluate(() => window.moments!.read());
          return view.playback.kind === 'playing' && view.playback.phase === 'waiting' && view.playback.pace === 'demo' && view.lastVerified?.checkpointId === 'created';
        }, { timeout: 15000 }).toBe(true);
        await panelButton('Pause');
        await settled('ready', 'created');
        const paused = await page.evaluate(() => window.moments!.read());
        assert.equal(paused.playback.kind, 'idle');
        assert.equal((await state())[0].completed, false);
        await panelButton('Play journey');
        await settled('ready', 'completed');
        const completed = await state();
        assert.equal(completed.length, 1); assert.equal(completed[0].completed, true);
        assertions.push('Demo playback reaches a verified step, Pause stops before completing the task, and Play resumes to completion without duplicate records');

        await checkpoint.selectOption('draft');
        await panelButton('Start fresh here');
        await confirmation.waitFor();
        await panelButton('Keep exploring');
        assert.equal(await confirmation.count(), 0);
        assert.equal((await page.evaluate(() => window.moments!.read())).runRef, runRef);
        assert.equal((await state()).length, 1);
        await panelButton('Start fresh here');
        await confirmation.waitFor();
        const checked = await page.evaluate(async () => {
          const view = await window.moments!.read();
          return window.moments!.command({ runRef: view.runRef!, revision: view.revision, command: { kind: 'check' } });
        });
        assert.equal(checked.accepted, true);
        await settled('ready', 'completed');
        await confirmation.waitFor({ state: 'hidden' });
        assert.equal((await page.evaluate(() => window.moments!.read())).runRef, runRef);
        assertions.push('Fresh-run cancellation preserves the run; an actual runner revision change invalidates pending confirmation');
        await panelButton('Restart at checkpoint');
        await confirmation.waitFor();
        await panelButton('Keep exploring');
        assert.equal(await confirmation.count(), 0);
        assert.equal((await page.evaluate(() => window.moments!.read())).runRef, runRef);
        assert.equal((await state()).length, 1);
        assertions.push('Restart at the selected native checkpoint requires confirmation; cancellation preserves the current task');
        await panelButton('Restart at checkpoint');
        await confirmation.waitFor();
        await page.evaluate(`(() => {
          const proof = window;
          const original = window.moments;
          proof.proofBridge = original;
          const race = proof.proofRevisionRace = { checked: false, submitted: 0, before: undefined, after: undefined };
          let armed = false;
          const button = [...document.querySelectorAll('.moments-package button')].find(button => button.textContent === 'Start fresh');
          button.addEventListener('click', () => { armed = true; }, { capture: true, once: true });
          window.moments = { ...original,
            async read() {
              if (!armed) return original.read();
              armed = false;
              const before = await original.read();
              race.before = before.revision;
              const reply = await original.command({ runRef: before.runRef, revision: before.revision, command: { kind: 'check' } });
              if (!reply.accepted) throw Error('Proof preflight Check rejected');
              const deadline = Date.now() + 10000;
              while (Date.now() < deadline) {
                const after = await original.read();
                if (after.activity === 'ready' && after.revision !== before.revision) {
                  race.checked = true; race.after = after.revision; return after;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              throw Error('Proof preflight Check did not settle');
            },
            command(request) { race.submitted++; return original.command(request); }
          };
        })()`);
        await panelButton('Start fresh');
        await panel.getByText('The session changed. Review the current state before trying again.', { exact: true }).waitFor();
        const race = await page.evaluate(() => (window as ProofWindow).proofRevisionRace!);
        assert.equal(race.checked, true); assert.ok(race.after! > race.before!); assert.equal(race.submitted, 0);
        assert.equal((await page.evaluate(() => window.moments!.read())).runRef, runRef);
        assert.deepEqual(await state(), completed);
        await confirmation.waitFor({ state: 'hidden' });
        await page.evaluate(() => { const proof = window as ProofWindow; window.moments = proof.proofBridge; });
        assertions.push('Actual Check inside confirmed Restart preflight changes revision; hook refuses submission, replacement and predecessor cleanup');
        await panelButton('Restart at checkpoint');
        await confirmation.waitFor();
        await panelButton('Start fresh');
        await expect.poll(async () => {
          const replacement = latestRun;
          if (!replacement || replacement === proofRun || replacement.context.page.isClosed()) return false;
          // create publishes the handle before native navigation finishes.
          const view = await replacement.context.page.evaluate(() => window.moments?.read()).catch(() => undefined);
          return !!view && view.runRef === replacement.context.runRef && view.runRef !== runRef
            && view.activity === 'ready' && view.lastVerified?.checkpointId === 'draft';
        }, { timeout: 15000 }).toBe(true);
        activeRun = latestRun!;
        proofRuns.push(activeRun);
        const replacement = activeRun.context.runRef;
        runRefs.push(replacement);
        assert.equal(page.isClosed(), true, 'Confirmed restart closes the predecessor page');
        assert.equal(page.context().browser()?.isConnected(), false, 'Confirmed restart closes the predecessor browser');
        assert.ok((await stat(proofRun.tracePath)).size > 0, 'Predecessor trace flushes before context closure');
        assert.deepEqual(await state(activeRun, runRef), []);
        assertions.push('Confirmed restart closes the predecessor page/browser and retains its flushed context trace before the replacement is observed');
        await panelButton('Continue', activeRun);
        await settled('ready', 'created', activeRun);
        const replacementState = await state(activeRun);
        assert.equal(replacementState.length, 1); assert.equal(replacementState[0].completed, false);
        assert.equal(replacementState[0].runRef, replacement);
        assertions.push('A newly reviewed confirmed Restart cleans predecessor tasks and creates one independently verified task owned by the new run');
      } else if (scenario === 'signal') {
        await panelButton('Continue'); await settled('ready', 'created');
        assert.equal((await state()).length, 1);
        await proofRun.stopTrace();
        await writeFile(join(evidence, 'signal-ready.json'), JSON.stringify({ runRef, assertions: ['Live CLI has one committed task before SIGTERM'] }, null, 2));
        return;
      } else throw Error('Unknown proof scenario');
      await activeRun.stopTrace();
      for (const owned of proofRuns) assert.ok((await stat(owned.tracePath)).size > 0, 'Each exercised context retains its own trace');
      await writeFile(join(evidence, 'scenario.json'), JSON.stringify({ runRef, runRefs, scenario, assertions,
        traces: proofRuns.map(owned => ({ runRef: owned.context.runRef, path: owned.tracePath })), passed: true }, null, 2));
      await panelButton('End session', activeRun);
    } catch (error) {
      await writeFile(join(evidence, 'scenario.json'), JSON.stringify({ runRef, scenario, assertions, passed: false, error: String(error) }, null, 2));
      const owner = latestRun ?? activeRun;
      await owner.stopTrace().catch(() => {});
      const ownedPage = owner.context.page;
      const view = await ownedPage.evaluate(() => window.moments!.read()).catch(() => undefined);
      if (view?.runRef) await ownedPage.evaluate(view => window.moments!.command({ runRef: view.runRef!, revision: view.revision, command: { kind: 'end' } }), view).catch(() => {});
    }
  }
  return { ...driver,
    async enter(checkpoint: 'draft' | 'created' | 'completed') {
      if (scenario === 'controls') await proofRun.startTrace();
      await driver.enter(checkpoint);
      if (!launched && checkpoint === 'draft' && ['manual', 'retry', 'signal', 'controls'].includes(scenario)
        && (scenario !== 'controls' || !controlsLaunched)) {
        if (scenario === 'controls') controlsLaunched = true;
        launched = true; setTimeout(() => { void exercise(); }, 0);
      }
    },
    async verify(checkpoint: 'draft' | 'created' | 'completed') {
      if (!faulted && checkpoint === 'created' && ['retry', 'once-failure'].includes(scenario)) {
        faulted = true; await fault(true);
      }
      await driver.verify(checkpoint);
    },
    async cleanup() {
      try { return await driver.cleanup(); }
      finally { await proofRun.stopTrace(); }
    }
  };
} };
export default { ...config, journeys: [journey] };
