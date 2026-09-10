/**
 * D8 — competitor intelligence evidence integrity.
 *
 * The defect these tests lock out: competitor comparison metrics could be produced with
 * no observation of the competitor at all, and were then published as a real comparison
 * that drove gap narratives, confidence scores and persisted recommendations naming real
 * companies.
 *
 * Two independent mechanisms did it:
 *   - unconditional constants (+6 content, +8 authority, +9 SEO, +7 AEO) added to every
 *     crawled competitor's metrics, sized to clear the very thresholds at which the
 *     report starts telling the customer it is losing;
 *   - `liftMetrics()`, which synthesised a whole metric set from the CUSTOMER's own
 *     numbers plus a classification/index-keyed lift whenever the competitor's site was
 *     not crawled — including when it 404'd, 500'd, timed out, or failed DNS, all of
 *     which collapsed into the same anonymous `null`.
 *
 * These assert semantic values and evidence state, never mere existence.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../db/supabaseClient', () => {
  const buildQuery = () => {
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.order = jest.fn(() => query);
    query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
    query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
    return query;
  };
  return { supabase: { from: jest.fn(() => buildQuery()) } };
});

jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })) }));

const safeFetchMock = jest.fn();
const readCappedMock = jest.fn(async (_response: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...(args as [])),
  readCapped: (...args: unknown[]) => readCappedMock(...(args as [never])),
}));

import type { ResolvedReportInput } from '../../services/reportInputResolver';
import { buildCompetitorIntelligence, competitorGapsToDecisions } from '../../services/reportCompetitorIntelligenceService';
import { crawlDomainSignals, buildGapDefinitions } from '../../services/reportCompetitorIntelligenceServiceEngine';
import { averageCompetitorMetrics } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { competitorEntriesEligibleForRadar } from '../../services/snapshotReport/competitorSummaryHelpers';
import {
  resolveCompetitorMetrics,
  isUnobservedCrawl,
  CRAWL_OBSERVED_DIMENSIONS,
  CRAWL_UNOBSERVED_DIMENSIONS,
  type CompetitorCrawlOutcome,
} from '../../services/competitor/competitorMetricsEvidence';
import type { ComparisonMetrics } from '../../services/reportCompetitorIntelligenceServiceModel';
import type { DomainCrawlSignals } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { buildCompetitorStanding } from '../../../pages/api/reports/reportViewUtils';

const COMPANY: ComparisonMetrics = {
  content_depth: 50,
  authority_score: 50,
  publishing_frequency: 50,
  engagement_score: 50,
  seo_coverage: 50,
  geo_presence: 50,
  aeo_readiness: 50,
};

/** Signals whose observed dimensions are exactly equal to the company's. */
function signalsEqualToCompany(): DomainCrawlSignals {
  return {
    contentScore: 50,
    keywordCoverageScore: 50,
    authorityProxy: 50,
    technicalScore: 50,
    aiAnswerPresenceScore: 50,
    extractedKeywords: [],
    answerTopics: [],
  };
}

function makeResolvedInput(overrides?: Partial<ResolvedReportInput['resolved']>): ResolvedReportInput {
  return {
    companyId: 'company-1',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'company-1',
      name: 'Drishik',
      category: 'AI clarity platform',
      industry: 'AI wellness and decision intelligence',
      website_url: 'https://drishik.com',
      products_services: 'AI clarity engine for self-reflection, emotional wellbeing, and life decisions',
      products_services_list: ['AI clarity engine', 'self-reflection guidance'],
      target_audience: 'individuals seeking personal clarity',
      ideal_customer_profile: 'adults seeking private emotional support',
      brand_positioning: 'AI-guided personal clarity',
      competitive_advantages: 'private reflection, decision clarity',
    },
    requestPayload: {},
    defaults: {
      company_name: null, website_domain: null, business_type: null,
      geography: null, social_links: [], competitors: [],
    },
    resolved: {
      companyName: null,
      websiteDomain: 'drishik.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      socialLinks: [],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance'],
        targetCustomer: 'individuals seeking personal clarity',
        idealCustomerProfile: 'adults seeking private emotional support',
        brandPositioning: 'AI-guided personal clarity',
        competitiveAdvantages: 'private reflection, decision clarity',
        teamSize: '1-10', foundedYear: '2024', revenueRange: 'Pre-revenue',
      },
      ...overrides,
    },
    integrations: {
      google_analytics: { connected: false, source: 'system', label: 'Google Analytics' },
      google_search_console: { connected: false, source: 'system', label: 'Google Search Console' },
      google_ads: { connected: false, source: 'system', label: 'Google Ads' },
      linkedin_ads: { connected: false, source: 'system', label: 'LinkedIn Ads' },
      meta_ads: { connected: false, source: 'system', label: 'Meta Ads' },
      shopify: { connected: false, source: 'system', label: 'Shopify' },
      woocommerce: { connected: false, source: 'system', label: 'WooCommerce' },
      social_accounts: { connected: false, source: 'system', label: 'Social Accounts' },
      wordpress: { connected: false, source: 'system', label: 'WordPress' },
      custom_blog_api: { connected: false, source: 'system', label: 'Custom Blog API' },
      lead_webhook: { connected: false, source: 'system', label: 'Lead Webhook' },
      website_crawl: { connected: true, source: 'system', label: 'Website Crawl' },
      data_upload: { connected: false, source: 'system', label: 'Uploaded Data File' },
      manual_entry: { connected: false, source: 'system', label: 'Manual Data Entry' },
    },
  };
}

