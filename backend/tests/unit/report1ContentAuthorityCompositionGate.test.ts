/**
 * R1-OPEN-01 (3AH-182) — Report 1 composition accepts a content-authority conclusion only when it
 * was computed from THIS report's domain.
 *
 * Persisted `decision_objects` carry no domain column; content-authority rows now stamp
 * `evidence.domain_id`. `composeSnapshotReport` runs for real here, with the persisted decision
 * set mocked per tier. The decisions it hands downstream (to competitor discovery and composition)
 * are recorded by wrapping the real competitor step, not replacing it. Network is hermetic and every
 * database read returns zero rows.
 */
export {};

type Row = Record<string, unknown>;

const byTier: Record<string, Row[]> = { snapshot: [], growth: [] };
const handedDownstream: Row[][] = [];

jest.mock('../../services/decisionComposerService', () => {
  const actual = jest.requireActual('../../services/decisionComposerService');
  return {
    ...actual,
    composeDecisionIntelligence: async (p: { reportTier: string }) => ({ decisions: byTier[p.reportTier] ?? [] }),
  };
});

jest.mock('../../services/reportCompetitorIntelligenceServiceEngine', () => {
  const actual = jest.requireActual('../../services/reportCompetitorIntelligenceServiceEngine');
  return {
    ...actual,
    buildCompetitorIntelligenceActive: async (p: { decisions: Row[] }) => {
      handedDownstream.push(p.decisions);
      return actual.buildCompetitorIntelligenceActive(p);
    },
  };
});

jest.mock('../../services/reportCompetitorIntelligenceServiceHelpers', () => {
  const actual = jest.requireActual('../../services/reportCompetitorIntelligenceServiceHelpers');
  return { ...actual, fetchSerpResultsForKeyword: async () => [] };
});

jest.mock('../../db/supabaseClient', () => {
  const actual = jest.requireActual('../../db/supabaseClient');
  const zero = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'gte', 'lte', 'order', 'limit', 'is', 'neq', 'or', 'filter']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.single = async () => ({ data: null, error: null });
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject);
    return q;
  };
  return { ...actual, supabase: { from: () => zero(), rpc: async () => ({ data: null, error: null }) } };
});

const { composeSnapshotReport } = require('../../services/snapshotReportService');
const { isDecisionForReportDomain, DOMAIN_SCOPED_DECISION_SERVICES } = require('../../services/evidenceProvenance');

jest.setTimeout(120_000);

const NOW = new Date('2026-09-22T00:00:00.000Z').toISOString();
const decision = (id: string, over: Row): Row => ({
  id, company_id: 'co-1', report_tier: 'growth', source_service: 'contentAuthorityService',
  entity_type: 'content_cluster', entity_id: id, issue_type: 'topic_gap', title: id, description: id,
  evidence: {}, impact_traffic: 50, impact_conversion: 30, impact_revenue: 20, priority_score: 60,
  effort_score: 20, execution_score: 60, confidence_score: 0.8, recommendation: 'Act.',
  action_type: 'improve_content', action_payload: {}, status: 'open', last_changed_by: 'system',
  created_at: NOW, updated_at: NOW, resolved_at: null, ignored_at: null, ...over,
});

const CURRENT = decision('CURRENT-CA', { evidence: { domain_id: 'd-cur' } });
const STALE = decision('STALE-CA', { evidence: { domain_id: 'd-old' } });
const LEGACY = decision('LEGACY-CA', { evidence: { content_cluster: 'tutorial' } });
const UNRELATED_GROWTH = decision('UNRELATED-GROWTH', {
  source_service: 'brandTrustIntelligenceService', entity_type: 'global', issue_type: 'brand_trust_gap', evidence: {},
});
const UNRELATED_SNAPSHOT = decision('UNRELATED-SNAPSHOT', {
  report_tier: 'snapshot', source_service: 'authorityIntelligenceService', entity_type: 'global', issue_type: 'authority_gap',
});

