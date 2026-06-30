import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { assertWebsiteCompanyAccess } from '../../../../backend/services/websiteService';
import { crawlCompanyWebsite } from '../../../../backend/services/crawlerService';

/**
 * POST /api/websites/[id]/analyze  (BETA-005 · RULE 1/9)
 *
 * The customer-facing trigger that was missing: it actually RUNS the crawl so the
 * deterministic intelligence engines (content/technical/accessibility/brand) and the
 * reports have real `canonical_pages` data to read. Previously `crawlCompanyWebsite`
 * was only reachable from the background ingestion scheduler / scripts, so a Beta
 * customer who finished setup got null scores forever.
 *
 * Runs synchronously with a representative page cap (the crawl persists each page as it
 * goes, so partial results are real and re-runnable). A soft timeout returns an honest
 * 'partial' status instead of a 504 if a large site exceeds the function budget.
 * No new queue/worker/architecture — it reuses the existing crawler service verbatim.
 */

export const config = { maxDuration: 60, api: { bodyParser: true } };

// Beta-safe synchronous crawl bounds. Deeper/scheduled crawls still run via the
// background ingestion scheduler with its larger default (250).
const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 40;
const PER_PAGE_TIMEOUT_MS = 8000;
const SOFT_BUDGET_MS = 50_000; // < maxDuration so we can answer before Vercel kills us

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId = typeof req.query.id === 'string' ? req.query.id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required', code: 'COMPANY_ID_REQUIRED' });
  if (!websiteId) return res.status(400).json({ error: 'website id is required', code: 'WEBSITE_ID_REQUIRED' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  let website;
  try {
    website = await assertWebsiteCompanyAccess(companyId, websiteId);
  } catch {
    return res.status(404).json({ error: 'Website not found or inaccessible', code: 'NOT_FOUND' });
  }

  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  // Resolve the root URL from the website record; crawler falls back to the company's
  // configured site if this is null. Unsupported (no URL) → explicit reason (RULE 7).
  const rootUrl =
    (typeof website.canonical_url === 'string' && website.canonical_url.trim()) ||
    (typeof (website.settings as any)?.root_url === 'string' && (website.settings as any).root_url.trim()) ||
    undefined;

  const requested = Number(req.body?.maxPages);
  const maxPages = Number.isFinite(requested) && requested > 0
    ? Math.min(HARD_MAX_PAGES, Math.floor(requested))
    : DEFAULT_MAX_PAGES;

  try {
    const crawlPromise = crawlCompanyWebsite({
      companyId,
      rootUrl,
      maxPages,
      timeoutMs: PER_PAGE_TIMEOUT_MS,
    });
    // Don't let a slow large site turn into a bare 504 — race a soft budget and, if it
    // wins, report 'partial' (pages crawled so far are already persisted + analyzable).
    let timer: NodeJS.Timeout | undefined;
    const softTimeout = new Promise<'soft_timeout'>((resolve) => {
      timer = setTimeout(() => resolve('soft_timeout'), SOFT_BUDGET_MS);
    });

    const outcome = await Promise.race([
      crawlPromise.then((result) => ({ kind: 'done' as const, result })),
      softTimeout.then((k) => ({ kind: k })),
    ]);
    if (timer) clearTimeout(timer);

    if (outcome.kind === 'soft_timeout') {
      // Keep the crawl from raising an unhandled rejection after we respond.
      crawlPromise.catch(() => {});
      return res.status(202).json({
        status: 'partial',
        message:
          'Analysis is taking longer than the request budget. Pages crawled so far are saved and ' +
          'already reflected in your scores and reports — re-run analysis to continue crawling.',
        rootUrl: rootUrl ?? null,
        maxPages,
      });
    }

    const r = outcome.result;
    return res.status(200).json({
      status: r.pagesInserted > 0 ? 'completed' : 'completed_no_pages',
      pagesProcessed: r.pagesProcessed,
      pagesInserted: r.pagesInserted,
      linksInserted: r.linksInserted,
      contentBlocksInserted: r.contentBlocksInserted,
      rootUrl: r.rootUrl,
      message:
        r.pagesInserted > 0
          ? `Analyzed ${r.pagesInserted} page(s). Scores and reports now reflect live site data.`
          : 'No pages could be crawled (site may block crawlers or be unreachable). Verify the URL and retry.',
    });
  } catch (err: any) {
    const reason = err?.message || 'Crawl failed';
    const noUrl = /no website configured/i.test(reason);
    // RULE 7: always a reason + retryable signal, never a silent/blank failure.
    return res.status(noUrl ? 400 : 502).json({
      status: 'failed',
      error: noUrl
        ? 'No website URL is configured for this site. Set a canonical URL in website settings, then retry.'
        : `Analysis failed: ${reason}`,
      code: noUrl ? 'NO_WEBSITE_URL' : 'CRAWL_FAILED',
      retryable: !noUrl,
    });
  }
}
