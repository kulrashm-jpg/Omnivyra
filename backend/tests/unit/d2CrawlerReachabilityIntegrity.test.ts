/**
 * D2 — CRAWLER REACHABILITY MEASUREMENT INTEGRITY.
 *
 * WHY THIS SUITE EXISTS. Report 1 shipped a check called "Broken pages
 * (4xx/5xx)" that was structurally incapable of firing. `fetchHtml` threw on any
 * status outside 200–399, and the crawl loop's catch persisted `http_status: 0`.
 * The check counted `(http_status ?? 200) >= 400`, and zero fails that test — so
 * every customer, on every run, was told "0 pages returned 4xx/5xx" and scored
 * 100, whether their site was healthy or entirely down.
 *
 * The same `0` was simultaneously read as not-crawlable by `crawlability`, so
 * two checks on the same row disagreed about whether the page worked.
 *
 * Two separate falsehoods had to be fixed, and this suite pins both:
 *   1. a page that ANSWERED 404/500 must reach the database with its real status;
 *   2. a page we never got an answer for must never be counted as a working page
 *      — which `?? 200` did, by defaulting an unobserved page to success.
 *
 * SECRETS: all synthetic. No network, no credential, no real host.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const upserts: any[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    upsert: (row: any) => {
      upserts.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'page-1' }, error: null }) }) };
    },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }),
  }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/crawl/crawlEventService', () => ({
  emitCrawlEvent: jest.fn(),
  resolveCrawlCorrelationId: async () => 'corr-1',
}));
jest.mock('../../services/ingestionUtils', () => ({
  ...jest.requireActual('../../services/ingestionUtils'),
  ensureCanonicalDomain: async () => ({ id: 'domain-1' }),
  resolveCompanyWebsite: async () => 'https://site.test',
}));

const safeFetch = jest.fn();
// Params are DECLARED, not implicit: a `jest.fn(async () => …)` has arity 0, so
// calling it with an argument is a type error the certification typecheck catches
// even though jest (transpile-only) runs it happily.
const readCapped = jest.fn(async (_response: unknown) =>
  Buffer.from('<html><head><title>T</title></head><body><h1>H</h1><p>Body copy here.</p></body></html>'),
);
jest.mock('../../../lib/security/safeFetch', () => ({
  // Declared params, not a spread: `readCapped` has a fixed arity, and a
  // rest-forwarded call does not satisfy it under the certification typecheck
  // (which, unlike jest, actually type-checks this file).
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import { crawlCompanyWebsite } from '../../services/crawlerService';
import {
  classifyFetchError,
  classifyHttpStatus,
  hasHttpResponse,
  isHttpErrorOutcome,
  reachabilityForPage,
} from '../../services/crawl/reachabilityOutcome';
import { scoreTechnicalIntelligence } from '../../services/websiteIntelligence/technicalIntelligenceEngine';
import { buildWebsiteChecks } from '../../services/snapshotReport/websiteCheckGrouping';
import { renderWebsiteChecks } from '../../services/intelligence/exportRendererReport1';

/** A Response as safeFetch returns it — non-2xx included; safeFetch does not throw on status. */
const httpResponse = (status: number) => ({
  status,
  headers: {
    forEach: (fn: (v: string, k: string) => void) => fn('text/html', 'content-type'),
    get: () => null,
  },
});

const crawlOnce = async () => {
  upserts.length = 0;
  await crawlCompanyWebsite({ companyId: 'c1', rootUrl: 'https://site.test', maxPages: 1 });
  return upserts.find((u) => u && 'http_status' in u);
};

beforeEach(() => {
  safeFetch.mockReset();
  readCapped.mockClear();
});

// ── 1. THE CRAWLER PRESERVES WHAT IT OBSERVED ───────────────────────────────