beforeEach(() => {
  safeFetchMock.mockReset();
  readCappedMock.mockReset();
  readCappedMock.mockImplementation(async () => Buffer.from(''));
});

describe('D8 — the metrics seam refuses to invent a competitor', () => {
  it('case 1 + 12: no competitor evidence yields NULL metrics, not zeroes', () => {
    const resolution = resolveCompetitorMetrics({
      signals: null,
      crawlOutcome: 'not_attempted',
      companyMetrics: COMPANY,
    });

    expect(resolution.metrics).toBeNull();
    expect(resolution.state).toBe('unavailable');
    // A zero is a measurement claim ("this competitor has no capability"); null is the
    // absence of one. The distinction is the whole point.
    expect(resolution.metrics).not.toEqual({
      content_depth: 0, authority_score: 0, publishing_frequency: 0,
      engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0,
    });
    expect(resolution.basis).toMatch(/no comparison metrics were derived/i);
  });

  it('case 2 + 4: an observed crawl yields metrics derived from the competitor’s OWN signals', () => {
    const resolution = resolveCompetitorMetrics({
      signals: {
        ...signalsEqualToCompany(),
        contentScore: 71,
        authorityProxy: 33,
        keywordCoverageScore: 64,
        aiAnswerPresenceScore: 29,
      },
      crawlOutcome: 'success',
      companyMetrics: COMPANY,
    });

    expect(resolution.state).toBe('inferred');
    expect(resolution.crawl_outcome).toBe('success');
    // Exactly the competitor's own signal values — no blend with the company, no constant.
    expect(resolution.metrics?.content_depth).toBe(71);
    expect(resolution.metrics?.authority_score).toBe(33);
    expect(resolution.metrics?.seo_coverage).toBe(64);
    expect(resolution.metrics?.aeo_readiness).toBe(29);
  });

  it('case 10: a page-text authority proxy is NEVER reported as measured authority', () => {
    const resolution = resolveCompetitorMetrics({
      // authorityProxy is a count of credibility words in page copy — not a backlink or
      // domain-authority measurement of any kind.
      signals: { ...signalsEqualToCompany(), authorityProxy: 95 },
      crawlOutcome: 'success',
      companyMetrics: COMPANY,
    });

    expect(resolution.state).not.toBe('measured');
    expect(resolution.state).toBe('inferred');
  });

  it('case 11: equal observed signals produce a ZERO delta — no unconditional lift survives', () => {
    const resolution = resolveCompetitorMetrics({
      signals: signalsEqualToCompany(),
      crawlOutcome: 'success',
      companyMetrics: COMPANY,
    });
    const metrics = resolution.metrics!;

    // The defect added +6 / +8 / +9 / +7 here. A competitor observed to be exactly level
    // with the customer must come out exactly level, on every dimension.
    for (const dimension of Object.keys(COMPANY) as Array<keyof ComparisonMetrics>) {
      expect(metrics[dimension] - COMPANY[dimension]).toBe(0);
    }
  });

  it('case 11b: dimensions a crawl cannot observe contribute a zero delta in BOTH directions', () => {
    // The customer's unobservable dimensions are deliberately far from any midpoint: a
    // fixed constant (e.g. 50) would show this competitor "ahead" on engagement purely
    // because the customer's own number sits below the constant.
    const lopsided: ComparisonMetrics = { ...COMPANY, publishing_frequency: 12, engagement_score: 9, geo_presence: 88 };
    const resolution = resolveCompetitorMetrics({
      signals: signalsEqualToCompany(),
      crawlOutcome: 'success',
      companyMetrics: lopsided,
    });

    for (const dimension of CRAWL_UNOBSERVED_DIMENSIONS) {
      expect(resolution.metrics![dimension] - lopsided[dimension]).toBe(0);
    }
    // And the observed dimensions still reflect the competitor, not the customer.
    expect(CRAWL_OBSERVED_DIMENSIONS).toEqual(
      expect.arrayContaining(['content_depth', 'authority_score', 'seo_coverage', 'aeo_readiness']),
    );
  });

  it.each([
    ['client_error' as const],
    ['server_error' as const],
    ['transport_failure' as const],
    ['timeout' as const],
    ['not_attempted' as const],
  ])('cases 5-8: a %s crawl yields null metrics and preserves its own outcome', (outcome) => {
    const resolution = resolveCompetitorMetrics({
      // Even if signals were somehow present, an unobserved outcome must not be scored.
      signals: signalsEqualToCompany(),
      crawlOutcome: outcome,
      companyMetrics: COMPANY,
    });

    expect(resolution.metrics).toBeNull();
    expect(resolution.state).toBe('unavailable');
    // The reason survives — a 404 does not become "we never looked".
    expect(resolution.crawl_outcome).toBe(outcome);
    expect(isUnobservedCrawl(outcome)).toBe(true);
  });

  it('a redirect that still returned pages counts as observed', () => {
    expect(isUnobservedCrawl('redirect')).toBe(false);
    expect(isUnobservedCrawl('success')).toBe(false);
  });
});

