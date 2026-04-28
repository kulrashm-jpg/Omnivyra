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

export async function resolveOmnivyraWebsiteCompany(): Promise<OmnivyraWebsiteCompanyRecord | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, website, website_domain, status')
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

  return (
    enrichedCompanies.find(
      (company) =>
        company.status === 'active' &&
        (
          isOmnivyraWebsiteDomain(company.website_domain) ||
          isOmnivyraWebsiteDomain(company.website) ||
          isOmnivyraWebsiteDomain(company.company_profiles?.[0]?.website_url) ||
          String(company.name || '').toLowerCase().includes('omnivyra')
        ),
    ) ?? null
  );
}
