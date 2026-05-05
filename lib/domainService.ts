import { runWithServiceRole } from '@/backend/db/supabaseClient';

export const normalizeDomain = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  return withoutProtocol.split('/')[0]?.replace(/^www\./, '') ?? '';
};

export type DomainResolution =
  | { action: 'attach'; organization_id: string }
  | { action: 'blocked'; reason: 'DOMAIN_NOT_VERIFIED'; organization_id: string }
  | { action: 'create'; domain: string };

export async function resolveDomainOrganization(domainInput: string): Promise<DomainResolution> {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new Error('domain required');

  const { data, error } = await runWithServiceRole(
    'Resolve organization by verified domain',
    (client) => client
      .from('company_domains')
      .select('organization_id, company_id, verification_status')
      .eq('final_domain', domain)
      .maybeSingle(),
  );

  if (error) throw new Error(error.message);
  if (!data) return { action: 'create', domain };

  const organization_id = String((data as any).organization_id || (data as any).company_id);
  if (String((data as any).verification_status) !== 'verified') {
    return { action: 'blocked', reason: 'DOMAIN_NOT_VERIFIED', organization_id };
  }

  return { action: 'attach', organization_id };
}
