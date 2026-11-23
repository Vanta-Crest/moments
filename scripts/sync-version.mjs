// npm runs this from the `version` lifecycle: the protocol constant follows package.json,
// so a running Director/panel and runner always agree on the release they belong to.
import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const file = new URL('../src/internal/protocol.ts', import.meta.url);
const source = await readFile(file, 'utf8');
const next = source.replace(/export const PACKAGE_VERSION = '[^']*' as const;/, `export const PACKAGE_VERSION = '${version}' as const;`);
if (next === source && !source.includes(`'${version}'`)) throw new Error('PACKAGE_VERSION declaration not found');
await writeFile(file, next);
