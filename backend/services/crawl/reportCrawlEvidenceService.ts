/**
 * Report-triggered crawl evidence (Phase 1A).
 *
 * THE missing link between a Report 1 request and the website evidence every
 * deterministic engine reads. Before this, `crawlCompanyWebsite` was reachable only
 * from onboarding, the manual `/api/websites/[id]/analyze` button and the background
 * ingestion scheduler — never from the report path. A report therefore read whatever
 * `canonical_pages` happened to contain, which for almost every company was nothing,
 * so `technicalScore` / `contentScore` came back null and the report abstained on
 * everything it could otherwise have measured.
 *
 * This module adds NO crawler. It decides — using the EXISTING refresh-policy cooldown
 * — whether the stored evidence is usable, and if not it calls the EXISTING
 * `crawlCompanyWebsite`, which owns all persistence (`canonical_domains`,
 * `canonical_pages`, `page_content`, `page_links`, `crawl_metadata.signals`).
 *
 * Contract:
 *   • It NEVER throws. A crawl failure must degrade the report to honest abstention,
 *     never fail the report — the engines already return `not_evaluable` with no pages.
 *   • It NEVER fabricates. It writes no rows itself and returns only observed counts.
 *   • It is bounded. The crawl runs inside the report's async lifecycle, so it races a
 *     soft budget. `crawlCompanyWebsite` persists each page as it goes, so a soft
 *     timeout still leaves real, re-usable evidence behind for this and later runs.
 */
import { supabase } from '../../db/supabaseClient';
import { crawlCompanyWebsite } from '../crawlerService';
import { cooldownForTier, getRefreshPolicyConfig } from './refreshPolicyConfig';

export type ReportCrawlAction =
  /** Stored evidence was present and fresh enough — nothing was fetched. */
  | 'reused'
  /** No usable stored evidence existed — a first crawl ran. */
  | 'crawled'
  /** Stored evidence existed but was older than the refresh cooldown — it was re-crawled. */
  | 'refreshed'
  /** A crawl started and persisted pages but exceeded the soft budget. */
  | 'partial'
  /** No website domain is known for this company — nothing to crawl. */
  | 'skipped_no_domain'
  /** The crawl was attempted and failed. The report still proceeds, abstaining. */
  | 'failed';

export interface ReportCrawlEvidenceResult {
  action: ReportCrawlAction;
  /** Pages in `canonical_pages` before the decision. */
  pagesBefore: number;
  /** Pages in `canonical_pages` after (equal to `pagesBefore` when reused/skipped). */
  pagesAfter: number;
  lastCrawledAt: string | null;
  ageMs: number | null;
  cooldownMs: number;
  durationMs: number;
  /** Human-readable decision reason — surfaced in logs, never in customer copy. */
  reason: string;
  error?: string;
}

/**
 * Minimum pages that count as "usable" evidence. Below this the engines have too little
 * to evaluate (a single redirect stub or an error page would otherwise look like a
 * successful crawl and permanently suppress re-crawling).
 */
const MIN_USABLE_PAGES = Math.max(1, Number(process.env.REPORT_CRAWL_MIN_PAGES) || 3);

/**
 * Bounded crawl shape for the report path. Deliberately smaller than the ingestion
 * scheduler's default (250) because this runs inside the report's serverless lifecycle.
 * Both are env-tunable so the budget can be raised without a code change.
 */
const MAX_PAGES = Math.max(1, Number(process.env.REPORT_CRAWL_MAX_PAGES) || 15);
const PER_PAGE_TIMEOUT_MS = Math.max(2000, Number(process.env.REPORT_CRAWL_PAGE_TIMEOUT_MS) || 8000);
const SOFT_BUDGET_MS = Math.max(5000, Number(process.env.REPORT_CRAWL_SOFT_BUDGET_MS) || 20000);

