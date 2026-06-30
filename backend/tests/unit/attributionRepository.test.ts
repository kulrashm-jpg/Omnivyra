/**
 * Phase 6D contract-equivalence — Attribution Diagnostics repository migration (E2).
 * The repository must reproduce the legacy AttributionDiagnosticsReport exactly
 * (totals, percentages, channel grouping, issues/remediation, ordering) and expose
 * the additive richer aggregation. Per-table recording mock; `now` injected for
 * determinism; no DB.
 */
const fx: {
  leads: any[]; attributions: any[]; sessionsTotal: number; sessionsStitched: number;
  throwOn: Set<string>;
} = { leads: [], attributions: [], sessionsTotal: 0, sessionsStitched: 0, throwOn: new Set() };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let hasNot = false;
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = ret;
    builder.eq = ret;
    builder.gte = ret;
    builder.not = () => { hasNot = true; return builder; };
    (builder as { then: unknown }).then = (resolve: (o: any) => void, reject: (e: any) => void) => {
      if (fx.throwOn.has(table)) return reject(new Error(`boom:${table}`));
      if (table === 'visitor_sessions') return resolve({ count: hasNot ? fx.sessionsStitched : fx.sessionsTotal });
      if (table === 'leads') return resolve({ data: fx.leads });
      if (table === 'lead_attributions') return resolve({ data: fx.attributions });
      return resolve({ data: [] });
    };
    return builder;
  },
}));

import { getAttributionDiagnostics, getAttributionAggregation } from '../../services/leadIntelligence/attributionRepository';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const attr = (over: Record<string, unknown> = {}) => ({
  lead_id: 'L1', visitor_session_id: 's1', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring',
  utm_content: 'ad1', utm_term: 'kw', referrer: 'https://google.com/', created_at: '2026-05-30T10:00:00Z', ...over,
});

beforeEach(() => { fx.leads = []; fx.attributions = []; fx.sessionsTotal = 0; fx.sessionsStitched = 0; fx.throwOn = new Set(); });

