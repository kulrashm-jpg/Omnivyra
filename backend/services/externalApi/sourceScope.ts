/**
 * external_api_sources scope (e1, 2026-11-12) - a company may see and configure only its OWN sources
 * (company_id = companyId) and PLATFORM sources (company_id IS NULL), never another company's private source.
 *
 * Previously the read paths used an interpolated PostgREST `.or(company_id.eq.<id>,company_id.is.null)` built from a
 * request company id, fell back on a read error to the SAME query with NO company filter, and read
 * `.in('id', <ids a company config row named>)` with no company constraint at all - so a company admin who knew
 * another company's private source id could enable it and read that company's source configuration.
 *
 * Every read here is two exact queries; a non-uuid company id is refused; a failed read THROWS (never "read
 * everything instead"). When the tenant seam lands, these become tenantOrPlatformTable reads.
 */
import { ownedDbTable } from '../../db/writeOwner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ExternalApiScopeError extends Error {
  constructor(public readonly code: 'EXTERNAL_API_COMPANY_ID_INVALID' | 'EXTERNAL_API_SOURCE_READ_FAILED', message: string) {
    super(message);
  }
}

/** A company id that is safe to use as a filter value: a uuid, lower-cased. */
export function scopedCompanyId(companyId: string): string {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId.trim())) {
    throw new ExternalApiScopeError('EXTERNAL_API_COMPANY_ID_INVALID', 'external API company id must be a uuid');
  }
  return companyId.trim().toLowerCase();
}

type Refine = (query: any) => any;

/**
 * The company's OWN sources plus PLATFORM sources, as two exact reads. `refine` adds the caller's other filters
 * (is_active, an id list, ordering) to BOTH reads. Rows come back ordered by created_at ascending.
 */
export async function readOwnOrPlatformSources(companyId: string, refine: Refine = (q) => q): Promise<any[]> {
  const id = scopedCompanyId(companyId);
  const [own, platform] = await Promise.all([
    refine(ownedDbTable('external_api_sources').select('*').eq('company_id', id)),
    refine(ownedDbTable('external_api_sources').select('*').is('company_id', null)),
  ]);
  const err = own?.error ?? platform?.error;
  if (err) {
    throw new ExternalApiScopeError('EXTERNAL_API_SOURCE_READ_FAILED', `external API sources unreadable (${err.message ?? 'error'})`);
  }
  return [...(own.data ?? []), ...(platform.data ?? [])]
    .sort((a: any, b: any) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}

/**
 * True when `sourceId` is the company's OWN source or a PLATFORM source - never another company's. Every write that
 * stores a source id for a company (company_api_configs) must pass it. A failed read throws ("cannot tell" is never
 * "allowed").
 */
export async function isSourceOwnOrPlatform(companyId: string, sourceId: string): Promise<boolean> {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  const rows = await readOwnOrPlatformSources(companyId, (q) => q.eq('id', sourceId).limit(1));
  return rows.length > 0;
}
