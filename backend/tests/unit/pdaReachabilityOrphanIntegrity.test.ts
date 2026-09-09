/**
 * PDA — public-domain audit reachability / orphan integrity.
 *
 * ─── WHAT THIS SUITE PROTECTS ──────────────────────────────────────────────
 * `publicDomainAuditService` loads EVERY `canonical_pages` row for a company
 * and then derives crawl findings from them. It is not the crawler's table
 * alone: `ga4IngestionService.upsertPage` upserts rows straight from analytics
 * paths with only `company_id`, `domain_id`, `url` and a mechanically-assigned
 * `page_type` — no `http_status`, no crawl, no content. Those rows carry
 * `http_status = NULL` and the column default `internal_link_count = 0`.
 *
 * Two claims used to be made about them anyway:
 *
 *   1. ORPHAN — a GA4-only path is labelled `page_type: 'landing'` purely
 *      because its path is not "/". `orphanLikePages` read that label as
 *      "important page", found no incoming link (there cannot be one: the page
 *      was never crawled), and named the URL as an orphan. The audit asserted a
 *      property of a page it had never read.
 *   2. STATUS ERROR — `pagesWithStatusErrors` folded the `0` sentinel (D2: "no
 *      HTTP response existed") into the same population as real 4xx/5xx and
 *      reported the total as `status_error_count` / `error_pages`. A request
 *      that never got an answer has no status to report.
 *
 * Classification is delegated to D2's canonical contract
 * (`backend/services/crawl/reachabilityOutcome.ts`) — one crawl observation,
 * one interpretation, several readers. This suite does not define a second one.
 */
const mockFrom = jest.fn();

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

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

function wire(pages: unknown[], content: unknown[] = [], links: unknown[] = []): void {
  const pagesQuery = makeBuilder(pages);
  const contentQuery = makeBuilder(content);
  const linksQuery = makeBuilder(links);
  mockFrom.mockImplementation((table: string) => {
    if (table === 'canonical_pages') return pagesQuery;
    if (table === 'page_content') return contentQuery;
    if (table === 'page_links') return linksQuery;
    throw new Error(`Unexpected table ${table}`);
  });
}

const RESOLVED_INPUT = {
  companyId: COMPANY_ID,
  reportCategory: 'snapshot',
  profile: null,
  requestPayload: {},
  defaults: {
    company_name: null,
    website_domain: 'example.com',
    business_type: 'B2B SaaS',
    geography: null,
    social_links: [],
    competitors: [],
  },
  resolved: {
    companyName: null,
    websiteDomain: 'example.com',
    businessType: 'B2B SaaS',
    geography: null,
    socialLinks: [],
    competitors: [],
    source: 'manual-entry',
    uploadedFileName: null,
    manualData: null,
  },
  integrations: {},
} as unknown as ResolvedReportInput;

async function run() {
  return buildPublicDomainAuditDecisions({
    companyId: COMPANY_ID,
    reportTier: 'snapshot',
    resolvedInput: RESOLVED_INPUT,
  });
}

/** A page the crawler actually read and that answered. */
function crawledPage(over: Record<string, unknown>) {
  return {
    id: 'page-home',
    url: 'https://example.com/',
    page_type: 'home',
    title: 'Example Platform',
    meta_title: 'Example Platform',
    meta_description: 'A platform for teams that want to move faster together.',
    headings: [{ level: 1, text: 'Work better' }],
    ctas: [{ text: 'Book a demo', href: 'https://example.com/contact' }],
    internal_link_count: 4,
    http_status: 200,
    crawl_depth: 0,
    crawl_metadata: {},
    ...over,
  };
}

/**
 * EXACTLY what `ga4IngestionService.upsertPage` produces: url + a page_type
 * assigned from the path shape alone, plus the column defaults. Nothing here
 * was observed — the crawler never asked for this URL.
 */
function ga4OnlyPage(id: string, url: string) {
  return {
    id,
    url,
    page_type: 'landing', // ga4IngestionService.ts:360 — 'home' for "/", else 'landing'
    title: null,
    meta_title: null,
    meta_description: null,
    headings: [], // migration default '[]'::jsonb
    ctas: [], // migration default '[]'::jsonb
    internal_link_count: 0, // migration default: NOT NULL DEFAULT 0
    http_status: null, // never written by GA4 ingestion
    crawl_depth: 0,
    crawl_metadata: {},
  };
}

function crawlFinding(result: Awaited<ReturnType<typeof run>>) {
  return result.decisions.find(
    (d) => d.title === 'Technical crawlability and internal linking are leaving pages under-supported',
  );
}

