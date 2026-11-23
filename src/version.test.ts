import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PACKAGE_VERSION } from './internal/protocol.js';

test('the protocol version is the published package version', async () => {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(PACKAGE_VERSION, version);
});
