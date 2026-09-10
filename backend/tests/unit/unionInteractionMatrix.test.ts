/**
 * SIX-WORKSTREAM UNION — cross-workstream interaction matrix (I1–I8, I10).
 *
 * WHY THIS SUITE EXISTS. Every workstream in the union arrived with its own suite, and
 * each suite proves its own invariant in isolation. None of them can prove that two
 * workstreams still agree once they share a codebase. That is not hypothetical: the
 * first thing this union exposed was DG-011's fixtures and DG-001's schema disagreeing
 * about `SerpKeywordResult.features` — both suites green, certification red.
 *
 * Each describe block below names two (or three) workstreams and asserts the property
 * that only holds if BOTH invariants survived integration. Wherever possible the
 * assertion runs the real code path rather than inspecting text; the few source-level
 * checks pin a structural rule (a single seam, a single taxonomy, an ordering) that a
 * behavioural test cannot see.
 *
 * I9 (DG-001 routing) lives in unionSerpRouting.test.ts because it must replace the
 * canonical SERP client for the whole module, which would silently change what these
 * tests observe.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// One controllable table source. Report composition wants an empty, well-behaved
// store; the PDA interaction swaps in the exact rows it needs, then restores this.
const genericQuery = () => {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
  query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
  return query;
};
const mockFrom = jest.fn((_table: string) => genericQuery());
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })) }));

// The canonical outbound seam. Every provider fails unless a test says otherwise, so
// any value that reaches a payload had to come from code, not from a provider.
const safeFetch = jest.fn(async (..._args: unknown[]) => ({ ok: false }) as never);
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  readCapped: (response: unknown) => readCapped(response),
}));

import { execSync } from 'child_process';
import * as fs from 'fs';

import { resolveProbeOutcome } from '../../services/intelligence/aiVisibilityGrounding';
import {
  provenanceForSource,
  provenanceForDecisionService,
  partitionDecisionsForReport1,
} from '../../services/evidenceProvenance';
import { buildAIVisibilityState } from '../../services/intelligence/dossier/intelligenceSurfacesCompetitive';
import { renderAiDiscoverability } from '../../services/intelligence/exportRendererAssembly';

import {
  reachabilityForPage,
  hasHttpResponse,
  isHttpErrorOutcome,
} from '../../services/crawl/reachabilityOutcome';
import { assessDigitalExperience, type ExperiencePage } from '../../services/digitalExperience';
import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';

import { buildSearchFeatures } from '../../services/snapshotReport/searchFeatureHelpers';
import { featureOwnership } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import type { SerpKeywordResult } from '../../services/reportCompetitorIntelligenceServiceHelpers';

import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';

import { resolveCompetitorMetrics } from '../../services/competitor/competitorMetricsEvidence';
import type { ComparisonMetrics } from '../../services/reportCompetitorIntelligenceServiceModel';

import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { observeSocialPresence } from '../../services/socialPresenceObservation';

import handler from '../../../pages/api/trending/current';

import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

// ── Shared fixtures ─────────────────────────────────────────────────────────

const NOW_ISO = new Date('2026-03-31T00:00:00.000Z').toISOString();

/** Private Search Console values. None of these may appear in a Report 1 payload. */
const GSC = {
  impressions: 12000,
  clicks: 300,
  ctr: 0.025,
  avgPosition: 12.4,
  keyword: 'crm software',
  lastSeen: '2026-03-30T00:00:00.000Z',
};

function decision(params: {
  id: string;
  service: string;
  issueType: string;
  title: string;
  evidence: Record<string, unknown>;
  impact: number;
  payload?: Record<string, unknown>;
}): PersistedDecisionObject {
  return {
    id: params.id,
    company_id: 'c1',
    report_tier: 'snapshot',
    source_service: params.service,
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: 'description',
    evidence: params.evidence,
    impact_traffic: params.impact,
    impact_conversion: 10,
    impact_revenue: 10,
    priority_score: params.impact,
    effort_score: 20,
    execution_score: 60,
    confidence_score: 0.8,
    recommendation: 'recommendation',
    action_type: 'improve_content',
    action_payload: params.payload ?? {},
    status: 'open',
    last_changed_by: 'system',
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    resolved_at: null,
    ignored_at: null,
  } as unknown as PersistedDecisionObject;
}