describe('public domain audit — orphan claims require an observed page', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('never names a GA4-only, never-crawled URL as an orphan', async () => {
    wire([
      crawledPage({}),
      ga4OnlyPage('page-ga4-a', 'https://example.com/campaign-a'),
      ga4OnlyPage('page-ga4-b', 'https://example.com/campaign-b'),
      ga4OnlyPage('page-ga4-c', 'https://example.com/campaign-c'),
    ]);

    const finding = crawlFinding(await run());
    const named = (finding?.action_payload as { orphan_like_pages?: string[] } | undefined)?.orphan_like_pages ?? [];

    expect(named).not.toContain('https://example.com/campaign-a');
    expect(named).not.toContain('https://example.com/campaign-b');
    expect(named).not.toContain('https://example.com/campaign-c');
    expect((finding?.evidence as { orphan_like_page_count?: number } | undefined)?.orphan_like_page_count ?? 0).toBe(0);
  });

  it('does not fire the crawlability finding on GA4-only rows alone', async () => {
    // One healthy, well-linked crawled page + never-crawled analytics paths.
    // There is no observed crawl problem here at all.
    wire([crawledPage({}), ga4OnlyPage('a', 'https://example.com/a'), ga4OnlyPage('b', 'https://example.com/b')]);
    expect(crawlFinding(await run())).toBeUndefined();
  });

  it('still names a genuinely orphaned page that WAS crawled and answered', async () => {
    wire([
      crawledPage({}),
      crawledPage({
        id: 'page-pricing',
        url: 'https://example.com/pricing',
        page_type: 'pricing',
        internal_link_count: 0,
        http_status: 200,
        crawl_depth: 1,
      }),
      crawledPage({
        id: 'page-feature',
        url: 'https://example.com/features',
        page_type: 'feature',
        internal_link_count: 0,
        http_status: 200,
        crawl_depth: 1,
      }),
    ]);

    const finding = crawlFinding(await run());
    const named = (finding?.action_payload as { orphan_like_pages?: string[] } | undefined)?.orphan_like_pages ?? [];
    expect(named).toContain('https://example.com/pricing');
    expect(named).toContain('https://example.com/features');
  });

  it('does not treat a transport-failure row as an orphan either', async () => {
    // http_status 0 = D2's "no HTTP response". We asked and got nothing, so we
    // know no more about its inbound links than for a page we never asked for.
    // One page that DID answer and is genuinely unlinked keeps the finding
    // present, so the exclusions below are asserted against a real decision.
    wire([
      crawledPage({}),
      crawledPage({ id: 'real', url: 'https://example.com/real-orphan', page_type: 'pricing', internal_link_count: 0, http_status: 200 }),
      crawledPage({ id: 'real2', url: 'https://example.com/real-orphan-2', page_type: 'product', internal_link_count: 0, http_status: 200 }),
      crawledPage({ id: 'p1', url: 'https://example.com/p1', page_type: 'pricing', internal_link_count: 0, http_status: 0 }),
      crawledPage({ id: 'p2', url: 'https://example.com/p2', page_type: 'product', internal_link_count: 0, http_status: 0 }),
    ]);

    const finding = crawlFinding(await run());
    expect(finding).toBeDefined();
    const named = (finding?.action_payload as { orphan_like_pages?: string[] } | undefined)?.orphan_like_pages ?? [];
    expect(named).toEqual(['https://example.com/real-orphan', 'https://example.com/real-orphan-2']);
    expect((finding?.evidence as { orphan_like_page_count?: number } | undefined)?.orphan_like_page_count).toBe(2);
  });
});

describe('public domain audit — "returned an error" means the page answered', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('counts a 404 as a status error', async () => {
    wire([
      crawledPage({}),
      crawledPage({ id: 'p404', url: 'https://example.com/gone', page_type: 'other', http_status: 404 }),
    ]);
    const finding = crawlFinding(await run());
    expect((finding?.evidence as { status_error_count?: number } | undefined)?.status_error_count).toBe(1);
    expect((finding?.action_payload as { error_pages?: string[] } | undefined)?.error_pages).toContain('https://example.com/gone');
  });

  it('counts a 503 as a status error', async () => {
    wire([
      crawledPage({}),
      crawledPage({ id: 'p503', url: 'https://example.com/down', page_type: 'other', http_status: 503 }),
    ]);
    expect((crawlFinding(await run())?.evidence as { status_error_count?: number } | undefined)?.status_error_count).toBe(1);
  });

  it('does NOT count the transport-failure sentinel as a status error', async () => {
    // A real 404 is present so the finding definitely fires — otherwise the
    // assertions below would pass vacuously against an absent decision.
    wire([
      crawledPage({}),
      crawledPage({ id: 'pdead', url: 'https://example.com/unreachable', page_type: 'other', http_status: 0 }),
      crawledPage({ id: 'pdead2', url: 'https://example.com/unreachable-2', page_type: 'other', http_status: 0 }),
      crawledPage({ id: 'p404', url: 'https://example.com/gone', page_type: 'other', http_status: 404 }),
    ]);
    const finding = crawlFinding(await run());
    expect(finding).toBeDefined();
    const errorPages = (finding?.action_payload as { error_pages?: string[] } | undefined)?.error_pages ?? [];
    expect(errorPages).toEqual(['https://example.com/gone']);
    expect((finding?.evidence as { status_error_count?: number } | undefined)?.status_error_count).toBe(1);
  });

  it('does NOT count a never-observed page as a status error', async () => {
    wire([crawledPage({}), ga4OnlyPage('g', 'https://example.com/never-crawled')]);
    const finding = crawlFinding(await run());
    const errorPages = (finding?.action_payload as { error_pages?: string[] } | undefined)?.error_pages ?? [];
    expect(errorPages).not.toContain('https://example.com/never-crawled');
    expect((finding?.evidence as { status_error_count?: number } | undefined)?.status_error_count ?? 0).toBe(0);
  });

  it('reports unreachable pages separately, so they are not silently dropped', async () => {
    wire([
      crawledPage({}),
      crawledPage({ id: 'pdead', url: 'https://example.com/unreachable', page_type: 'other', http_status: 0 }),
      crawledPage({ id: 'p404', url: 'https://example.com/gone', page_type: 'other', http_status: 404 }),
    ]);
    const finding = crawlFinding(await run());
    expect(finding).toBeDefined();
    const evidence = finding?.evidence as {
      unreachable_page_count?: number;
      status_error_count?: number;
      orphan_like_page_count?: number;
      pages_observed?: number;
    } | undefined;
    expect(evidence?.status_error_count).toBe(1);
    expect(evidence?.unreachable_page_count).toBe(1);
    // The unreachable row must not leak into any other population's count.
    expect(evidence?.orphan_like_page_count).toBe(0);
    expect(evidence?.pages_observed).toBe(2);
    const payload = finding?.action_payload as { unreachable_pages?: string[]; error_pages?: string[] } | undefined;
    expect(payload?.unreachable_pages).toEqual(['https://example.com/unreachable']);
    expect(payload?.error_pages).toEqual(['https://example.com/gone']);
  });
});

