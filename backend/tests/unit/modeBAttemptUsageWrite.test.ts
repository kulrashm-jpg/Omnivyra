/**
 * The mode B usage columns are written in a SEPARATE best-effort update, so a
 * schema without them (before the usage-ledger migration) can never fail the
 * attempt close itself.
 */
const updates: Array<Record<string, unknown>> = [];
let failUsage = false;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    update: (row: Record<string, unknown>) => {
      updates.push(row);
      const isUsage = !('completed_at' in row);
      const res = { error: isUsage && failUsage ? { code: 'PGRST204', message: 'column missing' } : null };
      const chain = { eq: () => chain, then: (f: (v: unknown) => unknown) => Promise.resolve(res).then(f) };
      return chain;
    },
  }),
}));
import { completeAttempt } from '../../services/enrichment/attempts';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const base = { organizationId: ORG, attemptId: 'a1', outcome: 'enriched' as const, providerCalled: true,
  executionStatus: 'completed' as const, completedAt: '2026-11-10T12:00:00.000Z' };
beforeEach(() => { updates.length = 0; failUsage = false; });

it('close first, usage second; the close row never carries usage columns', async () => {
  await completeAttempt({ ...base, funding: 'platform', providerCostUnits: 1, creditsCharged: 18 } as never);
  expect(updates).toHaveLength(2);
  expect(updates[0]).not.toHaveProperty('funding');
  expect(updates[1]).toEqual({ funding: 'platform', provider_cost_units: 1, credits_charged: 18 });
});

it('a usage write failure (column missing) does NOT fail the close', async () => {
  failUsage = true;
  await expect(completeAttempt({ ...base, funding: 'tenant', providerCostUnits: 1, creditsCharged: 0 } as never)).resolves.toBeUndefined();
});

it('nothing stated -> no usage write at all', async () => {
  await completeAttempt(base as never);
  expect(updates).toHaveLength(1);
});
