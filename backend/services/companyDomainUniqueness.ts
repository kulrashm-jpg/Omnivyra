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

/** 050's canonical-form CHECKs: a stored domain must already equal lower(btrim(value)). */
export const WEBSITE_DOMAIN_CANONICAL_CHECK = 'companies_website_domain_canonical';
export const ADMIN_EMAIL_DOMAIN_CANONICAL_CHECK = 'companies_admin_email_domain_canonical';

/**
 * A 23514 naming a canonical-domain CHECK is a PROGRAMMING error (05): a writer stored a non-normalised domain. The
 * CHECK is the positive control that a missed writer fails LOUDLY; this makes it legible - one distinct ERROR log
 * naming the constraint and the writer, enough to find the writer from one alert. The caller keeps its generic 500.
 * Returns true when it was such a violation (and logged it).
 */
export function reportCanonicalDomainViolation(err: unknown, writer: string, log: { error: (event: string, meta: Record<string, unknown>) => void }): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown };
  if (e.code !== '23514') return false;
  const text = `${String(e.message ?? '')} ${String(e.details ?? '')} ${String(e.constraint ?? '')}`;
  const constraint = text.includes(WEBSITE_DOMAIN_CANONICAL_CHECK) ? WEBSITE_DOMAIN_CANONICAL_CHECK
    : text.includes(ADMIN_EMAIL_DOMAIN_CANONICAL_CHECK) ? ADMIN_EMAIL_DOMAIN_CANONICAL_CHECK : null;
  if (!constraint) return false;
  log.error('company_domain_not_canonical_write', { writer, constraint, message: String(e.message ?? '') });
  return true;
}