describe('D2 — the observed HTTP status reaches the database', () => {
  it.each([
    ['200 success', 200, 200, 'success'],
    ['301 redirect', 301, 301, 'redirect'],
    ['302 redirect', 302, 302, 'redirect'],
    ['403 client error', 403, 403, 'client_error'],
    ['404 client error', 404, 404, 'client_error'],
    ['500 server error', 500, 500, 'server_error'],
  ])('%s persists the real status and outcome', async (_label, status, expectedStatus, outcome) => {
    safeFetch.mockResolvedValue(httpResponse(status));
    const row = await crawlOnce();
    expect(row.http_status).toBe(expectedStatus);
    expect(row.crawl_metadata.reachability.outcome).toBe(outcome);
    expect(row.crawl_metadata.reachability.status).toBe(expectedStatus);
  });

  it('a transport failure records NO status, and says so', async () => {
    // The decisive separation: there was no HTTP response, so there is no status
    // to report. Writing 404 here would invent a finding about the page; writing
    // 200 would invent a healthy one.
    safeFetch.mockRejectedValue(new Error('SSRF blocked (dns_resolution_failed) for site.test'));
    const row = await crawlOnce();
    expect(row.crawl_metadata.reachability.outcome).toBe('transport_failure');
    expect(row.crawl_metadata.reachability.status).toBeNull();
    expect(row.http_status).toBe(0);
  });

  it('a timeout is distinguishable from a transport failure', async () => {
    safeFetch.mockRejectedValue(new Error('UND_ERR_HEADERS_TIMEOUT'));
    const row = await crawlOnce();
    expect(row.crawl_metadata.reachability.outcome).toBe('timeout');
    expect(row.crawl_metadata.reachability.status).toBeNull();
  });

  it('a 404 body is never read as site content', async () => {
    // An error page's HTML is the error page, not the customer's content.
    safeFetch.mockResolvedValue(httpResponse(404));
    await crawlOnce();
    expect(readCapped).not.toHaveBeenCalled();
  });

  it('a successful page still parses its body — backward compatible', async () => {
    safeFetch.mockResolvedValue(httpResponse(200));
    const row = await crawlOnce();
    expect(readCapped).toHaveBeenCalled();
    expect(row.title).toBe('T');
    expect(row.crawl_metadata.signals).toBeTruthy();
  });
});

// ── 2. THE CLASSIFIER ───────────────────────────────────────────────────────

describe('D2 — reachability classification', () => {
  it.each([
    [200, 'success'], [204, 'success'], [301, 'redirect'], [302, 'redirect'],
    [400, 'client_error'], [403, 'client_error'], [404, 'client_error'],
    [500, 'server_error'], [503, 'server_error'],
  ])('status %i is %s', (status, outcome) => {
    expect(classifyHttpStatus(status as number)).toBe(outcome);
  });

  it('only 4xx/5xx count as the "returned 4xx/5xx" population', () => {
    expect(isHttpErrorOutcome('client_error')).toBe(true);
    expect(isHttpErrorOutcome('server_error')).toBe(true);
    // A site we could not reach did not "return 4xx/5xx". It returned nothing.
    expect(isHttpErrorOutcome('transport_failure')).toBe(false);
    expect(isHttpErrorOutcome('timeout')).toBe(false);
    expect(isHttpErrorOutcome('success')).toBe(false);
    expect(isHttpErrorOutcome('redirect')).toBe(false);
  });

  it('transport failure and timeout are the two no-response outcomes', () => {
    expect(hasHttpResponse('transport_failure')).toBe(false);
    expect(hasHttpResponse('timeout')).toBe(false);
    for (const o of ['success', 'redirect', 'client_error', 'server_error'] as const) {
      expect(hasHttpResponse(o)).toBe(true);
    }
  });

  it('timeout is recognised by the same identities safeFetch itself tests for', () => {
    for (const msg of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'request timeout']) {
      expect(classifyFetchError(new Error(msg)).outcome).toBe('timeout');
    }
    expect(classifyFetchError(new Error('ECONNREFUSED')).outcome).toBe('transport_failure');
  });

  it('a legacy row (status 0, no reachability) is NOT read as a broken page', () => {
    // Pre-D2 rows collapsed every failure into 0. Which kind is unrecoverable, so
    // it reads as "no response" — keeping it out of a 4xx/5xx count it was never
    // evidence for, rather than guessing.
    const legacy = reachabilityForPage({ http_status: 0, crawl_metadata: {} });
    expect(legacy.outcome).toBe('transport_failure');
    expect(isHttpErrorOutcome(legacy.outcome)).toBe(false);
  });

  it('a NULL status never defaults to success', () => {
    // `?? 200` was the second falsehood: a page we never observed counted as a
    // working page.
    const unobserved = reachabilityForPage({ http_status: null, crawl_metadata: null });
    expect(unobserved.outcome).not.toBe('success');
    expect(hasHttpResponse(unobserved.outcome)).toBe(false);
  });
});

