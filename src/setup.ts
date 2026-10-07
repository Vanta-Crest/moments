/** Public autofill inputs only. Runtime identity and credentials belong to the driver. */
export type SetupValues = Readonly<Record<string, string>>;
export type MomentSetup = Readonly<{ schemaVersion: number; values: SetupValues }>;
export type SetupField = Readonly<{ key: string; label: string; multiline?: true; maxLength: number }>;
export type SetupIssue = Readonly<{ field?: string; message: string }>;
export type SetupParseResult = { ok: true; values: SetupValues } | { ok: false; issues: readonly SetupIssue[] };
export type SetupDefinition = Readonly<{
    schemaVersion: number;
    fields: readonly SetupField[];
    defaults: SetupValues;
    parse(values: unknown): SetupParseResult;
}>;
export type MomentSetupFile = Readonly<{
    formatVersion: 1;
    journeyId: string;
    checkpointId: string;
    setup: MomentSetup;
}>;

export const MAX_SETUP_BYTES = 64 * 1024;
const MAX_FIELDS = 64;
const fieldKey = (value: string) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
    && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export class MomentSetupError extends Error {
    readonly issues: readonly SetupIssue[];
    constructor(issues: readonly SetupIssue[] = [{ message: 'Invalid run setup.' }]) {
        super('Invalid run setup.');
        this.name = 'MomentSetupError';
        this.issues = Object.freeze(issues.slice(0, MAX_FIELDS).map(issue => Object.freeze({
            ...(typeof issue.field === 'string' && fieldKey(issue.field) ? { field: issue.field } : {}),
            message: typeof issue.message === 'string' ? issue.message.slice(0, 240) : 'Invalid value.'
        })));
    }
}

function invalid(message: string): never { throw new MomentSetupError([{ message }]); }
function bounded(value: unknown): void {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SETUP_BYTES)
        invalid('Run setup exceeds 64 KiB.');
}

/** Structural parsing cannot establish a journey's field names or semantic rules. */
export function parseMomentSetup(value: unknown): MomentSetup {
    if (!object(value) || !exact(value, ['schemaVersion', 'values']) || !version(value.schemaVersion)
        || !object(value.values) || Object.keys(value.values).length > MAX_FIELDS)
        invalid('Invalid setup schema or values.');
    const entries = Object.entries(value.values);
    if (entries.some(([key, item]) => !fieldKey(key) || typeof item !== 'string' || item.length > MAX_SETUP_BYTES))
        invalid('Setup values must be public text fields.');
    const setup = { schemaVersion: value.schemaVersion, values: Object.freeze(Object.fromEntries(entries) as Record<string, string>) };
    bounded(setup);
    return Object.freeze(setup);
}

function validateFields(fields: readonly SetupField[]): void {
    if (!Array.isArray(fields) || !fields.length || fields.length > MAX_FIELDS) invalid('Invalid setup field definition.');
    const keys = new Set<string>();
    for (const field of fields) {
        if (!object(field) || Object.keys(field).some(key => !['key', 'label', 'multiline', 'maxLength'].includes(key))
            || typeof field.key !== 'string' || !fieldKey(field.key) || keys.has(field.key)
            || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 160
            || typeof field.maxLength !== 'number' || !Number.isSafeInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > MAX_SETUP_BYTES
            || (field.multiline !== undefined && field.multiline !== true)) invalid('Invalid setup field definition.');
        keys.add(field.key);
    }
}

/** Common public string rules; a journey adds any further domain validation. */
export function validateSetupValues(fields: readonly SetupField[], value: unknown): SetupParseResult {
    validateFields(fields);
    if (!object(value)) return { ok: false, issues: [{ message: 'Provide every run value.' }] };
    const issues: SetupIssue[] = [], values: Record<string, string> = {};
    const keys = new Set(fields.map(field => field.key));
    if (Object.keys(value).some(key => !keys.has(key))) issues.push({ message: 'Remove unknown fields.' });
    for (const field of fields) {
        const supplied = Object.hasOwn(value, field.key) ? value[field.key] : undefined;
        if (typeof supplied !== 'string') issues.push({ field: field.key, message: 'Enter a text value.' });
        else if (!supplied.trim()) issues.push({ field: field.key, message: 'Enter a value.' });
        else if (supplied.trim().length > field.maxLength) issues.push({ field: field.key, message: `Use ${field.maxLength} characters or fewer.` });
        else values[field.key] = supplied.trim();
    }
    if (issues.length) return { ok: false, issues };
    try { bounded(values); } catch { return { ok: false, issues: [{ message: 'Run setup exceeds 64 KiB.' }] }; }
    return { ok: true, values: Object.freeze(values) };
}

/** Pure admission: no fixture state, effects, or partial default merging. */
export function resolveSetup(definition: SetupDefinition | undefined, supplied?: MomentSetup): MomentSetup | undefined {
    if (definition === undefined) {
        if (supplied !== undefined) invalid('This journey does not accept run values.');
        return undefined;
    }
    if (!object(definition)) invalid('Invalid setup definition.');
    if (!version(definition.schemaVersion) || typeof definition.parse !== 'function') invalid('Invalid setup definition.');
    validateFields(definition.fields);
    const input = parseMomentSetup(supplied === undefined
        ? { schemaVersion: definition.schemaVersion, values: definition.defaults } : supplied);
    if (input.schemaVersion !== definition.schemaVersion) invalid('Unsupported setup schema version.');
    const common = validateSetupValues(definition.fields, input.values);
    if (!common.ok) throw new MomentSetupError(common.issues);
    let parsed: SetupParseResult;
    try { parsed = definition.parse(common.values); }
    catch { return invalid('The journey rejected these run values.'); }
    if (!parsed || typeof parsed !== 'object') invalid('Invalid setup parser result.');
    if (!parsed.ok) {
        if (!Array.isArray(parsed.issues) || !parsed.issues.length) invalid('The journey rejected these run values.');
        throw new MomentSetupError(parsed.issues);
    }
    const checked = validateSetupValues(definition.fields, parsed.values);
    if (!checked.ok) throw new MomentSetupError(checked.issues);
    return Object.freeze({ schemaVersion: definition.schemaVersion, values: checked.values });
}

export function parseSetupFile(value: unknown): MomentSetupFile {
    if (!object(value) || !exact(value, ['formatVersion', 'journeyId', 'checkpointId', 'setup']) || value.formatVersion !== 1
        || typeof value.journeyId !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(value.journeyId)
        || typeof value.checkpointId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.checkpointId))
        invalid('Invalid run setup file.');
    const file = { formatVersion: 1 as const, journeyId: value.journeyId, checkpointId: value.checkpointId, setup: parseMomentSetup(value.setup) };
    bounded(file);
    return Object.freeze(file);
}

export function serializeSetupFile(value: MomentSetupFile): string {
    const text = JSON.stringify(parseSetupFile(value), null, 2) + '\n';
    if (new TextEncoder().encode(text).byteLength > MAX_SETUP_BYTES) invalid('Run setup exceeds 64 KiB.');
    return text;
}

/** Public validation issues only; do not pass caught driver errors or submitted values. */
export function formatSetupIssues(issues: readonly SetupIssue[]): string {
    return issues.map(issue => `${issue.field ? `${issue.field}: ` : ""}${issue.message}`).join("\n");
}
