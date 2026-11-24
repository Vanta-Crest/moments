# Your first journey

This tutorial takes you from an empty folder to a verified, recorded and reviewable run in about fifteen minutes.

You will drive the example task app as if it were your own application, so every command here works as written. At the end, [Adapting it to your application](#adapting-it-to-your-application) lists what to change.

## 1. Start the application

Follow [Try it](../README.md#try-it-in-five-minutes) as far as `npm start`, and leave the task app running at `http://127.0.0.1:4177`.

## 2. Create a project for your journeys

In a second terminal, outside the Moments repository:

```sh
mkdir my-journeys && cd my-journeys
npm init -y
npm pkg set type=module
npm install --save-dev @vanta-crest/moments @playwright/test
npx playwright install chromium
```

## 3. Write the journey

A journey is an ordered list of checkpoints, with one step per checkpoint. Each step says how to reach the checkpoint (`enter`) and how to prove it from the product (`verify`). Create `journey.ts`:

```ts
import { defineStepJourney } from '@vanta-crest/moments';

export const firstTask = defineStepJourney({
  id: 'first-task',
  title: 'Record a first task',
  checkpoints: [
    { id: 'empty', title: 'Empty list', description: 'No task exists for this run.' },
    { id: 'created', title: 'Task created', description: 'One open task is shown and stored.', actor: 'Reviewer, task owner' },
  ],
  create({ page, baseURL, runRef }) {
    // Everything this run creates carries its runRef, so cleanup removes exactly that and nothing else.
    const title = `First task ${runRef}`;
    async function stored() {
      const response = await page.request.get(`${baseURL}/api/tasks?runRef=${runRef}`);
      if (!response.ok()) throw Error('The task API did not answer');
      return (await response.json()) as { title: string; completed: boolean }[];
    }
    return {
      steps: {
        empty: {
          async enter() {
            await page.goto(`${baseURL}/?run=${runRef}`);
          },
          async verify() {
            if ((await stored()).length !== 0) throw Error('Expected no tasks for this run');
            await page.getByText('No tasks yet', { exact: true }).waitFor();
          },
        },
        created: {
          async enter() {
            await page.getByLabel('Task title').fill(title);
            await page.getByRole('button', { name: 'Create task' }).click();
          },
          async verify() {
            const tasks = await stored();
            if (tasks.length !== 1 || tasks[0].completed) throw Error('Expected one open task for this run');
            await page.getByText(tasks[0].title, { exact: true }).waitFor();
          },
        },
      },
      async cleanup() {
        const response = await page.request.delete(`${baseURL}/api/tasks?runRef=${runRef}`);
        if (!response.ok()) throw Error('Could not delete this run’s tasks');
        return 'complete';
      },
    };
  },
});
```

`verify` reads the backend and the screen. A checkpoint that only looks right is not proven. It accepts any one open task, whoever created it: that lets Moments adopt a task you create by hand in step 7.

## 4. Write the config

Create `moments.config.ts` beside it:

```ts
import { defineConfig } from '@vanta-crest/moments';
import { firstTask } from './journey.js';

export default defineConfig({
  baseURL: 'http://127.0.0.1:4177',
  environment: 'Task app, my machine',
  journeys: [firstTask],
  async beforeRun() {
    const response = await fetch('http://127.0.0.1:4177/api/health');
    if (!response.ok) throw Error('Start the task app first');
  },
});
```

`environment` names the system for anyone reading the record later. `beforeRun` runs before any browser opens; if it throws, nothing else happens.

## 5. List and run

```sh
npx moments list
```

```text
first-task.empty	Record a first task / Empty list
first-task.created	Record a first task / Task created
```

Run to the last checkpoint without a visible browser, then clean up:

```sh
npx moments open first-task.created --once
```

Progress goes to stderr as it happens, then a summary:

```text
  0:00  entering    Empty list
  0:01  verified    Empty list
  0:01  entering    Task created
  0:02  verified    Task created
Run reference: 6f0d7c1e-…
Run receipt: /…/my-journeys/.moments/runs/6f0d7c1e-….json
Moments: complete; cleanup: complete.
Checkpoints:
  passed      Empty list
  passed      Task created
```

The exit status is 0 when the run completed and 1 when it did not.

## 6. Read the result

The receipt is the record of the run. It names the system, the journey as it stood, each observation and how it was made, and whether cleanup completed. `.moments/runs/latest.json` points at the newest one. [Reference](reference.md#receipt) shows every field.

Check that nothing has changed since the run ended, then write a page a reviewer can read:

```sh
npx moments verify
npx moments report
```

`report` prints `Run sheet: <path>.html`. Open it in a browser. It shows screens from the run, so it is private: review it before sharing.

## 7. Take over by hand

```sh
npx moments open first-task.empty
```

A browser opens at the empty list, held there by Moments. The task app embeds the Moments panel, so you will see it on the page. Create a task yourself, with any title, then press **Continue** in the panel.

Moments works out where the application now is, verifies it, and records "Task created" as reached **By hand**. It does not create a second task. Had you created two tasks, no checkpoint would match, the panel would say so, and nothing would be repeated: Moments adopts only what it can prove.

Press **End session**. Moments deletes only this run's tasks and closes the browser.

## Adapting it to your application

- Set `baseURL` and `beforeRun` to your application and a cheap health check.
- Replace the selectors and API calls with your own. Prefer roles and labels, as here.
- Key every record a run creates on `runRef`, and have `cleanup` remove exactly those.
- Add `.moments/` to your `.gitignore`. See [Evidence and review](guides/evidence-and-review.md#keeping-and-deleting).

Next: [Writing journeys](guides/writing-journeys.md) covers the driver contract, adoption and cleanup in depth.
