/**
 * R1-C — CRAWL EXTRACTION INTEGRITY (producer side).
 *
 * WHY THIS SUITE EXISTS. Four measurements the Report 1 crawler persists were wrong
 * in the same direction — they described markup the page does not contain, or failed
 * to see markup the page does contain, and in both cases the report then asserted a
 * fact about the customer's website that was really a fact about the parser.
 *
 *   1. H1 DETECTION. Headings were pushed only `if (text)`, so `<h1><img alt="Acme
 *      Analytics"></h1>` produced no heading entry at all and every reader reported
 *      the page as having no H1. A true "no H1" and a detection miss were the same row.
 *   2. COPY / WORD COUNT. `<${tag}[^>]*>` matches any tag whose name merely BEGINS
 *      with the name asked for, so `li` matched `<link>` in `<head>` and ran to the
 *      first real `</li>`, swallowing the navigation; `p` matched `<path>`/`<picture>`.
 *      Nested blocks were counted twice and CTA text a third time.
 *   3. CTA DETECTION. Only `<a>` anchors counted, so `<button>` and a form's submit
 *      control — both present in the stored markup — were invisible and conversion
 *      coverage was reported lower than the served HTML shows.
 *   4. REDIRECTS. Links were resolved against the PRE-redirect URL, and `normalizeHost`
 *      does not fold `www.`, so an `example.com → www.example.com` site had every one
 *      of its own links classified external: zero internal links, an empty frontier
 *      after one page, and a home page reported as a dead end.
 *
 * NEGATIVE CONTROLS. Each assertion is paired with the PRE-FIX algorithm re-run on the
 * same fixture, asserted to produce the wrong answer. That is what makes the fixture
 * discriminating rather than merely satisfied.
 *
 * NON-VACUITY CONTROLS. A page that genuinely has no H1 must still report none; a page
 * whose only CTA is an ordinary anchor must still be detected; a non-CTA button must
 * not become a CTA. The fixes must not be blanket suppression.
 *
 * SECRETS: all synthetic. No network, no credential, no real host.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

type Captured = { table: string; rows: unknown };

const upserts: Array<Record<string, unknown>> = [];
const inserts: Captured[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    upsert: (row: Record<string, unknown>) => {
      if (table === 'canonical_pages') upserts.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'page-1' }, error: null }) }) };
    },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    insert: async (rows: unknown) => { inserts.push({ table, rows }); return { error: null }; },
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

interface FakeResponse {
  status: number;
  url?: string;
  __body: string;
  headers: { forEach: (fn: (v: string, k: string) => void) => void; get: (k: string) => string | null };
}

const safeFetch = jest.fn();
const readCapped = jest.fn(async (response: unknown) => Buffer.from((response as FakeResponse).__body ?? ''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import { crawlCompanyWebsite } from '../../services/crawlerService';

const respond = (body: string, extra: { url?: string } = {}): FakeResponse => ({
  status: 200,
  __body: body,
  ...(extra.url ? { url: extra.url } : {}),
  headers: {
    forEach: (fn) => fn('text/html', 'content-type'),
    get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null),
  },
});

/** Crawl exactly ONE page (`maxPages: 1`) and return the row + blocks it persisted. */
const crawlOne = async (html: string, opts: { finalUrl?: string; rootUrl?: string } = {}) => {
  upserts.length = 0;
  inserts.length = 0;
  safeFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) return respond('');
    return respond(html, opts.finalUrl ? { url: opts.finalUrl } : {});
  });
  await crawlCompanyWebsite({
    companyId: 'co-1',
    rootUrl: opts.rootUrl ?? 'https://site.test',
    maxPages: 1,
    timeoutMs: 2000,
  });
  const page = upserts[0] ?? {};
  const blocks = (inserts.find((i) => i.table === 'page_content')?.rows ?? []) as Array<{
    block_type: string; content_text: string; heading_level: number | null; metadata?: Record<string, unknown>;
  }>;
  return { page, blocks };
};

const wordsIn = (texts: readonly string[]): number =>
  texts.reduce((sum, t) => sum + String(t).split(/\s+/).filter(Boolean).length, 0);

