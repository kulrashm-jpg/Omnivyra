/**
 * D7 — the SECOND reachability reader.
 *
 * WHY THIS SUITE EXISTS. D2 fixed the reachability checks in
 * `technicalIntelligenceEngine`, but `digitalExperience` is a second reader of
 * the same `canonical_pages.http_status` column, it reaches Report 1 through
 * `assembleDigitalSnapshot`, and it still read the status as
 * `(http_status ?? 200)`.
 *
 * That default is the defect D2 named: an unobserved page becomes a page that
 * successfully returned 200.
 *
 * ─── WHY THIS IS LIVE AND NOT MERELY LEGACY ────────────────────────────────
 * `ga4IngestionService.upsertPage` creates `canonical_pages` rows from analytics
 * paths with NO `http_status` column at all. So every URL GA4 has seen but the
 * crawler has never fetched sits in the table with `http_status = NULL` — and
 * under `?? 200` each one was counted as a live, successfully-responding page.
 *
 * The consequences compound, because those rows also have no crawl data:
 * `internal_link_count` is null and `wordCount` is 0, so a page that was never
 * fetched was reported to the customer as an ORPHAN and as a THIN page, and was
 * offered to PageSpeed as an eligible probe target.
 *
 * ─── WHAT THIS SUITE DOES NOT DO ───────────────────────────────────────────
 * It introduces no second reachability contract. Classification is delegated to
 * D2's `reachabilityForPage`, which already distinguishes success, redirect,
 * client error, server error, transport failure and timeout, and which already
 * treats "no status recorded" as no HTTP response rather than as success.
 *
 * SECRETS: all synthetic. No network, no database.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { assessDigitalExperience, detectClientSideRendering, type ExperiencePage } from '../../services/digitalExperience';
import { reachabilityForPage } from '../../services/crawl/reachabilityOutcome';

/** A crawled page that answered. */
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

/** Exactly what ga4IngestionService.upsertPage leaves behind: a URL, and nothing else. */
const ga4OnlyPage = (url: string): ExperiencePage => ({
  url,
  page_type: 'landing',
  title: null,
  meta_description: null,
  headings: null,
  ctas: null,
  internal_link_count: null,
  http_status: null,
  crawl_depth: null,
  wordCount: 0,
  crawl_metadata: null,
});

const findingsFor = (pages: ExperiencePage[]) =>
  assessDigitalExperience({ pages }).pillars.flatMap((p) => p.findings);

const problemTitles = (pages: ExperiencePage[]) => findingsFor(pages).map((f) => f.problem);

/** The exact finding strings this module emits — asserted verbatim so a negative
 *  test cannot pass merely because the string it looked for never existed. */
const ORPHAN_FINDING = 'Some pages are dead ends with no outbound internal links';
const THIN_FINDING = 'Pages carry too little content to explain the offering';
const BROKEN_FINDING = 'Pages return errors';

// ── 1. THE DEFECT ───────────────────────────────────────────────────────────

describe('D7 — an unobserved page is not a successful page', () => {
  it('a GA4-created row with NO status is not counted as a live 200 page', () => {
    // The reader's own view of "pages that returned 200". Under `?? 200` this
    // page — never fetched by anything — was in that set.
    const pages = [
      page('https://site.test/a', 200, { wordCount: 20, headings: [] }),
      page('https://site.test/b', 200, { wordCount: 20, headings: [] }),
      page('https://site.test/c', 200, { wordCount: 20, headings: [] }),
      ga4OnlyPage('https://site.test/never-crawled'),
    ];
    // `detectClientSideRendering` requires >= 3 pages that returned 200 and then
    // measures the share that look like empty shells. The GA4 row has 0 words and
    // no headings, so counting it inflates the shell ratio with a page nobody read.
    const withGhost = detectClientSideRendering(pages);
    const withoutGhost = detectClientSideRendering(pages.slice(0, 3));
    expect(withGhost).toBe(withoutGhost);
  });

  it('a never-crawled page is NOT reported as an orphan', () => {
    // The sharpest customer-facing consequence: `internal_link_count` is null
    // because nothing ever crawled the page, not because the page lacks links.
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/b', 200),
      ga4OnlyPage('https://site.test/never-crawled'),
    ]);
    expect(problems).not.toContain(ORPHAN_FINDING);
  });

  it('a never-crawled page is NOT reported as thin content', () => {
    // Same root cause: `wordCount` is 0 because the page was never fetched.
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/b', 200),
      ga4OnlyPage('https://site.test/never-crawled'),
    ]);
    expect(problems).not.toContain(THIN_FINDING);
  });

  it('a never-crawled page is NOT counted as a broken page either', () => {
    // The fix must not overcorrect: absence of evidence is not a 4xx/5xx.
    const problems = problemTitles([
      page('https://site.test/a', 200),
      ga4OnlyPage('https://site.test/never-crawled'),
    ]);
    expect(problems).not.toContain(BROKEN_FINDING);
  });
});

