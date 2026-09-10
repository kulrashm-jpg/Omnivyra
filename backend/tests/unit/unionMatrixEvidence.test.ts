/**
 * SIX-WORKSTREAM UNION — interaction matrix: evidence classification and reachability.
 *
 * Each describe block names the workstreams whose invariants must BOTH survive
 * integration, and asserts the property that only holds if they do. Every workstream's
 * own suite proves its invariant in isolation; none can prove two workstreams still
 * agree once they share a codebase.
 *
 * Covers I1 (D1 × DG-008), I2 (D2 × D7 × PDA) and I4 (D3 × DG-010). The full matrix is I1–I10 across unionMatrixEvidence,
 * unionMatrixReport1, unionMatrixSources and unionSerpRouting; the 17-mutation battery
 * in scripts/union-matrix-mutations.js proves these tests actually constrain what they
 * claim.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// One controllable table source; tests that need specific rows swap them in.
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
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import { gscDecision, executable, productionDefiners } from '../helpers/unionMatrixFixtures';

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => genericQuery());
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

