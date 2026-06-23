/**
 * companyIdentityDriftService.ts
 *
 * TELEMETRY-ONLY integrity monitor for company identity drift. Detects when
 * admin_email_domain / website_domain / website become inconsistent (over time,
 * via imports, manual edits, migrations, or bugs).
 *
 * This NEVER blocks, NEVER auto-corrects, NEVER mutates data. It only detects
 * and emits a structured COMPANY_IDENTITY_DRIFT_WARNING telemetry event.
 *
 * Canonical identity rule: normalizeCompanyDomain(admin_email_domain) ===
 * normalizeCompanyDomain(website_domain). Normalization reuses the SINGLE
 * source of truth — lib/shared/domain/companyDomain.normalizeCompanyDomain.
 */

import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';
import { logger } from './logger';

export type CompanyIdentityInput = {
  id?: string | null;
  company_id?: string | null;
  name?: string | null;
  admin_email_domain?: string | null;
  website_domain?: string | null;
  website?: string | null;
};

export type CompanyIdentityDriftReason =
  | 'MISSING_ADMIN_EMAIL_DOMAIN'
  | 'MISSING_WEBSITE_DOMAIN'
  | 'MISSING_WEBSITE'
  | 'DOMAIN_MISMATCH'
  | 'INVALID_WEBSITE_DOMAIN'
  | 'INVALID_WEBSITE_FORMAT';

export type CompanyIdentityDriftResult = {
  hasDrift: boolean;
  companyId: string;
  companyName: string;
  adminEmailDomain: string | null;
  websiteDomain: string | null;
  website: string | null;
  driftReasons: CompanyIdentityDriftReason[];
};

export const COMPANY_IDENTITY_DRIFT_EVENT = 'COMPANY_IDENTITY_DRIFT_WARNING';

const nonEmpty = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v.trim());

/**
 * Pure drift evaluation. No I/O, no side effects. Reuses the canonical
 * normalizer; does NOT define its own.
 */
export function checkCompanyIdentityDrift(company: CompanyIdentityInput): CompanyIdentityDriftResult {
  const companyId = String(company.id ?? company.company_id ?? '');
  const companyName = String(company.name ?? '');
  const adminEmailDomain = nonEmpty(company.admin_email_domain) ? company.admin_email_domain.trim() : null;
  const websiteDomain = nonEmpty(company.website_domain) ? company.website_domain.trim() : null;
  const website = nonEmpty(company.website) ? company.website.trim() : null;

  const reasons: CompanyIdentityDriftReason[] = [];

  if (!adminEmailDomain) reasons.push('MISSING_ADMIN_EMAIL_DOMAIN');
  if (!websiteDomain) reasons.push('MISSING_WEBSITE_DOMAIN');
  if (!website || isUuid(website)) reasons.push('MISSING_WEBSITE');

  const normAdmin = adminEmailDomain ? normalizeCompanyDomain(adminEmailDomain) : '';
  const normWebsiteDomain = websiteDomain ? normalizeCompanyDomain(websiteDomain) : '';

  // website_domain present but not a parseable domain.
  if (websiteDomain && normWebsiteDomain === '') reasons.push('INVALID_WEBSITE_DOMAIN');

  // website present (and not a UUID placeholder) but no domain can be extracted.
  if (website && !isUuid(website) && normalizeCompanyDomain(website) === '') reasons.push('INVALID_WEBSITE_FORMAT');

  // Canonical rule: admin email domain must equal website domain when both exist.
  if (normAdmin && normWebsiteDomain && normAdmin !== normWebsiteDomain) reasons.push('DOMAIN_MISMATCH');

  return {
    hasDrift: reasons.length > 0,
    companyId,
    companyName,
    adminEmailDomain,
    websiteDomain,
    website,
    driftReasons: reasons,
  };
}

/**
 * Emit the structured drift-warning telemetry event (only when drift exists).
 * Telemetry must never throw — all errors are swallowed.
 */
export function emitCompanyIdentityDriftWarning(result: CompanyIdentityDriftResult): void {
  if (!result.hasDrift) return;
  try {
    logger.warn(COMPANY_IDENTITY_DRIFT_EVENT, {
      companyId: result.companyId,
      companyName: result.companyName,
      adminEmailDomain: result.adminEmailDomain,
      websiteDomain: result.websiteDomain,
      website: result.website,
      driftReasons: result.driftReasons,
      detectedAt: new Date().toISOString(),
    });
  } catch {
    /* telemetry must never throw */
  }
}

/**
 * Check + emit in one fire-and-forget call. NEVER throws — safe to drop into any
 * company create/update path without risking the request. Returns the result for
 * callers that want it, or null if evaluation itself failed.
 */
export function monitorCompanyIdentityDrift(company: CompanyIdentityInput): CompanyIdentityDriftResult | null {
  try {
    const result = checkCompanyIdentityDrift(company);
    emitCompanyIdentityDriftWarning(result);
    return result;
  } catch {
    return null;
  }
}