describe('D8 — the crawl preserves why it failed', () => {
  async function crawlWith(response: unknown, isError = false): Promise<{ signals: unknown; outcome: CompetitorCrawlOutcome }> {
    if (isError) safeFetchMock.mockRejectedValue(response);
    else safeFetchMock.mockResolvedValue(response);
    return crawlDomainSignals('peer.com', ['clarity']);
  }

  it('case 5: a 404 is reported as client_error, not as an anonymous absence', async () => {
    const result = await crawlWith({ status: 404 });
    expect(result.signals).toBeNull();
    expect(result.outcome).toBe('client_error');
  });

  it('case 6: a 503 is reported as server_error', async () => {
    const result = await crawlWith({ status: 503 });
    expect(result.signals).toBeNull();
    expect(result.outcome).toBe('server_error');
  });

  it('case 7: a DNS/connection failure is reported as transport_failure', async () => {
    const result = await crawlWith(new Error('getaddrinfo ENOTFOUND peer.com'), true);
    expect(result.signals).toBeNull();
    expect(result.outcome).toBe('transport_failure');
  });

  it('case 8: an abandoned request is reported as timeout, distinctly from transport failure', async () => {
    const result = await crawlWith(new Error('UND_ERR_HEADERS_TIMEOUT'), true);
    expect(result.signals).toBeNull();
    expect(result.outcome).toBe('timeout');
  });

  it('a failed crawl NEVER returns signals a caller could score', async () => {
    for (const failure of [{ status: 404 }, { status: 500 }]) {
      const result = await crawlWith(failure);
      expect(result.signals).toBeNull();
    }
  });
});

describe('D8 — nothing unsupported reaches the customer', () => {
  const COMPETITORS = ['Wysa', 'Woebot Health', 'Reflectly'];

  function syncIntelligence() {
    return buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeResolvedInput({ competitors: COMPETITORS }),
    });
  }

  it('case 9: a path that observed no competitor reports is_fallback_used = true', () => {
    const intelligence = syncIntelligence();

    // This path performs no crawl at all. It previously reported `false`, and downstream
    // consumers use exactly this flag to decide whether to downgrade confidence.
    expect(intelligence.discovery_metadata?.is_fallback_used).toBe(true);
    expect(intelligence.discovery_metadata?.competitors_with_observed_metrics).toBe(0);
  });

  it('case 3 + 13: unobserved competitors carry null metrics and null deltas', () => {
    const intelligence = syncIntelligence();
    const entries = intelligence.comparison?.competitors ?? [];

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.metrics).toBeNull();
      expect(entry.deltas_vs_company).toBeNull();
      expect(entry.metrics_state).toBe('unavailable');
      expect(entry.crawl_outcome).toBe('not_attempted');
    }
  });

  it('case 14: no gap narrative is generated from competitors that were never observed', () => {
    const intelligence = syncIntelligence();

    // The reproduction produced "Competitors cover more buying-stage content than
    // drishik.com" at confidence 0.87, naming wysa.com and woebothealth.com, on zero
    // observation of either company.
    expect(intelligence.generated_gaps).toEqual([]);
  });

  it('case 15: no recommendation is persisted from unobserved competitor evidence', () => {
    const intelligence = syncIntelligence();
    const decisions = competitorGapsToDecisions({
      companyId: 'company-1',
      gaps: intelligence.generated_gaps,
    });

    expect(decisions).toEqual([]);
  });

  it('no real company is ever named as a leading competitor without observation', () => {
    const intelligence = syncIntelligence();
    const named = intelligence.generated_gaps.flatMap((gap) => gap.leading_competitors);
    expect(named).toEqual([]);
  });

  it('case 13b: the comparison table states "Not Observed" rather than asserting parity', () => {
    // An absent delta previously rendered as 'At Par' — a positive comparative verdict
    // reported on no evidence.
    expect(buildCompetitorStanding(undefined)).toBe('Not Observed');
    expect(buildCompetitorStanding(null as never)).toBe('Not Observed');
    // A real observed delta still produces a real verdict.
    expect(buildCompetitorStanding({
      content_depth: 20, authority_score: 20, publishing_frequency: 20,
      engagement_score: 20, seo_coverage: 20, geo_presence: 20, aeo_readiness: 20,
    } as never)).toBe('Behind');
  });
});

