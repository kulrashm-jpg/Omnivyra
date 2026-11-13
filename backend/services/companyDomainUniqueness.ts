/**
 * The companies domain-uniqueness rules (20270217000050) and how a 23505 from them is recognised (e1 2026-11-13).
 *
 * companies carries SEVERAL unique rules (primary key, these two partial domain indexes, and others), so a bare 23505
 * is ambiguous: it is classified by the CONSTRAINT / INDEX NAME (PostgREST puts it in message / details), never by the
 * SQLSTATE alone (05). Only a 23505 naming one of these two indexes means "another company holds this domain".
 */
export const WEBSITE_DOMAIN_UNIQUE_INDEX = 'idx_companies_website_domain_unique';
export const ADMIN_EMAIL_DOMAIN_UNIQUE_INDEX = 'idx_companies_admin_email_domain_unique';

export type CompanyDomainConflict = 'website_domain' | 'admin_email_domain';

/** Which domain rule a database error violated, or null when it is not one of ours (incl. any other 23505). */
export function classifyCompanyDomainConflict(err: unknown): CompanyDomainConflict | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown };
  if (e.code !== '23505') return null;
  const text = `${String(e.message ?? '')} ${String(e.details ?? '')} ${String(e.constraint ?? '')}`;
  if (text.includes(WEBSITE_DOMAIN_UNIQUE_INDEX)) return 'website_domain';
  if (text.includes(ADMIN_EMAIL_DOMAIN_UNIQUE_INDEX)) return 'admin_email_domain';
  return null;
}