/** Exactly what seoIntelligenceService emits: impact and priority derived from private impressions. */
const gscDecision = (payload: Record<string, unknown> = { keyword: GSC.keyword }) =>
  decision({
    id: 'gsc-1',
    service: 'seoIntelligenceService',
    issueType: 'keyword_opportunity',
    title: 'Keyword impressions are not turning into clicks',
    evidence: {
      keyword: GSC.keyword,
      impressions: GSC.impressions,
      clicks: GSC.clicks,
      ctr: GSC.ctr,
      avg_position: GSC.avgPosition,
      last_seen_at: GSC.lastSeen,
    },
    impact: 100,
    payload,
  });

/** A crawl/audit finding — genuinely public evidence. */
const publicDecision = () =>
  decision({
    id: 'pub-1',
    service: 'publicDomainAuditService',
    issueType: 'content_gap',
    title: 'Buying-stage content is thin',
    evidence: { avg_relevance: 0.62 },
    impact: 40,
    payload: { keyword: 'buying guide' },
  });

function resolvedInput(competitors: string[] = []): ResolvedReportInput {
  return {
    companyId: 'c1',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'c1',
      name: 'Drishik',
      category: 'AI clarity platform',
      industry: 'AI wellness and decision intelligence',
      website_url: 'https://drishik.com',
      products_services: 'AI clarity engine for self-reflection and life decisions',
      products_services_list: ['AI clarity engine', 'self-reflection guidance'],
      target_audience: 'individuals seeking personal clarity',
      ideal_customer_profile: 'adults seeking private emotional support',
      brand_positioning: 'AI-guided personal clarity',
      competitive_advantages: 'private reflection',
    },
    requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: null,
      websiteDomain: 'drishik.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      socialLinks: [],
      competitors,
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance'],
        targetCustomer: 'individuals seeking personal clarity',
        idealCustomerProfile: 'adults seeking private emotional support',
        brandPositioning: 'AI-guided personal clarity',
        competitiveAdvantages: 'private reflection',
        teamSize: '1-10', foundedYear: '2024', revenueRange: 'Pre-revenue',
      },
    },
    integrations: {},
  } as unknown as ResolvedReportInput;
}

/** Every private GSC figure, in every textual form a renderer might print it. */
const GSC_FINGERPRINTS = [
  'avg position 12.4',
  'average position 12.4',
  '12,000 impressions',
  '12000 impressions',
  '2.5% CTR',
  '2.50% CTR',
];

