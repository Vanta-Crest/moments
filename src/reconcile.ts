/**
 * For a driver's `reconcile`: verify from the last checkpoint back to `floor` (usually the last
 * verified one) and return the furthest that passes. Throws when none does: unknown state is never adopted.
 */
export async function furthestVerified<const I extends string>(order: readonly I[], floor: I, verify: (checkpoint: I) => Promise<void>): Promise<I> {
    const lowest = order.indexOf(floor);
    if (lowest < 0) throw Error(`Unknown floor checkpoint "${floor}".`);
    let last: unknown;
    for (let i = order.length - 1; i >= lowest; i--) {
        try { await verify(order[i]!); return order[i]!; }
        catch (error) { last = error; }
    }
    const reason = (last instanceof Error ? last.message : String(last)).split('\n')[0];
    throw Error(`No checkpoint from "${order.at(-1)}" back to "${floor}" could be verified. Last error: ${reason}`, { cause: last });
}
