/**
 * Wave 5 — performanceIntelligence.deriveIntelligence unit tests.
 *
 * Proves the engine is DETERMINISTIC + EXPLAINABLE + company-scoped:
 *  - per-dimension patterns are derived from the SAME input identically
 *    (same input → byte-identical output, order included);
 *  - each `score` is a reproducible company-history percentile (hand-checkable);
 *  - persistence is idempotent (re-derivation upserts, never duplicates);
 *  - it never reads/writes the historical `content` table;
 *  - it is FAIL-SAFE (a throwing supabase resolves to []).
 *
 * supabase is replaced with a faithful in-memory fake so idempotency and the
 * never-touch-content invariant are actually exercised, not just asserted.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let mockFrom: jest.Mock = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

import {
  deriveIntelligence,
  fetchPerformanceObservations,
} from '../../services/content/performanceIntelligence';

const clone = (o: any) => JSON.parse(JSON.stringify(o));

// ── in-memory supabase fake ──────────────────────────────────────────────────

function makeBuilder(table: string, store: Record<string, any[]>, genId: () => string) {
  const state: any = {
    table, filters: [] as any[], op: 'select', payload: null,
    single: false, maybe: false, onConflict: null, limit: null,
  };
  const match = (row: any) =>
    state.filters.every((f: any) => {
      if (f.t === 'eq') return row[f.col] === f.val;
      if (f.t === 'is') return f.val == null ? row[f.col] == null : row[f.col] === f.val;
      if (f.t === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
      return true;
    });
  const run = () => {
    const rows = store[table] || (store[table] = []);
    if (state.op === 'select') {
      let res = rows.filter(match);
      if (state.limit != null) res = res.slice(0, state.limit);
      if (state.maybe) return { data: res[0] ? clone(res[0]) : null, error: null };
      if (state.single) return { data: res[0] ? clone(res[0]) : null, error: res.length ? null : { message: 'no rows' } };
      return { data: res.map(clone), error: null };
    }
    if (state.op === 'insert') {
      const arr = Array.isArray(state.payload) ? state.payload : [state.payload];
      const ins = arr.map((r: any) => { const row = { id: r.id ?? genId(), ...clone(r) }; rows.push(row); return clone(row); });
      return { data: state.single ? ins[0] : ins, error: null };
    }
    if (state.op === 'update') {
      const m = rows.filter(match);
      m.forEach((r: any) => Object.assign(r, clone(state.payload)));
      return { data: m.map(clone), error: null };
    }
    if (state.op === 'upsert') {
      const arr = Array.isArray(state.payload) ? state.payload : [state.payload];
      const cols = String(state.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
      const out: any[] = [];
      for (const r of arr) {
        const ex = cols.length ? rows.find((row: any) => cols.every((c) => row[c] === r[c])) : null;
        if (ex) { Object.assign(ex, clone(r)); out.push(clone(ex)); }
        else { const row = { id: r.id ?? genId(), ...clone(r) }; rows.push(row); out.push(clone(row)); }
      }
      return { data: state.single ? out[0] : out, error: null };
    }
    return { data: null, error: null };
  };
  const b: any = {
    select() { state.op = 'select'; return b; },
    insert(p: any) { state.op = 'insert'; state.payload = p; return b; },
    update(p: any) { state.op = 'update'; state.payload = p; return b; },
    upsert(p: any, opts: any) { state.op = 'upsert'; state.payload = p; state.onConflict = opts?.onConflict ?? null; return b; },
    eq(col: string, val: any) { state.filters.push({ t: 'eq', col, val }); return b; },
    is(col: string, val: any) { state.filters.push({ t: 'is', col, val }); return b; },
    in(col: string, val: any) { state.filters.push({ t: 'in', col, val }); return b; },
    order() { return b; },
    limit(n: number) { state.limit = n; return b; },
    single() { state.single = true; return b; },
    maybeSingle() { state.maybe = true; return b; },
    then(resolve: any) { resolve(run()); },
  };
  return b;
}

function fakeStore(seed: Record<string, any[]> = {}) {
  const store: Record<string, any[]> = {
    content_performance: [], content_memory: [], learning_intelligence: [],
    learning_memory: [], content: [], ...clone(seed),
  };
  let i = 1;
  const genId = () => `gen-${i++}`;
  const from = jest.fn((t: string) => makeBuilder(t, store, genId));
  return { store, from };
}

// ── deterministic seed ───────────────────────────────────────────────────────
// Three published items. Engagement rate = engagement / impressions:
//   c1 = 300/1000 = 0.30 → top    → percentile 1.0  (2 of 2 below)
//   c2 = 100/1000 = 0.10 → mid    → percentile 0.5  (1 of 2 below)
//   c3 =  10/1000 = 0.01 → bottom → percentile 0.0  (0 of 2 below)
// c1 & c2 share hook "Hook A" on linkedin/camp1; c3 uses "Hook B" on twitter.
function seed(): Record<string, any[]> {
  return {
    content_memory: [
      {
        company_id: 'co1', content_id: 'c1', platform: 'linkedin', campaign_id: 'camp1', content_type: 'post',
        text_excerpt: 'Hook A\n\nBody text here about growth.\n\nBuy now\n\n#ai #growth',
        intelligence: { hooks: ['Hook A'], ctas: ['Buy now'], narratives: ['Body text here about growth.'], keyMessages: ['This is a strong key message'] },
      },
      {
        company_id: 'co1', content_id: 'c2', platform: 'linkedin', campaign_id: 'camp1', content_type: 'post',
        text_excerpt: 'Hook A\n\nSecond body about scale.\n\n#ai',
        intelligence: { hooks: ['Hook A'], ctas: [], narratives: ['Second body about scale.'], keyMessages: ['Another message goes here now'] },
      },
      {
        company_id: 'co1', content_id: 'c3', platform: 'twitter', campaign_id: 'camp2', content_type: 'post',
        text_excerpt: 'Hook B\n\nTiny.',
        intelligence: { hooks: ['Hook B'], ctas: [], narratives: ['Tiny.'], keyMessages: [] },
      },
    ],
    content_performance: [
      { company_id: 'co1', content_id: 'c1', platform: 'linkedin', impressions: 1000, engagement: 300, captured_at: '2026-07-18T03:00:00Z' },
      { company_id: 'co1', content_id: 'c2', platform: 'linkedin', impressions: 1000, engagement: 100, captured_at: '2026-07-18T02:00:00Z' },
      { company_id: 'co1', content_id: 'c3', platform: 'twitter', impressions: 1000, engagement: 10, captured_at: '2026-07-18T01:00:00Z' },
    ],
  };
}

const find = (ps: any[], dim: string, key: string, platform: any = null) =>
  ps.find((p) => p.dimension === dim && p.patternKey === key && (p.platform ?? null) === platform);

describe('performanceIntelligence.deriveIntelligence', () => {
  it('derives per-dimension patterns with explainable company-history percentile scores', async () => {
    mockFrom = fakeStore(seed()).from;
    const patterns = await deriveIntelligence('co1');

    // Hook "Hook A" spans c1 (pctl 1.0) + c2 (pctl 0.5) → mean 0.75, sample 2.
    const hookA = find(patterns, 'hook', 'hook a');
    expect(hookA).toBeDefined();
    expect(hookA.score).toBe(0.75);
    expect(hookA.sampleSize).toBe(2);
    expect(hookA.pattern.method).toBe('company_history_percentile');
    expect(hookA.pattern.meanPercentile).toBe(0.75);
    expect(typeof hookA.pattern.explanation).toBe('string');

    // Hook "Hook B" is only c3 (bottom) → 0.0, sample 1.
    const hookB = find(patterns, 'hook', 'hook b');
    expect(hookB.score).toBe(0);
    expect(hookB.sampleSize).toBe(1);

    // Platform dimension is the only one that sets the platform column.
    const linkedin = find(patterns, 'platform', 'linkedin', 'linkedin');
    expect(linkedin).toBeDefined();
    expect(linkedin.score).toBe(0.75);
    expect(linkedin.platform).toBe('linkedin');

    // Campaign trend.
    const camp1 = find(patterns, 'campaign', 'camp1');
    expect(camp1.score).toBe(0.75);
    expect(camp1.sampleSize).toBe(2);
  });

  it('is deterministic: same input → identical output (values AND order)', async () => {
    mockFrom = fakeStore(seed()).from;
    const a = await deriveIntelligence('co1');
    mockFrom = fakeStore(seed()).from; // fresh store, identical seed
    const b = await deriveIntelligence('co1');
    expect(a).toEqual(b);
  });

  it('persists idempotently: re-derivation upserts, never duplicates rows', async () => {
    const fake = fakeStore(seed());
    mockFrom = fake.from;
    await deriveIntelligence('co1');
    const count1 = fake.store.learning_intelligence.length;
    expect(count1).toBeGreaterThan(0);
    await deriveIntelligence('co1');
    const count2 = fake.store.learning_intelligence.length;
    expect(count2).toBe(count1); // converged — no duplicate pattern rows
  });

  it('never reads or writes the historical `content` table', async () => {
    const fake = fakeStore(seed());
    mockFrom = fake.from;
    await deriveIntelligence('co1');
    const tables = fake.from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('content');
    expect(fake.store.content).toHaveLength(0);
  });

  it('is company-scoped: only reads rows for the requested company', async () => {
    const fake = fakeStore(seed());
    mockFrom = fake.from;
    const obs = await fetchPerformanceObservations('co1');
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => ['c1', 'c2', 'c3'].includes(o.contentId))).toBe(true);
  });

  it('is FAIL-SAFE: a throwing supabase resolves to [] (never throws)', async () => {
    mockFrom = jest.fn(() => { throw new Error('db down'); });
    await expect(deriveIntelligence('co1')).resolves.toEqual([]);
  });

  it('returns [] cleanly when the company has no performance history', async () => {
    mockFrom = fakeStore({}).from;
    await expect(deriveIntelligence('co-empty')).resolves.toEqual([]);
  });
});
