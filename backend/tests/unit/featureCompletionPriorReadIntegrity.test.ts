/**
 * K1 — a failed prior-state read must never be mistaken for "no prior state".
 *
 * syncFeatureCompletion reads the company's existing feature_completion rows to
 * build the monotonic latch ("done once = scored forever"). That read used to
 * destructure away its error, so an unreadable prior state and a genuinely empty
 * one produced the same empty priorByKey — and the all-or-nothing bulk upsert
 * then wrote freshly computed values over earned credit.
 *
 * For a feature whose underlying entity still exists that self-heals on the next
 * load. For a latched-only feature — a tool used once, a tier reached, credits
 * spent — there is no live entity to recompute from, so the historical fact is
 * destroyed permanently. Hence the highest-priority invariant here is not "an
 * error was thrown" but "NOTHING WAS WRITTEN".
 */
// This file drives the mock via require() rather than import, which would leave
// it a global SCRIPT to the type-checker — its module-scope names would then
// collide with the sibling featureCompletionBulkUpsert suite, which uses the
// same harness vocabulary. `export {}` makes it a module so both files keep
// their own scope. Jest is unaffected: ts-jest still hoists jest.mock above the
// require below.
export {};

const upsertCalls: Array<{ rows: any; opts: any }> = [];
let priorRows: any[] = [];
let priorReadError: any = null;
let upsertResult: { data: any[] | null; error: any } = { data: [], error: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: any = {
      select: () => chain,
      eq: () => Promise.resolve({ data: priorReadError ? null : priorRows, error: priorReadError }),
      upsert: (rows: any, opts: any) => {
        upsertCalls.push({ rows, opts });
        return { select: () => Promise.resolve(upsertResult) };
      },
    };
    return chain;
  },
}));

let computedFeatures: any[] = [];
jest.mock('../../services/featureCompletionService', () => ({
  computeFeatureCompletion: jest.fn(async () => computedFeatures),
}));

const { syncFeatureCompletion } = require('../../services/featureCompletionSyncService');

/** A feature the recompute has dropped to zero (entity deleted / one-time event). */
const droppedToZero = (key: string) => ({
  key, status: 'not_started' as const, score: 0, completedAt: null, reason: 'no live entity',
});

beforeEach(() => {
  upsertCalls.length = 0;
  priorRows = [];
  priorReadError = null;
  computedFeatures = [
    { key: 'campaign_created', status: 'completed' as const, score: 1, completedAt: new Date('2026-01-01T00:00:00Z'), reason: 'ok' },
  ];
  upsertResult = { data: [{ feature_key: 'campaign_created' }], error: null };
});

describe('K1 — successful prior read is unchanged', () => {
  it('proceeds and writes when the prior read succeeds with rows', async () => {
    priorRows = [{ feature_key: 'campaign_created', status: 'completed', completed_at: '2025-01-01T00:00:00Z', metadata: { score: 1 } }];
    const result = await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls).toHaveLength(1);
    expect(result.companyId).toBe('company-1');
  });

  it('proceeds and writes when the prior read succeeds with ZERO rows (new company)', async () => {
    priorRows = [];
    priorReadError = null;
    await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].rows).toHaveLength(1);
  });

  it('an empty successful read still latches nothing and uses the computed value', async () => {
    priorRows = [];
    computedFeatures = [droppedToZero('market_pulse_used')];
    upsertResult = { data: [{ feature_key: 'market_pulse_used' }], error: null };
    await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls[0].rows[0].status).toBe('not_started');
  });
});

describe('K1 — failed prior read aborts before any write', () => {
  it('CRITICAL: a prior-read failure produces ZERO feature_completion writes', async () => {
    priorReadError = { message: 'canceling statement due to statement timeout', code: '57014' };
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow();
    // The invariant that matters. Not "it threw" — that nothing was persisted.
    expect(upsertCalls).toHaveLength(0);
  });

  it('surfaces the prior-read failure rather than swallowing it', async () => {
    priorReadError = { message: 'connection reset', code: '08006' };
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow(/connection reset/);
    expect(upsertCalls).toHaveLength(0);
  });

  it('a failed read cannot DOWNGRADE an already-completed feature', async () => {
    // Prior state says completed; the recompute has dropped to zero. If the read
    // error were ignored, priorByKey would be empty and this zero would be written.
    priorRows = [{ feature_key: 'campaign_published', status: 'completed', completed_at: '2025-06-01T00:00:00Z', metadata: { score: 1 } }];
    priorReadError = { message: 'read failed', code: 'XX000' };
    computedFeatures = [droppedToZero('campaign_published')];
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow();
    expect(upsertCalls).toHaveLength(0);
    const wroteAnyDowngrade = upsertCalls.some((c) =>
      (c.rows as any[]).some((r) => r.feature_key === 'campaign_published' && r.status !== 'completed'),
    );
    expect(wroteAnyDowngrade).toBe(false);
  });

  it('a failed read cannot ERASE a latched-only feature (no live entity to recover from)', async () => {
    priorRows = [{ feature_key: 'free_credits_used', status: 'completed', completed_at: '2025-03-01T00:00:00Z', metadata: { score: 1 } }];
    priorReadError = { message: 'statement timeout', code: '57014' };
    computedFeatures = [droppedToZero('free_credits_used')];
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow();
    expect(upsertCalls).toHaveLength(0);
  });

  it('MUTATION GUARD: an unreadable prior state is never treated as an empty one', async () => {
    // Same computed input, two prior-read outcomes. The empty-but-successful read
    // must write; the failed read must not. If the error check were removed these
    // two cases would become indistinguishable and this test fails.
    computedFeatures = [droppedToZero('content_creator')];
    upsertResult = { data: [{ feature_key: 'content_creator' }], error: null };

    priorRows = [];
    priorReadError = null;
    await syncFeatureCompletion('company-1', 'user-1');
    const writesAfterEmptySuccess = upsertCalls.length;

    upsertCalls.length = 0;
    priorReadError = { message: 'unreadable', code: 'XX000' };
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow();
    const writesAfterFailure = upsertCalls.length;

    expect(writesAfterEmptySuccess).toBe(1);
    expect(writesAfterFailure).toBe(0);
  });
});

describe('K1 — caller contract', () => {
  it('throws a typed sync failure the route can swallow as non-fatal', async () => {
    priorReadError = { message: 'boom', code: 'XX000' };
    await expect(syncFeatureCompletion('company-1', 'user-1')).rejects.toThrow(
      /Feature completion sync failed/,
    );
  });

  it('company scoping is unchanged on the success path', async () => {
    priorRows = [];
    await syncFeatureCompletion('company-abc', 'user-1');
    expect(upsertCalls[0].rows[0].company_id).toBe('company-abc');
  });
});
