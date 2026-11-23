import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MomentResult, MomentsConfig } from './types.js';
import { parseMomentSetup } from './setup.js';
import { PACKAGE_VERSION } from './internal/protocol.js';
const stages = ['admission', 'browser', 'create', 'enter', 'verify', 'reconcile', 'cleanup', 'persist', 'close'];
export function validateResult(r: MomentResult): void {
    const exact = (o: object, keys: string[]) => Object.keys(o).every(k => keys.includes(k));
    const id = (s: string) => typeof s === 'string' && /^[a-zA-Z0-9.-]{1,128}$/.test(s);
    const time = (s: string) => typeof s === 'string' && Number.isFinite(Date.parse(s));
    if (!r || !exact(r, ['schemaVersion', 'packageVersion', 'sessionId', 'runRef', 'journeyId', 'target', 'previousRunRef', 'setup', 'replacementRequested', 'activity', 'startedAt', 'updatedAt', 'observations', 'cleanup', 'failures', 'outcome']) || r.schemaVersion !== 2 || r.packageVersion !== PACKAGE_VERSION || ![r.sessionId, r.runRef, r.journeyId, r.target, ...(r.previousRunRef ? [r.previousRunRef] : [])].every(id) || !time(r.startedAt) || !time(r.updatedAt) || !['preparing', 'ready', 'working', 'needs-attention', 'closing', 'closed'].includes(r.activity) || !['not-attempted', 'complete', 'neutralized-with-residue', 'incomplete'].includes(r.cleanup) || !['pending', 'complete', 'neutralized-with-residue', 'incomplete'].includes(r.outcome) || !Array.isArray(r.observations) || !Array.isArray(r.failures))
        throw Error('Invalid Moments result');
    if (r.setup !== undefined) parseMomentSetup(r.setup);
    if (r.replacementRequested !== undefined) {
        const request = r.replacementRequested;
        if (!request || !exact(request, ['checkpointId', 'setup']) || Object.keys(request).length !== 2
            || typeof request.checkpointId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(request.checkpointId)
            || !r.setup || request.setup?.schemaVersion !== r.setup.schemaVersion)
            throw Error('Invalid Moments replacement request');
        parseMomentSetup(request.setup);
    }
    for (const o of r.observations)
        if (!exact(o, ['checkpointId', 'at', 'provenance', 'status']) || !id(o.checkpointId) || !time(o.at) || !['native', 'manual'].includes(o.provenance) || !['passed', 'skipped', 'failed'].includes(o.status))
            throw Error('Invalid Moments observation');
    for (const f of r.failures)
        if (!exact(f, ['stage', 'code', 'checkpointId', 'at']) || !stages.includes(f.stage) || !['operation-failed', 'persistence-failed', 'interrupted'].includes(f.code) || !time(f.at) || (f.checkpointId !== undefined && !id(f.checkpointId)))
            throw Error('Invalid Moments failure');
}
export function createWriter(config: MomentsConfig): (r: MomentResult) => Promise<void> {
    let pending = Promise.resolve();
    return result => {
        const snapshot = structuredClone(result);
        const operation = pending.then(async () => {
            validateResult(snapshot);
            if (config.writeReceipt) {
                await config.writeReceipt(snapshot);
                return;
            }
            const dir = path.resolve(config.outputDir ?? '.moments/runs');
            await mkdir(dir, {
                recursive: true, mode: 0o700
            });
            const temporary = path.join(dir, `.${snapshot.runRef}.${randomUUID()}.tmp`);
            try {
                await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', {
                    mode: 0o600, flag: 'wx'
                });
                await rename(temporary, path.join(dir, `${snapshot.runRef}.json`));
            }
            finally {
                await rm(temporary, { force: true });
            }
        });
        pending = operation.catch(() => { });
        return operation;
    };
}
