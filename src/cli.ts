#!/usr/bin/env node
import { loadConfig, ConfigError } from './config.js';
import { openMoment, MomentOpenError } from './index.js';
import { describeMomentFailure } from './internal/protocol.js';
import type { MomentEvent, MomentsConfig, MomentResult } from './types.js';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FILE_ONLY_STAGES, evidenceRoot } from './evidence.js';
import { checkManifest, exists, manifestPath, writeManifest, writeReport } from './record.js';
import { MAX_SETUP_BYTES, formatSetupIssues, MomentSetupError, parseSetupFile, type MomentSetupFile } from './setup.js';

const help = `Usage:
  moments list [--config <path>]
  moments open <journey.checkpoint> [--config <path>] [--once] [--headless] [--resume] [--output <dir>]
               [--record [--chapters] | --window <width>x<height>]
  moments open [journey.checkpoint] --setup <path> [same options]
  moments verify [runRef] [--config <path>] [--output <dir>]
  moments report [runRef] [--config <path>] [--output <dir>]
  moments --help

Config defaults to moments.config.ts in the current directory.
Relative outputDir paths resolve beside the config (default: .moments/runs).
Setup paths resolve from the current directory; a positional target must match the file.
Open uses a headed browser; use End (panel or Moments Director) or close a Moments window to finish.
--once verifies the target in a headless browser, cleans up, and exits.
--headless runs an interactive session without a visible browser.
--resume verifies each checkpoint before entering it; one already there is recorded
         as existing and not entered. Entering starts at the first that fails.
--output writes receipts and latest.json to <dir> (relative to the current directory)
         for this run; failure evidence goes to <dir>/../evidence unless evidenceDir is set.
--record films the run privately beside its failure evidence: a WebM per stretch between
         private checkpoints, timeline.json, and the frame at each verified checkpoint.
         latest.json points at it. A recording failure never fails the run.
--chapters draws each checkpoint's title into the recording as it is verified.
--window sizes the application window's page area, for presenting (for example 1280x720).
verify   recomputes the fingerprints in a run's manifest, written beside its receipt when
         the run ends; exits 1 if any receipt, evidence or recording file changed.
report   writes <runRef>.html beside the receipt: a private run sheet with each checkpoint,
         who acted, how it was verified and its frame. Both default to the latest run.
Progress lines go to stderr as each checkpoint is entered and verified.
A failed step prints its message and a local evidence file (message, URL, screenshot).
Exit status: 0 completed, 1 incomplete, 2 invalid arguments/config,
             130 interrupted by SIGINT, 143 interrupted by SIGTERM.
`;

class UsageError extends Error {}
type Arguments = { command: 'list' | 'open' | 'verify' | 'report'; configPath?: string; setupPath?: string; outputPath?: string; target?: string; once: boolean; headless: boolean; resume: boolean; record: boolean; chapters: boolean; window?: { width: number; height: number } };

function parseArguments(args: string[]): Arguments | undefined {
    if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) return undefined;
    const command = args[0];
    if (command !== 'list' && command !== 'open' && command !== 'verify' && command !== 'report') throw new UsageError('Choose list, open, verify or report. Use moments --help for usage.');
    const run = command === 'verify' || command === 'report';
    let configPath: string | undefined, setupPath: string | undefined, outputPath: string | undefined, target: string | undefined, once = false, headless = false, resume = false, record = false, chapters = false;
    let window: { width: number; height: number } | undefined;
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
        } else if (arg === '--output') {
            const next = args[++i];
            if (command === 'list' || outputPath !== undefined || !next || next.startsWith('-')) throw new UsageError('Use --output once with a directory on moments open, verify or report.');
            outputPath = next;
        } else if (arg === '--once') {
            if (command !== 'open' || once) throw new UsageError('--once is available once with moments open.');
            once = true;
        } else if (arg === '--resume') {
            if (command !== 'open' || resume) throw new UsageError('--resume is available once with moments open.');
            resume = true;
        } else if (arg === '--record') {
            if (command !== 'open' || record) throw new UsageError('--record is available once with moments open.');
            record = true;
        } else if (arg === '--chapters') {
            if (command !== 'open' || chapters) throw new UsageError('--chapters is available once with moments open.');
            chapters = true;
        } else if (arg === '--window') {
            const size = /^(\d{3,4})x(\d{3,4})$/.exec(args[++i] ?? '');
            if (command !== 'open' || window || !size) throw new UsageError('Use --window once with a size such as 1280x720 on moments open.');
            window = { width: Number(size[1]), height: Number(size[2]) };
        } else if (arg === '--headless') {
            if (command !== 'open' || headless) throw new UsageError('--headless is available once with moments open.');
            headless = true;
        } else if (!arg.startsWith('-') && (command === 'open' || run) && target === undefined) {
            target = arg;
        } else {
            throw new UsageError('Unexpected argument. Use moments --help for usage.');
        }
    }
    if (chapters && !record) throw new UsageError('--chapters draws into a recording: add --record.');
    if (window && record) throw new UsageError('--record sets its own window size; use one or the other.');
    if (run && target !== undefined && !/^[a-zA-Z0-9.-]{1,128}$/.test(target)) throw new UsageError('Give a run reference from latest.json or a receipt file name.');
    if (command === 'open' && !target && !setupPath) throw new UsageError('Choose a target: moments open <journey.checkpoint>, or use --setup <path>. Use moments list to see targets.');
    return { command, configPath, setupPath, outputPath, target, once, headless, resume, record, chapters, ...(window ? { window } : {}) };
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