// ── 2. REAL STATUSES STILL BEHAVE ───────────────────────────────────────────

describe('D7 — observed statuses keep their D2 meanings', () => {
  it.each([
    ['404 client error', 404, true],
    ['500 server error', 500, true],
    ['403 client error', 403, true],
  ])('%s is still reported as a broken page', (_label, status, expected) => {
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/bad', status as number),
    ]);
    expect(problems.includes(BROKEN_FINDING)).toBe(expected);
  });

  it.each([
    ['200', 200],
    ['301', 301],
    ['302', 302],
  ])('%s is not reported as a broken page', (_label, status) => {
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/b', status as number),
    ]);
    expect(problems).not.toContain(BROKEN_FINDING);
  });

  it("D2's no-response sentinel (0) is not a broken page and not a live page", () => {
    // A transport failure answered nothing. It is neither 4xx/5xx nor a success.
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/down', 0),
    ]);
    expect(problems).not.toContain(BROKEN_FINDING);
    expect(problems).not.toContain(ORPHAN_FINDING);
  });

  it('a real orphan — crawled, responded 200, no internal links — is still reported', () => {
    // The fix must not silence genuine findings.
    const problems = problemTitles([
      page('https://site.test/a', 200),
      page('https://site.test/b', 200),
      page('https://site.test/orphan', 200, { internal_link_count: 0 }),
    ]);
    expect(problems).toContain(ORPHAN_FINDING);
  });
});

// ── 3. THE D2 CONTRACT IS THE ONE IN USE ────────────────────────────────────

describe('D7 — classification is delegated to the D2 canonical contract', () => {
  it('reads D2 reachability metadata when the crawler recorded it', () => {
    // A page the crawler recorded as a timeout carries a structured observation.
    // It must be read, not re-derived from the status column.
    const timedOut = page('https://site.test/slow', 0, {
      crawl_metadata: { reachability: { outcome: 'timeout', status: null, reason: 'UND_ERR_HEADERS_TIMEOUT' } },
    } as Partial<ExperiencePage>);
    expect(reachabilityForPage(timedOut).outcome).toBe('timeout');
    const problems = problemTitles([page('https://site.test/a', 200), timedOut]);
    expect(problems).not.toContain(BROKEN_FINDING);
  });

  it('the contract agrees with this reader about every status', () => {
    // One vocabulary. If these ever disagreed, Report 1 would carry two different
    // answers to "did this page work" derived from the same row.
    expect(reachabilityForPage({ http_status: 200 }).outcome).toBe('success');
    expect(reachabilityForPage({ http_status: 301 }).outcome).toBe('redirect');
    expect(reachabilityForPage({ http_status: 404 }).outcome).toBe('client_error');
    expect(reachabilityForPage({ http_status: 500 }).outcome).toBe('server_error');
    expect(reachabilityForPage({ http_status: 0 }).outcome).toBe('transport_failure');
    expect(reachabilityForPage({ http_status: null }).outcome).toBe('transport_failure');
  });

  it('no unobserved page can be classified as success', () => {
    for (const status of [null, 0]) {
      expect(reachabilityForPage({ http_status: status }).outcome).not.toBe('success');
    }
  });
});

