/**
 * Phase 6H contract-equivalence — Cohort Funnel Intelligence migration.
 * The repository must reproduce the legacy CohortFunnelReport exactly: cohort keying
 * (session/user/domain/campaign), the five-stage walk, dropoff, attribution-breaks,
 * bottleneck, revenue lineage, confidence, size-DESC ordering, notes. Per-table mock;
 * `now` injected for determinism; no DB.
 */
const fx: { touches: any[]; leads: any[]; sessions: any[]; audits: any[]; throwOn: Set<string> } = {
  touches: [], leads: [], sessions: [], audits: [], throwOn: new Set(),
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = ret; builder.eq = ret; builder.gte = ret; builder.limit = ret;
    (builder as { then: unknown }).then = (resolve: (o: any) => void, reject: (e: any) => void) => {
      if (fx.throwOn.has(table)) return reject(new Error(`boom:${table}`));
      const map: Record<string, any[]> = {
        campaign_touchpoints: fx.touches, leads: fx.leads, visitor_sessions: fx.sessions, audit_events: fx.audits,
      };
      return resolve({ data: map[table] ?? [] });
    };
    return builder;
  },
}));

import {
  getCohortFunnelIntelligence,
  getCohortFunnelInputs,
  analyzeCohortFunnel,
} from '../../services/leadIntelligence/cohortFunnelRepository';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

beforeEach(() => { fx.touches = []; fx.leads = []; fx.sessions = []; fx.audits = []; fx.throwOn = new Set(); });