/** One stderr line per event, timed from the start of the run. */
function progressPrinter(checkpoints: readonly { id: string; title: string }[]): (event: MomentEvent) => void {
    const began = Date.now();
    return event => {
        const seconds = Math.floor((Date.now() - began) / 1000);
        const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`.padStart(6);
        const title = 'checkpointId' in event ? checkpoints.find(point => point.id === event.checkpointId)?.title ?? event.checkpointId : '';
        const line = event.kind === 'entering' ? `entering    ${title}`
            : event.kind === 'observed' ? `${event.status === 'passed' ? 'verified' : 'skipped'}    ${title}${event.provenance === 'native' ? '' : ` (${event.provenance})`}`
            : event.progress === 'waiting-for-code' ? 'waiting for a fresh code…' : undefined;
        if (line) process.stderr.write(`${clock}  ${line}\n`);
    };
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
            const file = evidence(failure.evidence), detail = file && !FILE_ONLY_STAGES.includes(failure.stage) && await firstLine(file);
            process.stderr.write(file && detail
                ? `${checkpoint ? `Checkpoint "${checkpoint.title}" failed` : 'Run failed'} at ${failure.stage}: ${detail} (evidence: ${file})\n`
                : `${describeMomentFailure(failure, checkpoint)}${file ? ` The message is in ${file}` : ''}\n`);
        }
        if (result.failures.some(failure => failure.code === 'persistence-failed'))
            process.stderr.write('Moments: receipt persistence failed; durable recovery was not established.\n');
    }
    if (journey) process.stdout.write(`Checkpoints:\n${checkpointSummary(result, journey.checkpoints)}`);
    const first = evidence(result.failures.find(failure => failure.evidence)?.evidence);
    const recording = root && join(root, result.runRef, 'recording');
    const recorded = recording && await stat(join(recording, 'timeline.json')).then(() => true, () => false);
    if (recorded) process.stdout.write(`Recording: ${recording}\n`);
    const runDir = root ? join(root, result.runRef) : undefined;
    const manifest = receipt && await exists(receipt) ? await writeManifest(receipt, runDir, result.runRef).catch(() => {
        process.stderr.write('Moments: the run manifest could not be written.\n'); return undefined;
    }) : undefined;
    if (receipt) await writeLatest(config.outputDir!, { runRef: result.runRef, receipt, outcome: result.outcome, ...(first ? { evidence: first } : {}), ...(recorded ? { recording } : {}), ...(manifest ? { manifest } : {}) });
}

/** `verify` and `report` read a finished run from the receipt directory; neither changes it. */
async function inspectRun(command: 'verify' | 'report', runRef: string | undefined, config: MomentsConfig): Promise<number> {
    if (config.writeReceipt) throw new UsageError(`${command} reads receipts from outputDir; this config writes them itself.`);
    const dir = resolve(config.outputDir ?? '.moments/runs');
    const ref = runRef ?? await readFile(join(dir, 'latest.json'), 'utf8').then(text => (JSON.parse(text) as { runRef?: string }).runRef, () => undefined);
    const receipt = ref && join(dir, `${ref}.json`);
    if (!receipt || !await exists(receipt)) throw new UsageError(`No run receipt ${ref ? `for ${ref} ` : ''}in ${dir}. Give a run reference, or run moments open first.`);
    const root = evidenceRoot(config), runDir = root ? join(root, ref!) : undefined;
    const manifest = manifestPath(receipt), sealed = await exists(manifest);
    const checks = sealed ? await checkManifest(manifest, runDir) : undefined;
    if (command === 'report') {
        process.stdout.write(`Run sheet: ${await writeReport(receipt, runDir, checks)}\nIt shows screens from the run: review it before sharing.\n`);
        return 0;
    }
    if (!checks) throw new UsageError(`No manifest for ${ref}: it is written when a run ends with moments open.`);
    for (const check of checks) process.stdout.write(`  ${check.state.padEnd(10)}${check.path}\n`);
    const changed = checks.filter(check => check.state !== 'unchanged').length;
    process.stdout.write(changed ? `Moments: ${changed} of ${checks.length} files differ from the manifest.\n` : `Moments: all ${checks.length} files match the manifest.\n`);
    return changed ? 1 : 0;
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
        const loaded = await loadConfig(args.configPath);
        if (args.outputPath !== undefined && loaded.writeReceipt) throw new UsageError('--output needs a config that uses outputDir, not writeReceipt.');
        const config: MomentsConfig = args.outputPath === undefined ? loaded : { ...loaded, outputDir: resolve(process.cwd(), args.outputPath) } as MomentsConfig;
        if (controller.signal.aborted) return interrupted === 'SIGTERM' ? 143 : 130;
        if (args.record && !evidenceRoot(config)) throw new UsageError('--record keeps the recording beside failure evidence: set evidenceDir, or use outputDir rather than writeReceipt.');
        if (args.command === 'verify' || args.command === 'report') return await inspectRun(args.command, args.target, config);
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
                target: target!, ...(file ? { setup: file.setup } : {}), once: args.once, headless: args.once || args.headless, resume: args.resume, signal: controller.signal,
                onEvent: progressPrinter(journey.checkpoints), ...(args.record ? { record: { chapters: args.chapters } } : {}), ...(args.window ? { window: args.window } : {})
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
