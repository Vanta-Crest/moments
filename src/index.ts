import { openBrowser } from './browser.js';
import { openWithBrowser } from './runner.js';
import type { MomentsConfig, OpenMomentOptions } from './types.js';
export { defineJourney, MomentOpenError } from './runner.js';
export { defineConfig } from './config.js';
export type * from './types.js';
export * from './setup.js';
export function openMoment(config: MomentsConfig, options: OpenMomentOptions) { return openWithBrowser(config, options, openBrowser); }
