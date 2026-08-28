/**
 * Client-side service to fetch company platform configuration.
 * Used by PlatformContentMatrix in campaign planner.
 *
 * CP-STRUCT-005 — this must go through `fetchWithAuth`.
 *
 * It previously used a bare `fetch(..., { credentials: 'include' })`, so the
 * request carried NO `Authorization: Bearer` header and the API route could
 * only authenticate by cookie. When that failed, the failure did not surface
 * as a 401: `resolveUserContext` falls back to a synthetic dev identity
 * (`DEV_USER_ID` / 'dev-user'), which is a member of no company, so
 * `enforceCompanyAccess` -> `assertTenantAccess` returned NOT_A_MEMBER and the
 * route answered **403 "Access denied to company"**. PlatformContentMatrix
 * renders exactly that as "Access denied to this company.", making an
 * authentication problem look like a tenancy denial.
 *
 * Verified against production: an UNAUTHENTICATED GET to this route returns
 * HTTP 403 with that exact body — the symptom reproduced with no browser.
 *
 * fetchWithAuth sends the Bearer AND `credentials: 'include'`, so it is a
 * strict superset of the previous behaviour. It is the established pattern
 * here (152 client files use it; only 7 used bare fetch). No authorization
 * semantics change: TenantGuard and enforceCompanyAccess are untouched, and a
 * genuine non-member still receives 403.
 */
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';

export type PlatformConfigItem = {
  platform: string;
  content_types: string[];
};

export type CompanyPlatformConfigResponse = {
  platforms: PlatformConfigItem[];
};

export async function getCompanyPlatformConfig(
  companyId: string
): Promise<CompanyPlatformConfigResponse> {
  const res = await fetchWithAuth(
    `/api/company/platform-config?companyId=${encodeURIComponent(companyId)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error((err as { error?: string })?.error || 'Failed to load platform config') as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json();
}