// ── The pre-fix algorithm, kept verbatim as the negative control ──────────────
const decodeEntities = (s: string) => s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
const stripTagsLegacy = (v: string) => decodeEntities(v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const cleanHtmlLegacy = (v: string) => v
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<!--([\s\S]*?)-->/g, '')
  .replace(/\s+/g, ' ');
/** The exact `extractTagContents` this suite replaced. */
function extractTagContentsLegacy(html: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = stripTagsLegacy(match[1]);
    if (text) values.push(text);
  }
  return values;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** An H1 that is a logo image WITH alt text — a real headline the old parser lost. */
const IMAGE_H1 = '<html><head><title>Acme</title></head><body>'
  + '<h1><img src="/logo.svg" alt="Acme Analytics"></h1>'
  + '<p>We measure what marketing teams actually ship.</p></body></html>';

/** An H1 that is a logo image with NO alt and no aria-label — present, but says nothing. */
const TEXTLESS_H1 = '<html><head><title>Acme</title></head><body>'
  + '<h1><img src="/logo.svg"></h1>'
  + '<p>We measure what marketing teams actually ship.</p></body></html>';

/** NON-VACUITY: genuinely no H1 element anywhere. Must still report none. */
const NO_H1 = '<html><head><title>Acme</title></head><body>'
  + '<h2>Secondary heading</h2>'
  + '<p>We measure what marketing teams actually ship.</p></body></html>';

/**
 * The word-count fixture. Honest content is four blocks / 14 words:
 *   h1 "Acme Analytics" (2) · li "Alpha beta gamma" (3) · li "Delta epsilon zeta" (3)
 *   · p "Ready to begin? Book a demo" (6)
 * `<link>` in head, inline `<svg><path>`, a `<picture>`, `<p>` nested inside each
 * `<li>`, and a CTA anchor inside the final paragraph are all present on purpose.
 */
const COPY_PAGE = '<html><head><title>Acme</title><link rel="stylesheet" href="/a.css"></head><body>'
  + '<nav>Home About Pricing Contact Blog Careers</nav>'
  + '<h1><img src="/logo.svg" alt="Acme Analytics"></h1>'
  + '<svg><path d="M0 0 L10 10"></path></svg><picture><img src="/hero.jpg"></picture>'
  + '<ul><li><p>Alpha beta gamma</p></li><li><p>Delta epsilon zeta</p></li></ul>'
  + '<p>Ready to begin? <a href="/demo">Book a demo</a></p>'
  + '</body></html>';

/** Conversion controls that are NOT anchors, plus a button that is not a CTA. */
const BUTTON_CTA_PAGE = '<html><head><title>Acme</title></head><body>'
  + '<h1>Acme</h1>'
  + '<button type="button" onclick="open()">Book a demo</button>'
  + '<form action="/subscribe"><input type="email" name="e"><input type="submit" value="Start free trial"></form>'
  + '<button type="button" aria-label="Close dialog"><svg></svg></button>'
  + '</body></html>';

/** NON-VACUITY: an ordinary anchor CTA, which must still be detected. */
const ANCHOR_CTA_PAGE = '<html><head><title>Acme</title></head><body>'
  + '<h1>Acme</h1><p><a href="/demo">Book a demo</a></p></body></html>';

/** NON-VACUITY: no conversion control of any kind. Must report none. */
const NO_CTA_PAGE = '<html><head><title>Acme</title></head><body>'
  + '<h1>Acme</h1><p>Some plain prose with no next step at all.</p></body></html>';

/** A page whose own links are absolute on the POST-redirect host. */
const REDIRECTED_PAGE = '<html><head><title>Acme</title></head><body>'
  + '<h1>Acme</h1>'
  + '<p><a href="https://www.site.test/pricing">Pricing</a> <a href="https://www.site.test/contact">Contact us</a></p>'
  + '</body></html>';

const headingsOf = (page: Record<string, unknown>) =>
  (page.headings ?? []) as Array<{ level: number; text: string; textSource?: string }>;
const ctasOf = (page: Record<string, unknown>) =>
  (page.ctas ?? []) as Array<{ text: string; href: string | null; source?: string }>;
const signalsOf = (page: Record<string, unknown>) =>
  ((page.crawl_metadata as { signals?: Record<string, unknown> } | undefined)?.signals ?? {}) as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────

