import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineJourney } from './runner.js';
import type { MomentsConfig } from './types.js';

/** Preserve inference while authoring a Moments configuration. */
export function defineConfig(config: MomentsConfig): MomentsConfig {
    return config;
}

export class ConfigError extends Error {
    constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

function validateConfig(value: unknown): asserts value is MomentsConfig {
    if (!value || typeof value !== 'object') throw new ConfigError('The config must have a default export containing a Moments configuration.');
    const config = value as Partial<MomentsConfig>;
    try {
        if (typeof config.baseURL !== 'string') throw Error();
        const url = new URL(config.baseURL);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
        if (typeof config.beforeRun !== 'function' || !Array.isArray(config.journeys) || !config.journeys.length) throw Error();
        const ids = new Set<string>();
        for (const journey of config.journeys) {
            defineJourney(journey);
            if (typeof journey.create !== 'function' || ids.has(journey.id)) throw Error();
            ids.add(journey.id);
        }
        if (config.outputDir !== undefined && (typeof config.outputDir !== 'string' || !config.outputDir.trim())) throw Error();
        if (config.writeReceipt !== undefined && typeof config.writeReceipt !== 'function') throw Error();
        if (config.outputDir !== undefined && config.writeReceipt !== undefined) throw Error();
    } catch {
        throw new ConfigError('Invalid Moments config. Check baseURL, journeys, beforeRun, and either outputDir or writeReceipt.');
    }
}

/** Only the requested config and its imports use the scoped TypeScript loader. */
export async function loadConfig(configPath?: string, cwd = process.cwd()): Promise<MomentsConfig> {
    const path = resolve(cwd, configPath ?? 'moments.config.ts');
    try {
        if (!(await stat(path)).isFile()) throw Error();
    } catch {
        throw new ConfigError(configPath === undefined
            ? 'No moments.config.ts found in the current directory. Create it or use --config <path>.'
            : 'Cannot read the requested config file. Check the path passed to --config.');
    }
    let value: unknown;
    try {
        const { tsImport } = await import('tsx/esm/api');
        const loaded = await tsImport(path, import.meta.url);
        value = loaded.default;
        // A .ts file outside an ESM package is transformed as CommonJS. Node
        // wraps that module's exports, so its authored default lives one level in.
        if (value && typeof value === 'object' && '__esModule' in value && value.__esModule === true && 'default' in value) {
            value = value.default;
        }
    } catch {
        throw new ConfigError('Could not load the config. Check its syntax, imports, and default export.');
    }
    validateConfig(value);
    if (value.writeReceipt !== undefined) return value;
    return { ...value, outputDir: resolve(dirname(path), value.outputDir ?? '.moments/runs') };
}
