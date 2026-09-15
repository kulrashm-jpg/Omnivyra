/**
 * SEC-91 W2-A (W2A-5) / W2-G (W2G-4) — is a company operational
 * (companies.status = 'active')?
 *
 * Mirrors the org step of TenantGuard.assertTenantAccess: a missing row or a
 * deterministic identity error (malformed id) is "not operational"; a transient
 * read error is reported separately so callers answer a retryable 503 — never
 * an allow.
 *
 * Shared by the two legacy fallbacks that admit a principal WITHOUT going
 * through the canonical guard's org check:
 *   - requireCampaignAccess (campaignAccessService) — member fast path (W2A-5a)
 *     and the getUserCompanyRole path, incl. the invited-admin fallback (W2G-4);
 *   - enforceCompanyAccess (userContextService) — invited-admin fallback (W2G-4).
 */
import { supabase } from '../db/supabaseClient';
import { isDeterministicIdentityError } from '../security/TenantGuard';

export type CompanyOperationalState = 'operational' | 'not_operational' | 'lookup_error';

export async function companyOperationalState(companyId: string): Promise<CompanyOperationalState> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, status')
    .eq('id', companyId)
    .maybeSingle();
  if (error) return isDeterministicIdentityError(error) ? 'not_operational' : 'lookup_error';
  if (!data) return 'not_operational';
  return (data as { status?: string | null }).status === 'active' ? 'operational' : 'not_operational';
}
