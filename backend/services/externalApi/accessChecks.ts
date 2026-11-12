import type { ExternalApiSource } from './types';
import { tenantOrPlatformTable, type TenantContext } from '../../db/tenantTable';

/**
 * Central execution gate — the single source of truth for whether an API source
 * is allowed to participate in any execution flow.
 *
 * Returns false when:
 *   • is_enabled_global is explicitly false (SuperAdmin kill-switch)
 *   • category = 'others' and is_whitelisted is not true (non-whitelisted tenant APIs)
 *
 * Accepts a partial object so it works with both full ExternalApiSource rows and
 * the lighter projections used by the scheduler.
 */
export function isApiSourceExecutable(source: {
  is_enabled_global?: boolean | null;
  is_whitelisted?: boolean | null;
  category?: string | null;
}): boolean {
  if (source.is_enabled_global === false) return false;
  if (source.category === 'others' && !source.is_whitelisted) return false;
  return true;
}

/**
 * Single source of truth for API enablement: company_api_configs.enabled.
 * external_api_user_access no longer determines API availability (only user-level overrides).
 * Uses in-memory cache (TTL 5 min); invalidate on config change.
 */
export async function getEnabledApiIdsFromCompanyConfig(
  companyId: string,
  options?: { skipCache?: boolean }
): Promise<string[]> {
  const { getCompanyConfigRows } = await import('../companyApiConfigCache');
  const rows = await getCompanyConfigRows(companyId, options);
  return rows.filter((r) => r.enabled).map((r) => r.api_source_id);
}

/**
 * True when `sourceId` is this company's OWN external API source or a PLATFORM source (company_id IS NULL) -
 * never another company's private source (e1 S2). Every write that stores a source id for a company
 * (company_api_configs) must pass it: getPlatformConfigs used to return whatever source a config row named.
 * A read error throws - "cannot tell" is never "allowed".
 */
export async function isSourceOwnOrPlatform(tenant: TenantContext, sourceId: string): Promise<boolean> {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  const { data, error } = await tenantOrPlatformTable('external_api_sources', tenant)
    .select('id')
    .eq('id', sourceId)
    .limit(1);
  if (error) throw new Error(`external API source lookup failed: ${(error as { message?: string }).message ?? 'error'}`);
  return ((data ?? []) as unknown[]).length > 0;
}
