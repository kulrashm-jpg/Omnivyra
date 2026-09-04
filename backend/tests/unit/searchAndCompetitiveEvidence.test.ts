/**
 * Phase 3 — search visibility + competitive discovery evidence contract.
 *
 * These prove the rules that must hold whether or not a SERP credential is live:
 * a ranking never becomes traffic, thin evidence abstains, and SERP overlap alone can
 * never promote a company to "direct competitor".
 */
import {
  MIN_QUERY_COVERAGE,
  buildSearchVisibility,
  type SerpObservation,
} from '../../services/serpVisibilityMetrics';
import {
  brandTokensFor,
  buildSerpQueryUniverse,
  classifyQuery,
  isBoilerplateQuery,
  summarizeQueryUniverse,
} from '../../services/serpQueryUniverse';
import {
  buildCompetitiveTables,
  buildEvidenceTrail,
  classifySegment,
  type CompetitorTableRow,
} from '../../services/competitiveTables';
import { deriveCompetitorRelations } from '../../services/competitorRelationModel';
import { createManualSerpProvider } from '../../services/serpAcquisitionService';
import type { CompetitorDimensionScores } from '../../../types/competitor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWN = 'acme.test';

function observation(over: Partial<SerpObservation> = {}): SerpObservation {
  return {
    query: 'crm software', queryClass: 'commercial', intent: 'commercial',
    position: 4, resultUrl: 'https://acme.test/crm', resultTitle: 'Acme CRM',
    competitorDomains: ['rival.test'], engine: 'google', provider: 'serpapi',
    geography: 'Global', device: 'desktop', observedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

const observations = (n: number, over: Partial<SerpObservation> = {}) =>
  Array.from({ length: n }, (_, i) => observation({ query: `query ${i}`, ...over }));

const STRONG: CompetitorDimensionScores = {
  productServiceFit: 88, workflowFit: 84, useCaseFit: 80,
  icpFit: 85, customerEvaluationFit: 82, revenueScaleFit: 75,
  employeeScaleFit: 70, geographyFit: 90, seoIntentFit: 65,
};
/** High SEO overlap ONLY — the shape a pure SERP co-occurrence would produce. */
const SEO_ONLY: CompetitorDimensionScores = {
  productServiceFit: 10, workflowFit: 8, useCaseFit: 12,
  icpFit: 10, customerEvaluationFit: 8, revenueScaleFit: 10,
  employeeScaleFit: 10, geographyFit: 15, seoIntentFit: 95,
};

// ── SERP provider behaviour ───────────────────────────────────────────────────

describe('Phase 3 — SERP provider', () => {
  it('parses and returns a valid provider response', async () => {
    const provider = createManualSerpProvider([{
      query: 'crm software', geography: 'Global', device: 'desktop',
      results: [{ position: 1, url: 'https://rival.test/', title: 'Rival', domain: 'rival.test' }] as never,
    }]);
    const result = await provider.fetch('crm software');
    expect(result).not.toBeNull();
    expect(result?.results).toHaveLength(1);
  });

  it('returns null for an unknown query rather than inventing results', async () => {
    const provider = createManualSerpProvider([]);
    await expect(provider.fetch('never seen')).resolves.toBeNull();
  });

  it('a provider failure yields NO observations — never fabricated evidence', () => {
    // A failed acquisition surfaces as an empty observation set, which must abstain.
    const result = buildSearchVisibility({ observations: [], ownDomain: OWN });
    expect(result.score.value).toBeNull();
    expect(result.score.state).toBe('unavailable');
    expect(result.overall.queriesObserved).toBe(0);
    expect(result.competitors).toEqual([]);
    expect(result.abstainReason).toContain('No SERP observations');
  });
});

// ── Search visibility ─────────────────────────────────────────────────────────

describe('Phase 3 — search visibility', () => {
  it('sufficient evidence produces a measured score', () => {
    const result = buildSearchVisibility({ observations: observations(MIN_QUERY_COVERAGE), ownDomain: OWN });
    expect(result.score.state).toBe('measured');
    expect(result.score.value).not.toBeNull();
    expect(result.score.evidence_count).toBe(MIN_QUERY_COVERAGE);
    expect(result.score.evidence_sources).toContain('serp');
  });

  it('below minimum coverage it abstains', () => {
    const result = buildSearchVisibility({ observations: observations(MIN_QUERY_COVERAGE - 1), ownDomain: OWN });
    expect(result.score.value).toBeNull();
    expect(result.score.state).toBe('insufficient_signal');
    expect(result.abstainReason).toContain(`below the ${MIN_QUERY_COVERAGE}-query minimum`);
  });

  it('observed but never ranked abstains rather than scoring zero', () => {
    const result = buildSearchVisibility({
      observations: observations(MIN_QUERY_COVERAGE, { position: null }), ownDomain: OWN,
    });
    expect(result.score.value).toBeNull();
    expect(result.overall.queriesRanked).toBe(0);
    expect(result.overall.coverageRate).toBe(0);
    expect(result.abstainReason).toContain('did not rank');
  });

  it('NEVER derives traffic from rankings', () => {
    const result = buildSearchVisibility({ observations: observations(10), ownDomain: OWN });
    expect(result.trafficDerived).toBe(false);
    // Scan the payload for traffic vocabulary, excluding the `trafficDerived` assertion flag
    // itself (which exists precisely to record that no traffic was derived).
    const { trafficDerived, ...payload } = result;
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const term of ['click', 'impression', 'traffic', 'session', 'visit', 'ctr']) {
      expect(serialized).not.toContain(term);
    }
  });

  it('splits visibility by intent', () => {
    const result = buildSearchVisibility({
      observations: [
        ...observations(3, { intent: 'branded', queryClass: 'branded' }),
        ...observations(4, { intent: 'commercial', position: 8 }),
      ],
      ownDomain: OWN,
    });
    expect(result.byIntent.branded.queriesObserved).toBe(3);
    expect(result.byIntent.commercial.queriesObserved).toBe(4);
    expect(result.byIntent.informational.queriesObserved).toBe(0);
  });

  it('computes competitor visibility and gap queries over the same universe', () => {
    const result = buildSearchVisibility({
      observations: [
        observation({ query: 'a', position: null, competitorDomains: ['rival.test'] }),
        observation({ query: 'b', position: null, competitorDomains: ['rival.test'] }),
        observation({ query: 'c', position: 2, competitorDomains: ['rival.test'] }),
        observation({ query: 'd', position: 5, competitorDomains: [] }),
        observation({ query: 'e', position: 6, competitorDomains: [] }),
      ],
      ownDomain: OWN,
    });
    const rival = result.competitors.find((c) => c.domain === 'rival.test');
    expect(rival?.queriesAppeared).toBe(3);
    expect(rival?.gapQueries.sort()).toEqual(['a', 'b']);
  });
});

// ── Query universe ────────────────────────────────────────────────────────────

describe('Phase 3 — query universe', () => {
  it('drops navigation boilerplate but keeps short real category terms', () => {
    for (const term of ['privacy', 'terms', 'get', 'help', 'pricing', 'features']) {
      expect(isBoilerplateQuery(term)).toBe(true);
    }
    for (const term of ['crm', 'seo', 'ai marketing']) {
      expect(isBoilerplateQuery(term)).toBe(false);
    }
  });

  it('classifies queries by intent', () => {
    const brand = brandTokensFor({ companyName: 'Acme', domain: 'acme.test' });
    expect(classifyQuery('acme', brand)).toBe('branded');
    expect(classifyQuery('acme vs rival', brand)).toBe('comparison');
    expect(classifyQuery('best crm software', brand)).toBe('commercial');
    expect(classifyQuery('how to choose a crm', brand)).toBe('problem');
  });

  it('builds an evidence-derived universe with boilerplate removed', () => {
    const universe = buildSerpQueryUniverse({
      companyName: 'Acme', domain: 'acme.test', category: 'crm software',
      offerings: ['pipeline automation'],
      crawlKeywords: ['privacy', 'terms', 'get', 'sales pipeline tracking', 'help'],
    });
    const queries = universe.map((q) => q.query);
    expect(queries).toContain('acme');
    expect(queries).toContain('crm software');
    expect(queries).toContain('sales pipeline tracking');
    expect(queries).not.toContain('privacy');
    expect(queries).not.toContain('terms');

    const summary = summarizeQueryUniverse(universe);
    expect(summary.byIntent.branded).toBeGreaterThan(0);
    expect(summary.byIntent.commercial).toBeGreaterThan(0);
  });
});

// ── Competitor discovery + classification ─────────────────────────────────────

describe('Phase 3 — competitor discovery and classification', () => {
  it('SERP overlap ALONE cannot produce a direct competitor', () => {
    // A domain co-occurring on every query but with no product or market overlap.
    const relations = deriveCompetitorRelations({
      dimensions: SEO_ONLY, evidenceCount: 4, hasStrongSource: true,
    });
    expect(relations.compositeRelation).not.toBe('direct');
    expect(relations.productRelation).not.toBe('direct');
    expect(relations.compositeRelation).toBe('not_competitive');
  });

  it('strong product + strong market → direct', () => {
    const relations = deriveCompetitorRelations({ dimensions: STRONG, evidenceCount: 4, hasStrongSource: true });
    expect(relations.compositeRelation).toBe('direct');
  });

  it('strong product + different market → strategic, not direct', () => {
    const relations = deriveCompetitorRelations({
      dimensions: { ...STRONG, icpFit: 15, customerEvaluationFit: 12, revenueScaleFit: 20, employeeScaleFit: 15, geographyFit: 20 },
      evidenceCount: 4, hasStrongSource: true,
    });
    expect(relations.productRelation).toBe('direct');
    expect(relations.marketRelation).toBe('different');
    expect(relations.compositeRelation).toBe('strategic');
  });

  it('weak evidence → unclassified regardless of dimension strength', () => {
    const relations = deriveCompetitorRelations({ dimensions: STRONG, evidenceCount: 1, hasStrongSource: true });
    expect(relations.compositeRelation).toBe('unclassified');
  });

  it('array position has no effect on classification', () => {
    const make = () => deriveCompetitorRelations({ dimensions: STRONG, evidenceCount: 4, hasStrongSource: true });
    const asFirst = make();
    const asFifth = [make(), make(), make(), make(), make()][4];
    expect(asFifth.compositeRelation).toBe(asFirst.compositeRelation);
    expect(asFifth.product.value).toBe(asFirst.product.value);
  });
});

// ── Segment classification ────────────────────────────────────────────────────

describe('Phase 3 — company segment', () => {
  it('classifies from employee evidence', () => {
    expect(classifySegment({ employeeCount: 40 })).toBe('smb');
    expect(classifySegment({ employeeCount: 450 })).toBe('mid_market');
    expect(classifySegment({ employeeCount: 5000 })).toBe('enterprise');
    expect(classifySegment({ employeeRange: '11-50' })).toBe('smb');
    expect(classifySegment({ employeeRange: '1000+' })).toBe('enterprise');
  });

  it('returns unknown rather than guessing', () => {
    expect(classifySegment({})).toBe('unknown');
    expect(classifySegment({ revenueRange: 'growth' })).toBe('unknown');
    expect(classifySegment({ employeeRange: '' })).toBe('unknown');
  });
});

// ── The two tables ────────────────────────────────────────────────────────────

describe('Phase 3 — competition tables', () => {
  const row = (name: string, dims: CompetitorDimensionScores | null, evidenceCount: number, over: Partial<CompetitorTableRow> = {}): CompetitorTableRow => {
    const relations = deriveCompetitorRelations({ dimensions: dims, evidenceCount, hasStrongSource: true, sources: ['serp'] });
    return {
      name, domain: `${name.toLowerCase()}.test`, relations,
      evidence: buildEvidenceTrail({
        discoverySources: ['serp'], category: 'crm software', segment: 'smb',
        geography: 'Global', targetCustomer: 'B2B teams',
        searchVisibility: { domain: `${name.toLowerCase()}.test`, queriesAppeared: 8, appearanceRate: 0.4, averagePosition: 3.2, bestPosition: 1, gapQueries: ['crm pricing'] },
        totalQueriesObserved: 20,
      }),
      segment: 'smb', geography: 'Global', businessModel: 'SaaS',
      unclassified: relations.abstained, ...over,
    };
  };

  it('produces both tables independently from the same competitors', () => {
    const tables = buildCompetitiveTables([
      row('Direct', STRONG, 4),
      row('Seoonly', SEO_ONLY, 4),
    ]);
    expect(tables.productCompetition).toHaveLength(2);
    expect(tables.marketCompetition).toHaveLength(2);
    // The two views must be able to disagree.
    const directProduct = tables.productCompetition.find((r) => r.competitor === 'Direct');
    const seoProduct = tables.productCompetition.find((r) => r.competitor === 'Seoonly');
    expect(directProduct?.productOverlap).toBeGreaterThan(seoProduct?.productOverlap as number);
    expect(tables.summary.direct).toBe(1);
    expect(tables.summary.not_competitive).toBe(1);
  });

  it('an abstained competitor appears in both tables with null scores and is listed unclassified', () => {
    const tables = buildCompetitiveTables([row('Thin', STRONG, 1)]);
    expect(tables.productCompetition[0].productOverlap).toBeNull();
    expect(tables.marketCompetition[0].marketOverlap).toBeNull();
    expect(tables.productCompetition[0].classification).toBe('unknown');
    expect(tables.unclassified).toHaveLength(1);
    expect(tables.unclassified[0].reason).toContain('below the');
  });

  it('carries a traceable evidence trail answering why the competitor is relevant', () => {
    const tables = buildCompetitiveTables([row('Direct', STRONG, 4)]);
    const trail = tables.productCompetition[0].evidence.join(' | ');
    expect(trail).toContain('Same category: crm software');
    expect(trail).toContain('Appeared in live search results');
    const market = tables.marketCompetition[0].evidence.join(' | ');
    expect(market).toContain('Target customer: B2B teams');
    expect(market).toContain('Segment: smb');
  });

  it('search evidence is recorded as discovery, never as classification', () => {
    const trail = buildEvidenceTrail({
      discoverySources: ['serp'], segment: 'unknown',
      searchVisibility: { domain: 'x.test', queriesAppeared: 8, appearanceRate: 0.4, averagePosition: 3.2, bestPosition: 1, gapQueries: ['a', 'b'] },
      totalQueriesObserved: 20,
    });
    expect(trail.search.join(' ')).toContain('Appears on 8/20 observed queries');
    // Search evidence must not appear in the product or market evidence lists.
    expect(trail.product).toHaveLength(0);
    expect(trail.market).toHaveLength(0);
  });

  it('no competitors produces an honest empty result, not a fabricated one', () => {
    const tables = buildCompetitiveTables([]);
    expect(tables.empty).toBe(true);
    expect(tables.productCompetition).toEqual([]);
    expect(tables.marketCompetition).toEqual([]);
    expect(tables.emptyReason).toContain('No competitors could be discovered');
  });
});

// ── Report wiring + company-context contamination guard ───────────────────────

describe('Phase 3 — report wiring', () => {
  const { buildCompetitorTableRows } = require('../../services/competitiveTables');

  it('builds rows from engine competitors without reclassifying them', () => {
    const relations = deriveCompetitorRelations({ dimensions: STRONG, evidenceCount: 4, hasStrongSource: true });
    const rows = buildCompetitorTableRows([
      { name: 'Rival', domain: 'rival.test', category: 'crm', relations, discoverySources: ['serp'] },
    ]);
    // The row must carry the SAME relation object the engine produced — no re-derivation.
    expect(rows[0].relations).toBe(relations);
    expect(rows[0].relations.compositeRelation).toBe('direct');
  });

  it('derives relations via the canonical model when the engine did not attach them', () => {
    const rows = buildCompetitorTableRows([
      { name: 'Rival', domain: 'rival.test', dimensions: STRONG, discoverySources: ['serp', 'provider'] },
    ]);
    expect(rows[0].relations.compositeRelation).toBe('direct');
    expect(rows[0].relations.product.state).toBe('measured');
  });

  it('NEVER describes a competitor using the company\'s own fit_signals', () => {
    // `fit_signals` is built from the COMPANY's profile and echoed onto every competitor.
    // Reading it would make Report 1 assert the company's own attributes as competitor facts.
    const rows = buildCompetitorTableRows([
      {
        name: 'HubSpot', domain: 'hubspot.com', dimensions: STRONG, discoverySources: ['serp'],
        fit_signals: {
          team_size: '11-50', revenue_range: '1-10m', geography: 'Global',
          target_customer: 'B2B SaaS marketing teams', business_model: 'SaaS subscription',
        },
      },
    ]);
    expect(rows[0].segment).toBe('unknown');
    expect(rows[0].geography).toBeNull();
    expect(rows[0].businessModel).toBeNull();
    const trail = JSON.stringify(rows[0].evidence);
    expect(trail).not.toContain('11-50');
    expect(trail).not.toContain('B2B SaaS marketing teams');
    expect(trail).not.toContain('smb');
  });

  it('uses competitor-owned enrichment when it is present', () => {
    const rows = buildCompetitorTableRows([
      {
        name: 'Rival', domain: 'rival.test', dimensions: STRONG, discoverySources: ['serp'],
        enrichment: {
          description: 'Marketing automation for enterprise teams',
          business_model: 'enterprise licensing', geography: 'North America',
          icp: { use_case: 'campaign orchestration', user_intent: 'enterprise marketing ops' },
        },
      },
    ]);
    expect(rows[0].geography).toBe('North America');
    expect(rows[0].businessModel).toBe('enterprise licensing');
    const trail = rows[0].evidence.market.join(' | ');
    expect(trail).toContain('enterprise marketing ops');
    expect(trail).toContain('North America');
  });
});