/** Strip comments so a structural check reads code, never the prose explaining it. */
const executable = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const productionDefiners = (pattern: string): string[] =>
  execSync(`git grep -l --untracked "${pattern}" -- "backend" "pages" || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => !f.includes('/tests/'));

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => genericQuery());
  safeFetch.mockReset();
  safeFetch.mockImplementation(async () => ({ ok: false }) as never);
  readCapped.mockReset();
  readCapped.mockImplementation(async () => Buffer.from(''));
});

// ── I1 — D1 × DG-008 ────────────────────────────────────────────────────────

describe('I1 — D1 × DG-008: the AI surface renders D1’s verdict, not its own', () => {
  it('no grounded provider → unavailable; ungrounded answer → insufficient_signal; never measured', () => {
    expect(resolveProbeOutcome({ retrievalGrounded: false, observations: [], failureReason: null }).state)
      .toBe('unavailable');
    expect(resolveProbeOutcome({
      retrievalGrounded: false,
      observations: [{ appeared: true, grounded_sources: [] }],
      failureReason: null,
    }).state).toBe('insufficient_signal');
    // Grounded retrieval flag set, but no source ever came back: still not a measurement.
    expect(resolveProbeOutcome({
      retrievalGrounded: true,
      observations: [{ appeared: true, grounded_sources: [] }],
      failureReason: null,
    }).state).toBe('insufficient_signal');
  });

  it('an LLM probe is never public observation; an answer engine is', () => {
    expect(provenanceForSource('llm_probe')).not.toBe('PUBLIC_OBSERVED');
    expect(provenanceForSource('llm_probe')).toBe('INFERRED');
    expect(provenanceForSource('answer_engine')).toBe('PUBLIC_OBSERVED');
  });

  it('DG-008 abstains exactly where D1 withholds — same score, different D1 surface', () => {
    const structural = {
      value: 62, state: 'inferred', confidence: 'medium', band: 'operational',
      evidence: { count: 1, sources: ['crawler'], freshness: 'fresh', observations: [] },
      benchmark: { value: null, label: null },
    };
    const report = {
      ai_surface_presence: {
        score: structural,
        citation_matrix: { coverage: { measured_cells: 0, total_cells: 20 }, cells: [], by_provider: [] },
      },
      knowledge_graph: { entity: null },
    } as never;

    // D1: zero observed cells means the surface is unmeasured at the source.
    const visibility = buildAIVisibilityState(report);
    expect(visibility.state).toBe('unmeasured');

    const section = {
      id: 'ai_discoverability',
      meta: { title: 'AI Discoverability', dominant_question: 'Q?' },
      surface_score: structural,
      rationale: { text: 'r' },
      citation_matrix: null,
      entity_score: { ...structural, value: null, state: 'unavailable' },
      entity_summary: null,
      positioning_paragraph: 'p',
      framing_sentence: 'f',
      constraint_narrative: null,
    } as never;
    const surfaces = {
      channel_leverage: { state: 'unavailable', top_leverage_cells: [], read: '' },
      ai_retrieval_reliability: { state: 'unavailable', entries: [], read: '' },
      ai_trajectory: { state: 'insufficient_history', delta: null, direction: null },
      competitive_ai: { state: 'unavailable', reading: '' },
      ai_visibility_state: visibility,
      ai_trust_coherence: { state: 'unavailable', kind: 'unmeasured', kind_label: 'x', reinforcement_signals: [], reading: '' },
      ai_absence_risk: { state: 'unavailable', reading: '', retrieval_examples: [] },
      ai_strategic_unlock: { concept_label: 'c', headline: 'h', body: 'b', move: 'm' },
    } as never;

    const html = renderAiDiscoverability(section, surfaces, '03');
    // DG-008 consumed D1's `unmeasured` rather than printing the structural 62.
    expect(html).not.toMatch(/AI surface \d+\/100/);
    expect(html).not.toContain('62/100');
  });

  it('there is exactly one grounding seam — DG-008 did not add a second classifier', () => {
    expect(productionDefiners('export function resolveProbeOutcome'))
      .toEqual(['backend/services/intelligence/aiVisibilityGrounding.ts']);
    const renderer = executable(fs.readFileSync('backend/services/intelligence/exportRendererAssembly.ts', 'utf8'));
    // The renderer reads D1's decision; it does not re-derive grounding itself.
    expect(renderer).toContain('ai_visibility_state');
    expect(renderer).not.toMatch(/grounded_sources|retrievalGrounded/);
  });
});

// ── I2 — D2 × D7 × PDA ──────────────────────────────────────────────────────

describe('I2 — D2 × D7 × PDA: three readers, one reachability vocabulary', () => {
  const page = (url: string, status: number | null, extra: Partial<ExperiencePage> = {}): ExperiencePage => ({
    url,
    page_type: 'landing',
    title: 'T',
    meta_description: 'D',
    headings: [{ level: 1, text: 'H' }],
    ctas: [{ text: 'Go', href: '/x' }],
    internal_link_count: 5,
    http_status: status,
    crawl_depth: 1,
    wordCount: 500,
    crawl_metadata: null,
    ...extra,
  });

  it('D2 never turns an unobserved page into a 200', () => {
    expect(reachabilityForPage({ http_status: null } as never).outcome).toBe('transport_failure');
    expect(reachabilityForPage({ http_status: 0 } as never).outcome).toBe('transport_failure');
    expect(reachabilityForPage({ http_status: 404 } as never).outcome).toBe('client_error');
    expect(reachabilityForPage({ http_status: 503 } as never).outcome).toBe('server_error');
    expect(reachabilityForPage({ http_status: 200 } as never).outcome).toBe('success');
    // Transport failure is neither a response nor an HTTP error.
    expect(hasHttpResponse('transport_failure')).toBe(false);
    expect(hasHttpResponse('timeout')).toBe(false);
    expect(isHttpErrorOutcome('transport_failure')).toBe(false);
    expect(isHttpErrorOutcome('timeout')).toBe(false);
  });

  it('D7 keeps a non-responding page out of its population — no orphan, no thin page, no broken page', () => {
    // An orphan-shaped, thin, non-responding page: every defect D7 checks is present
    // EXCEPT an HTTP response. Under the old `?? 200` it would have produced findings.
    const ghost = page('https://site.test/ghost', null, { internal_link_count: 0, wordCount: 10 });
    // POSITIVE CONTROL: the same defects on a page that DID answer are reported, by URL.
    // Without it, "the ghost is absent" would pass just as well if findings never named
    // URLs at all.
    const realOrphan = page('https://site.test/real-orphan', 200, { internal_link_count: 0 });
    const findings = assessDigitalExperience({ pages: [page('https://site.test/a', 200), realOrphan, ghost] })
      .pillars.flatMap((pillar) => pillar.findings);
    const serialized = JSON.stringify(findings);
    expect(serialized).toContain('https://site.test/real-orphan');
    expect(serialized).not.toContain('https://site.test/ghost');
  });

  it('D7’s DENOMINATOR counts only pages that answered', () => {
    // D7 defends in two layers: a population filter, and a success check inside each
    // finding predicate. Asserting only on findings leaves the first layer unguarded —
    // the ghost stays out of the findings either way (union mutation U3 survived). The
    // denominator is where an unobserved page would silently inflate the population.
    const findings = assessDigitalExperience({
      pages: [
        page('https://site.test/a', 200),
        page('https://site.test/real-orphan', 200, { internal_link_count: 0 }),
        page('https://site.test/ghost', null, { internal_link_count: 0 }),
      ],
    }).pillars.flatMap((pillar) => pillar.findings);
    const orphanFinding = findings.find((f) => /no internal links/.test(JSON.stringify(f)));
    expect(orphanFinding).toBeDefined();
    // Two pages answered. The ghost never did, so it is not one of "N pages".
    expect(orphanFinding!.evidence).toContain('1 of 2 pages');
    expect(orphanFinding!.evidence).not.toContain('of 3 pages');
  });

  it('D7 and D2 agree on which statuses are HTTP errors', () => {
    const findings = assessDigitalExperience({
      pages: [page('https://site.test/a', 200), page('https://site.test/gone', 404), page('https://site.test/dead', null)],
    }).pillars.flatMap((pillar) => pillar.findings);
    const serialized = JSON.stringify(findings);
    // POSITIVE CONTROL: a real 404 answered, so it IS a broken page and is reported.
    expect(serialized).toContain('https://site.test/gone');
    // A page that never answered is not a "broken page".
    expect(serialized).not.toContain('https://site.test/dead');
  });

  it('PDA reports a 404 as a status error and never names an unobserved URL', async () => {
    const pdaRows = [
      { id: 'home', url: 'https://example.com/', page_type: 'home', title: 'Home', meta_title: 'Home',
        meta_description: 'A platform for teams that want to move faster together.', headings: [{ level: 1, text: 'H' }],
        ctas: [{ text: 'Demo', href: 'https://example.com/contact' }], internal_link_count: 4, http_status: 200,
        crawl_depth: 0, crawl_metadata: {} },
      { id: 'gone', url: 'https://example.com/gone', page_type: 'other', title: 'Gone', meta_title: 'Gone',
        meta_description: 'x', headings: [], ctas: [], internal_link_count: 1, http_status: 404, crawl_depth: 1, crawl_metadata: {} },
      // Exactly what GA4 ingestion writes: no status, no links — never fetched.
      { id: 'ghost', url: 'https://example.com/ghost', page_type: 'landing', title: null, meta_title: null,
        meta_description: null, headings: [], ctas: [], internal_link_count: 0, http_status: null, crawl_depth: 0, crawl_metadata: {} },
    ];
    const builder = (data: unknown) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data, error: null }),
      in: jest.fn().mockResolvedValue({ data, error: null }),
    });
    mockFrom.mockImplementation((table: string) =>
      (table === 'canonical_pages' ? builder(pdaRows) : builder([])) as never);

    const result = await buildPublicDomainAuditDecisions({
      companyId: '11111111-1111-1111-1111-111111111111',
      reportTier: 'snapshot',
      resolvedInput: { companyId: 'x', resolved: { websiteDomain: 'example.com', businessType: 'B2B SaaS' }, defaults: {}, integrations: {} } as never,
    });
    const crawl = result.decisions.find((d) =>
      d.title === 'Technical crawlability and internal linking are leaving pages under-supported');
    const payload = crawl?.action_payload as { error_pages?: string[]; orphan_like_pages?: string[] } | undefined;

    // The 404 answered, so it IS an error page; D2 and PDA agree.
    expect(payload?.error_pages ?? []).toContain('https://example.com/gone');
    // The ghost never answered: not an error page, not an orphan.
    expect(payload?.error_pages ?? []).not.toContain('https://example.com/ghost');
    expect(payload?.orphan_like_pages ?? []).not.toContain('https://example.com/ghost');
  });

  it('there is exactly one reachability taxonomy and all three readers import it', () => {
    expect(productionDefiners('export type ReachabilityOutcome'))
      .toEqual(['backend/services/crawl/reachabilityOutcome.ts']);
    for (const file of [
      'backend/services/digitalExperience.ts',
      'backend/services/publicDomainAuditService.ts',
    ]) {
      const code = executable(fs.readFileSync(file, 'utf8'));
      expect(code).toContain('reachabilityOutcome');
      // No reader may default an unobserved status to success.
      expect(code).not.toMatch(/http_status\s*\?\?\s*200/);
    }
  });
});

// ── I3 — D3 × DG-001 ────────────────────────────────────────────────────────

describe('I3 — D3 × DG-001: SERP evidence stays public; GSC stays out of Report 1', () => {
  it('the boundary classifies GSC as connected and SERP-derived findings as public', () => {
    expect(provenanceForDecisionService('seoIntelligenceService')).toBe('CONNECTED_SOURCE');
    expect(provenanceForDecisionService('reportCompetitorIntelligenceService')).toBe('PUBLIC_OBSERVED');
    const { publicEvidence, connectedEvidence } = partitionDecisionsForReport1([gscDecision(), publicDecision()]);
    expect(publicEvidence.map((d) => d.id)).toEqual(['pub-1']);
    expect(connectedEvidence.map((d) => d.id)).toEqual(['gsc-1']);
  });

  it('Report 1 withholds GSC while the SERP feature block is still assembled', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: null,
      publicAudit: null,
    });
    const payload = JSON.stringify(report);

    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(1);
    for (const fingerprint of GSC_FINGERPRINTS) expect(payload).not.toContain(fingerprint);
    expect(payload).not.toContain(GSC.keyword);
  });

  it('the Report 1 search surface is typed PUBLIC_OBSERVED, never CONNECTED_SOURCE', () => {
    const types = executable(fs.readFileSync('backend/services/snapshotReportTypes.ts', 'utf8'));
    const surface = types.slice(types.indexOf('export type SnapshotSearchVisibility'));
    const block = surface.slice(0, surface.indexOf('\n};'));
    expect(block).toContain("provenance: 'PUBLIC_OBSERVED'");
    expect(block).not.toContain('CONNECTED_SOURCE');
  });
});

// ── I4 — D3 × DG-010 ────────────────────────────────────────────────────────

describe('I4 — D3 × DG-010: only a DECLARED update date is modification evidence', () => {
  const NOW = Date.parse('2026-09-06T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const page = (id: string, extra: Record<string, unknown>, signals: Record<string, unknown> = {}) => ({
    id,
    url: `https://acme.io/${id}`,
    title: `Page ${id}`,
    meta_title: `Page ${id}`,
    meta_description: 'description',
    page_type: 'page',
    headings: [{ level: 1, text: 'Heading' }],
    ctas: [{ text: 'Get started' }],
    internal_link_count: 5,
    http_status: 200,
    // Crawled seconds ago: the moment WE fetched it, not when THEY changed it.
    last_crawled_at: new Date(NOW).toISOString(),
    crawl_metadata: { signals: { published_time: null, ...signals } },
    ...extra,
  }) as never;
  const freshness = (pages: never[]) =>
    scoreContentIntelligence(pages, [], NOW).checks.find((c) => c.key === 'content_freshness')!;

  it('the crawl time, a GSC last-seen date and a sitemap lastmod are NOT update dates', () => {
    const check = freshness([
      page('a', { gsc_last_seen_at: daysAgo(1), sitemap_lastmod: daysAgo(1), last_modified_header: daysAgo(1) }),
      page('b', { gsc_last_seen_at: daysAgo(2), sitemap_lastmod: daysAgo(2), last_modified_header: daysAgo(2) }),
      page('c', { gsc_last_seen_at: daysAgo(3), sitemap_lastmod: daysAgo(3), last_modified_header: daysAgo(3) }),
    ]);
    // Three fresh-looking timestamps per page, and none of them declared by the page.
    expect(check.status).toBe('not_evaluable');
    expect(check.score).toBeNull();
  });

  it('a page’s own declared modified_time IS evidence', () => {
    const check = freshness([
      page('a', {}, { modified_time: daysAgo(10) }),
      page('b', {}, { modified_time: daysAgo(20) }),
      page('c', {}, { modified_time: daysAgo(30) }),
    ]);
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('the crawler sources modified_time from the page only — never the header or the sitemap', () => {
    const crawler = executable(fs.readFileSync('backend/services/crawlerService.ts', 'utf8'));
    const assignment = crawler.match(/modified_time:\s*([^\n]+)/)?.[1] ?? '';
    expect(assignment).toContain("article:modified_time");
    expect(assignment).not.toMatch(/last-?modified|lastmod|headers/i);
  });

  it('GSC decisions cannot reach the content surface: they are connected-source', () => {
    expect(provenanceForDecisionService('seoIntelligenceService')).toBe('CONNECTED_SOURCE');
    expect(partitionDecisionsForReport1([gscDecision()]).publicEvidence).toEqual([]);
  });
});