const resolvedInput = {
  companyId: 'co-1', reportCategory: 'snapshot', profile: null, requestPayload: {},
  defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
  resolved: {
    companyName: 'Gate Co', websiteDomain: 'current.test', businessType: null, geography: null, socialLinks: [], competitors: [],
    source: 'manual-entry', uploadedFileName: null, manualData: null,
    companyContext: {
      marketFocus: null, productServices: [], targetCustomer: null, idealCustomerProfile: null, brandPositioning: null,
      competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null,
    },
  },
  integrations: {},
};

async function compose(domainId: string | null): Promise<string[]> {
  handedDownstream.length = 0;
  byTier.snapshot = [UNRELATED_SNAPSHOT];
  byTier.growth = [CURRENT, STALE, LEGACY, UNRELATED_GROWTH];
  await composeSnapshotReport('co-1', { resolvedInput, domainScope: { domainId } });
  expect(handedDownstream).toHaveLength(1);
  return handedDownstream[0].map((d) => String(d.id));
}

describe('3AH-182 — composition keeps only the current domain\'s content-authority conclusions', () => {
  it('G/H/I. current kept; D1-stamped and unstamped legacy rows withheld', async () => {
    const ids = await compose('d-cur');
    expect(ids).toEqual(expect.arrayContaining(['CURRENT-CA']));
    expect(ids).not.toContain('STALE-CA');
    expect(ids).not.toContain('LEGACY-CA');
  });

  it('J. unrelated sources pass unchanged in both tiers', async () => {
    const ids = await compose('d-cur');
    expect(ids).toEqual(expect.arrayContaining(['UNRELATED-GROWTH', 'UNRELATED-SNAPSHOT']));
  });

  it('K. a report whose domain is not the one the producer ran on keeps none of its conclusions', async () => {
    // The producer stamped d-cur (the company website); this report is for another domain.
    const ids = await compose('d-report-other');
    expect(ids.filter((id) => id.endsWith('-CA'))).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(['UNRELATED-GROWTH', 'UNRELATED-SNAPSHOT']));
  });

  it('   the gate also covers the snapshot tier, should a content-authority row ever land there', async () => {
    handedDownstream.length = 0;
    byTier.snapshot = [UNRELATED_SNAPSHOT, { ...STALE, id: 'STALE-SNAPSHOT-CA', report_tier: 'snapshot' }];
    byTier.growth = [];
    await composeSnapshotReport('co-1', { resolvedInput, domainScope: { domainId: 'd-cur' } });
    const ids = handedDownstream[0].map((d) => String(d.id));
    expect(ids).not.toContain('STALE-SNAPSHOT-CA');
    expect(ids).toContain('UNRELATED-SNAPSHOT');
  });

  it('   an unresolved report domain keeps no content-authority conclusion at all', async () => {
    const ids = await compose(null);
    expect(ids.filter((id) => id.endsWith('-CA'))).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(['UNRELATED-GROWTH']));
  });
});

describe('3AH-182 — the predicate itself', () => {
  it('is scoped to the domain-scoped sources only', () => {
    expect([...DOMAIN_SCOPED_DECISION_SERVICES]).toEqual(['contentAuthorityService']);
    expect(isDecisionForReportDomain({ source_service: 'trafficIntelligenceService', evidence: {} }, null)).toBe(true);
    expect(isDecisionForReportDomain({ source_service: 'funnelIntelligenceService' }, 'd-cur')).toBe(true);
  });

  it('requires an exact string stamp and a resolved domain', () => {
    const ca = (evidence: unknown) => ({ source_service: 'contentAuthorityService', evidence });
    expect(isDecisionForReportDomain(ca({ domain_id: 'd-cur' }), 'd-cur')).toBe(true);
    expect(isDecisionForReportDomain(ca({ domain_id: 'd-old' }), 'd-cur')).toBe(false);
    expect(isDecisionForReportDomain(ca({}), 'd-cur')).toBe(false);
    expect(isDecisionForReportDomain(ca(null), 'd-cur')).toBe(false);
    expect(isDecisionForReportDomain(ca({ domain_id: null }), null)).toBe(false);
  });
});
