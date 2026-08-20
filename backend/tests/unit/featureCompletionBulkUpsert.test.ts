/**
 * syncFeatureCompletion — one bulk upsert, not seventeen sequential ones.
 *
 * The write loop issued a separate awaited upsert per feature: seventeen
 * database round trips, sequential only by the order they were written. The
 * rows are independent — distinct (company_id, feature_key) under that unique
 * constraint, and no iteration reads another result. Against a cross-region
 * database whose measured per-hop floor is ~280ms, that ordering dominated the
 * endpoint: sync was 10,455ms of an 11,908ms request.
 */
const upsertCalls: Array<{ rows: any; opts: any }> = [];
const selectCalls: string[] = [];
let priorRows: any[] = [];
let upsertResult: { data: any[] | null; error: any } = { data: [], error: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: any = {
      select: (cols?: string) => { selectCalls.push(table + ':' + (cols || '')); return chain; },
      eq: () => Promise.resolve({ data: priorRows, error: null }),
      upsert: (rows: any, opts: any) => {
        upsertCalls.push({ rows, opts });
        return { select: () => Promise.resolve(upsertResult) };
      },
    };
    return chain;
  },
}));

const computed = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    key: 'feature_' + i, status: 'completed' as const, score: 1,
    completedAt: new Date('2026-01-01T00:00:00Z'), reason: 'reason ' + i,
  }));

let computedFeatures: any[] = computed(17);
jest.mock('../../services/featureCompletionService', () => ({
  computeFeatureCompletion: jest.fn(async () => computedFeatures),
}));

const { syncFeatureCompletion } = require('../../services/featureCompletionSyncService');

beforeEach(() => {
  upsertCalls.length = 0; selectCalls.length = 0;
  priorRows = [];
  computedFeatures = computed(17);
  upsertResult = { data: computedFeatures.map((f) => ({ feature_key: f.key })), error: null };
});

describe('A/B/C/D — one bulk upsert carrying every row', () => {
  it('A — builds all 17 feature rows', async () => {
    await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls[0].rows).toHaveLength(17);
  });

  it('B — CRITICAL: exactly ONE upsert operation occurs', async () => {
    await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls).toHaveLength(1);
  });

  it('C — uses the company_id,feature_key conflict key', async () => {
    await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls[0].opts).toEqual({ onConflict: 'company_id,feature_key' });
  });

  it('D — every row keeps its exact shape, values and order', async () => {
    await syncFeatureCompletion('company-1', 'user-1');
    const row = upsertCalls[0].rows[3];
    expect(row.company_id).toBe('company-1');
    expect(row.user_id).toBe('user-1');
    expect(row.feature_key).toBe('feature_3');
    expect(row.status).toBe('completed');
    // Pre-existing latch semantics: a newly-completed feature is stamped with
    // a fresh Date, not the detector value. Unchanged by this remediation.
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(row.metadata.reason).toBe('reason 3');
    expect(row.metadata.score).toBe(1);
    expect(row.metadata.latched).toBe(false);
    expect(typeof row.metadata.computedAt).toBe('string');
    expect(upsertCalls[0].rows.map((r: any) => r.feature_key))
      .toEqual(computedFeatures.map((f) => f.key));
  });

  it('user_id is null when absent, as before', async () => {
    await syncFeatureCompletion('company-1');
    expect(upsertCalls[0].rows[0].user_id).toBeNull();
  });
});

describe('E — latching unchanged', () => {
  it('a previously completed feature stays completed when recomputed as not_started', async () => {
    computedFeatures = [{ key: 'feature_0', status: 'not_started', score: 0,
      completedAt: null, reason: 'no longer present' }];
    priorRows = [{ feature_key: 'feature_0', status: 'completed',
      completed_at: '2025-06-01T00:00:00Z', metadata: { score: 1 } }];
    upsertResult = { data: [{ feature_key: 'feature_0' }], error: null };

    await syncFeatureCompletion('company-1', 'user-1');
    const row = upsertCalls[0].rows[0];
    expect(row.status).toBe('completed');
    expect(row.metadata.score).toBe(1);
    expect(row.metadata.latched).toBe(true);
    expect(row.metadata.reason).toContain('retained');
    expect(row.completed_at).toBe('2025-06-01T00:00:00Z');  // prior timestamp preserved
  });

  it('prior state is read before the write', async () => {
    await syncFeatureCompletion('company-1', 'user-1');
    expect(selectCalls.some((c) => c.indexOf('feature_completion:feature_key') === 0)).toBe(true);
  });
});

describe('F/G — changesCount and empty behaviour', () => {
  it('F — changesCount still counts the rows the write returned', async () => {
    const result = await syncFeatureCompletion('company-1', 'user-1');
    expect(result.changesCount).toBe(17);
  });

  it('F — a write returning fewer rows reports fewer, as the loop did', async () => {
    upsertResult = { data: [{ feature_key: 'feature_0' }], error: null };
    const result = await syncFeatureCompletion('company-1', 'user-1');
    expect(result.changesCount).toBe(1);
  });

  it('G — no computed features issues no write and returns zero', async () => {
    computedFeatures = [];
    const result = await syncFeatureCompletion('company-1', 'user-1');
    expect(upsertCalls).toHaveLength(0);
    expect(result.changesCount).toBe(0);
    expect(result.features).toEqual([]);
  });

  it('return contract is unchanged', async () => {
    const result = await syncFeatureCompletion('company-1', 'user-1');
    expect(Object.keys(result).sort()).toEqual(['changesCount', 'companyId', 'features', 'syncedAt']);
    expect(result.companyId).toBe('company-1');
    expect(result.syncedAt).toBeInstanceOf(Date);
  });
});

describe('H — failure semantics', () => {
  it('an upsert error still throws the wrapped sync failure', async () => {
    upsertResult = { data: null, error: { message: 'db exploded' } };
    await expect(syncFeatureCompletion('company-1', 'user-1'))
      .rejects.toThrow(/Feature completion sync failed/);
  });
});

describe('I — no per-feature upserts remain', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../services/featureCompletionSyncService.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = code.slice(code.indexOf('export async function syncFeatureCompletion'),
                          code.indexOf('export async function syncFeatureCompletionBatch'));

  it('syncFeatureCompletion contains exactly one upsert call', () => {
    expect(body.split('.upsert(').length - 1).toBe(1);
  });

  it('the write is not inside a per-feature loop', () => {
    expect(body).not.toMatch(/for \(const feature of computedFeatures\)[\s\S]*\.upsert\(/);
    expect(body).toContain('.upsert(rows, {');
  });
});
