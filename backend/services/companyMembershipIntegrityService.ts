import { extractDomain, isFreeEmailDomain } from './companyMatchService';

export type CompanyMembershipCompany = {
  website_domain?: string | null;
  admin_email_domain?: string | null;
};

export type CompanyMembershipRoleRow = {
  company_id?: string | null;
  join_source?: string | null;
};

export const SELF_REGISTERED_JOIN_SOURCE = 'self_joined';

export function isSelfRegisteredJoinSource(joinSource?: string | null): boolean {
  const normalized = String(joinSource || '').trim().toLowerCase();
  return normalized === 'self_joined' || normalized === 'self_registered';
}

export function companyMembershipMatchesWorkEmail(params: {
  company?: CompanyMembershipCompany | null;
  joinSource?: string | null;
  userEmail?: string | null;
}): boolean {
  if (!isSelfRegisteredJoinSource(params.joinSource)) return true;

  const emailDomain = extractDomain(params.userEmail ?? '');
  if (!emailDomain || isFreeEmailDomain(emailDomain)) return true;

  const companyDomains = [
    params.company?.website_domain,
    params.company?.admin_email_domain,
  ]
    .map((domain) => String(domain || '').trim().toLowerCase())
    .filter(Boolean);

  return companyDomains.length === 0 || companyDomains.includes(emailDomain.toLowerCase());
}

export function filterCompatibleCompanyRoleRows<T extends CompanyMembershipRoleRow>(params: {
  rows: T[];
  companyById: Map<string, CompanyMembershipCompany>;
  userEmail?: string | null;
}): T[] {
  return params.rows.filter((row) =>
    companyMembershipMatchesWorkEmail({
      company: row.company_id ? params.companyById.get(String(row.company_id)) : null,
      joinSource: row.join_source,
      userEmail: params.userEmail,
    }),
  );
}

export function selectCompatibleCompanyRole<T extends CompanyMembershipRoleRow>(params: {
  rows: T[];
  companyById: Map<string, CompanyMembershipCompany>;
  userEmail?: string | null;
}): T | null {
  return filterCompatibleCompanyRoleRows(params)[0] ?? null;
}