// ── 3. THE CHECK ────────────────────────────────────────────────────────────

const page = (url: string, status: number | null, outcome?: string) => ({
  id: url, url, title: 'T', meta_description: 'D', headings: [], internal_link_count: 1,
  http_status: status, crawl_depth: 0, last_crawled_at: new Date().toISOString(),
  crawl_metadata: outcome
    ? { reachability: { outcome, status: outcome === 'transport_failure' || outcome === 'timeout' ? null : status, reason: null } }
    : {},
}) as never;

const checkFor = (pages: unknown[], key: string) =>
  scoreTechnicalIntelligence(pages as never, Date.now()).checks.find((c) => c.key === key)!;

describe('D2 — the reachability checks report what was observed', () => {
  it('genuine 404/500 pages are counted as broken', () => {
    const broken = checkFor(
      [page('https://site.test/a', 200, 'success'), page('https://site.test/b', 404, 'client_error'), page('https://site.test/c', 500, 'server_error')],
      'broken_links',
    );
    expect(broken.detail).toContain('2 pages returned 4xx/5xx');
    expect(broken.score).toBeLessThan(100);
    expect(broken.examples?.map((e) => e.url)).toEqual(['https://site.test/b', 'https://site.test/c']);
  });

  it('an all-healthy site still reports zero broken — and it is now MEANT', () => {
    const broken = checkFor([page('https://site.test/a', 200, 'success'), page('https://site.test/b', 200, 'success')], 'broken_links');
    expect(broken.detail).toContain('0 pages returned 4xx/5xx');
    expect(broken.score).toBe(100);
    expect(broken.status).toBe('pass');
  });

  it('a transport failure is NOT counted as zero broken pages', () => {
    // The acceptance criterion. Two pages answered fine, one was unreachable —
    // the report may not present that as a clean, complete measurement.
    const broken = checkFor(
      [page('https://site.test/a', 200, 'success'), page('https://site.test/b', 0, 'transport_failure')],
      'broken_links',
    );
    expect(broken.detail).toContain('1 unreachable');
    expect(broken.detail).toContain('of 1 that responded');
  });

  it('a timeout is NOT counted as zero broken pages', () => {
    const broken = checkFor(
      [page('https://site.test/a', 200, 'success'), page('https://site.test/b', 0, 'timeout')],
      'broken_links',
    );
    expect(broken.detail).toContain('1 unreachable');
  });

  it('when NOTHING responded, all three checks abstain instead of scoring 100', () => {
    const pages = [page('https://site.test/a', 0, 'transport_failure'), page('https://site.test/b', 0, 'timeout')];
    for (const key of ['broken_links', 'redirect_chains', 'crawlability']) {
      const check = checkFor(pages, key);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
      expect(check.detail).toMatch(/could not be established/i);
      expect(check.detail).not.toMatch(/^0 pages returned/);
    }
  });

  it('an unreachable page never acquires example URLs it did not earn', () => {
    const broken = checkFor([page('https://site.test/a', 0, 'transport_failure'), page('https://site.test/b', 200, 'success')], 'broken_links');
    expect(broken.examples).toBeUndefined();
  });

  it('redirects are counted separately from broken pages', () => {
    const pages = [page('https://site.test/a', 301, 'redirect'), page('https://site.test/b', 404, 'client_error')];
    expect(checkFor(pages, 'redirect_chains').detail).toContain('1 redirecting pages');
    expect(checkFor(pages, 'broken_links').detail).toContain('1 pages returned 4xx/5xx');
  });

  it('legacy rows with no reachability object do not fabricate broken pages', () => {
    // Backward compatibility: a corpus crawled before D2 must not suddenly grow
    // a pile of "broken" pages out of its 0 sentinels.
    const broken = checkFor([page('https://site.test/a', 200), page('https://site.test/b', 0)], 'broken_links');
    expect(broken.detail).toContain('0 pages returned 4xx/5xx');
    expect(broken.detail).toContain('1 unreachable');
  });
});

