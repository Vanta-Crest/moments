#!/usr/bin/env node
import { loadConfig, ConfigError } from './config.js';
import { openMoment, MomentOpenError } from './index.js';
import { describeMomentFailure } from './internal/protocol.js';
import type { MomentsConfig, MomentResult } from './types.js';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { evidenceRoot } from './evidence.js';
import { MAX_SETUP_BYTES, formatSetupIssues, MomentSetupError, parseSetupFile, type MomentSetupFile } from './setup.js';

const help = `Usage:
  moments list [--config <path>]
  moments open <journey.checkpoint> [--config <path>] [--once] [--headless]
  moments open [journey.checkpoint] --setup <path> [--config <path>] [--once] [--headless]
  moments --help

Config defaults to moments.config.ts in the current directory.
Relative outputDir paths resolve beside the config (default: .moments/runs).
Setup paths resolve from the current directory; a positional target must match the file.
Open uses a headed browser; use End (panel or Moments Director) or close a Moments window to finish.
--once verifies the target in a headless browser, cleans up, and exits.
--headless runs an interactive session without a visible browser.
Exit status: 0 completed, 1 incomplete, 2 invalid arguments/config,
             130 interrupted by SIGINT, 143 interrupted by SIGTERM.
`;

class UsageError extends Error {}
type Arguments = { command: 'list' | 'open'; configPath?: string; setupPath?: string; target?: string; once: boolean; headless: boolean };

function parseArguments(args: string[]): Arguments | undefined {
    if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) return undefined;
    const command = args[0];
    if (command !== 'list' && command !== 'open') throw new UsageError('Choose list or open. Use moments --help for usage.');
    let configPath: string | undefined, setupPath: string | undefined, target: string | undefined, once = false, headless = false;
    for (let i = 1; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--config') {
            const next = args[++i];
            if (configPath !== undefined || !next || next.startsWith('-')) throw new UsageError('Use --config once with a file path.');
            configPath = next;
        } else if (arg === '--setup') {
            const next = args[++i];
            if (command !== 'open' || setupPath !== undefined || !next || next.startsWith('-')) throw new UsageError('Use --setup once with a file path on moments open.');
            setupPath = next;
        } else if (arg === '--once') {
            if (command !== 'open' || once) throw new UsageError('--once is available once with moments open.');
            once = true;
        } else if (arg === '--headless') {
            if (command !== 'open' || headless) throw new UsageError('--headless is available once with moments open.');
            headless = true;
        } else if (!arg.startsWith('-') && command === 'open' && target === undefined) {
            target = arg;
        } else {
            throw new UsageError('Unexpected argument. Use moments --help for usage.');
        }
    }
    if (command === 'open' && !target && !setupPath) throw new UsageError('Choose a target: moments open <journey.checkpoint>, or use --setup <path>. Use moments list to see targets.');
    return { command, configPath, setupPath, target, once, headless };
}

async function readSetupFile(filePath: string): Promise<MomentSetupFile> {
    const path = resolve(process.cwd(), filePath);
    let content: Buffer;
    try {
        const info = await stat(path);
        if (!info.isFile()) throw Error();
        if (info.size > MAX_SETUP_BYTES) throw new UsageError('Run setup file exceeds 64 KiB.');
        content = await readFile(path);
    } catch (error) {
        if (error instanceof UsageError) throw error;
        throw new UsageError('Cannot read run setup file. Check the path passed to --setup.');
    }
    if (content.byteLength > MAX_SETUP_BYTES) throw new UsageError('Run setup file exceeds 64 KiB.');
    try { return parseSetupFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content))); }
    catch (error) { if (error instanceof MomentSetupError) throw error; throw new UsageError('Invalid run setup file. Check its version, fields and complete public values.'); }
}

/** One line per checkpoint through the furthest of the target and anything observed. */
function checkpointSummary(result: MomentResult, checkpoints: readonly { id: string; title: string }[]): string {
    const touched = [result.target, ...result.observations.map(o => o.checkpointId), ...result.failures.flatMap(f => f.checkpointId ?? [])];
    const last = Math.max(...touched.map(id => checkpoints.findIndex(point => point.id === id)));
    return checkpoints.slice(0, last + 1).map(point => {
        const observed = result.observations.filter(o => o.checkpointId === point.id).at(-1);
        const failedLater = result.failures.some(f => f.checkpointId === point.id && (!observed || f.at >= observed.at));
        const status = failedLater ? 'failed' : observed?.status ?? 'not reached';
        const provenance = observed && !failedLater && observed.provenance !== 'native' ? ` (${observed.provenance})` : '';
        return `  ${status.padEnd(12)}${point.title}${provenance}\n`;
    }).join('');
}

async function firstLine(path: string): Promise<string | undefined> {
    try { return (await readFile(path, 'utf8')).split('\n')[0] || undefined; } catch { return undefined; }
}

