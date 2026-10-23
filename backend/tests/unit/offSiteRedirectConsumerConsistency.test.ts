/**
 * #305 follow-up — report consumers read an off-site redirect row as what it is.
 *
 * PR #305 stopped the crawler storing another site's document as the customer's page:
 * a URL that redirects to a different site keeps a `canonical_pages` row with the
 * redirect as evidence and EMPTY content columns. Every consumer then read that row as a
 * page that answered (HTTP 200) with no title, no H1, no CTAs and no links, and reported
 * exactly that to the customer — e.g. a CRITICAL "home page exposes NO H1" and "No
 * conversion path" for a domain that simply redirects elsewhere.
 *
 * These tests pin the contract: an unread redirect is evidence that the URL redirects
 * away (a distinct finding), never evidence about what a page contains. Legitimate page
 * failures (4xx) keep producing their own findings, and the scorers give the same
 * content answers with or without the unread row.
 *
 * SECRETS: none. Synthetic hosts, no network, no database.
 */

const mockFrom = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import {
  isOffSiteRedirect,
  isReadablePage,
  isUnreadRedirect,
  offSiteRedirectTarget,
} from '../../services/crawl/reachabilityOutcome';
import { assessDigitalExperience } from '../../services/digitalExperience';
import { scoreTechnicalIntelligence } from '../../services/websiteIntelligence/technicalIntelligenceEngine';
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import { scoreAccessibilityIntelligence } from '../../services/websiteIntelligence/accessibilityIntelligenceEngine';
import { scoreBrandIntelligence } from '../../services/websiteIntelligence/brandIntelligenceEngine';
import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';

const NOW = Date.parse('2026-10-22T00:00:00Z');
const CRAWLED_AT = '2026-10-21T00:00:00Z';

const offSite = (url: string, finalUrl: string, extra: Record<string, unknown> = {}): any => ({
  id: `off:${url}`,
  url,
  page_type: /^https?:\/\/[^/]+\/?$/.test(url) ? 'home' : 'landing',
  title: null,
  meta_title: null,
  meta_description: null,
  headings: [],
  ctas: [],
  internal_link_count: 0,
  http_status: 200,
  crawl_depth: 0,
  wordCount: 0,
  last_crawled_at: CRAWLED_AT,
  crawl_metadata: {
    reachability: { outcome: 'redirect', status: 200, reason: 'off_site_redirect' },
    redirect: { requestedUrl: url, finalUrl },
  },
  ...extra,
});

const GOOD_HOME: any = {
  id: 'home', url: 'https://acme.test/', page_type: 'home',
  title: 'Acme — reliable widgets', meta_title: 'Acme', meta_description: 'Acme builds reliable widgets for teams.',
  headings: [{ level: 1, text: 'Reliable widgets for growing teams' }, { level: 2, text: 'Features' }],
  ctas: [{ text: 'Book a demo', href: '/contact' }], internal_link_count: 6, http_status: 200, crawl_depth: 0,
  wordCount: 400, last_crawled_at: CRAWLED_AT,
  crawl_metadata: { reachability: { outcome: 'success', status: 200, reason: null }, meta_tags: { 'og:title': 'Acme' }, signals: { form_count: 1 } },
};
const GOOD_CONTACT: any = {
  id: 'contact', url: 'https://acme.test/contact', page_type: 'contact',
  title: 'Contact Acme', meta_title: 'Contact', meta_description: 'Talk to the Acme team about your project.',
  headings: [{ level: 1, text: 'Contact us' }], ctas: [{ text: 'Send message', href: null }], internal_link_count: 4,
  http_status: 200, crawl_depth: 1, wordCount: 220, last_crawled_at: CRAWLED_AT,
  // Legacy shape: no persisted reachability — readable via http_status 200.
  crawl_metadata: { meta_tags: {} },
};
const BROKEN: any = {
  id: 'broken', url: 'https://acme.test/old-page', page_type: 'landing', title: null, meta_title: null, meta_description: null,
  headings: [], ctas: [], internal_link_count: 0, http_status: 404, crawl_depth: 1, wordCount: 0, last_crawled_at: CRAWLED_AT,
  crawl_metadata: { reachability: { outcome: 'client_error', status: 404, reason: 'HTTP 404' } },
};
const OFF_ROOT = offSite('https://acme.test/', 'https://other.example/');
const OFF_SHOP = offSite('https://acme.test/shop', 'https://store.vendor.test/', { id: 'off-shop', crawl_depth: 1 });
const UNVERIFIABLE = offSite('https://acme.test/odd', '/relative-only', {
  id: 'odd', crawl_depth: 1,
  crawl_metadata: { reachability: { outcome: 'redirect', status: 200, reason: 'unverifiable_final_url' }, redirect: { requestedUrl: 'https://acme.test/odd', finalUrl: '/relative-only' } },
});

