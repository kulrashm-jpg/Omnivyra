/**
 * Client-side service to fetch company platform configuration.
 * Used by PlatformContentMatrix in campaign planner.
 */

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
  const res = await fetch(
    `/api/company/platform-config?companyId=${encodeURIComponent(companyId)}`,
    { credentials: 'include' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error((err as { error?: string })?.error || 'Failed to load platform config') as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json();
}