// ── 4. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D7 — no success-default and no second reachability interpretation', () => {
  const fs = require('fs');
  const executable = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    'backend/services/digitalExperience.ts',
    'backend/services/digitalExperienceRepository.ts',
  ])('%s does not default an unobserved status to 200', (file) => {
    const code = executable(fs.readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/http_status\s*\?\?\s*200/);
    expect(code).not.toMatch(/httpStatus\s*\?\?\s*200/);
  });

  it('the secondary reader consumes the canonical contract rather than its own', () => {
    const code = executable(fs.readFileSync('backend/services/digitalExperience.ts', 'utf8'));
    expect(code).toContain('reachabilityForPage');
    // It must not re-derive the classification with its own thresholds.
    expect(code).not.toMatch(/http_status[^)]*>=\s*400/);
  });

  it('exactly one module defines the reachability vocabulary', () => {
    const { execSync } = require('child_process');
    const owners = execSync(
      'git grep -l --untracked "export type ReachabilityOutcome" -- backend || true',
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));
    expect(owners).toEqual(['backend/services/crawl/reachabilityOutcome.ts']);
  });
});

// ── 5. THE DENOMINATOR AND THE STATED LIMITATION ────────────────────────────
//
// These exist because the population filter survived mutation without them: the
// per-predicate contract checks already excluded ghost rows from FINDINGS, so
// nothing observed whether those rows were still inflating the counts a customer
// reads, or whether their exclusion was disclosed.

describe('D7 — excluded pages leave the denominator and are disclosed', () => {
  const withGhost = () => assessDigitalExperience({
    pages: [
      page('https://site.test/a', 200, { internal_link_count: 0 }),
      page('https://site.test/b', 200),
      ga4OnlyPage('https://site.test/ghost-1'),
      ga4OnlyPage('https://site.test/ghost-2'),
    ],
  });

  it('evidence counts only the pages actually read', () => {
    // Four rows in, two observed. "1 of 4" would describe a corpus that was
    // never assessed.
    const orphan = withGhost().pillars.flatMap((p) => p.findings).find((f) => f.problem === ORPHAN_FINDING)!;
    expect(orphan.evidence).toContain('of 2 pages');
    expect(orphan.evidence).not.toContain('of 4 pages');
  });

  it('coverage reports the observed page count, not the row count', () => {
    expect(withGhost().coverage.pagesEvaluated).toBe(2);
  });

  it('the exclusion is stated as an evidence limitation, not hidden', () => {
    // Silently shrinking a denominator is its own way of misleading a reader.
    const limitation = withGhost().limitations.find((l) => l.kind === 'no_crawl');
    expect(limitation).toBeTruthy();
    expect(limitation!.message).toContain('2 known URLs');
    expect(limitation!.message).toMatch(/no HTTP response/i);
  });

  it('a fully observed corpus reports no such limitation', () => {
    const clean = assessDigitalExperience({
      pages: [page('https://site.test/a', 200), page('https://site.test/b', 200)],
    });
    expect(clean.limitations.find((l) => l.kind === 'no_crawl')).toBeUndefined();
    expect(clean.coverage.pagesEvaluated).toBe(2);
  });

  it('a page that answered with an error stays IN the assessed population', () => {
    // It was observed. Excluding it would hide a real broken page.
    const result = assessDigitalExperience({
      pages: [page('https://site.test/a', 200), page('https://site.test/gone', 404)],
    });
    expect(result.coverage.pagesEvaluated).toBe(2);
    expect(result.pillars.flatMap((p) => p.findings).map((f) => f.problem)).toContain(BROKEN_FINDING);
  });
});

describe('D7 — the contract keeps no-response distinct from an error response', () => {
  const { isHttpErrorOutcome, hasHttpResponse } = require('../../services/crawl/reachabilityOutcome');

  it('transport failure and timeout are never 4xx/5xx', () => {
    expect(isHttpErrorOutcome('transport_failure')).toBe(false);
    expect(isHttpErrorOutcome('timeout')).toBe(false);
    expect(isHttpErrorOutcome('client_error')).toBe(true);
    expect(isHttpErrorOutcome('server_error')).toBe(true);
  });

  it('transport failure and timeout never count as having responded', () => {
    expect(hasHttpResponse('transport_failure')).toBe(false);
    expect(hasHttpResponse('timeout')).toBe(false);
    for (const o of ['success', 'redirect', 'client_error', 'server_error']) {
      expect(hasHttpResponse(o)).toBe(true);
    }
  });
});