const problems = (r: { findings: Array<{ problem: string }> }) => r.findings.map((f) => f.problem);
const PAGE_QUALITY = /home page does not clearly state|No conversion path|missing a title or meta description|thin|orphan/i;

describe('canonical predicates — reachabilityOutcome', () => {
  it('a page is readable only when its observed outcome is success (including legacy 200 rows)', () => {
    expect(isReadablePage(GOOD_HOME)).toBe(true);
    expect(isReadablePage(GOOD_CONTACT)).toBe(true);
    expect(isReadablePage(OFF_ROOT)).toBe(false);
    expect(isReadablePage(UNVERIFIABLE)).toBe(false);
    expect(isReadablePage(BROKEN)).toBe(false);
    expect(isReadablePage({ http_status: null, crawl_metadata: null })).toBe(false);
  });

  it('identifies unread redirects by reason, not by status', () => {
    expect(isUnreadRedirect(OFF_ROOT)).toBe(true);
    expect(isUnreadRedirect(UNVERIFIABLE)).toBe(true);
    expect(isOffSiteRedirect(OFF_ROOT)).toBe(true);
    expect(isOffSiteRedirect(UNVERIFIABLE)).toBe(false);
    // NON-VACUITY — a read page, a legacy row, a 404 and a plain 3xx observation are not unread redirects.
    expect(isUnreadRedirect(GOOD_HOME)).toBe(false);
    expect(isUnreadRedirect(GOOD_CONTACT)).toBe(false);
    expect(isUnreadRedirect(BROKEN)).toBe(false);
    expect(isUnreadRedirect({ http_status: 301, crawl_metadata: { reachability: { outcome: 'redirect', status: 301, reason: 'HTTP 301' } } })).toBe(false);
    expect(offSiteRedirectTarget(OFF_ROOT)).toBe('https://other.example/');
    expect(offSiteRedirectTarget(GOOD_HOME)).toBeNull();
  });
});

describe('digitalExperience — an off-site root is a redirect finding, not an empty home page', () => {
  it('produces no page-quality findings from the off-site root row', () => {
    const r = assessDigitalExperience({ pages: [OFF_ROOT] });
    expect(problems(r).filter((p) => PAGE_QUALITY.test(p))).toEqual([]);
  });

  it('states the redirect as its own finding and limitation', () => {
    const r = assessDigitalExperience({ pages: [OFF_ROOT] });
    const finding = r.findings.find((f) => f.problem === 'The website address redirects to a different site');
    expect(finding).toBeDefined();
    expect(finding?.evidence).toContain('https://acme.test/ → https://other.example/');
    expect(r.limitations.map((l) => l.kind)).toContain('off_site_redirect');
    // It is not "nothing was crawled".
    expect(r.limitations.map((l) => l.kind)).not.toContain('no_crawl');
    expect(r.coverage.pagesEvaluated).toBe(0);
  });

  it('with real pages: the off-site page is excluded, the redirect is reported, a real 404 is still a finding', () => {
    const r = assessDigitalExperience({ pages: [GOOD_HOME, GOOD_CONTACT, BROKEN, OFF_SHOP, UNVERIFIABLE] });
    expect(r.coverage.pagesEvaluated).toBe(3);
    expect(problems(r)).toContain('Some pages redirect to a different site');
    expect(problems(r)).toContain('Pages return errors');
    expect(problems(r)).not.toContain('The home page does not clearly state what the company does');
    expect(problems(r)).not.toContain('No conversion path is discoverable from the crawled pages');
  });

  it('NON-VACUITY — the same real pages without unread redirects report no redirect finding', () => {
    const r = assessDigitalExperience({ pages: [GOOD_HOME, GOOD_CONTACT, BROKEN] });
    expect(problems(r).some((p) => /redirect to a different site|redirects to a different site/.test(p))).toBe(false);
    expect(r.limitations.map((l) => l.kind)).not.toContain('off_site_redirect');
  });
});