describe('R1-C defect 1 — an H1 the parser could read is no longer reported as absent', () => {
  it('recovers the headline from an image-only H1 via its alt text', async () => {
    const { page } = await crawlOne(IMAGE_H1);
    const h1s = headingsOf(page).filter((h) => h.level === 1);
    expect(h1s).toHaveLength(1);
    expect(h1s[0].text).toBe('Acme Analytics');
    expect(h1s[0].textSource).toBe('image_alt');
  });

  it('NEGATIVE CONTROL — the pre-fix extractor finds no H1 at all on the same markup', () => {
    expect(extractTagContentsLegacy(cleanHtmlLegacy(IMAGE_H1), 'h1')).toEqual([]);
  });

  it('records an H1 element that carries no readable text, and marks it as such', async () => {
    const { page } = await crawlOne(TEXTLESS_H1);
    const h1s = headingsOf(page).filter((h) => h.level === 1);
    expect(h1s).toHaveLength(1);
    expect(h1s[0].text).toBe('');
    expect(h1s[0].textSource).toBe('none');
  });

  it('NON-VACUITY — a page with genuinely no H1 element still reports none', async () => {
    const { page } = await crawlOne(NO_H1);
    expect(headingsOf(page).filter((h) => h.level === 1)).toEqual([]);
    expect(headingsOf(page).some((h) => h.level === 2 && h.text === 'Secondary heading')).toBe(true);
  });
});

describe('R1-C defect 2 — copy extraction counts the page, not the markup around it', () => {
  it('stores exactly the four real blocks and 14 words', async () => {
    const { blocks } = await crawlOne(COPY_PAGE);
    expect(blocks.map((b) => [b.block_type, b.content_text])).toEqual([
      ['heading', 'Acme Analytics'],
      ['paragraph', 'Ready to begin? Book a demo'],
      ['list', 'Alpha beta gamma'],
      ['list', 'Delta epsilon zeta'],
    ]);
    expect(wordsIn(blocks.map((b) => b.content_text))).toBe(14);
  });

  it('never lets <link> become a list item or <path>/<picture> a paragraph', async () => {
    const { blocks } = await crawlOne(COPY_PAGE);
    const all = blocks.map((b) => b.content_text).join(' | ');
    // The navigation is chrome outside every p/li/h1 — it must not appear as body copy.
    expect(all).not.toMatch(/Home About Pricing/);
    expect(blocks.filter((b) => b.block_type === 'list')).toHaveLength(2);
  });

  it('does not emit a CTA block for a CTA already inside a counted paragraph', async () => {
    const { blocks } = await crawlOne(COPY_PAGE);
    expect(blocks.filter((b) => b.block_type === 'cta')).toEqual([]);
  });

  it('NEGATIVE CONTROL — the pre-fix extractor reports 6 blocks and 27 words on the same page', () => {
    const cleaned = cleanHtmlLegacy(COPY_PAGE);
    const legacyH1 = extractTagContentsLegacy(cleaned, 'h1');
    const legacyP = extractTagContentsLegacy(cleaned, 'p');
    const legacyLi = extractTagContentsLegacy(cleaned, 'li');
    const legacyCta = ['Book a demo']; // emitted as its own block, on top of the paragraph
    // The nav text arrives as a "list item", opened by <link rel="stylesheet">.
    expect(legacyLi[0]).toBe('Home About Pricing Contact Blog Careers Alpha beta gamma');
    // The same copy is counted twice: once as the <li>, once as the nested <p>.
    expect(legacyP).toContain('Alpha beta gamma');
    expect(legacyH1).toEqual([]);
    const legacyBlocks = legacyH1.length + legacyP.length + legacyLi.length + legacyCta.length;
    expect(legacyBlocks).toBe(6);
    expect(wordsIn([...legacyH1, ...legacyP, ...legacyLi, ...legacyCta])).toBe(27);
    // 27 against a true 14 — a 1.9x inflation, in the direction that flatters the site.
    expect(wordsIn([...legacyH1, ...legacyP, ...legacyLi, ...legacyCta])).toBeGreaterThan(14);
  });
});