describe('public domain audit — link density is measured over observed pages', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('does not dilute internal_link_avg with never-crawled rows', async () => {
    // Four crawled pages averaging 4 internal links, plus six analytics-only
    // rows whose 0 is a column default, not an observation. The honest average
    // is 4; diluting by the unobserved rows yields 1.6 and manufactures a
    // "weak internal linking" finding out of nothing.
    wire([
      crawledPage({ id: 'c1', url: 'https://example.com/', internal_link_count: 4 }),
      crawledPage({ id: 'c2', url: 'https://example.com/x', page_type: 'other', internal_link_count: 4 }),
      crawledPage({ id: 'c3', url: 'https://example.com/y', page_type: 'other', internal_link_count: 4 }),
      crawledPage({ id: 'c4', url: 'https://example.com/z', page_type: 'other', internal_link_count: 4 }),
      ...['1', '2', '3', '4', '5', '6'].map((n) => ga4OnlyPage(`g${n}`, `https://example.com/ga4-${n}`)),
    ]);

    const result = await run();
    const withAvg = result.decisions.filter(
      (d) => (d.evidence as { internal_link_avg?: number } | null)?.internal_link_avg !== undefined,
    );
    expect(withAvg.length).toBeGreaterThan(0);
    for (const decision of withAvg) {
      expect((decision.evidence as { internal_link_avg?: number }).internal_link_avg).toBe(4);
    }
  });

  it('states insufficient_signal rather than reporting a link average of zero', async () => {
    wire([ga4OnlyPage('g1', 'https://example.com/a'), ga4OnlyPage('g2', 'https://example.com/b')]);
    const result = await run();

    const carriers = result.decisions.filter(
      (d) => 'internal_link_avg' in ((d.evidence ?? {}) as Record<string, unknown>),
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const decision of carriers) {
      const evidence = decision.evidence as { internal_link_avg?: number | null; internal_link_avg_state?: string };
      // 0.0 would read as "we measured the links and there are none".
      expect(evidence.internal_link_avg).toBeNull();
      expect(evidence.internal_link_avg_state).toBe('insufficient_signal');
      // The payload the caller acts on must not disagree with the evidence.
      const payload = decision.action_payload as { internal_link_avg?: number | null; internal_link_avg_state?: string };
      if ('internal_link_avg' in payload) {
        expect(payload.internal_link_avg).toBeNull();
        expect(payload.internal_link_avg_state).toBe('insufficient_signal');
      }
    }

    // No page was ever read, so no crawl finding may be asserted.
    expect(crawlFinding(result)).toBeUndefined();
  });

  it('labels the link average as measured when pages did answer', async () => {
    wire([crawledPage({ internal_link_count: 4 })]);
    const result = await run();
    const carriers = result.decisions.filter(
      (d) => 'internal_link_avg_state' in ((d.evidence ?? {}) as Record<string, unknown>),
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const decision of carriers) {
      expect((decision.evidence as { internal_link_avg_state?: string }).internal_link_avg_state).toBe('measured');
      const payload = decision.action_payload as { internal_link_avg_state?: string };
      if ('internal_link_avg_state' in payload) expect(payload.internal_link_avg_state).toBe('measured');
    }
  });
});
