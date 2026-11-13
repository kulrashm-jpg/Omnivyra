/**
 * companyIdentityWriter.ts
 *
 * THE single canonical write layer for company identity fields
 * (`companies.website`, `companies.website_domain`, `companies.admin_email_domain`).
 *
 * Purpose (Phase 11A): centralize + govern identity writes so every future write
 * flows through one implementation that guarantees internal consistency. This
 * phase adds the layer ONLY — no caller is migrated, no runtime behavior changes.
 *
 * It does NOT make business-rule or validation-policy decisions (no domain
 * ownership / claimed-domain / live-website checks). It only enforces structural
 * consistency of the three columns and normalizes the domain values.
 *
 * Invariants enforced:
 *   A. website IS NULL  ⇔  website_domain IS NULL
 *   B. website populated ⇒ website_domain populated
 *   C. website_domain is normalized (registrable domain, www-stripped)
 *   D. no partial identity writes (the website⇔website_domain pair is atomic)
 *
 * Normalization reuses the SINGLE source of truth:
 * lib/shared/domain/companyDomain.normalizeCompanyDomain.
 */

import { supabase } from '../db/supabaseClient';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';
import { reportCanonicalDomainViolation } from './companyDomainUniqueness';
import { logger } from './logger';

export class CompanyIdentityInvariantError extends Error {
  readonly code = 'COMPANY_IDENTITY_INVARIANT_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'CompanyIdentityInvariantError';
  }
}

/** Caller-facing input (camelCase). Any field omitted is treated as null. */
export interface CompanyIdentityInput {
  website?: string | null;
  websiteDomain?: string | null;
  adminEmailDomain?: string | null;
}

/** The governed DB columns (snake_case) ready to write. */
export interface CompanyIdentityColumns {
  website: string | null;
  website_domain: string | null;
  admin_email_domain: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Normalize + enforce the identity invariants, returning the exact columns to
 * write. Throws CompanyIdentityInvariantError on any inconsistency. Pure — no I/O.
 */
export function prepareCompanyIdentityWrite(input: CompanyIdentityInput): CompanyIdentityColumns {
  const website = clean(input.website);
  const rawDomain = clean(input.websiteDomain);
  const rawAdmin = clean(input.adminEmailDomain);

  // Invariant C — normalize the domain values.
  const website_domain = rawDomain ? normalizeCompanyDomain(rawDomain) || null : null;
  const admin_email_domain = rawAdmin ? normalizeCompanyDomain(rawAdmin) || null : null;

  if (rawDomain && !website_domain) {
    throw new CompanyIdentityInvariantError(
      `website_domain "${rawDomain}" does not normalize to a valid domain (Invariant C)`,
    );
  }

  // Invariants A, B, D — website and website_domain must be both-set or both-null.
  const hasWebsite = website !== null;
  const hasDomain = website_domain !== null;
  if (hasWebsite && !hasDomain) {
    throw new CompanyIdentityInvariantError(
      'website is set but website_domain is missing — partial identity write (Invariants B/D)',
    );
  }
  if (!hasWebsite && hasDomain) {
    throw new CompanyIdentityInvariantError(
      'website_domain is set but website is missing — partial identity write (Invariants A/D)',
    );
  }

  return { website, website_domain, admin_email_domain };
}

// ── DB seams (injectable for tests) ─────────────────────────────────────────
export interface CompanyIdentityWriterDeps {
  insertCompany?: (record: Record<string, unknown>) => Promise<{ id: string }>;
  updateCompany?: (companyId: string, patch: Record<string, unknown>) => Promise<void>;
  /** Names the calling writer in the canonical-domain violation log (e.g. 'onboarding/setup-company'). */
  writer?: string;
}

/** Re-throw a PostgREST error WITH its code and details (the canonical-domain reporter and 23505 classification need them). */
function toThrowable(error: { message?: string; code?: string; details?: string }, fallback: string): Error {
  const e = new Error(error.message ?? fallback) as Error & { code?: string; details?: string };
  e.code = error.code;
  e.details = error.details;
  return e;
}

/**
 * 05 (2026-11-13 follow-up): the canonical-domain CHECK violation is reported INSIDE the governed writer, so every
 * caller - including a future one - inherits it structurally instead of by enumeration of call sites.
 */
async function reportingCanonicalViolation<T>(writer: string | undefined, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    reportCanonicalDomainViolation(err, writer ?? 'companyIdentityWriter', logger);
    throw err;
  }
}

const defaultInsertCompany = async (record: Record<string, unknown>): Promise<{ id: string }> => {
  const { data, error } = await supabase.from('companies').insert(record).select('id').single();
  if (error) throw toThrowable(error, 'company insert failed');
  if (!data) throw new Error('company insert failed');
  return { id: (data as { id: string }).id };
};

const defaultUpdateCompany = async (companyId: string, patch: Record<string, unknown>): Promise<void> => {
  const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
  if (error) throw toThrowable(error, 'company update failed');
};

/**
 * Create a company with governed identity columns. `record` carries the rest of
 * the new-company row (name, status, …); the three identity columns it may
 * contain are stripped and replaced with the validated, normalized values.
 */
export async function createCompanyIdentity(
  record: Record<string, unknown> & CompanyIdentityInput,
  deps: CompanyIdentityWriterDeps = {},
): Promise<{ id: string }> {
  const identity = prepareCompanyIdentityWrite(record);
  const insert = deps.insertCompany ?? defaultInsertCompany;
  // Strip the camelCase identity inputs so they don't leak as bogus columns.
  const { website, websiteDomain, adminEmailDomain, ...rest } = record;
  void website; void websiteDomain; void adminEmailDomain;
  return reportingCanonicalViolation(deps.writer, () => insert({ ...rest, ...identity }));
}

/**
 * Update the governed identity triple for an existing company. Writes all three
 * columns atomically (the website⇔website_domain pair can never be split).
 */
export async function updateCompanyIdentity(
  companyId: string,
  input: CompanyIdentityInput,
  deps: CompanyIdentityWriterDeps = {},
): Promise<void> {
  if (!companyId) throw new CompanyIdentityInvariantError('companyId is required for updateCompanyIdentity');
  const identity = prepareCompanyIdentityWrite(input);
  const update = deps.updateCompany ?? defaultUpdateCompany;
  // `CompanyIdentityColumns` is a closed snake_case column object — at runtime it
  // already IS a `Record<string, unknown>`; the cast only supplies the index
  // signature the update seam's parameter type requires. Routed via `unknown`
  // (the standard widening cast) so the stricter worker tsconfig accepts it. No
  // runtime change.
  await reportingCanonicalViolation(deps.writer, () => update(companyId, identity as unknown as Record<string, unknown>));
}