describe('D8 — partial evidence never borrows credibility from the observed competitor', () => {
  function entry(name: string, metrics: ComparisonMetrics | null) {
    return {
      competitor: { name, domain: `${name.toLowerCase()}.com` },
      metrics,
      deltas_vs_company: metrics ? { ...metrics } : null,
      metrics_state: metrics ? 'inferred' : 'unavailable',
      metrics_basis: '',
      crawl_outcome: metrics ? 'success' : 'client_error',
    } as never;
  }

  it('case 3: a gap narrative names ONLY competitors that were actually observed', () => {
    const observed: ComparisonMetrics = { ...COMPANY, content_depth: 90, authority_score: 90, seo_coverage: 90, aeo_readiness: 90 };

    const gaps = buildGapDefinitions({
      domain: 'drishik.com',
      businessContext: 'AI wellness',
      // One competitor was observed and is genuinely ahead; the other was never observed.
      entries: [entry('Observed', observed), entry('Unobserved', null)],
      companyMetrics: COMPANY,
    });

    expect(gaps.length).toBeGreaterThan(0);
    const named = [...new Set(gaps.flatMap((gap) => gap.leading_competitors))];
    // The unobserved competitor must not be carried into the narrative on the observed
    // one's evidence — being listed as a "leading competitor" is a public claim about it.
    expect(named).toEqual(['observed.com']);
    expect(named).not.toContain('unobserved.com');
  });

  it('the observed competitor alone sets the gap size — unobserved entries do not dilute or inflate it', () => {
    const observed: ComparisonMetrics = { ...COMPANY, content_depth: 90 };
    const withUnobserved = buildGapDefinitions({
      domain: 'drishik.com', businessContext: 'AI wellness',
      entries: [entry('Observed', observed), entry('Unobserved', null)],
      companyMetrics: COMPANY,
    });
    const observedOnly = buildGapDefinitions({
      domain: 'drishik.com', businessContext: 'AI wellness',
      entries: [entry('Observed', observed)],
      companyMetrics: COMPANY,
    });

    expect(withUnobserved.map((gap) => [gap.gap_type, gap.impact_score]))
      .toEqual(observedOnly.map((gap) => [gap.gap_type, gap.impact_score]));
  });

  it('case 16: averaging an all-unobserved set yields null, never zeroes', () => {
    expect(averageCompetitorMetrics([])).toBeNull();
    expect(averageCompetitorMetrics([entry('A', null), entry('B', null)])).toBeNull();

    // A zeroed average would read as "competitors score 0 across the board", which is a
    // measurement claim, and would then be compared against the customer's real numbers.
    const zeroed = { content_depth: 0, authority_score: 0, publishing_frequency: 0, engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0 };
    expect(averageCompetitorMetrics([entry('A', null)])).not.toEqual(zeroed);
  });

  it('case 17: the comparison radar plots only observed competitors', () => {
    const observed: ComparisonMetrics = { ...COMPANY, content_depth: 77 };
    const eligible = competitorEntriesEligibleForRadar([
      entry('Observed', observed),
      entry('Unobserved', null),
    ]);

    expect(eligible).toHaveLength(1);
    expect((eligible[0] as { competitor: { name: string } }).competitor.name).toBe('Observed');
  });
});

describe('D8 — the fabrication helper is gone, not merely unused', () => {
  it('liftMetrics is no longer exported from the helpers module', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const helpers = require('../../services/reportCompetitorIntelligenceServiceHelpers');
    expect(helpers.liftMetrics).toBeUndefined();
  });

  it('no production module references liftMetrics in executable code', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const files = [
      'reportCompetitorIntelligenceServiceEngine.ts',
      'reportCompetitorIntelligenceServiceHelpers.ts',
      'reportCompetitorIntelligenceServiceModel.ts',
    ];
    for (const file of files) {
      const source: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'services', file),
        'utf8',
      );
      // Strip comments first: this guard must not be satisfied — or defeated — by the
      // explanatory comments that record why the helper was removed.
      const executable = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(executable).not.toMatch(/\bliftMetrics\b/);
    }
  });
});