// ── I5 — D3 × D8 ────────────────────────────────────────────────────────────

describe('I5 — D3 × D8: a competitor never inherits the customer’s (or GSC’s) numbers', () => {
  const HIGH: ComparisonMetrics = {
    content_depth: 95, authority_score: 95, publishing_frequency: 95,
    engagement_score: 95, seo_coverage: 95, geo_presence: 95, aeo_readiness: 95,
  };

  it('an unobserved competitor stays null however strong the customer’s own evidence is', () => {
    for (const outcome of ['not_attempted', 'client_error', 'server_error', 'transport_failure', 'timeout'] as const) {
      const resolution = resolveCompetitorMetrics({ signals: null, crawlOutcome: outcome, companyMetrics: HIGH });
      expect(resolution.metrics).toBeNull();
      expect(resolution.state).toBe('unavailable');
    }
  });

  it('Report 1 with GSC evidence present: competitors unobserved, no gaps, GSC withheld', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: resolvedInput(['Wysa', 'Woebot Health']),
      publicAudit: null,
    });
    const intelligence = report.competitor_intelligence;
    const entries = intelligence?.comparison?.competitors ?? [];

    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(1);
    // Guard against a vacuous pass: the loop below must actually inspect competitors.
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.metrics).toBeNull();
      expect(entry.deltas_vs_company).toBeNull();
      expect(entry.metrics_state).toBe('unavailable');
    }
    // No gap may be manufactured when nothing about a competitor was observed.
    expect(intelligence?.generated_gaps ?? []).toEqual([]);
    for (const fingerprint of GSC_FINGERPRINTS) expect(JSON.stringify(report)).not.toContain(fingerprint);
  });
});