describe('R1-C defect 3 — conversion controls other than anchors are observed', () => {
  it('detects a <button> CTA and a form submit control', async () => {
    const { page } = await crawlOne(BUTTON_CTA_PAGE);
    const ctas = ctasOf(page);
    expect(ctas.map((c) => [c.source, c.text])).toEqual([
      ['button', 'Book a demo'],
      ['form_submit', 'Start free trial'],
    ]);
  });

  it('NON-VACUITY — a button whose label is not CTA wording is NOT a CTA', async () => {
    const { page } = await crawlOne(BUTTON_CTA_PAGE);
    expect(ctasOf(page).some((c) => /close/i.test(c.text))).toBe(false);
  });

  it('NON-VACUITY — an ordinary anchor CTA is still detected, with its href', async () => {
    const { page } = await crawlOne(ANCHOR_CTA_PAGE);
    const ctas = ctasOf(page);
    expect(ctas).toHaveLength(1);
    expect(ctas[0].text).toBe('Book a demo');
    expect(ctas[0].source).toBe('anchor');
    expect(String(ctas[0].href)).toContain('/demo');
  });

  it('NON-VACUITY — a page with no conversion control of any kind reports none', async () => {
    const { page } = await crawlOne(NO_CTA_PAGE);
    expect(ctasOf(page)).toEqual([]);
    expect(signalsOf(page).button_count).toBe(0);
    expect(signalsOf(page).submit_control_count).toBe(0);
  });

  it('records the controls it saw, so "no CTA" is distinguishable from "no controls"', async () => {
    const { page } = await crawlOne(BUTTON_CTA_PAGE);
    expect(signalsOf(page).button_count).toBe(2);
    expect(signalsOf(page).submit_control_count).toBe(1);
  });

  it('NEGATIVE CONTROL — the anchor-only rule sees no CTA on the button/submit page', () => {
    const CTA_PATTERNS = /\b(start|book|demo|try|contact|learn more|get started|request|sign up|talk to sales|download)\b/i;
    const anchorRegex = /<a\s+([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
    const anchorTexts: string[] = [];
    let m: RegExpExecArray | null;
    const cleaned = cleanHtmlLegacy(BUTTON_CTA_PAGE);
    while ((m = anchorRegex.exec(cleaned)) != null) anchorTexts.push(stripTagsLegacy(m[2]));
    expect(anchorTexts.filter((t) => CTA_PATTERNS.test(t))).toEqual([]);
  });
});

describe('R1-C defect 8 — a redirected page resolves its links against the URL it came from', () => {
  it('classifies the site\'s own absolute links as internal after a www redirect', async () => {
    const { page } = await crawlOne(REDIRECTED_PAGE, { finalUrl: 'https://www.site.test/' });
    expect(page.internal_link_count).toBe(2);
  });

  it('records the redirect as evidence rather than silently absorbing it', async () => {
    const { page } = await crawlOne(REDIRECTED_PAGE, { finalUrl: 'https://www.site.test/' });
    const redirect = (page.crawl_metadata as { redirect?: { requestedUrl: string; finalUrl: string } }).redirect;
    expect(redirect).toEqual({ requestedUrl: 'https://site.test/', finalUrl: 'https://www.site.test/' });
  });

  it('NON-VACUITY — a page served from the URL requested records no redirect', async () => {
    const { page } = await crawlOne(REDIRECTED_PAGE, { finalUrl: 'https://site.test/' });
    expect((page.crawl_metadata as { redirect?: unknown }).redirect).toBeUndefined();
  });

  it('NEGATIVE CONTROL — resolving against the pre-redirect URL yields zero internal links', () => {
    const { normalizeHost, normalizeUrl } = jest.requireActual('../../services/ingestionUtils');
    const host = normalizeHost('https://site.test/'); // the URL we ASKED for, as before
    const hrefs = ['https://www.site.test/pricing', 'https://www.site.test/contact'];
    const internal = hrefs.filter((href) => normalizeHost(normalizeUrl(href)) === host);
    expect(internal).toEqual([]);
    // …and `normalizeHost` is what makes it so: it does not fold `www.`.
    expect(normalizeHost('https://www.site.test/')).not.toBe(host);
  });
});