describe('website intelligence engines — content answers do not change because of an unread redirect', () => {
  const READ = [GOOD_HOME, GOOD_CONTACT];
  const blocks: any[] = [
    { page_id: 'home', block_type: 'paragraph', content_text: 'Acme builds reliable widgets for teams. '.repeat(30), heading_level: null },
    { page_id: 'contact', block_type: 'paragraph', content_text: 'Talk to us about your project. '.repeat(20), heading_level: null },
  ];
  const links: any[] = [{ from_page_id: 'home', anchor_text: 'Book a demo' }];
  const CONTENT_KEYS = ['meta_tags', 'duplicate_titles', 'duplicate_descriptions', 'heading_structure', 'internal_linking', 'page_depth', 'open_graph', 'twitter_cards', 'indexability'];
  const byKey = (checks: Array<{ key: string }>, keys: string[]) => checks.filter((c) => keys.includes(c.key));

  it('technical: content checks ignore the unread row; reachability still sees the redirect', () => {
    const clean = scoreTechnicalIntelligence(READ, NOW);
    const withOff = scoreTechnicalIntelligence([...READ, OFF_SHOP], NOW);
    expect(byKey(withOff.checks, CONTENT_KEYS)).toEqual(byKey(clean.checks, CONTENT_KEYS));
    expect(withOff.checks.find((c) => c.key === 'redirect_chains')?.detail).toContain('1 redirecting pages');
  });

  it('technical: a crawl that read nothing marks content checks not_evaluable instead of scoring 0', () => {
    const r = scoreTechnicalIntelligence([OFF_ROOT], NOW);
    for (const key of CONTENT_KEYS) {
      expect(r.checks.find((c) => c.key === key)?.status).toBe('not_evaluable');
    }
  });

  it('content: identical checks with or without the unread row', () => {
    expect(scoreContentIntelligence([...READ, OFF_SHOP, UNVERIFIABLE], blocks, NOW).checks)
      .toEqual(scoreContentIntelligence(READ, blocks, NOW).checks);
  });

  it('accessibility: identical checks with or without the unread row', () => {
    expect(scoreAccessibilityIntelligence([...READ, OFF_SHOP], blocks, links, NOW).checks)
      .toEqual(scoreAccessibilityIntelligence(READ, blocks, links, NOW).checks);
  });

  it('brand: identical checks with or without the unread row', () => {
    expect(scoreBrandIntelligence(null, null, [], [...READ, OFF_SHOP], NOW).checks)
      .toEqual(scoreBrandIntelligence(null, null, [], READ, NOW).checks);
  });
});

describe('publicDomainAuditService — an off-site root produces no audit decisions about page content', () => {
  const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
  function makeBuilder(data: unknown) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data, error: null }),
      in: jest.fn().mockResolvedValue({ data, error: null }),
    };
  }
  function wire(pages: unknown[]): void {
    const pagesQuery = makeBuilder(pages);
    const emptyQuery = makeBuilder([]);
    mockFrom.mockImplementation((table: string) => (table === 'canonical_pages' ? pagesQuery : emptyQuery));
  }

  it('an off-site root alone yields no decisions and no identified home page', async () => {
    wire([OFF_ROOT]);
    const result = await buildPublicDomainAuditDecisions({ companyId: COMPANY_ID });
    expect(result.decisions).toEqual([]);
    expect(result.site_structure.homepage).toBeNull();
  });

  it('NON-VACUITY — the same empty row WITHOUT the redirect reason is still audited as a page', async () => {
    const plainEmpty = { ...OFF_ROOT, crawl_metadata: { reachability: { outcome: 'success', status: 200, reason: null } } };
    wire([plainEmpty]);
    const result = await buildPublicDomainAuditDecisions({ companyId: COMPANY_ID });
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.site_structure.homepage).toBe('https://acme.test/');
  });
});