// ── I6 — D5 × D6 ────────────────────────────────────────────────────────────

describe('I6 — D5 × D6: every trending lane is honest when every provider fails', () => {
  const FABRICATED = ['15420', '12300', '18700', '14200', '2.3M', '1.8M', '5.2M', '+45%', '+78%'];
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const invoke = async (platforms: string) => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })), json } as never;
    await (handler as unknown as (q: unknown, r: unknown) => Promise<void>)(
      { method: 'GET', query: { platforms } } as never,
      res,
    );
    return json.mock.calls[0][0] as Record<string, unknown>;
  };

  it('runs the real route with Google Trends, Reddit and YouTube all failing', async () => {
    // Every outbound provider refuses: the seam, and the YouTube path's own fetch.
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }) as never) as never;
    const body = await invoke('linkedin,twitter,instagram,facebook,youtube');
    const serialized = JSON.stringify(body);

    // Executed, not grepped: no invented engagement survives any lane.
    for (const literal of FABRICATED) expect(serialized).not.toContain(literal);

    // The lanes live under `trending`. This used to read `body.data ?? body` and skip
    // any undefined lane — and since `data` does not exist, EVERY lane was skipped and
    // the assertion checked nothing. Each lane is now required to be present.
    const lanes = body.trending as Record<string, unknown>;
    expect(lanes).toBeDefined();
    for (const lane of ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube']) {
      expect(lanes).toHaveProperty(lane);
      // An unavailable lane is an empty list — never a placeholder row.
      expect(lanes[lane]).toEqual([]);
    }
  });

  it('the fallback function pins every lane to its contract’s empty observation', () => {
    // WHY THIS IS STRUCTURAL. In the union, getFallbackTrendingData() is unreachable by
    // any provider failure: D4 made Google fail softly, D6 made Reddit fail softly, and
    // D5 made YouTube never fetch at all. Each was right on its own. Together they left
    // nothing in the aggregate that can throw — so no behavioural test can execute the
    // fallback, and D5's own "the fallback path invents nothing" test, which forces it
    // with a throwing fetch, silently stopped reaching it once D6 landed (on D5's own
    // branch Reddit still threw, so that test was real there).
    //
    // D6 already pins its two lanes in source. D5's guard only checks that the string
    // `youTubeTrendingUnavailable()` appears somewhere, which it does several times, so
    // a fabricated `youtube:` fallback lane passed it. This pins all five lanes by name,
    // so the fallback stays honest even though nothing can run it.
    const route = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    const start = route.indexOf('const getFallbackTrendingData');
    expect(start).toBeGreaterThan(-1);
    const body = route.slice(start, route.indexOf('\n};', start));

    expect(body).toMatch(/linkedin:\s*googleTrendsUnavailable\(\)/);
    expect(body).toMatch(/twitter:\s*redditTrendingUnavailable\(\)/);
    expect(body).toMatch(/instagram:\s*youTubeTrendingUnavailable\(\)/);
    expect(body).toMatch(/facebook:\s*redditTrendingUnavailable\(\)/);
    expect(body).toMatch(/youtube:\s*youTubeTrendingUnavailable\(\)/);
    // No lane may be an inline literal row — the shape every fabricated row took.
    expect(body).not.toMatch(/\[\s*\{/);
    for (const literal of FABRICATED) expect(body).not.toContain(literal);
  });

});

