/**
 * Technical readiness — `buildTechnicalFindings` contract, gates, and SCORE ISOLATION.
 *
 * The isolation suite pins the program rule "scoring is unchanged": the additive crawl fields
 * this change writes must not move any engine score/check, and findings never enter an
 * engine's checks[].
 */
import { buildTechnicalFindings, type TechnicalFinding, type TechnicalFindingPageRow } from '../../services/technicalReadiness/technicalFindings';
import { robotsObservationFromProbe, llmsObservationFromProbe, type SiteFileProbe } from '../../services/technicalReadiness/siteFilesProbe';
import { validateJsonLdBlocks } from '../../services/technicalReadiness/jsonLdValidation';
import { scoreTechnicalIntelligence } from '../../services/websiteIntelligence/technicalIntelligenceEngine';
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import { scoreAccessibilityIntelligence } from '../../services/websiteIntelligence/accessibilityIntelligenceEngine';
import { buildWebsiteChecks } from '../../services/snapshotReport/websiteCheckGrouping';

const T = '2026-10-29T10:00:00.000Z';
const probe = (url: string, over: Partial<SiteFileProbe>): SiteFileProbe => ({
  url, fetched_at: T, outcome: 'ok', status: 200, content_type: 'text/plain', bytes: 1, body: '', reason: null, ...over,
});

/** A legacy root page exactly as rows crawled before this change look (no new fields). */
const legacySignals = () => ({
  canonical: true, jsonld_count: 1, jsonld_types: ['Organization'], hreflang_count: 0, has_pagination: false, feed_links: 0,
  lang: 'en', img_count: 2, img_with_alt: 1, form_count: 0, table_count: 0, button_count: 1, submit_control_count: 0,
  published_time: null, modified_time: null, author: null, same_as: ['https://www.linkedin.com/company/site-test'],
  declared_credentials: [], legal_name: null, address_country: null,
  response: { content_encoding: 'gzip', cache_control: 'max-age=60', security: { hsts: true, csp: false, x_frame_options: true, x_content_type_options: true }, security_header_count: 3 },
});

const legacyRows = (): any[] => [
  {
    id: 'p1', url: 'https://site.test/', title: 'Site Test', meta_title: 'Site Test', meta_description: 'Desc', page_type: 'homepage',
    headings: [{ level: 1, text: 'Site Test' }], ctas: [{ text: 'Get started', href: '/signup' }], internal_link_count: 4,
    http_status: 200, crawl_depth: 0, last_crawled_at: T,
    crawl_metadata: { meta_tags: { 'og:site_name': 'Site Test', robots: 'index,follow' }, signals: { ...legacySignals(), site: { robots_txt: true, sitemap_xml: true, sitemap_url_count: 3 } }, reachability: { outcome: 'success', status: 200, reason: null } },
  },
  {
    id: 'p2', url: 'https://site.test/blog/post', title: 'Post', meta_title: 'Post', meta_description: 'Post desc', page_type: 'blog',
    headings: [{ level: 1, text: 'Post' }], ctas: [], internal_link_count: 2, http_status: 200, crawl_depth: 1, last_crawled_at: T,
    crawl_metadata: { meta_tags: { 'og:site_name': 'Site Test Inc.' }, signals: legacySignals(), reachability: { outcome: 'success', status: 200, reason: null } },
  },
];

/** The same rows with every additive field this change writes. */
const enrichedRows = (robotsBody = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /blog\n'): any[] => {
  const rows = legacyRows();
  const org = JSON.stringify({ '@type': 'Organization', name: 'Site Test', url: 'https://site.test' });
  rows[0].crawl_metadata.signals = {
    ...rows[0].crawl_metadata.signals,
    jsonld_validation: validateJsonLdBlocks([org]), canonical_href: 'https://site.test/', x_robots_tag: null,
    site: {
      ...rows[0].crawl_metadata.signals.site,
      robots: robotsObservationFromProbe(probe('https://site.test/robots.txt', { body: robotsBody })),
      llms: llmsObservationFromProbe(probe('https://site.test/llms.txt', { outcome: 'client_error', status: 404, body: null })),
      llms_full: llmsObservationFromProbe(probe('https://site.test/llms-full.txt', { outcome: 'client_error', status: 404, body: null })),
    },
  };
  rows[1].crawl_metadata.signals = {
    ...rows[1].crawl_metadata.signals,
    jsonld_validation: validateJsonLdBlocks(['{ broken']), canonical_href: 'https://other-site.test/post', x_robots_tag: 'googlebot: noindex',
  };
  return rows;
};

const byId = (findings: TechnicalFinding[], id: string) => findings.find((f) => f.check_id === id)!;

