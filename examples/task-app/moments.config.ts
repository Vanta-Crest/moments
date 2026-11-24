import type { MomentsConfig } from '@vanta-crest/moments';
import { taskJourney } from './journey.js';

const config: MomentsConfig = {
  baseURL: process.env.TASK_APP_URL || 'http://127.0.0.1:4177',
  environment: 'Task app example, local',
  outputDir: process.env.MOMENTS_OUTPUT_DIR || '.moments/runs',
  journeys: [taskJourney],
  async beforeRun() {
    const response = await fetch(`${config.baseURL}/api/health`);
    if (!response.ok || !(await response.json()).ready) throw Error('Start the task app before opening a moment');
  }
};
export default config;
