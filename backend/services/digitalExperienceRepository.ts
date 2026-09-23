/**
 * Evidence loader for Digital Experience + performance (Phase 4).
 *
 * Kept separate so `digitalExperience.ts` and `performanceEvidence.ts` stay pure and
 * testable. Reads ONLY the existing canonical crawl tables — it adds no schema and performs
 * no crawling of its own.
 */
import { supabase } from '../db/supabaseClient';
import { scopeExcludesAllPages, type ReportDomainScope } from './crawl/reportDomainScope';
import type { ExperiencePage } from './digitalExperience';
// D7 — the same canonical reachability contract the assessment reader uses, so
// probe eligibility and finding eligibility cannot disagree about a page.
import { reachabilityForPage } from './crawl/reachabilityOutcome';
import {
  aggregatePerformanceEvidence,
  fetchPageSpeed,
  isPageSpeedConfigured,
  type PerformanceEvidence,
  type PerformanceObservation,
} from './performanceEvidence';

/** Pages to assess. Matches the technical engine's own cap so both read the same corpus. */
const MAX_PAGES = 500;

/**
 * How many URLs to measure with PageSpeed per report. PSI takes 15–40s per URL per form
 * factor, so this is deliberately small: the home page plus the highest-linked page, each on
 * mobile and desktop, is four provider calls. Coverage is reported honestly rather than
 * inflated by measuring more pages than the request budget allows.
 */
const MAX_PSI_URLS = Math.max(1, Number(process.env.PAGESPEED_MAX_URLS) || 2);

/** Load crawl evidence shaped for the experience assessment, including per-page word counts. */
export async function loadExperiencePages(companyId: string, domainScope?: ReportDomainScope): Promise<ExperiencePage[]> {
  // R1-OPEN-01: Report 1 reads only the current domain's pages.
  if (scopeExcludesAllPages(domainScope)) return [];
  try {
    let pagesQuery = supabase
      .from('canonical_pages')
      .select('id, url, page_type, title, meta_description, headings, ctas, internal_link_count, http_status, crawl_depth, crawl_metadata')
      .eq('company_id', companyId);
    if (domainScope) pagesQuery = pagesQuery.eq('domain_id', domainScope.domainId as string);
    const { data: pages } = await pagesQuery
      .order('last_crawled_at', { ascending: false })
      .limit(MAX_PAGES);
    const rows = pages ?? [];
    if (rows.length === 0) return [];

    // Word counts come from the existing page_content blocks — the same source the content
    // engine uses, so "thin page" means the same thing in both places.
    let blocksQuery = supabase
      .from('page_content')
      .select('page_id, content_text')
      .eq('company_id', companyId);
    // Scoped runs read only these pages' blocks, so another domain's blocks cannot use up the cap.
    if (domainScope) blocksQuery = blocksQuery.in('page_id', rows.map((row) => String((row as { id?: string }).id ?? '')));
    const { data: blocks } = await blocksQuery.limit(5000);
    const wordsByPage = new Map<string, number>();
    for (const block of blocks ?? []) {
      const id = String((block as { page_id?: string }).page_id ?? '');
      if (!id) continue;
      const text = String((block as { content_text?: string }).content_text ?? '');
      const count = text.trim() ? text.trim().split(/\s+/).length : 0;
      wordsByPage.set(id, (wordsByPage.get(id) ?? 0) + count);
    }

    return rows.map((row) => ({
      url: String((row as { url?: string }).url ?? ''),
      page_type: (row as { page_type?: string | null }).page_type ?? null,
      title: (row as { title?: string | null }).title ?? null,
      meta_description: (row as { meta_description?: string | null }).meta_description ?? null,
      headings: (row as { headings?: ExperiencePage['headings'] }).headings ?? null,
      ctas: (row as { ctas?: ExperiencePage['ctas'] }).ctas ?? null,
      internal_link_count: (row as { internal_link_count?: number | null }).internal_link_count ?? null,
      http_status: (row as { http_status?: number | null }).http_status ?? null,
      crawl_depth: (row as { crawl_depth?: number | null }).crawl_depth ?? null,
      wordCount: wordsByPage.get(String((row as { id?: string }).id ?? '')) ?? 0,
      crawl_metadata: (row as { crawl_metadata?: ExperiencePage['crawl_metadata'] }).crawl_metadata ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Whether to attempt PageSpeed for this report.
 *
 * Inert unless a dedicated quota is configured (`PAGESPEED_API_KEY`) or explicitly enabled
 * (`PAGESPEED_ENABLED=true`). The keyless shared quota is routinely exhausted, so calling it
 * on every report would add tens of seconds of latency for a 429 — the evidence is reported
 * as unavailable instead, with the reason.
 */
export function pageSpeedEnabled(): boolean {
  return isPageSpeedConfigured() || /^(1|true|on|yes)$/i.test(process.env.PAGESPEED_ENABLED ?? '');
}

/**
 * Collect performance evidence for the most important crawled URLs, on both form factors.
 * Never throws. When disabled or failing it returns honest `unavailable` evidence.
 */
export async function collectPerformanceEvidence(params: {
  pages: readonly ExperiencePage[];
  enabled?: boolean;
}): Promise<PerformanceEvidence> {
  // D7 — `?? 200` made every never-fetched row an eligible probe target, so a URL
  // GA4 had seen but the crawler had never reached could be sent to PageSpeed as
  // though it were a known-good page. Only a page observed to return 200 qualifies.
  const eligible = params.pages.filter((p) => reachabilityForPage(p).outcome === 'success' && p.url);

  if (!(params.enabled ?? pageSpeedEnabled())) {
    return {
      observations: [],
      coverage: { measured: 0, attempted: 0, eligible: eligible.length },
      byFormFactor: { mobile: { measured: 0, verdict: 'unknown' }, desktop: { measured: 0, verdict: 'unknown' } },
      state: 'unavailable',
      reasonUnavailable: 'PageSpeed Insights is not enabled for this environment. Set PAGESPEED_API_KEY (or PAGESPEED_ENABLED=true) to collect performance evidence.',
    };
  }

  // Home page first, then the most internally-linked page — the two a visitor is most likely
  // to land on. Selection is evidence-based, not arbitrary.
  const home = eligible.find((p) => /^https?:\/\/[^/]+\/?$/.test(p.url)) ?? eligible[0];
  const rest = eligible
    .filter((p) => p.url !== home?.url)
    .sort((a, b) => Number(b.internal_link_count ?? 0) - Number(a.internal_link_count ?? 0));
  const targets = [home, ...rest].filter(Boolean).slice(0, MAX_PSI_URLS) as ExperiencePage[];

  const observations: PerformanceObservation[] = [];
  for (const page of targets) {
    for (const formFactor of ['mobile', 'desktop'] as const) {
      observations.push(await fetchPageSpeed({ url: page.url, formFactor }));
    }
  }

  return aggregatePerformanceEvidence({ observations, eligiblePages: eligible.length });
}
