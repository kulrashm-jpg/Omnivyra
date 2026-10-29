/**
 * Technical readiness — the read seam for integration. Reads the report domain's stored
 * `canonical_pages` rows (same query shape and scope rule as the technical engine) and hands
 * them to the pure `buildTechnicalFindings`. Issues no outbound request. Never throws: a failed
 * read returns null so the caller can say "not available" rather than report an empty result.
 */
import { supabase } from '../../db/supabaseClient';
import { scopeExcludesAllPages, withDomainScope, type ReportDomainScope } from '../crawl/reportDomainScope';
import { buildTechnicalFindings, type TechnicalFindingPageRow, type TechnicalFindingsResult } from './technicalFindings';

export async function loadTechnicalFindings(params: {
  companyId: string;
  targetUrl?: string | null;
  domainScope?: ReportDomainScope;
}): Promise<TechnicalFindingsResult | null> {
  try {
    if (scopeExcludesAllPages(params.domainScope)) return buildTechnicalFindings({ pages: [], targetUrl: params.targetUrl ?? null });
    const { data, error } = await withDomainScope(
      supabase.from('canonical_pages')
        .select('url, page_type, http_status, crawl_depth, last_crawled_at, crawl_metadata')
        .eq('company_id', params.companyId),
      params.domainScope,
    ).order('last_crawled_at', { ascending: false }).limit(500);
    if (error) return null;
    return buildTechnicalFindings({ pages: (data ?? []) as TechnicalFindingPageRow[], targetUrl: params.targetUrl ?? null });
  } catch {
    return null;
  }
}