async function countPages(companyId: string): Promise<{ count: number; lastCrawledAt: string | null }> {
  const [{ count }, { data }] = await Promise.all([
    supabase
      .from('canonical_pages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabase
      .from('canonical_pages')
      .select('last_crawled_at')
      .eq('company_id', companyId)
      .not('last_crawled_at', 'is', null)
      .order('last_crawled_at', { ascending: false })
      .limit(1),
  ]);
  return {
    count: count ?? 0,
    lastCrawledAt: (data?.[0]?.last_crawled_at as string | undefined) ?? null,
  };
}

/**
 * Ensure the company has usable, reasonably fresh crawl evidence before a report is
 * composed. Reuses stored evidence when it is sufficient; otherwise runs the existing
 * crawler. Never throws.
 */
export async function ensureReportCrawlEvidence(params: {
  companyId: string;
  /** Resolved website domain from the report input resolver. */
  websiteDomain?: string | null;
  /** Overrides the refresh cooldown; defaults to the existing free-tier policy value. */
  cooldownMsOverride?: number;
}): Promise<ReportCrawlEvidenceResult> {
  const startedAt = Date.now();
  const cooldownMs = params.cooldownMsOverride
    ?? cooldownForTier(getRefreshPolicyConfig(), 'free');

  const base = {
    pagesBefore: 0,
    pagesAfter: 0,
    lastCrawledAt: null as string | null,
    ageMs: null as number | null,
    cooldownMs,
    durationMs: 0,
  };

  let before: { count: number; lastCrawledAt: string | null };
  try {
    before = await countPages(params.companyId);
  } catch (error) {
    // Cannot read the evidence table — do NOT crawl blindly, and do not fail the
    // report. Compose against whatever the engines can read themselves.
    return {
      ...base,
      action: 'failed',
      durationMs: Date.now() - startedAt,
      reason: 'could not read canonical_pages to evaluate crawl freshness',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const ageMs = before.lastCrawledAt ? Date.now() - Date.parse(before.lastCrawledAt) : null;
  const usable = before.count >= MIN_USABLE_PAGES;
  const fresh = ageMs !== null && Number.isFinite(ageMs) && ageMs < cooldownMs;

  if (usable && fresh) {
    return {
      ...base,
      action: 'reused',
      pagesBefore: before.count,
      pagesAfter: before.count,
      lastCrawledAt: before.lastCrawledAt,
      ageMs,
      durationMs: Date.now() - startedAt,
      reason: `${before.count} stored pages, last crawled ${Math.round((ageMs ?? 0) / 3_600_000)}h ago (within ${Math.round(cooldownMs / 3_600_000)}h cooldown)`,
    };
  }

  // `crawlCompanyWebsite` resolves the company's website itself when no rootUrl is
  // given; pass the resolver's domain when we have it so the report and the crawl
  // agree on the target. A company with no website at all is skipped honestly.
  //
  // GAP-03 — the value handed in here is a BARE DOMAIN, not a URL.
  //
  // `reportInputResolver.normalizeDomain` deliberately strips the scheme
  // (`raw.replace(/^https?:\/\//i, '')`), and `reports.domain` is stored the same way, so this
  // path supplied e.g. `calendly.com`. `crawlCompanyWebsite` immediately calls
  // `normalizeUrl(rootUrl)`, which is a bare `new URL(rawUrl)` — and `new URL('calendly.com')`
  // throws `TypeError: Invalid URL`. The throw happened BEFORE `ensureCanonicalDomain` and
  // before the fetch loop, so not even the loop's fetch-error row was written: the company ended
  // with zero `canonical_pages`, which is exactly the production state this gap describes.
  //
  // Every other caller escapes this because they route through `resolveCompanyWebsite`, which
  // already applies the codebase's established convention:
  //
  //     return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  //
  // Only the report path bypassed that helper. The same expression is applied here rather than
  // relaxing `normalizeUrl`, because the crawler's contract genuinely is a URL — every other
  // caller honours it — and loosening the shared parser would let malformed input through for
  // callers that currently fail fast on it.
  const websiteDomain = params.websiteDomain?.trim() || '';
  const rootUrl = websiteDomain
    ? (/^https?:\/\//i.test(websiteDomain) ? websiteDomain : `https://${websiteDomain}`)
    : undefined;
  if (!rootUrl) {
    const { data: company } = await supabase
      .from('companies')
      .select('website')
      .eq('id', params.companyId)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }));
    if (!company?.website) {
      return {
        ...base,
        action: 'skipped_no_domain',
        pagesBefore: before.count,
        pagesAfter: before.count,
        lastCrawledAt: before.lastCrawledAt,
        ageMs,
        durationMs: Date.now() - startedAt,
        reason: 'no website domain resolved for this company',
      };
    }
  }

  const intendedAction: ReportCrawlAction = before.count > 0 ? 'refreshed' : 'crawled';
  const decisionReason = before.count === 0
    ? 'no stored pages'
    : !usable
      ? `only ${before.count} stored page(s), below the ${MIN_USABLE_PAGES}-page usable threshold`
      : `stored evidence is ${ageMs === null ? 'undated' : `${Math.round(ageMs / 3_600_000)}h old`}, past the ${Math.round(cooldownMs / 3_600_000)}h cooldown`;

  let timer: NodeJS.Timeout | undefined;
  try {
    const crawlPromise = crawlCompanyWebsite({
      companyId: params.companyId,
      rootUrl,
      maxPages: MAX_PAGES,
      timeoutMs: PER_PAGE_TIMEOUT_MS,
    });

    const softTimeout = new Promise<'soft_timeout'>((resolve) => {
      timer = setTimeout(() => resolve('soft_timeout'), SOFT_BUDGET_MS);
    });

    const outcome = await Promise.race([
      crawlPromise.then((result) => ({ kind: 'done' as const, result })),
      softTimeout.then((kind) => ({ kind })),
    ]);
    if (timer) clearTimeout(timer);

    if (outcome.kind === 'soft_timeout') {
      // Keep the still-running crawl from raising an unhandled rejection. Its pages
      // are persisted incrementally, so they remain usable for this composition and
      // for the next report.
      crawlPromise.catch(() => {});
      const after = await countPages(params.companyId).catch(() => before);
      return {
        ...base,
        action: 'partial',
        pagesBefore: before.count,
        pagesAfter: after.count,
        lastCrawledAt: after.lastCrawledAt,
        ageMs,
        durationMs: Date.now() - startedAt,
        reason: `${decisionReason}; crawl exceeded the ${SOFT_BUDGET_MS}ms soft budget — ${after.count} page(s) persisted so far`,
      };
    }

    const after = await countPages(params.companyId).catch(() => ({
      count: before.count + outcome.result.pagesInserted,
      lastCrawledAt: before.lastCrawledAt,
    }));
    return {
      ...base,
      action: intendedAction,
      pagesBefore: before.count,
      pagesAfter: after.count,
      lastCrawledAt: after.lastCrawledAt,
      ageMs,
      durationMs: Date.now() - startedAt,
      reason: `${decisionReason}; crawled ${outcome.result.pagesProcessed} page(s) from ${outcome.result.rootUrl}`,
    };
  } catch (error) {
    if (timer) clearTimeout(timer);
    const after = await countPages(params.companyId).catch(() => before);
    return {
      ...base,
      action: 'failed',
      pagesBefore: before.count,
      pagesAfter: after.count,
      lastCrawledAt: after.lastCrawledAt,
      ageMs,
      durationMs: Date.now() - startedAt,
      reason: `${decisionReason}; crawl failed — report proceeds with existing evidence`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
