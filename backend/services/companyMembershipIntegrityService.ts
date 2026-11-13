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

/**
 * Every stored spelling of a self-joined membership. 'self_joined' is what current code writes; 'self_registered' is a
 * legacy spelling still present on live rows (C99, 2026-11-13: 5 rows) until the owner-approved rename lands. Every
 * reader that selects self-joined members uses THIS list, so the governance check and the admin screens can never
 * disagree about who is self-joined (e9 ruling 2026-11-13, BLOCKING: the 5 legacy rows were governed but invisible).
 */
export const SELF_JOINED_JOIN_SOURCE_SPELLINGS = ['self_joined', 'self_registered'] as const;

export function isSelfRegisteredJoinSource(joinSource?: string | null): boolean {
  const normalized = String(joinSource || '').trim().toLowerCase();
  return (SELF_JOINED_JOIN_SOURCE_SPELLINGS as readonly string[]).includes(normalized);
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