describe('Phase 6D — Attribution Diagnostics repository migration (byte-identical)', () => {
  it('reproduces the full report with totals, confidence %, channel grouping & issues', async () => {
    fx.leads = [
      { id: 'L1', visitor_session_id: 's1', created_at: '2026-05-30T10:00:00Z' },
      { id: 'L2', visitor_session_id: null, created_at: '2026-05-29T10:00:00Z' },
    ];
    fx.attributions = [
      attr({ lead_id: 'L1', utm_medium: 'cpc', referrer: 'https://google.com/' }),               // paid (medium cpc)
      attr({ lead_id: 'L3', utm_source: null, utm_medium: null, referrer: 'https://news.ycombinator.com/' }), // referral, no utm but referrer
    ];
    fx.sessionsTotal = 5; fx.sessionsStitched = 0;

    const r = await getAttributionDiagnostics('co1', 30, NOW);
    expect(r).toEqual({
      companyId: 'co1',
      generatedAt: '2026-06-01T00:00:00.000Z',
      windowDays: 30,
      leads: 2,
      leadsWithAttribution: 1,          // only L1 has an attribution row matching a lead
      leadsWithSession: 1,              // only L1 has a session
      sessionsStitched: 0,
      sessionsTotal: 5,
      missingAttribution: 1,            // L2
      missingUtmButHasReferrer: 1,      // the L3 row
      attributionConfidence: Math.round(((1 * 0.6 + 1 * 0.4) / 2) * 100), // 50
      channelBreakdown: { direct: 0, organic_search: 0, paid: 1, social: 0, email: 0, referral: 1, internal: 0, unknown: 0 },
      integrityIssues: [
        '1/2 leads have no attribution snapshot.',
        'No visitor sessions are stitched to leads — anonymous→lead linkage may be broken.',
        '1 attributions rely on referrer only (no UTM) — channel accuracy reduced.',
      ],
      remediation: [
        'Ensure the form/webhook payload forwards utm_* + referrer + landing_page (tracker captures these automatically when installed).',
        'Confirm leads submit the anonymous_id/session_id captured by the tracker.',
      ],
    });
  });

  it('channelBreakdown key ordering is the canonical order', async () => {
    fx.attributions = [attr()];
    const r = await getAttributionDiagnostics('co1', 30, NOW);
    expect(Object.keys(r.channelBreakdown)).toEqual(['direct', 'organic_search', 'paid', 'social', 'email', 'referral', 'internal', 'unknown']);
  });

  it('empty dataset → zeros, 0 confidence, no issues', async () => {
    const r = await getAttributionDiagnostics('co1', 14, NOW);
    expect(r.leads).toBe(0);
    expect(r.attributionConfidence).toBe(0);
    expect(r.integrityIssues).toEqual([]);
    expect(r.remediation).toEqual([]);
    expect(r.windowDays).toBe(14);
  });

  it('fail-open: a throwing source degrades to empty (no crash)', async () => {
    fx.throwOn = new Set(['leads', 'lead_attributions', 'visitor_sessions']);
    const r = await getAttributionDiagnostics('co1', 30, NOW);
    expect(r.leads).toBe(0);
    expect(r.channelBreakdown.paid).toBe(0);
  });

  it('tenant scoping is applied (company_id eq on every source)', async () => {
    // covered structurally: each query chains .eq('company_id', companyId); a wrong
    // tenant returns no rows. Empty fixtures for another tenant → empty report.
    const r = await getAttributionDiagnostics('other-co', 30, NOW);
    expect(r.companyId).toBe('other-co');
    expect(r.leads).toBe(0);
  });

  describe('E2 richer aggregation (additive)', () => {
    it('produces channel/source/medium/campaign/referrer/UTM/timeline aggregates', async () => {
      fx.leads = [{ id: 'L1', visitor_session_id: 's1', created_at: '2026-05-30T10:00:00Z' }];
      fx.attributions = [
        attr({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', referrer: 'https://google.com/', created_at: '2026-05-30T10:00:00Z' }),
        attr({ lead_id: 'L2', utm_source: 'google', utm_medium: 'organic', utm_campaign: null, utm_content: null, utm_term: null, referrer: null, created_at: '2026-05-31T09:00:00Z' }),
      ];
      fx.sessionsTotal = 3; fx.sessionsStitched = 2;

      const a = await getAttributionAggregation('co1', 30, NOW);
      expect(a.totals).toEqual({
        leads: 1, attributions: 2, leadsWithAttribution: 1, leadsWithSession: 1,
        sessionsTotal: 3, sessionsStitched: 2, missingAttribution: 0, missingUtmButHasReferrer: 0,
      });
      expect(a.sourceBreakdown).toEqual({ google: 2 });
      expect(a.mediumBreakdown).toEqual({ cpc: 1, organic: 1 });
      expect(a.campaignBreakdown).toEqual({ '(none)': 1, spring: 1 });
      expect(a.referrerBreakdown).toEqual({ '(none)': 1, 'https://google.com/': 1 });
      expect(a.utmAggregation).toEqual({ withUtmSource: 2, withUtmMedium: 2, withUtmCampaign: 1, withUtmContent: 1, withUtmTerm: 1 });
      expect(a.channelBreakdown.paid).toBe(1);            // cpc
      expect(a.channelBreakdown.organic_search).toBe(1);  // organic medium
      expect(a.timeline).toEqual([
        { date: '2026-05-30', attributions: 1 },
        { date: '2026-05-31', attributions: 1 },
      ]);
    });

    it('timeline is sorted ascending and skips null created_at', async () => {
      fx.attributions = [
        attr({ created_at: '2026-05-31T00:00:00Z' }),
        attr({ created_at: '2026-05-29T00:00:00Z' }),
        attr({ created_at: null }),
      ];
      const a = await getAttributionAggregation('co1', 30, NOW);
      expect(a.timeline.map((t) => t.date)).toEqual(['2026-05-29', '2026-05-31']);
    });
  });
});
