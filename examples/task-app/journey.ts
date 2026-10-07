import { defineJourney, type JourneyContext } from '@alpine/moments';

export function taskTitle(runRef: string) { return `Review a small task ${runRef}`; }

export const taskJourney = defineJourney({
  id: 'task', title: 'Create and complete a task',
  checkpoints: [
    { id: 'draft', title: 'Empty draft', description: 'No task has been submitted.' },
    { id: 'created', title: 'Task created', description: 'One open task is stored in the backend.' },
    { id: 'completed', title: 'Task completed', description: 'That same task is complete in the backend.' }
  ],
  create({ page, baseURL, runRef }: JourneyContext) {
    const title = taskTitle(runRef);
    async function records() {
      const response = await page.request.get(`${baseURL}/api/tasks?runRef=${encodeURIComponent(runRef)}&verify=1`);
      if (!response.ok()) throw Error('Backend verification unavailable');
      const value = await response.json() as { id: string; runRef: string; title: string; completed: boolean }[];
      if (!Array.isArray(value) || value.length > 1 || value.some(task => task.runRef !== runRef || task.title !== title || typeof task.completed !== 'boolean')) throw Error('Task state is ambiguous');
      return value;
    }
    return {
      async enter(checkpoint) {
        if (checkpoint === 'draft') {
          await page.goto(`${baseURL}/?run=${encodeURIComponent(runRef)}`);
          await page.getByText('No tasks yet', { exact: true }).waitFor();
        } else if (checkpoint === 'created') {
          await page.getByLabel('Task title', { exact: true }).fill(title);
          await page.getByRole('button', { name: 'Create task', exact: true }).click();
          await page.getByRole('button', { name: 'Complete task', exact: true }).waitFor();
        } else {
          await page.getByRole('button', { name: 'Complete task', exact: true }).click();
          await page.getByRole('status').filter({ hasText: /^Completed$/ }).waitFor();
        }
      },
      async verify(checkpoint) {
        const tasks = await records();
        if (checkpoint === 'draft') {
          if (tasks.length !== 0 || await page.getByLabel('Task title', { exact: true }).inputValue() !== '') throw Error('Draft is not empty');
          await page.getByText('No tasks yet', { exact: true }).waitFor();
        } else {
          if (tasks.length !== 1 || tasks[0]!.completed !== (checkpoint === 'completed')) throw Error('Task checkpoint not committed');
          await page.getByText(title, { exact: true }).waitFor();
          await page.getByRole('status').filter({ hasText: checkpoint === 'completed' ? /^Completed$/ : /^Open$/ }).waitFor();
        }
      },
      async reconcile() {
        const tasks = await records();
        if (tasks.length === 0) {
          if (await page.getByLabel('Task title', { exact: true }).inputValue() !== '') throw Error('Restore the empty draft before continuing');
          return 'draft';
        }
        return tasks[0]!.completed ? 'completed' : 'created';
      },
      async cleanup() {
        const response = await page.request.delete(`${baseURL}/api/tasks?runRef=${encodeURIComponent(runRef)}`);
        if (!response.ok()) throw Error('Cleanup failed');
        const remaining = await records();
        if (remaining.length) throw Error('Owned tasks remain');
        return 'complete';
      }
    };
  }
});
