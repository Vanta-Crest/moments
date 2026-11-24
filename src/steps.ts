import { defineJourney } from './runner.js';
import { furthestVerified } from './reconcile.js';
import type { CleanupOutcome, JourneyContext, JourneyDefinition } from './types.js';

/** What it takes to reach one checkpoint from the one before it, and to prove it from the product. */
export type Step = { enter(): Promise<void>; verify(): Promise<void> };

/**
 * A journey written as one step per checkpoint. The type requires a step for every checkpoint id.
 * `reconcile` is derived: it verifies from the last checkpoint back to the last one this run verified
 * and adopts the furthest that is true, so progress made by hand is adopted rather than repeated.
 */
export function defineStepJourney<const I extends string>(definition: Omit<JourneyDefinition<I>, 'create'> & {
    create(context: JourneyContext): { steps: { readonly [K in I]: Step }; cleanup(): Promise<CleanupOutcome> };
}): JourneyDefinition<I> {
    const { create, ...rest } = definition;
    const order = definition.checkpoints.map(point => point.id);
    return defineJourney<I>({
        ...rest,
        create(context) {
            const { steps, cleanup } = create(context);
            let reached: I | undefined;
            const verify = async (id: I) => { await steps[id].verify(); reached = id; };
            return {
                enter: id => steps[id].enter(),
                verify,
                reconcile: () => furthestVerified(order, reached ?? order[0]!, id => steps[id].verify()),
                cleanup
            };
        }
    });
}
