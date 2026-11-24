import { defineStepJourney } from '@vanta-crest/moments';

export function taskTitle(runRef: string) { return `Review a small task ${runRef}`; }

export const taskJourney = defineStepJourney({
  id: 'task', title: 'Create and complete a task',
  checkpoints: [
    { id: 'draft', title: 'Empty draft', description: 'No task has been submitted.' },
    { id: 'created', title: 'Task created', description: 'One open task is stored in the backend.' },
    { id: 'completed', title: 'Task completed', description: 'That same task is complete in the backend.' }
  ],
  create({ page, baseURL, runRef }) {
    const title = taskTitle(runRef);
    // Each run owns the tasks carrying its runRef; verification reads them from the backend, not the screen alone.
    async function records() {
      const response = await page.request.get(`${baseURL}/api/tasks?runRef=${encodeURIComponent(runRef)}&verify=1`);
      if (!response.ok()) throw Error('Backend verification unavailable');
      const value = await response.json() as { id: string; runRef: string; title: string; completed: boolean }[];
      if (!Array.isArray(value) || value.length > 1 || value.some(task => task.runRef !== runRef || task.title !== title || typeof task.completed !== 'boolean')) throw Error('Task state is ambiguous');
      return value;
    }
    async function oneTask(completed: boolean) {
      const tasks = await records();
      if (tasks.length !== 1 || tasks[0]!.completed !== completed) throw Error('Task checkpoint not committed');
      await page.getByText(title, { exact: true }).waitFor();
      await page.getByRole('status').filter({ hasText: completed ? /^Completed$/ : /^Open$/ }).waitFor();
    }
    return {
      steps: {
        draft: {
          async enter() {
            await page.goto(`${baseURL}/?run=${encodeURIComponent(runRef)}`);
            await page.getByText('No tasks yet', { exact: true }).waitFor();
          },
          async verify() {
            if ((await records()).length !== 0 || await page.getByLabel('Task title', { exact: true }).inputValue() !== '') throw Error('Draft is not empty');
            await page.getByText('No tasks yet', { exact: true }).waitFor();
          }
        },
        created: {
          async enter() {
            await page.getByLabel('Task title', { exact: true }).fill(title);
            await page.getByRole('button', { name: 'Create task', exact: true }).click();
            await page.getByRole('button', { name: 'Complete task', exact: true }).waitFor();
          },
          verify: () => oneTask(false)
        },
        completed: {
          async enter() {
            await page.getByRole('button', { name: 'Complete task', exact: true }).click();
            await page.getByRole('status').filter({ hasText: /^Completed$/ }).waitFor();
          },
          verify: () => oneTask(true)
        }
      },
      async cleanup() {
        const response = await page.request.delete(`${baseURL}/api/tasks?runRef=${encodeURIComponent(runRef)}`);
        if (!response.ok()) throw Error('Cleanup failed');
        if ((await records()).length) throw Error('Owned tasks remain');
        return 'complete';
      }
    };
  }
});
