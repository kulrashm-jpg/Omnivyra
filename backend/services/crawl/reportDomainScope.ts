/**
 * R1-OPEN-01 — Report 1 website evidence must belong to the report's CURRENT domain.
 *
 * `canonical_pages` is unique per (company_id, url) and every row carries the
 * `domain_id` of the crawl that wrote it, so a company that changed websites keeps
 * the old site's pages alongside the new one's. Reading by `company_id` alone let a
 * report for the current domain be built from the previous site's pages (observed
 * 2026-09-14: python.org pages seeded calendly.com's SERP queries).
 *
 * This resolves the report domain to its existing `canonical_domains` row — READ-ONLY,
 * keyed exactly as the crawler keys it (`normalizeHost(rootUrl)` in
 * `ensureCanonicalDomain`) — and readers filter on its id. Nothing is deleted: old
 * pages stay as history, they just never enter a report for a different domain.
 *
 *   scope `undefined`       → caller is not Report 1; legacy company-wide read, unchanged
 *   `{ domainId: null }`    → Report 1 with no resolvable current domain: read NOTHING
 *   `{ domainId: '<id>' }`  → only that domain's pages
 */
import { supabase } from '../../db/supabaseClient';
import { normalizeHost } from '../ingestionUtils';

export type ReportDomainScope = { readonly domainId: string | null };

/** The same scheme convention the crawl uses for a bare report domain (GAP-03). */
function toRootUrl(domainOrUrl: string): string {
  return /^https?:\/\//i.test(domainOrUrl) ? domainOrUrl : `https://${domainOrUrl}`;
}

export async function resolveReportDomainScope(
  companyId: string,
  domainOrUrl: string | null | undefined,
): Promise<ReportDomainScope> {
  const raw = domainOrUrl?.trim();
  if (!companyId || !raw) return { domainId: null };
  const host = normalizeHost(toRootUrl(raw));
  if (!host) return { domainId: null };
  const { data, error } = await supabase
    .from('canonical_domains')
    .select('id')
    .eq('company_id', companyId)
    .eq('primary_domain', host)
    .maybeSingle();
  // A read ERROR is not "no such domain": callers that must not act blindly (the crawl decision)
  // see it, and composition treats it as unresolved and abstains.
  if (error) throw new Error(`could not resolve report domain scope: ${error.message}`);
  if (!data?.id) return { domainId: null };
  return { domainId: String(data.id) };
}

/** True when a Report 1 scope is active but no current domain resolved — read nothing. */
export function scopeExcludesAllPages(scope: ReportDomainScope | undefined): boolean {
  return scope !== undefined && scope.domainId === null;
}

/**
 * Narrow a `canonical_pages` query to the scoped domain. Callers check
 * `scopeExcludesAllPages` first, so a scope reaching here always has a domain id.
 */
export function withDomainScope<Q>(query: Q, scope: ReportDomainScope | undefined): Q {
  if (!scope || scope.domainId === null) return query;
  return (query as unknown as { eq(column: string, value: string): Q }).eq('domain_id', scope.domainId);
}
