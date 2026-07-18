/**
 * Wave 5 — learningEngine.recordLearningEvent unit tests.
 *
 * Proves the publish-time learning seam is:
 *  - IDEMPOTENT: re-running for the same contentId creates the placeholder
 *    performance row at most once and the rollup content converges;
 *  - FAIL-OPEN: a throwing supabase resolves (never throws into publishing);
 *  - APPEND-ONLY vs history: it NEVER calls the historical `content` table
 *    (asserted directly against the mock) and never mutates a content row.
 *
 * supabase is replaced with a faithful in-memory fake so idempotency and the
 * never-touch-content invariant are exercised, not merely asserted.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let mockFrom: jest.Mock = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

import { recordLearningEvent, buildLearningMemory } from '../../services/content/learningEngine';
import type { PerformanceObservation } from '../../services/content/performanceIntelligence';

const clone = (o: any) => JSON.parse(JSON.stringify(o));

// ── in-memory supabase fake (shared shape with performanceIntelligence test) ──

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

function seedWithHistory(): Record<string, any[]> {
  return {
    content_memory: [
      {
        company_id: 'co1', content_id: 'c1', platform: 'linkedin', campaign_id: 'camp1', content_type: 'post',
        text_excerpt: 'Winner hook\n\nStrong body about outcomes.\n\nBuy now',
        intelligence: { hooks: ['Winner hook'], ctas: ['Buy now'], narratives: ['Strong body about outcomes.'], keyMessages: ['Customers love measurable outcomes clearly'] },
      },
      {
        company_id: 'co1', content_id: 'c3', platform: 'twitter', campaign_id: 'camp2', content_type: 'post',
        text_excerpt: 'Weak hook\n\nmeh',
        intelligence: { hooks: ['Weak hook'], ctas: [], narratives: ['meh'], keyMessages: ['nothing much happened here today'] },
      },
    ],
    content_performance: [
      { company_id: 'co1', content_id: 'c1', platform: 'linkedin', impressions: 1000, engagement: 400, captured_at: '2026-07-18T03:00:00Z' },
      { company_id: 'co1', content_id: 'c2', platform: 'linkedin', impressions: 1000, engagement: 100, captured_at: '2026-07-18T02:00:00Z' },
      { company_id: 'co1', content_id: 'c3', platform: 'twitter', impressions: 1000, engagement: 5, captured_at: '2026-07-18T01:00:00Z' },
    ],
  };
}

describe('learningEngine.recordLearningEvent', () => {
  it('creates the placeholder performance row at most once (idempotent)', async () => {
    const fake = fakeStore({ content_memory: seedWithHistory().content_memory });
    mockFrom = fake.from;

    await recordLearningEvent({ companyId: 'co1', contentId: 'c9', platform: 'linkedin' });
    await recordLearningEvent({ companyId: 'co1', contentId: 'c9', platform: 'linkedin' });

    const forC9 = fake.store.content_performance.filter((r) => r.content_id === 'c9');
    expect(forC9).toHaveLength(1);
    expect(forC9[0].source).toBe('learning_event');
  });

  it('folds a single company learning_memory row and bumps model_version each event', async () => {
    const fake = fakeStore(seedWithHistory());
    mockFrom = fake.from;

    await recordLearningEvent({ companyId: 'co1', contentId: 'c1' });
    expect(fake.store.learning_memory).toHaveLength(1);
    const snap1 = clone(fake.store.learning_memory[0]);
    expect(snap1.model_version).toBe(1);

    await recordLearningEvent({ companyId: 'co1', contentId: 'c1' });
    const snap2 = clone(fake.store.learning_memory[0]);

    // Still ONE row (keyed by company_id); content converges; version advances.
    expect(fake.store.learning_memory).toHaveLength(1);
    expect(snap2.successful_messaging).toEqual(snap1.successful_messaging);
    expect(snap2.unsuccessful_messaging).toEqual(snap1.unsuccessful_messaging);
    expect(snap2.winning_structures).toEqual(snap1.winning_structures);
    expect(snap2.model_version).toBe(2);

    // Winner (c1) messaging is captured; loser (c3) is marked unsuccessful.
    expect(snap2.successful_messaging).toContain('Winner hook');
    expect(snap2.unsuccessful_messaging).toContain('Weak hook');
  });

  it('does not re-insert a placeholder when real metrics already exist', async () => {
    const fake = fakeStore(seedWithHistory());
    mockFrom = fake.from;
    const before = fake.store.content_performance.length;
    await recordLearningEvent({ companyId: 'co1', contentId: 'c1', platform: 'linkedin' });
    // c1 already had a metrics row → no placeholder added.
    expect(fake.store.content_performance.filter((r) => r.content_id === 'c1')).toHaveLength(1);
    expect(fake.store.content_performance.length).toBe(before);
  });

  it('NEVER touches the historical `content` table (no read, no write)', async () => {
    const fake = fakeStore(seedWithHistory());
    mockFrom = fake.from;
    await recordLearningEvent({ companyId: 'co1', contentId: 'c1', platform: 'linkedin' });

    const tables = fake.from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('content');
    expect(fake.store.content).toHaveLength(0);
    // Only the append-only learning tables are written.
    expect(new Set(tables)).toEqual(
      new Set(['content_performance', 'content_memory', 'learning_intelligence', 'learning_memory']),
    );
  });

  it('is FAIL-OPEN: a throwing supabase resolves without throwing', async () => {
    mockFrom = jest.fn(() => { throw new Error('db down'); });
    await expect(
      recordLearningEvent({ companyId: 'co1', contentId: 'c1' }),
    ).resolves.toBeUndefined();
  });

  it('returns quietly on missing identity (no companyId/contentId)', async () => {
    const fake = fakeStore();
    mockFrom = fake.from;
    await expect(recordLearningEvent({ companyId: '', contentId: 'c1' } as any)).resolves.toBeUndefined();
    expect(fake.from).not.toHaveBeenCalled();
  });
});

// ── pure rollup determinism ──────────────────────────────────────────────────

function obs(partial: Partial<PerformanceObservation>): PerformanceObservation {
  return {
    contentId: 'x', platform: null, campaignId: null, contentType: null,
    intelligence: { hooks: [], ctas: [], narratives: [], keyMessages: [] },
    text: '', rawEngagement: 0, denominator: null, rate: 0, rateMethod: 'absolute_engagement',
    percentile: 0, ...partial,
  };
}

describe('learningEngine.buildLearningMemory (pure)', () => {
  it('is a deterministic percentile-thresholded fold (same input → same output)', () => {
    const observations = [
      obs({ contentId: 'c1', platform: 'linkedin', percentile: 1.0, text: 'Hook\n\nBody.\n\nBuy now', intelligence: { hooks: ['Win'], ctas: ['Buy now'], narratives: ['Body.'], keyMessages: ['great outcome message'] } }),
      obs({ contentId: 'c2', platform: 'twitter', percentile: 0.0, intelligence: { hooks: ['Lose'], ctas: [], narratives: ['bad'], keyMessages: ['weak message'] } }),
    ];
    const a = buildLearningMemory(observations, 3);
    const b = buildLearningMemory(observations, 3);
    expect(a).toEqual(b);
    expect(a.successfulMessaging).toContain('Win');
    expect(a.unsuccessfulMessaging).toContain('Lose');
    expect(a.platformAdaptations).toEqual({ linkedin: 1, twitter: 0 });
    expect(a.modelVersion).toBe(4);
  });
});
