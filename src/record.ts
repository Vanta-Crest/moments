import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_VERSION } from './internal/protocol.js';
import type { MomentResult } from './types.js';

/** Fingerprints of one run's files, kept beside its receipt as `<runRef>.manifest.json`. */
export type RunManifest = {
    schemaVersion: 1;
    runRef: string;
    packageVersion: string;
    createdAt: string;
    algorithm: 'sha256';
    /** Paths are relative to the manifest's own directory and use `/`. */
    files: { path: string; bytes: number; sha256: string }[];
};
export type FileCheck = { path: string; state: 'unchanged' | 'changed' | 'missing' | 'added' };

const fingerprint = async (file: string) => {
    const content = await readFile(file);
    return { bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') };
};
const portable = (from: string, to: string) => path.relative(from, to).split(path.sep).join('/');

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(entries.map(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(full) : entry.isFile() ? [full] : [];
    }));
    return nested.flat().sort();
}

/** The receipt plus everything in the run's evidence folder: failure evidence and the recording. */
async function runFiles(receipt: string, runDir: string | undefined) {
    return [receipt, ...(runDir ? await filesUnder(runDir) : [])];
}

export function manifestPath(receipt: string) { return receipt.replace(/\.json$/, '.manifest.json'); }

export async function writeManifest(receipt: string, runDir: string | undefined, runRef: string): Promise<string> {
    const home = path.dirname(receipt);
    const files = await Promise.all((await runFiles(receipt, runDir)).map(async file => ({ path: portable(home, file), ...await fingerprint(file) })));
    const manifest: RunManifest = { schemaVersion: 1, runRef, packageVersion: PACKAGE_VERSION, createdAt: new Date().toISOString(), algorithm: 'sha256', files };
    const target = manifestPath(receipt);
    await writeFile(target, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return target;
}

export async function readManifest(file: string): Promise<RunManifest> {
    const value = JSON.parse(await readFile(file, 'utf8')) as RunManifest;
    if (value?.schemaVersion !== 1 || value.algorithm !== 'sha256' || typeof value.runRef !== 'string' || !Array.isArray(value.files)
        || !value.files.every(f => typeof f.path === 'string' && !path.isAbsolute(f.path) && /^[0-9a-f]{64}$/.test(f.sha256)))
        throw Error('Not a Moments run manifest');
    return value;
}

/** Recomputes every fingerprint. Files added to the run's evidence folder since are reported too. */
export async function checkManifest(file: string, runDir: string | undefined): Promise<FileCheck[]> {
    const manifest = await readManifest(file), home = path.dirname(file);
    const checks: FileCheck[] = await Promise.all(manifest.files.map(async entry => {
        const now = await fingerprint(path.resolve(home, entry.path)).catch(() => undefined);
        return { path: entry.path, state: !now ? 'missing' : now.sha256 === entry.sha256 && now.bytes === entry.bytes ? 'unchanged' : 'changed' } as const;
    }));
    const listed = new Set(manifest.files.map(entry => entry.path));
    for (const extra of runDir ? await filesUnder(runDir) : [])
        if (!listed.has(portable(home, extra))) checks.push({ path: portable(home, extra), state: 'added' });
    return checks;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const how = { native: 'Moments', manual: 'By hand', existing: 'Already there' } as const;
const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

type Timeline = { segments?: { file: string; lost?: true }[]; events?: { kind: string; checkpointId?: string; frame?: string }[] };

/**
 * One self-contained HTML page a reviewer can read without the tooling: what system, who acted, what was
 * verified and how, with the frame of each verified checkpoint. It embeds screenshots, so it is written
 * privately and must be reviewed before it is shared.
 */
export async function writeReport(receipt: string, runDir: string | undefined, checks: FileCheck[] | undefined): Promise<string> {
    const result = JSON.parse(await readFile(receipt, 'utf8')) as MomentResult;
    const home = path.dirname(receipt), recording = runDir && path.join(runDir, 'recording');
    const timeline: Timeline = recording ? await readFile(path.join(recording, 'timeline.json'), 'utf8').then(JSON.parse, () => ({})) : {};
    const frames = new Map<string, string>();
    for (const event of timeline.events ?? [])
        if (event.kind === 'observed' && event.checkpointId && event.frame) frames.set(event.checkpointId, event.frame);
    const image = async (frame: string) => `data:image/jpeg;base64,${(await readFile(path.join(recording!, frame))).toString('base64')}`;
    const rows = await Promise.all(result.checkpoints.map(async (point, index) => {
        const seen = result.observations.filter(o => o.checkpointId === point.id).at(-1);
        const failed = result.failures.some(f => f.checkpointId === point.id && (!seen || f.at >= seen.at));
        const state = failed ? 'Failed' : seen?.status === 'passed' ? 'Verified' : seen?.status === 'skipped' ? 'Skipped' : 'Not reached';
        const frame = frames.get(point.id);
        return `<tr data-state="${state.toLowerCase().replace(' ', '-')}"><td class="n">${index + 1}</td>
<td><strong>${escape(point.title)}</strong>${point.actor ? `<div class="sub">${escape(point.actor)}</div>` : ''}${point.private ? '<div class="sub">Private: not filmed</div>' : ''}</td>
<td>${state}${seen && !failed ? `<div class="sub">${how[seen.provenance]} · ${when(seen.at)}</div>` : ''}</td>
<td>${point.covers?.map(c => `<code>${escape(c)}</code>`).join(' ') ?? ''}</td>
<td>${frame ? `<img alt="${escape(point.title)}" src="${await image(frame).catch(() => '')}">` : ''}</td></tr>`;
    }));
    const changed = checks?.filter(c => c.state !== 'unchanged') ?? [];
    const integrity = !checks ? 'No manifest was found for this run.'
        : changed.length ? `${changed.length} file${changed.length > 1 ? 's' : ''} differ from the manifest: ${changed.map(c => `${escape(c.path)} (${c.state})`).join(', ')}.`
        : `All ${checks.length} files match the manifest written when the run ended.`;
    const videos = (timeline.segments ?? []).map(segment => segment.lost ? `<li>${escape(segment.file)}: lost when the browser closed</li>`
        : `<li><a href="${escape(portable(home, path.join(recording!, segment.file)))}">${escape(segment.file)}</a></li>`).join('');
    const covered = [...new Set(result.checkpoints.flatMap(point => point.covers ?? []))];
    const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(result.journeyTitle)}: run ${escape(result.runRef.slice(0, 8))}</title>
<style>
:root { --ink:#17191c; --ink2:#4b525c; --line:#e1e4e8; --paper:#fff; --sunk:#f6f7f9; --ok:#1d7a4a; --bad:#b42318; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --ink:#eef0f3; --ink2:#b3bac5; --line:#2f343c; --paper:#16181c; --sunk:#1e2126; --ok:#4cc38a; --bad:#ff8a80; color-scheme: dark; } }
body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:68rem; margin:0 auto; padding:2.5rem 1rem 4rem; }
.kicker { font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; color:var(--ink2); font-weight:600; }
h1 { font-size:1.6rem; line-height:1.25; margin:.35rem 0 1.25rem; letter-spacing:-.01em; }
.private { border:1px solid var(--line); background:var(--sunk); border-radius:8px; padding:.7rem .9rem; color:var(--ink2); }
dl { display:grid; grid-template-columns:max-content 1fr; gap:.35rem 1.25rem; margin:1.5rem 0; }
dt { color:var(--ink2); } dd { margin:0; } code { font:.85em ui-monospace, "SF Mono", Menlo, monospace; }
table { width:100%; border-collapse:collapse; margin-top:1rem; } th, td { text-align:left; vertical-align:top; padding:.7rem .6rem; border-top:1px solid var(--line); }
th { font-size:.75rem; letter-spacing:.06em; text-transform:uppercase; color:var(--ink2); font-weight:600; }
td.n { color:var(--ink2); font-variant-numeric:tabular-nums; width:2rem; } .sub { color:var(--ink2); font-size:.85rem; }
tr[data-state="verified"] td:nth-child(3) { color:var(--ok); } tr[data-state="failed"] td:nth-child(3) { color:var(--bad); }
img { width:16rem; max-width:100%; border:1px solid var(--line); border-radius:4px; display:block; }
h2 { font-size:1rem; margin:2.25rem 0 .5rem; } footer { margin-top:3rem; color:var(--ink2); font-size:.85rem; border-top:1px solid var(--line); padding-top:1rem; }
@media (max-width:40rem) { td:nth-child(5) { display:none; } }
</style>
<main>
<div class="kicker">Moments run sheet</div>
<h1>${escape(result.journeyTitle)}</h1>
<p class="private">Private. This page shows screens from the run. Review it before sharing.</p>
<dl>
<dt>System</dt><dd>${result.environment ? `${escape(result.environment)} · ` : ''}<code>${escape(result.origin)}</code></dd>
<dt>Run</dt><dd><code>${escape(result.runRef)}</code></dd>
<dt>Started</dt><dd>${when(result.startedAt)}</dd>
<dt>Outcome</dt><dd>${escape(result.outcome)}; cleanup ${escape(result.cleanup)}</dd>
${covered.length ? `<dt>Covers</dt><dd>${covered.map(c => `<code>${escape(c)}</code>`).join(' ')}</dd>` : ''}
<dt>Integrity</dt><dd>${integrity}</dd>
</dl>
<table><thead><tr><th>#</th><th>Checkpoint</th><th>Result</th><th>Covers</th><th>Frame</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>
${videos ? `<h2>Recording</h2><ul>${videos}</ul>` : ''}
${result.failures.length ? `<h2>Failures</h2><ul>${result.failures.map(f => `<li>${escape(f.stage)}${f.checkpointId ? ` at ${escape(f.checkpointId)}` : ''}, ${when(f.at)}${f.evidence ? `: evidence <code>${escape(f.evidence)}</code>` : ''}</li>`).join('')}</ul>` : ''}
<footer>Prepared by Moments ${escape(result.packageVersion)} from the run receipt. A checkpoint marked Verified was proven from the application's own screens at the time shown; “By hand” means a person reached it and Moments then verified it.</footer>
</main></html>
`;
    const target = receipt.replace(/\.json$/, '.html');
    await writeFile(target, page, { mode: 0o600 });
    return target;
}

/** Whether a path exists as a file. */
export const exists = (file: string) => stat(file).then(info => info.isFile(), () => false);