// ── I7 — D8 × D3 ────────────────────────────────────────────────────────────

describe('I7 — D8 × D3: the partition runs before any competitor consumer', () => {
  it('the boundary is applied to the submitted decisions before competitor intelligence reads them', () => {
    const composer = executable(fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8'));
    const body = composer.slice(composer.indexOf('export async function composeSnapshotReportFromDecisions'));
    const partitionAt = body.indexOf('partitionDecisionsForReport1(submittedDecisions)');
    const competitorAt = body.indexOf('buildCompetitorIntelligence({');
    expect(partitionAt).toBeGreaterThan(-1);
    expect(competitorAt).toBeGreaterThan(-1);
    expect(partitionAt).toBeLessThan(competitorAt);
    // And the competitor engine is fed the partitioned set, not the raw submission.
    expect(body.slice(competitorAt, competitorAt + 200)).toContain('decisions: baseCombined');
    // `submittedDecisions` is read exactly once after it is declared: by the partition.
    expect((body.match(/submittedDecisions/g) ?? []).length).toBe(2);
  });

  it('a GSC decision cannot rank, cannot be narrated, and cannot price an action in Report 1', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: resolvedInput(['Wysa']),
      publicAudit: null,
    });
    const serialized = JSON.stringify(report);

    // The GSC decision carried impact_traffic 100 from private impressions. Had it
    // survived, it would have won rankByImpactConfidence outright.
    const titles = (report.top_priorities ?? []).map((p: { title?: string }) => p.title ?? '');
    expect(titles.join(' ')).not.toContain(GSC.keyword);
    expect(serialized).not.toContain('Keyword impressions are not turning into clicks');
    for (const fingerprint of GSC_FINGERPRINTS) expect(serialized).not.toContain(fingerprint);
    expect(report.pipeline_audit.final_decisions).toBeGreaterThanOrEqual(1);
  });
});