/** Tooling reads `<outputDir>/latest.json` instead of guessing the newest receipt by time. */
async function writeLatest(outputDir: string, pointer: object): Promise<void> {
    const temporary = join(outputDir, `.latest.${process.pid}.tmp`);
    try {
        await writeFile(temporary, JSON.stringify(pointer, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, join(outputDir, 'latest.json'));
    } catch {
        await rm(temporary, { force: true });
        process.stderr.write('Moments: latest.json could not be written.\n');
    }
}

async function reportResult(result: MomentResult, config: MomentsConfig): Promise<void> {
    const receipt = config.writeReceipt ? undefined : resolve(config.outputDir ?? ".moments/runs", `${result.runRef}.json`);
    const root = evidenceRoot(config);
    const evidence = (relative?: string) => root && relative ? join(root, relative) : undefined;
    process.stdout.write(`Run reference: ${result.runRef}\n`);
    if (receipt) process.stdout.write(`Run receipt: ${receipt}\n`);
    process.stdout.write(`Moments: ${result.outcome}; cleanup: ${result.cleanup}.\n`);
    const journey = config.journeys.find(item => item.id === result.journeyId);
    if (result.failures.length) {
        const stages = [...new Set(result.failures.map(failure => failure.stage))].join(', ');
        process.stderr.write(`Moments: needs attention at ${stages}. Inspect the run receipt for details.\n`);
        for (const failure of result.failures) {
            const checkpoint = journey?.checkpoints.find(point => point.id === failure.checkpointId);
            const file = evidence(failure.evidence), detail = file && await firstLine(file);
            process.stderr.write(file && detail
                ? `${checkpoint ? `Checkpoint "${checkpoint.title}" failed` : 'Run failed'} at ${failure.stage}: ${detail} (evidence: ${file})\n`
                : `${describeMomentFailure(failure, checkpoint)}\n`);
        }
        if (result.failures.some(failure => failure.code === 'persistence-failed'))
            process.stderr.write('Moments: receipt persistence failed; durable recovery was not established.\n');
    }
    if (journey) process.stdout.write(`Checkpoints:\n${checkpointSummary(result, journey.checkpoints)}`);
    const first = evidence(result.failures.find(failure => failure.evidence)?.evidence);
    if (receipt) await writeLatest(config.outputDir!, { runRef: result.runRef, receipt, outcome: result.outcome, ...(first ? { evidence: first } : {}) });
}

async function main(): Promise<number> {
    const args = parseArguments(process.argv.slice(2));
    if (!args) { process.stdout.write(help); return 0; }
    const file = args.setupPath ? await readSetupFile(args.setupPath) : undefined;
    const fileTarget = file ? `${file.journeyId}.${file.checkpointId}` : undefined;
    if (args.target && fileTarget && args.target !== fileTarget)
        throw new UsageError('The positional target must exactly match the run setup file.');
    const target = fileTarget ?? args.target;
    const controller = new AbortController();
    let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
    const interrupt = (signal: 'SIGINT' | 'SIGTERM') => {
        if (!interrupted) {
            interrupted = signal;
            process.stderr.write('Moments: stopping; waiting for cleanup and the run receipt.\n');
            controller.abort();
        }
    };
    const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    try {
        const config = await loadConfig(args.configPath);
        if (controller.signal.aborted) return interrupted === 'SIGTERM' ? 143 : 130;
        if (args.command === 'list') {
            for (const journey of config.journeys) {
                for (const checkpoint of journey.checkpoints) {
                    process.stdout.write(`${journey.id}.${checkpoint.id}\t${journey.title} / ${checkpoint.title}\n`);
                }
            }
            return 0;
        }
        const split = target!.lastIndexOf('.');
        const journey = config.journeys.find(item => item.id === target!.slice(0, split));
        if (split < 1 || !journey?.checkpoints.some(checkpoint => checkpoint.id === target!.slice(split + 1))) {
            throw new UsageError('Unknown target. Use moments list to see available journey.checkpoint targets.');
        }
        try {
            const session = await openMoment(config, {
                target: target!, ...(file ? { setup: file.setup } : {}), once: args.once, headless: args.once || args.headless, signal: controller.signal
            });
            if (!args.once && !controller.signal.aborted) process.stdout.write(config.director
                ? 'Moments: ready. Use the Moments Director window to move through the journey; End or closing either window finishes.\n'
                : 'Moments: ready. Explore the browser, then use End or close the browser to finish.\n');
            const result = await session.done;
            await reportResult(result, config);
            return interrupted ? (interrupted === 'SIGTERM' ? 143 : 130) : result.outcome === 'incomplete' ? 1 : 0;
        } catch (error) {
            if (error instanceof MomentSetupError) throw error;
            if (error instanceof MomentOpenError) await reportResult(error.result, config);
            else process.stderr.write('Moments: could not finish the run. Check your app and configuration, then inspect any run receipt.\n');
            return interrupted ? (interrupted === 'SIGTERM' ? 143 : 130) : 1;
        }
    } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
    }
}

main().then(code => { process.exitCode = code; }).catch(error => {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof MomentSetupError) {
        process.stderr.write(`Moments: ${error.message}\n`);
        if (error instanceof MomentSetupError) process.stderr.write(`${formatSetupIssues(error.issues)}\n`);
        process.exitCode = 2;
    } else {
        process.stderr.write('Moments: unable to complete this command. Check your configuration and try again.\n');
        process.exitCode = 1;
    }
});