describe('buildTechnicalFindings — contract', () => {
  it('every finding carries the full contract with a mandatory limitation', () => {
    const { findings } = buildTechnicalFindings({ pages: enrichedRows() });
    expect(findings.length).toBeGreaterThan(20);
    for (const f of findings) {
      expect(f.check_id).toBeTruthy();
      expect(f.check_version).toBeTruthy();
      expect(f.subject_url).toBe('https://site.test/');
      expect(['pass', 'issue', 'info', 'indeterminate', 'not_applicable', 'unavailable']).toContain(f.state);
      expect(f.limitation.length).toBeGreaterThan(40);
      expect(['high', 'medium', 'low']).toContain(f.confidence);
      expect('retrieved_at' in f && 'source_url' in f && 'evidence_excerpt' in f && 'feeds_dimension' in f).toBe(true);
      if (f.evidence_excerpt) expect(f.evidence_excerpt.length).toBeLessThanOrEqual(240);
    }
  });

  it('per-agent access: a disallowed training crawler is info, a partially blocked search crawler is an issue', () => {
    const { findings } = buildTechnicalFindings({ pages: enrichedRows() });
    const gpt = byId(findings, 'ai_crawler_access.GPTBot');
    expect(gpt).toMatchObject({ state: 'info', detail_state: 'disallowed', evidence_excerpt: 'line 2: Disallow: /', source_url: 'https://site.test/robots.txt', retrieved_at: T });
    const bing = byId(findings, 'ai_crawler_access.Bingbot');
    expect(bing).toMatchObject({ state: 'issue', detail_state: 'partially_disallowed', feeds_dimension: 'index_integrity' });
    expect(bing.detail).toContain('/blog/post');
    expect(byId(findings, 'ai_crawler_access.Google-Extended').detail).toMatch(/control token, not a crawler/);
  });

  it('legacy rows (crawled before this change): every new check is unavailable, never pass and never zero', () => {
    const { findings } = buildTechnicalFindings({ pages: legacyRows() });
    for (const id of ['ai_crawler_access.GPTBot', 'ai_crawler_access.Googlebot', 'llms_txt', 'llms_full_txt', 'jsonld_syntax', 'jsonld_required_properties', 'canonical_target', 'x_robots_tag_noindex']) {
      expect(byId(findings, id).state).toBe('unavailable');
      expect(byId(findings, id).reason).toBeTruthy();
    }
    expect(findings.find((f) => f.check_id === 'robots_fetch_outcome')).toBeUndefined();
  });

  it('robots 503 ⇒ every agent indeterminate with the RFC note; unreachable ⇒ unavailable', () => {
    const rows = enrichedRows();
    rows[0].crawl_metadata.signals.site.robots = robotsObservationFromProbe(probe('https://site.test/robots.txt', { outcome: 'server_error', status: 503, body: null }));
    let { findings } = buildTechnicalFindings({ pages: rows });
    const agents = findings.filter((f) => f.check_id.startsWith('ai_crawler_access.'));
    expect(agents).toHaveLength(16);
    for (const f of agents) {
      expect(f.state).toBe('indeterminate');
      expect(f.reason).toMatch(/treats the whole site as disallowed/);
    }
    rows[0].crawl_metadata.signals.site.robots = robotsObservationFromProbe(probe('https://site.test/robots.txt', { outcome: 'unreachable', status: null, body: null, reason: 'ECONNREFUSED' }));
    ({ findings } = buildTechnicalFindings({ pages: rows }));
    expect(findings.filter((f) => f.check_id.startsWith('ai_crawler_access.')).every((f) => f.state === 'unavailable')).toBe(true);
  });

  it('missing llms.txt is info (optional), never an issue', () => {
    const f = byId(buildTechnicalFindings({ pages: enrichedRows() }).findings, 'llms_txt');
    expect(f).toMatchObject({ state: 'info', detail_state: 'absent', source_http_status: 404 });
    expect(f.limitation).toMatch(/not evidence that any AI system/);
  });

  it('JSON-LD: invalid syntax on one page is an issue with the page as an example; nothing claims eligibility', () => {
    const { findings } = buildTechnicalFindings({ pages: enrichedRows() });
    const syntax = byId(findings, 'jsonld_syntax');
    expect(syntax).toMatchObject({ state: 'issue', detail_state: 'invalid_syntax', examples: [{ url: 'https://site.test/blog/post' }] });
    expect(byId(findings, 'jsonld_required_properties').state).toBe('pass');
    for (const f of findings) expect(f.detail).not.toMatch(/\beligible\b/i);
  });

  it('canonical off-site and X-Robots-Tag noindex are detected from page signals', () => {
    const { findings } = buildTechnicalFindings({ pages: enrichedRows() });
    expect(byId(findings, 'canonical_target')).toMatchObject({ state: 'issue', detail_state: 'off_site' });
    expect(byId(findings, 'x_robots_tag_noindex')).toMatchObject({ state: 'issue', examples: [{ url: 'https://site.test/blog/post' }] });
  });

  it('entity name consistency ignores legal suffixes; sameAs cross-check and NAP are unavailable with a reason', () => {
    const { findings } = buildTechnicalFindings({ pages: enrichedRows() });
    expect(byId(findings, 'entity_name_consistency')).toMatchObject({ state: 'pass', detail_state: 'consistent' });
    expect(byId(findings, 'entity_sameas_crosscheck')).toMatchObject({ state: 'unavailable' });
    expect(byId(findings, 'entity_sameas_crosscheck').reason).toMatch(/Wikidata/);
    expect(byId(findings, 'entity_sameas_crosscheck').detail).toContain('linkedin.com');
    const nap = byId(findings, 'local_nap_consistency');
    expect(nap).toMatchObject({ state: 'unavailable', feeds_dimension: 'trust_coherence' });
    expect(nap.reason).toMatch(/local-business/);
  });

  it('local-business checks are never applied to a SaaS site (and stay unavailable even when a LocalBusiness is declared)', () => {
    const saas = buildTechnicalFindings({ pages: enrichedRows() }).findings;
    expect(saas.filter((f) => f.check_id.startsWith('local_')).every((f) => f.state === 'unavailable')).toBe(true);
    const rows = enrichedRows();
    rows[0].crawl_metadata.signals.jsonld_validation = validateJsonLdBlocks([JSON.stringify({ '@type': 'Dentist', name: 'D', address: 'x' })]);
    const local = byId(buildTechnicalFindings({ pages: rows }).findings, 'local_nap_consistency');
    expect(local).toMatchObject({ state: 'unavailable', detail_state: 'local_business_declared' });
  });

  it('distinct organisation names are reported as variants (info), with pages', () => {
    const rows = enrichedRows();
    rows[1].crawl_metadata.meta_tags['og:site_name'] = 'Totally Different Brand';
    const f = byId(buildTechnicalFindings({ pages: rows }).findings, 'entity_name_consistency');
    expect(f).toMatchObject({ state: 'info', detail_state: 'variants_observed' });
  });

  it('no pages ⇒ deterministic result, never throws; counts add up', () => {
    const r = buildTechnicalFindings({ pages: [], targetUrl: 'https://site.test' });
    expect(r.findings.every((f) => f.state === 'unavailable')).toBe(true);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(r.findings.length);
    expect(() => buildTechnicalFindings({ pages: [{ url: 'not a url', http_status: 200, last_crawled_at: null, crawl_metadata: { signals: { site: {} } } } as TechnicalFindingPageRow] })).not.toThrow();
  });

  it('does not mutate its input', () => {
    const rows = enrichedRows();
    const before = JSON.stringify(rows);
    buildTechnicalFindings({ pages: rows });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('SCORE ISOLATION — the additive crawl fields move no engine score or check', () => {
  const now = Date.parse('2026-10-30T00:00:00.000Z');

  it('T-SCORE-1 technical engine: identical score, confidence and checks with and without the new fields', () => {
    const legacy = scoreTechnicalIntelligence(legacyRows(), now);
    const enriched = scoreTechnicalIntelligence(enrichedRows(), now);
    expect(enriched.checks).toEqual(legacy.checks);
    expect(JSON.stringify(enriched)).toBe(JSON.stringify(legacy));
  });

  it('T-SCORE-1b content and accessibility engines are identical too', () => {
    expect(JSON.stringify(scoreContentIntelligence(enrichedRows(), [], now))).toBe(JSON.stringify(scoreContentIntelligence(legacyRows(), [], now)));
    expect(JSON.stringify(scoreAccessibilityIntelligence(enrichedRows(), [], [], now))).toBe(JSON.stringify(scoreAccessibilityIntelligence(legacyRows(), [], [], now)));
  });

  it('T-SCORE-2 findings never enter an engine checks[] or the persisted website checks', () => {
    const tech = scoreTechnicalIntelligence(enrichedRows(), now);
    const findingIds = new Set(buildTechnicalFindings({ pages: enrichedRows() }).findings.map((f) => f.check_id));
    expect(tech.checks.some((c) => findingIds.has(c.key))).toBe(false);
    const checks = buildWebsiteChecks({ technical: tech, pagesEvaluated: 2 });
    const legacyChecks = buildWebsiteChecks({ technical: scoreTechnicalIntelligence(legacyRows(), now), pagesEvaluated: 2 });
    expect(checks).toEqual(legacyChecks);
  });
});
