/**
 * Phase 6C contract-equivalence — GET /api/leads/signals repository cutover.
 * The repository reader must reproduce the previous inline `fetchCanonicalSignals`
 * output byte-for-byte: same query (org scope, detected_at DESC, range, filters),
 * same per-row normalization, contacts join + graceful fallback, table-missing→null.
 * Recording mock for the supabase client; no DB.
 */
type Outcome = { data: unknown; error: { message?: string; code?: string } | null; count: number | null };
const state: { selects: string[]; calls: Array<[string, unknown[]]>; outcomes: Outcome[]; idx: number } = {
  selects: [], calls: [], outcomes: [], idx: 0,
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      const rec = (m: string) => (...args: unknown[]) => { state.calls.push([m, args]); return builder; };
      builder.eq = rec('eq');
      builder.order = rec('order');
      builder.range = rec('range');
      builder.gte = rec('gte');
      builder.lte = rec('lte');
      builder.select = (sel: string) => { state.selects.push(sel); return builder; };
      // resolves to the next queued outcome (one per select attempt)
      (builder as { then: unknown }).then = (resolve: (o: Outcome) => void) => {
        const o = state.outcomes[state.idx] ?? { data: [], error: null, count: 0 };
        state.idx += 1;
        return resolve(o);
      };
      return builder;
    },
  },
}));

import { getLeadSignals } from '../../services/leadIntelligence/legacySignalCompat';

const rawRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1', organization_id: 'co1', source_type: 'engagement', source_id: 'src1',
  thread_id: 't1', platform: 'reddit', platform_user_id: 'u1', content_text: 'hi',
  intent_score: 0.8, urgency_score: 0.6, icp_score: 0.5, confidence_score: 0.9, total_score: 0.75,
  detected_at: '2026-01-01T00:00:00Z', contact_key: 'ck1', contact_id: 'c1', metadata: { a: 1 },
  contact: { id: 'c1', platform: 'reddit', platform_user_id: 'u1', display_name: 'Jane' },
  ...over,
});

const baseParams = {
  organizationId: 'co1', minScore: null as number | null, maxScore: null as number | null,
  dateFrom: null as string | null, dateTo: null as string | null, page: 1, pageSize: 20,
};

beforeEach(() => { state.selects = []; state.calls = []; state.outcomes = []; state.idx = 0; });

describe('Phase 6C — legacy /api/leads/signals repository cutover (byte-identical)', () => {
  it('reproduces the normalized signal shape incl. nested contact', async () => {
    state.outcomes = [{ data: [rawRow()], error: null, count: 1 }];
    const out = await getLeadSignals(baseParams);
    expect(out).toEqual({
      items: [{
        id: 's1', organization_id: 'co1', source_type: 'engagement', source_id: 'src1',
        thread_id: 't1', platform: 'reddit', platform_user_id: 'u1', content_text: 'hi',
        intent_score: 0.8, urgency_score: 0.6, icp_score: 0.5, confidence_score: 0.9, total_score: 0.75,
        detected_at: '2026-01-01T00:00:00Z', contact_key: 'ck1', contact_id: 'c1', metadata: { a: 1 },
        contact: { contact_id: 'c1', platform: 'reddit', platform_user_id: 'u1', display_name: 'Jane' },
      }],
      total: 1,
    });
  });

  it('null preservation: missing scores/contact → nulls + metadata defaults to {}', async () => {
    state.outcomes = [{ data: [rawRow({ intent_score: null, total_score: undefined, detected_at: null, thread_id: null, contact: null, metadata: null })], error: null, count: 1 }];
    const out = await getLeadSignals(baseParams);
    expect(out!.items[0].intent_score).toBeNull();
    expect(out!.items[0].total_score).toBeNull();
    expect(out!.items[0].detected_at).toBeNull();
    expect(out!.items[0].thread_id).toBeNull();
    expect(out!.items[0].contact).toBeNull();
    expect(out!.items[0].metadata).toEqual({});
  });

  it('mirrors the exact query (tenant + detected_at DESC + range + all filters)', async () => {
    state.outcomes = [{ data: [], error: null, count: 0 }];
    await getLeadSignals({
      ...baseParams, sourceType: 'listening', platform: 'x', threadId: 't9', contactKey: 'k9',
      sourceId: 'sid9', minScore: 0.2, maxScore: 0.9, dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-02-01T23:59:59.999Z', page: 2, pageSize: 10,
    });
    expect(state.calls).toContainEqual(['eq', ['organization_id', 'co1']]);
    expect(state.calls).toContainEqual(['order', ['detected_at', { ascending: false }]]);
    expect(state.calls).toContainEqual(['range', [10, 19]]); // (page-1)*size .. page*size-1
    expect(state.calls).toContainEqual(['eq', ['source_type', 'listening']]);
    expect(state.calls).toContainEqual(['eq', ['platform', 'x']]);
    expect(state.calls).toContainEqual(['eq', ['thread_id', 't9']]);
    expect(state.calls).toContainEqual(['eq', ['contact_key', 'k9']]);
    expect(state.calls).toContainEqual(['eq', ['source_id', 'sid9']]);
    expect(state.calls).toContainEqual(['gte', ['total_score', 0.2]]);
    expect(state.calls).toContainEqual(['lte', ['total_score', 0.9]]);
    expect(state.calls).toContainEqual(['gte', ['detected_at', '2026-01-01T00:00:00.000Z']]);
    expect(state.calls).toContainEqual(['lte', ['detected_at', '2026-02-01T23:59:59.999Z']]);
  });

  it('falls back to the contacts-less select when the join is unavailable', async () => {
    state.outcomes = [
      { data: null, error: { message: 'Could not find a relationship for contacts' }, count: null },
      { data: [rawRow({ contact: undefined })], error: null, count: 1 },
    ];
    const out = await getLeadSignals(baseParams);
    expect(state.selects).toHaveLength(2); // retried without the contacts join
    expect(state.selects[1]).not.toContain('contact:contacts');
    expect(out!.items[0].contact).toBeNull();
  });

  it('returns null when the lead_signals table is absent (endpoint → 503)', async () => {
    state.outcomes = [{ data: null, error: { code: '42P01', message: 'relation "lead_signals" does not exist' }, count: null }];
    expect(await getLeadSignals(baseParams)).toBeNull();
  });

  it('propagates other query errors', async () => {
    state.outcomes = [{ data: null, error: { message: 'boom' }, count: null }];
    await expect(getLeadSignals(baseParams)).rejects.toThrow('boom');
  });

  it('total falls back to item count when count is null', async () => {
    state.outcomes = [{ data: [rawRow(), rawRow({ id: 's2' })], error: null, count: null }];
    const out = await getLeadSignals(baseParams);
    expect(out!.total).toBe(2);
  });
});
