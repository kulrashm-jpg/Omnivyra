/**
 * Mode B usage on discovery executions: funding, credits and R3 screening
 * counts, written AFTER the close, best-effort, cumulative across resumed runs.
 */
const calls: Array<{ op: string; row?: Record<string, unknown> }> = [];
let stored: Record<string, number | null> | null = { results_skipped_duplicate: 2, results_held_for_review: null, results_probe_unknown: 1 };
let readError: unknown = null;
let writeError: unknown = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    let op = '';
    let row: Record<string, unknown> | undefined;
    chain.select = () => { op = 'select'; return chain; };
    chain.update = (r: Record<string, unknown>) => { op = 'update'; row = r; return chain; };
    chain.eq = () => chain;
    chain.maybeSingle = async () => { calls.push({ op }); return { data: stored, error: readError }; };
    chain.then = (f: (v: unknown) => unknown) => { calls.push({ op, row }); return Promise.resolve({ error: writeError }).then(f); };
    return chain;
  },
}));
import { recordDiscoveryUsage } from '../../services/prospectDiscovery/discoveryAttemptStore';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const input = { organizationId: ORG, id: 'x1', funding: 'tenant' as const, creditsCharged: null,
  screeningDelta: { skippedDuplicates: 3, heldForReview: 1, probeUnknown: 0 } };
beforeEach(() => { calls.length = 0; readError = null; writeError = null;
  stored = { results_skipped_duplicate: 2, results_held_for_review: null, results_probe_unknown: 1 }; });

it('adds this run to the stored counts (cumulative, like results_ingested); tenant funding = 0 credits', async () => {
  await recordDiscoveryUsage(input);
  const w = calls.find((c) => c.op === 'update')!;
  expect(w.row).toEqual({ funding: 'tenant', credits_charged: 0,
    results_skipped_duplicate: 5, results_held_for_review: 1, results_probe_unknown: 1 });
});

it('a failed read writes NOTHING (never replaces a cumulative count with one run)', async () => {
  readError = { code: '42703' };
  await recordDiscoveryUsage(input);
  expect(calls.some((c) => c.op === 'update')).toBe(false);
});

it('a failed write (column missing before the migration) never throws', async () => {
  writeError = { code: 'PGRST204' };
  await expect(recordDiscoveryUsage(input)).resolves.toBeUndefined();
});

it('a tenant-funded row can never carry credits, whatever the caller passes', async () => {
  await recordDiscoveryUsage({ ...input, creditsCharged: 7 });
  expect(calls.find((c) => c.op === 'update')!.row!.credits_charged).toBe(0);
});