// ── 4. REPORT-FIRST: THE CUSTOMER-FACING RESULT ─────────────────────────────

describe('D2 — the difference reaches the rendered Report 1', () => {
  const renderFor = (pages: unknown[]) => {
    const technical = scoreTechnicalIntelligence(pages as never, Date.now());
    const website_checks = buildWebsiteChecks({ technical, pagesEvaluated: pages.length });
    return {
      website_checks,
      html: renderWebsiteChecks({ report1: { website_checks } } as never, 'EVIDENCE'),
    };
  };

  it('a healthy site renders the zero-broken claim', () => {
    const { html } = renderFor([page('https://site.test/a', 200, 'success')]);
    expect(html).toContain('0 pages returned 4xx/5xx');
  });

  it('a site with real 404s renders the real count, not zero', () => {
    const { html } = renderFor([
      page('https://site.test/a', 200, 'success'),
      page('https://site.test/b', 404, 'client_error'),
    ]);
    expect(html).toContain('1 pages returned 4xx/5xx');
    expect(html).not.toContain('0 pages returned 4xx/5xx');
    // The affected URL is shown, from the same population the count came from.
    expect(html).toContain('site.test/b');
  });

  it('an unreachable site renders NO zero-broken claim at all', () => {
    // The whole point of D2: silence beats a confident falsehood.
    const { html, website_checks } = renderFor([page('https://site.test/a', 0, 'transport_failure')]);
    expect(html).not.toContain('0 pages returned 4xx/5xx');
    expect(html).toMatch(/could not be established/i);
    const reach = website_checks!.groups.flatMap((g) => g.checks).find((c) => c.key === 'broken_links')!;
    expect(reach.status).toBe('not_evaluable');
  });

  it('the check still lands in the existing reachability group — no new section', () => {
    const { website_checks } = renderFor([page('https://site.test/a', 404, 'client_error')]);
    const group = website_checks!.groups.find((g) => g.checks.some((c) => c.key === 'broken_links'))!;
    expect(group.id).toBe('reachability');
  });
});

// ── 5. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D2 — no second HTTP acquisition path, and no hardcoded clean result', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const productionFiles = (pattern: string): string[] =>
    execSync(`git grep -l --untracked "${pattern}" -- "backend/services" || true`, { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f: string) => !f.includes('/tests/'));

  it('only the two known crawl paths issue a page fetch as the bot', () => {
    // A third crawler would reintroduce the defect somewhere this suite cannot
    // see. `--untracked` matters: a brand-new module is exactly the shape that
    // takes, and a plain `git grep` would not look at it until it was committed.
    //
    // Two are sanctioned, for stated reasons:
    //   crawlerService                        the OWN-SITE crawl D2 fixes
    //   reportCompetitorIntelligenceServiceEngine  the competitor-domain crawl,
    //     a pre-existing separate path that does not feed the reachability checks
    //     and is deliberately untouched here (its own budget, depth and purpose).
    const crawlers = productionFiles('OmnivyraBot/1.0');
    expect(crawlers.sort()).toEqual([
      'backend/services/crawlerService.ts',
      'backend/services/reportCompetitorIntelligenceServiceEngine.ts',
    ]);
  });

  it('no production module discards a non-2xx status by throwing on it', () => {
    // The exact line D2 removed: `throw new Error(\`Request failed with status\`)`.
    // Its return would silently restore the 0-sentinel collapse.
    const offenders = productionFiles('Request failed with status');
    expect(offenders).toEqual([]);
  });

  it('the reachability checks do not default an unobserved status to success', () => {
    const source: string = fs.readFileSync('backend/services/websiteIntelligence/technicalIntelligenceEngine.ts', 'utf8');
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // `http_status ?? 200` is the fabrication: it turns "never observed" into
    // "returned 200". The engine must reach status only through the classifier.
    expect(executable).not.toMatch(/http_status\s*\?\?\s*200/);
  });
});