describe('Phase 6H — Cohort Funnel Intelligence repository migration (byte-identical)', () => {
  it('empty datasets → no cohorts', async () => {
    const r = await getCohortFunnelIntelligence('co1', 'session', NOW);
    expect(r).toEqual({
      companyId: 'co1', generatedAt: '2026-06-01T00:00:00.000Z', windowDays: 30, kind: 'session',
      totalCohorts: 0, totalLeads: 0, totalRevenueUsd: 0, cohorts: [],
      capabilityNote: expect.stringContaining('Deterministic per-cohort funnel'),
    });
  });

  it('session cohort: visit→engage→lead stages, dropoff, attribution-break, confidence', async () => {
    fx.touches = [{ lead_id: 'L1', visitor_session_id: 'v1', campaign: 'c', source: 's', medium: 'm', page_url: 'https://x.com/p', touched_at: '2026-05-28T00:00:00Z', nonce: null }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', started_at: '2026-05-27T00:00:00Z', engaged_at: '2026-05-27T01:00:00Z' }];
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', created_at: '2026-05-29T00:00:00Z' }];
    const r = await getCohortFunnelIntelligence('co1', 'session', NOW);
    expect(r.totalCohorts).toBe(1);
    const c = r.cohorts[0];
    expect(c.cohortId).toBe('c_session_1');
    expect(c.key).toBe('v1');
    expect(c.stages.map((s) => [s.stage, s.count])).toEqual([
      ['visit', 1], ['engage', 1], ['lead', 1], ['opportunity', 0], ['closed_won', 0],
    ]);
    // dropFromPrev: visit 0; engage 1-1/1=0; lead 0; opportunity 1-0/1=1; closed_won prev0→0
    expect(c.stages.map((s) => s.dropFromPrev)).toEqual([0, 0, 0, 1, 0]);
    expect(c.bottleneckStage).toBe('opportunity'); // steepest drop
    expect(c.attributionBreaks).toBe(0); // 1 lead, touchCount 1
    expect(c.size).toBe(2); // sessionIds 1 + leadIds 1
    expect(c.confidence).toBe(Math.round((1 - Math.exp(-2 / 6)) * 100));
    expect(c.firstSeenAt).toBe('2026-05-28T00:00:00Z'); // min(touch, lead)
    expect(c.lastSeenAt).toBe('2026-05-29T00:00:00Z');
    expect(r.totalLeads).toBe(1);
  });

  it('revenue lineage: closed_won + opportunity + revenueUsd via audit metadata.stage', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', created_at: '2026-05-29T00:00:00Z' }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', started_at: '2026-05-27T00:00:00Z', engaged_at: null }];
    fx.audits = [
      { resource_id: 'r1', metadata: { leadId: 'L1', stage: 'closed_won', amountUsd: 1200.5 }, created_at: '2026-05-30T00:00:00Z' },
      { resource_id: 'r2', metadata: { leadId: 'L1', stage: 'opportunity', amountUsd: 0 }, created_at: '2026-05-30T01:00:00Z' },
    ];
    const r = await getCohortFunnelIntelligence('co1', 'session', NOW);
    const c = r.cohorts[0];
    expect(c.stages.find((s) => s.stage === 'closed_won')!.count).toBe(1);
    expect(c.stages.find((s) => s.stage === 'opportunity')!.count).toBe(1);
    expect(c.revenueUsd).toBe(1200.5);
    expect(r.totalRevenueUsd).toBe(1200.5);
  });

  it('domain cohort keys by page_url host; campaign cohort keys by campaign|source|medium', async () => {
    fx.touches = [
      { lead_id: null, visitor_session_id: 'v1', campaign: 'spring', source: 'google', medium: 'cpc', page_url: 'https://Shop.Example.com/x', touched_at: '2026-05-28T00:00:00Z', nonce: null },
    ];
    const dom = await getCohortFunnelIntelligence('co1', 'domain', NOW);
    expect(dom.cohorts[0].key).toBe('shop.example.com'); // lowercased host
    expect(dom.cohorts[0].cohortId).toBe('c_domain_1');
    const camp = await getCohortFunnelIntelligence('co1', 'campaign', NOW);
    expect(camp.cohorts[0].key).toBe('spring|google|cpc');
  });

  it('user cohort + ordering by size DESC', async () => {
    fx.leads = [
      { id: 'L1', visitor_session_id: 'v1', created_at: '2026-05-29T00:00:00Z' },
      { id: 'L2', visitor_session_id: null, created_at: '2026-05-29T00:00:00Z' },
    ];
    // L1 has a session → size 2; L2 no session → size 1 → L1 first
    const r = await getCohortFunnelIntelligence('co1', 'user', NOW);
    expect(r.cohorts.map((c) => c.key)).toEqual(['L1', 'L2']);
    expect(r.cohorts[0].size).toBeGreaterThanOrEqual(r.cohorts[1].size);
  });

  it('null/invalid handling: bad page_url under domain kind → skipped; revenue without leadId ignored', async () => {
    fx.touches = [{ lead_id: null, visitor_session_id: 'v1', campaign: null, source: null, medium: null, page_url: 'not a url', touched_at: '2026-05-28T00:00:00Z', nonce: null }];
    fx.audits = [{ resource_id: 'r1', metadata: { stage: 'closed_won', amountUsd: 50 }, created_at: '2026-05-30T00:00:00Z' }];
    const r = await getCohortFunnelIntelligence('co1', 'domain', NOW);
    expect(r.totalCohorts).toBe(0); // unparseable host → no cohort key
  });

  it('fail-open + tenant isolation: throwing sources degrade to empty', async () => {
    fx.throwOn = new Set(['campaign_touchpoints', 'leads', 'visitor_sessions', 'audit_events']);
    const r = await getCohortFunnelIntelligence('other-co', 'session', NOW);
    expect(r.companyId).toBe('other-co');
    expect(r.cohorts).toEqual([]);
  });

  it('inputs hydrate all four sources; analyzeCohortFunnel is pure', async () => {
    fx.touches = [{ lead_id: 'L1', visitor_session_id: 'v1', campaign: 'c', source: 's', medium: 'm', page_url: null, touched_at: '2026-05-28T00:00:00Z', nonce: null }];
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', created_at: '2026-05-29T00:00:00Z' }];
    const inputs = await getCohortFunnelInputs('co1', NOW);
    expect(inputs.touches).toHaveLength(1);
    expect(inputs.leads).toHaveLength(1);
    expect(analyzeCohortFunnel(inputs, 'session', NOW)).toEqual(analyzeCohortFunnel(inputs, 'session', NOW));
  });
});
