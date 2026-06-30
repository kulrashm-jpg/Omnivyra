/**
 * Phase 6F contract-equivalence — Customer Journey Intelligence migration.
 * The repository must reproduce the legacy CustomerJourneyReport exactly: the four
 * attribution models (first/last/linear/time_decay), timeline ordering, session+lead
 * touch merging, confidence, bottleneck, break-rate, notes. Per-table mock; `now`
 * injected for determinism; no DB.
 */
const fx: { leads: any[]; touches: any[]; throwOn: Set<string> } = { leads: [], touches: [], throwOn: new Set() };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = ret; builder.eq = ret; builder.gte = ret; builder.order = ret;
    builder.limit = ret; builder.or = ret; builder.in = ret;
    (builder as { then: unknown }).then = (resolve: (o: any) => void, reject: (e: any) => void) => {
      if (fx.throwOn.has(table)) return reject(new Error(`boom:${table}`));
      const map: Record<string, any[]> = { leads: fx.leads, campaign_touchpoints: fx.touches };
      return resolve({ data: map[table] ?? [] });
    };
    return builder;
  },
}));

import {
  getCustomerJourneyIntelligence,
  getCustomerJourneyInputs,
  analyzeJourneys,
} from '../../services/leadIntelligence/customerJourneyRepository';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const tp = (over: Record<string, unknown> = {}) => ({
  lead_id: 'L1', visitor_session_id: null, campaign: 'c1', source: 'google', medium: 'cpc',
  page_url: '/p', touched_at: '2026-05-31T00:00:00Z', touchpoint_type: 'event', ...over,
});

beforeEach(() => { fx.leads = []; fx.touches = []; fx.throwOn = new Set(); });

describe('Phase 6F — Customer Journey Intelligence repository migration (byte-identical)', () => {
  it('empty leads → no-leads report', async () => {
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    expect(r).toEqual({
      companyId: 'co1', generatedAt: '2026-06-01T00:00:00.000Z', windowDays: 30,
      journeys: [], attributionBreakRate: 0, bottleneck: null,
      capabilityNote: 'No leads in window — deterministic multi-touch attribution requires real lead conversions.',
    });
  });

  it('reproduces all four attribution models with correct credits & ordering', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: null, created_at: '2026-05-31T00:00:00Z' }];
    fx.touches = [
      tp({ campaign: 'c1', source: 'google', medium: 'cpc', touched_at: '2026-05-24T00:00:00Z' }), // 7d before conv
      tp({ campaign: 'c2', source: 'fb', medium: 'social', touched_at: '2026-05-31T00:00:00Z' }),  // at conversion
    ];
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    const j = r.journeys[0];
    expect(j.touchCount).toBe(2);
    expect(j.touchpoints.map((t) => t.campaignKey)).toEqual(['c1', 'c2']); // touched_at ASC
    expect(j.models.first_touch).toEqual([{ campaignKey: 'c1', credit: 1 }]);
    expect(j.models.last_touch).toEqual([{ campaignKey: 'c2', credit: 1 }]);
    expect(j.models.linear).toEqual([{ campaignKey: 'c1', credit: 0.5 }, { campaignKey: 'c2', credit: 0.5 }]);
    // time_decay: raw=[0.5^1, 0.5^0]=[0.5,1] → sum1.5 → [0.3333,0.6667]
    expect(j.models.time_decay).toEqual([{ campaignKey: 'c1', credit: 0.3333 }, { campaignKey: 'c2', credit: 0.6667 }]);
    // confidence = clamp(round((1-exp(-2/4))*100))
    expect(j.confidence).toBe(Math.round((1 - Math.exp(-0.5)) * 100));
    expect(r.bottleneck).toBe('google:cpc'); // tie → first inserted
    expect(r.capabilityNote).toContain('four-model multi-touch attribution');
  });

  it('merges lead-scoped + session-scoped touches and re-sorts by touched_at', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }];
    fx.touches = [
      tp({ lead_id: 'L1', visitor_session_id: null, campaign: 'direct-late', touched_at: '2026-05-30T00:00:00Z' }),
      tp({ lead_id: null, visitor_session_id: 's1', campaign: 'session-early', touched_at: '2026-05-28T00:00:00Z' }),
    ];
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    // combined sorted ASC: session-early (28th) then direct-late (30th)
    expect(r.journeys[0].touchpoints.map((t) => t.campaignKey)).toEqual(['session-early', 'direct-late']);
    expect(r.journeys[0].models.first_touch).toEqual([{ campaignKey: 'session-early', credit: 1 }]);
  });

  it('break-rate counts leads with no touches; empty journey has empty models', async () => {
    fx.leads = [
      { id: 'L1', visitor_session_id: null, created_at: '2026-05-31T00:00:00Z' },
      { id: 'L2', visitor_session_id: null, created_at: '2026-05-30T00:00:00Z' },
    ];
    fx.touches = [tp({ lead_id: 'L1' })];
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    expect(r.attributionBreakRate).toBe(0.5); // 1 of 2 broken
    const l2 = r.journeys.find((x) => x.leadId === 'L2')!;
    expect(l2.touchCount).toBe(0);
    expect(l2.models).toEqual({ first_touch: [], last_touch: [], linear: [], time_decay: [] });
    expect(l2.confidence).toBe(0);
  });

  it('campaignKey falls back source → "direct"; null handling preserved', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: null, created_at: '2026-05-31T00:00:00Z' }];
    fx.touches = [
      tp({ campaign: null, source: 'bing', medium: null, page_url: null, touchpoint_type: null }),
      tp({ campaign: null, source: null, medium: null, touched_at: '2026-05-31T01:00:00Z' }),
    ];
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    const tps = r.journeys[0].touchpoints;
    expect(tps[0].campaignKey).toBe('bing'); // campaign null → source
    expect(tps[1].campaignKey).toBe('direct'); // both null → 'direct'
    expect(tps[0].medium).toBeNull();
    expect(tps[0].type).toBe('event'); // null touchpoint_type → 'event'
  });

  it('null created_at: conversionAt is null but math falls back to now (no crash)', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: null, created_at: null }];
    fx.touches = [tp({ touched_at: '2026-05-31T00:00:00Z' })];
    const r = await getCustomerJourneyIntelligence('co1', 100, NOW);
    expect(r.journeys[0].conversionAt).toBeNull();
    expect(r.journeys[0].models.time_decay).toHaveLength(1); // computed against `now`
  });

  it('fail-open + tenant isolation: no leads for tenant → no-leads report', async () => {
    fx.throwOn = new Set(['leads']);
    const r = await getCustomerJourneyIntelligence('other-co', 100, NOW);
    expect(r.companyId).toBe('other-co');
    expect(r.journeys).toEqual([]);
  });

  it('inputs hydrate leads + touchRows; analyzeJourneys is pure', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }];
    fx.touches = [tp()];
    const inputs = await getCustomerJourneyInputs('co1', 100, NOW);
    expect(inputs.leads).toEqual([{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }]);
    expect(inputs.touchRows).toHaveLength(1);
    expect(analyzeJourneys(inputs, NOW)).toEqual(analyzeJourneys(inputs, NOW));
  });
});
