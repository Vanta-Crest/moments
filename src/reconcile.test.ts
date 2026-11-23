import assert from 'node:assert/strict';
import test from 'node:test';
import { furthestVerified } from './reconcile.js';

const order = ['draft', 'saved', 'approved', 'paid'] as const;
test('furthestVerified checks from the last checkpoint back to the floor and returns the first that passes', async () => {
    const checked: string[] = [];
    const found = await furthestVerified(order, 'saved', async id => { checked.push(id); if (id !== 'saved' && id !== 'draft') throw Error('absent'); });
    assert.equal(found, 'saved');
    assert.deepEqual(checked, ['paid', 'approved', 'saved']);
});
test('furthestVerified never looks below the floor and says what it checked', async () => {
    await assert.rejects(furthestVerified(order, 'approved', async () => { throw Error('Approval badge missing'); }),
        { message: 'No checkpoint from "paid" back to "approved" could be verified. Last error: Approval badge missing' });
    await assert.rejects(furthestVerified(order, 'unknown' as 'draft', async () => {}), { message: 'Unknown floor checkpoint "unknown".' });
});
