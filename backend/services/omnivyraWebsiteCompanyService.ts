import { supabase } from '../db/supabaseClient';

export type OmnivyraWebsiteCompanyRecord = {
  id: string;
  name: string | null;
  website: string | null;
  website_domain: string | null;
  status: string | null;
  company_profiles?: Array<{
    website_url: string | null;
    name: string | null;
  }> | null;
};

export function normalizeWebsiteDomain(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '');
}

export function isOmnivyraWebsiteDomain(value: string | null | undefined): boolean {
  return normalizeWebsiteDomain(value) === 'omnivyra.com';
}

export function resolveOmnivyraWebsiteUrl(company: OmnivyraWebsiteCompanyRecord): string {
  const primaryWebsite = String(company.website || '').trim();
  if (primaryWebsite) return primaryWebsite;

  const profileWebsite = String(company.company_profiles?.[0]?.website_url || '').trim();
  if (profileWebsite) return profileWebsite;

  const domain = String(company.website_domain || '').trim();
  return domain ? `https://${domain}` : '';
}

export function resolveOmnivyraCompanyName(company: OmnivyraWebsiteCompanyRecord): string {
  return (
    String(company.name || '').trim() ||
    String(company.company_profiles?.[0]?.name || '').trim() ||
    resolveOmnivyraWebsiteUrl(company) ||
    'Omnivyra'
  );
}

function isCanonicalOmnivyraName(value: string | null | undefined): boolean {
  return String(value || '').trim().toLowerCase() === 'omnivyra';
}

function scoreOmnivyraWebsiteCompany(company: OmnivyraWebsiteCompanyRecord): number {
  let score = 0;
  if (isCanonicalOmnivyraName(company.name)) score += 100;
  if (isCanonicalOmnivyraName(company.company_profiles?.[0]?.name)) score += 50;
  if (normalizeWebsiteDomain(company.website_domain) === 'omnivyra.com') score += 10;
  if (normalizeWebsiteDomain(company.website) === 'omnivyra.com') score += 5;
  if (normalizeWebsiteDomain(company.company_profiles?.[0]?.website_url) === 'omnivyra.com') score += 5;
  return score;
}

/**
 * Which claimant is the platform's own Omnivyra company. A website domain or a name is something
 * ANY tenant can type, so neither may decide it — that let a new tenant claiming omnivyra.com
 * receive Omnivyra's platform Search Console data and capture the Super Admin GSC binding.
 * Ownership signals decide instead, in order:
 *   1. OMNIVYRA_WEBSITE_COMPANY_ID, when set (explicit pin; must be an active claimant);
 *   2. a company with an active SUPER_ADMIN member (a tenant cannot grant itself that role);
 *   3. the OLDEST claimant (a later sign-up can never outrank the original);
 *   then the name score, only as a final tie-break.
 */
export function rankOmnivyraClaimants<T extends OmnivyraWebsiteCompanyRecord & { created_at?: string | null }>(
  candidates: T[], superAdminCompanyIds: ReadonlySet<string>, pinnedId: string | null,
): T | null {
  if (pinnedId) return candidates.find((c) => c.id === pinnedId) ?? null;
  const t = (c: T) => (c.created_at ? Date.parse(c.created_at) : Number.MAX_SAFE_INTEGER);
  return [...candidates].sort((a, b) =>
    Number(superAdminCompanyIds.has(b.id)) - Number(superAdminCompanyIds.has(a.id))
    || t(a) - t(b)
    || scoreOmnivyraWebsiteCompany(b) - scoreOmnivyraWebsiteCompany(a))[0] ?? null;
}

export async function resolveOmnivyraWebsiteCompany(): Promise<OmnivyraWebsiteCompanyRecord | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, website, website_domain, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`FAILED_TO_LOAD_COMPANIES: ${error.message}`);
  }

  const companies = (data ?? []) as OmnivyraWebsiteCompanyRecord[];
  if (companies.length === 0) return null;

  const companyIds = companies.map((company) => company.id).filter(Boolean);
  const { data: profileRows, error: profilesError } = await supabase
    .from('company_profiles')
    .select('company_id, website_url, name')
    .in('company_id', companyIds);

  if (profilesError) {
    throw new Error(`FAILED_TO_LOAD_COMPANY_PROFILES: ${profilesError.message}`);
  }

  const profilesByCompanyId = new Map<string, Array<{ website_url: string | null; name: string | null }>>();
  for (const row of (profileRows ?? []) as Array<{ company_id: string; website_url: string | null; name: string | null }>) {
    const existing = profilesByCompanyId.get(row.company_id) ?? [];
    existing.push({ website_url: row.website_url, name: row.name });
    profilesByCompanyId.set(row.company_id, existing);
  }

  const enrichedCompanies = companies.map((company) => ({
    ...company,
    company_profiles: profilesByCompanyId.get(company.id) ?? [],
  }));

  // Claimants: active companies whose website names omnivyra.com. Any tenant can type that, so a
  // claim alone never decides — rankOmnivyraClaimants picks by ownership signals.
  const candidates = enrichedCompanies.filter(
    (company) =>
      company.status === 'active' &&
      (
        isOmnivyraWebsiteDomain(company.website_domain) ||
        isOmnivyraWebsiteDomain(company.website) ||
        isOmnivyraWebsiteDomain(company.company_profiles?.[0]?.website_url)
      ),
  );

  if (candidates.length === 0) return null;
  const pinned = process.env.OMNIVYRA_WEBSITE_COMPANY_ID?.trim() || null;
  let superAdminCompanyIds = new Set<string>();
  if (!pinned) {
    const { data: roles } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('role', 'SUPER_ADMIN')
      .eq('status', 'active')
      .in('company_id', candidates.map((c) => c.id));
    superAdminCompanyIds = new Set(((roles ?? []) as Array<{ company_id: string }>).map((r) => r.company_id));
  }
  return rankOmnivyraClaimants(candidates as Array<OmnivyraWebsiteCompanyRecord & { created_at?: string | null }>, superAdminCompanyIds, pinned);
}