// ── I8 — DG-011 × Report 1 (and × DG-001) ───────────────────────────────────

describe('I8 — DG-011 × Report 1: presence is decided from organic rows, never from features', () => {
  const LINKEDIN = 'https://www.linkedin.com/company/drishik';

  const serp = (rows: Array<{ url: string; title?: string }>, features: SerpKeywordResult['features'] = []): SerpKeywordResult => ({
    status: 'ok',
    rows: rows.map((row, index) => ({
      position: index + 1,
      url: row.url,
      domain: new URL(row.url).hostname,
      title: row.title ?? null,
      snippet: null,
    })),
    reason: null,
    features,
  });

  const observe = (result: SerpKeywordResult) =>
    observeSocialPresence({
      candidateUrls: [LINKEDIN],
      companyName: 'Drishik',
      websiteDomain: 'drishik.com',
      fetchSerp: (async () => result) as never,
      now: () => new Date('2026-09-07T00:00:00.000Z'),
    });

  it('a profile seen in organic rows is observed, with provider text only', async () => {
    const [entry] = await observe(serp([{ url: LINKEDIN, title: 'Drishik | LinkedIn' }]));
    expect(entry.status).toBe('observed');
    expect(entry.source).toBe('serp');
    expect(entry.name).toBe('Drishik | LinkedIn');
  });

  it('a profile present ONLY as a DG-001 feature row is not promoted to observed', async () => {
    // A knowledge-panel link to the profile, with no organic row. DG-011 must not
    // start reading DG-001's sibling evidence as proof of presence.
    const [entry] = await observe(serp([], [
      { position: null, url: LINKEDIN, domain: 'www.linkedin.com', title: 'Drishik', snippet: null, result_type: 'knowledge_panel' } as never,
    ]));
    expect(entry.status).not.toBe('observed');
    expect(entry.observed_at).toBeNull();
  });

  it('an unreachable provider yields unreachable, and no entry carries an audience metric', async () => {
    const entries = await observeSocialPresence({
      candidateUrls: [LINKEDIN],
      companyName: 'Drishik',
      websiteDomain: 'drishik.com',
      fetchSerp: (async () => ({ status: 'failed', rows: [], reason: 'down', features: [] })) as never,
    });
    expect(entries[0].status).toBe('unreachable');
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'name', 'observed_at', 'platform', 'source', 'status', 'url']);
    }
  });

  it('one acquisition path, and Report 1 composition wires it', () => {
    expect(productionDefiners('export async function observeSocialPresence'))
      .toEqual(['backend/services/socialPresenceObservation.ts']);
    const obs = executable(fs.readFileSync('backend/services/socialPresenceObservation.ts', 'utf8'));
    expect(obs).not.toContain('features');
    const composer = executable(fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8'));
    expect(composer).toContain('social_presence: socialPresence');
  });
});

