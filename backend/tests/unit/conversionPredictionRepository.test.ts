/**
 * Phase 6E contract-equivalence — Marketing Conversion Prediction migration (E4).
 * The repository must reproduce the legacy ConversionPredictionReport exactly:
 * scores, tiers, signals, confidence, distribution, ordering, capability notes.
 * Per-table recording mock; `now` injected for determinism; no DB.
 */
const fx: { leads: any[]; attributions: any[]; events: any[]; signals: any[]; throwOn: Set<string> } = {
  leads: [], attributions: [], events: [], signals: [], throwOn: new Set(),
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = ret;
    builder.eq = ret;
    builder.order = ret;
    builder.in = ret;
    builder.limit = ret;
    (builder as { then: unknown }).then = (resolve: (o: any) => void, reject: (e: any) => void) => {
      if (fx.throwOn.has(table)) return reject(new Error(`boom:${table}`));
      const map: Record<string, any[]> = {
        leads: fx.leads, lead_attributions: fx.attributions, tracking_events: fx.events, lead_signals: fx.signals,
      };
      return resolve({ data: map[table] ?? [] });
    };
    return builder;
  },
}));

import {
  getMarketingConversionPrediction,
  getConversionPredictionInputs,
  predictFromInputs,
} from '../../services/leadIntelligence/conversionPredictionRepository';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

beforeEach(() => { fx.leads = []; fx.attributions = []; fx.events = []; fx.signals = []; fx.throwOn = new Set(); });

describe('Phase 6E — Marketing Conversion Prediction repository migration (byte-identical)', () => {
  it('empty leads → empty report with the no-leads capability note', async () => {
    const r = await getMarketingConversionPrediction('co1', 200, NOW);
    expect(r).toEqual({
      companyId: 'co1', generatedAt: '2026-06-01T00:00:00.000Z',
      predictions: [], distribution: { high: 0, medium: 0, low: 0, cold: 0 },
      capabilityNote: 'No leads available for prediction window.',
    });
  });

  it('reproduces scores, tiers, signals, confidence and distribution exactly', async () => {
    fx.leads = [
      { id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' },
      { id: 'L2', visitor_session_id: null, created_at: '2026-05-30T00:00:00Z' },
    ];
    fx.attributions = [{ lead_id: 'L1', utm_medium: 'cpc' }]; // paid channel weight 18
    fx.events = Array.from({ length: 7 }, () => ({ visitor_session_id: 's1' })); // 7 events on s1
    fx.signals = [{ crm_lead_id: 'L1', total_score: 40 }]; // +min(25, round(40/4)=10)=10

    const r = await getMarketingConversionPrediction('co1', 200, NOW);

    // L1: 10 +15(attr) +10(session) + round(log1p(7)*8)=round(2.0794*8)=round(16.6)=17 +10(signals) +18(cpc) = 80 → high
    const depth = Math.round(Math.log1p(7) * 8);
    const l1Score = 10 + 15 + 10 + depth + 10 + 18;
    const L1 = r.predictions.find((p) => p.leadId === 'L1')!;
    expect(L1.conversionScore).toBe(l1Score);
    expect(L1.tier).toBe('high');
    expect(L1.signals).toEqual(['attribution_present', 'session_stitched', `engagement_depth(7)`, 'lead_signal_score(40)', 'channel(cpc)']);
    expect(L1.confidence).toBe(100); // coverage 5 * 20, capped 100
    expect(L1.basis).toBe('baseline 10 + attribution 15 + session 10 + log1p(events)*8 + lead_signals/4 + channel weight');

    // L2: only baseline 10 → cold, no signals, confidence 0
    const L2 = r.predictions.find((p) => p.leadId === 'L2')!;
    expect(L2.conversionScore).toBe(10);
    expect(L2.tier).toBe('cold');
    expect(L2.signals).toEqual([]);
    expect(L2.confidence).toBe(0);

    expect(r.distribution).toEqual({ high: 1, medium: 0, low: 0, cold: 1 });
    expect(r.capabilityNote).toBe('Deterministic weighted heuristic over real attribution/engagement/lead_signals/UTM. No ML, no learned model.');
  });

  it('orders predictions by conversionScore DESC', async () => {
    fx.leads = [
      { id: 'low', visitor_session_id: null, created_at: '2026-05-31T00:00:00Z' },
      { id: 'high', visitor_session_id: 's1', created_at: '2026-05-30T00:00:00Z' },
    ];
    fx.attributions = [{ lead_id: 'high', utm_medium: 'email' }];
    const r = await getMarketingConversionPrediction('co1', 200, NOW);
    expect(r.predictions.map((p) => p.leadId)).toEqual(['high', 'low']);
  });

  it('null handling: total_score 0 / unknown channel contribute nothing', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }];
    fx.attributions = [{ lead_id: 'L1', utm_medium: 'carrier-pigeon' }]; // not in CHANNEL_WEIGHTS
    fx.signals = [{ crm_lead_id: 'L1', total_score: 0 }]; // 0 → no signal boost
    const r = await getMarketingConversionPrediction('co1', 200, NOW);
    const p = r.predictions[0];
    expect(p.signals).toEqual(['attribution_present', 'session_stitched']); // no engagement/signal/channel
    expect(p.conversionScore).toBe(35); // 10 + 15 + 10
  });

  it('engagement depth boost is capped at 20', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }];
    fx.events = Array.from({ length: 5000 }, () => ({ visitor_session_id: 's1' }));
    const r = await getMarketingConversionPrediction('co1', 200, NOW);
    expect(r.predictions[0].signals).toContain('engagement_depth(5000)');
    // 10 baseline + 10 session + 20 (capped) = 40
    expect(r.predictions[0].conversionScore).toBe(40);
  });

  it('fail-open: throwing sources degrade to empty inputs', async () => {
    fx.throwOn = new Set(['leads']);
    const r = await getMarketingConversionPrediction('co1', 200, NOW);
    expect(r.predictions).toEqual([]);
    expect(r.capabilityNote).toBe('No leads available for prediction window.');
  });

  it('tenant isolation: another tenant with no rows → no-leads report', async () => {
    const r = await getMarketingConversionPrediction('other-co', 200, NOW);
    expect(r.companyId).toBe('other-co');
    expect(r.predictions).toEqual([]);
  });

  it('getConversionPredictionInputs hydrates only consumed features; predictFromInputs is pure', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-31T00:00:00Z' }];
    fx.attributions = [{ lead_id: 'L1', utm_medium: 'social' }];
    fx.events = [{ visitor_session_id: 's1' }, { visitor_session_id: 's1' }];
    fx.signals = [{ crm_lead_id: 'L1', total_score: 12 }];
    const inputs = await getConversionPredictionInputs('co1', 200);
    expect(inputs.leads).toEqual([{ id: 'L1', visitor_session_id: 's1' }]);
    expect(inputs.attrByLead).toEqual({ L1: { utmMedium: 'social' } });
    expect(inputs.eventsBySession).toEqual({ s1: 2 });
    expect(inputs.signalsByLead).toEqual({ L1: 12 });
    // pure: same inputs → same output, twice
    const a = predictFromInputs(inputs, NOW);
    const b = predictFromInputs(inputs, NOW);
    expect(a).toEqual(b);
  });
});