// ── I10 — DG-001 × D3 ───────────────────────────────────────────────────────

describe('I10 — DG-001 × D3: SERP features are built from SERP rows and nothing else', () => {
  it('feature observations carry only SERP-origin fields — no GSC value can be expressed', () => {
    const features = buildSearchFeatures([
      { query: 'q', result_type: 'people_also_ask', position: null, url: null, domain: null, title: 'What is Drishik?', ownedByCompany: null },
      { query: 'q', result_type: 'local', position: 2, url: 'https://drishik.com/x', domain: 'drishik.com', title: 'Drishik', ownedByCompany: true },
    ], 1, 'ok');

    expect(features.state).toBe('measured');
    for (const observation of features.observed) {
      expect(Object.keys(observation).sort())
        .toEqual(['domain', 'ownedByCompany', 'position', 'query', 'result_type', 'title', 'url']);
    }
    const serialized = JSON.stringify(features);
    for (const field of ['impressions', 'clicks', 'ctr', 'avg_position', 'search_volume', 'demand']) {
      expect(serialized).not.toContain(field);
    }
  });

  it('when SERP never ran, the block says so — GSC presence does not fill it', () => {
    const features = buildSearchFeatures([], 0, 'unavailable');
    expect(features.state).toBe('unavailable');
    expect(features.observed).toEqual([]);
    expect(features.counts).toEqual({});
  });

  it('ownership is established only from a SERP domain, never assumed', () => {
    expect(featureOwnership(null, 'drishik.com')).toBeNull();
    expect(featureOwnership('drishik.com', 'drishik.com')).toBe(true);
    expect(featureOwnership('rival.test', 'drishik.com')).toBe(false);
  });

  it('Report 1 with a GSC decision and no SERP: no features invented, no GSC figure in the payload', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision()],
      resolvedInput: null,
      publicAudit: null,
    });
    const serialized = JSON.stringify(report);
    for (const fingerprint of GSC_FINGERPRINTS) expect(serialized).not.toContain(fingerprint);
    expect(serialized).not.toContain('"avg_position":12.4');
    expect(serialized).not.toContain('"impressions":12000');
  });

  it('the feature builder has no dependency on the connected-source vocabulary', () => {
    const source = executable(fs.readFileSync('backend/services/snapshotReport/searchFeatureHelpers.ts', 'utf8'));
    expect(source).not.toMatch(/seoIntelligenceService|gsc|CONNECTED_SOURCE|impressions/i);
  });
});
