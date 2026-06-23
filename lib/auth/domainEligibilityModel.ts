/**
 * domainEligibilityModel.ts — SINGLE SOURCE OF TRUTH for domain-eligibility
 * result codes and user-facing copy.
 *
 * Detection logic lives elsewhere and is unchanged:
 *   - email stage:     backend/services/domainEligibilityService.ts
 *   - canonical stage: backend/services/domainCanonicalService.ts (via setup-company)
 *
 * Those modules CLASSIFY into the codes below; this file owns the vocabulary,
 * the messages, and the HTTP mapping. No other file may define eligibility
 * result codes or hardcode eligibility copy.
 */

export type DomainEligibilityResult =
  | 'DOMAIN_ELIGIBLE'
  | 'PUBLIC_EMAIL'
  | 'DISPOSABLE_EMAIL'
  | 'NO_EMAIL_CAPABILITY'
  | 'NO_WEBSITE_FOUND'
  | 'DOMAIN_MISMATCH'
  | 'FORWARDING_DOMAIN'
  | 'DOMAIN_NOT_CANONICAL'
  | 'CLAIMED_DOMAIN'
  | 'BLOCKED';

/** Results that allow onboarding to proceed. */
export const eligibleResults: ReadonlySet<DomainEligibilityResult> = new Set<DomainEligibilityResult>([
  'DOMAIN_ELIGIBLE',
]);

/**
 * Results that route to the super-admin / contact-review path rather than a flat
 * "ineligible" — used by signup (review copy) and the access-request workflow
 * (these users may still submit a review request). FORWARDING_DOMAIN and
 * DOMAIN_NOT_CANONICAL are kept DISTINCT (operational analytics) even though they
 * share one user-facing message.
 */
export const reviewableResults: ReadonlySet<DomainEligibilityResult> = new Set<DomainEligibilityResult>([
  'PUBLIC_EMAIL',
  'FORWARDING_DOMAIN',
  'DOMAIN_NOT_CANONICAL',
  'NO_WEBSITE_FOUND',
]);

// Forwarding + non-canonical share this review-path copy by design.
const REVIEW_MESSAGE =
  "We couldn't automatically verify this domain as your organization's primary website domain.\n\n" +
  'If your organization uses a different website domain than its email domain, please contact our team ' +
  'and briefly explain how you plan to use Omnivyra.\n\n' +
  "We'll review your request and reach out if Omnivyra is a suitable fit.";

/** The ONLY canonical user-facing copy for each result. */
export const ELIGIBILITY_MESSAGES: Record<DomainEligibilityResult, string> = {
  DOMAIN_ELIGIBLE: '',
  PUBLIC_EMAIL:
    'Omnivyra requires a company email address.\n\n' +
    'If your organization does not use a company domain, please contact our team for review.',
  DISPOSABLE_EMAIL:
    'This email uses a disposable address. Please sign up with your organization’s work email address.',
  NO_EMAIL_CAPABILITY:
    'This domain cannot currently receive email.\n\n' +
    'Please use an active work email address associated with your organization.',
  NO_WEBSITE_FOUND:
    "We couldn't find a live website at your organization's email domain.\n\n" +
    'If your organization uses a different website domain than its email domain, ' +
    'please contact our team and we will review your request.',
  DOMAIN_MISMATCH:
    'Your website domain does not match your email domain.\n\n' +
    "Please use a website on your organization's email domain.",
  FORWARDING_DOMAIN: REVIEW_MESSAGE,
  DOMAIN_NOT_CANONICAL: REVIEW_MESSAGE,
  CLAIMED_DOMAIN:
    'An account for your organization already exists. Please contact your administrator to request access.',
  BLOCKED:
    'This email domain is not eligible. Please use a valid work email associated with your organization.',
};

export function messageFor(result: DomainEligibilityResult): string {
  return ELIGIBILITY_MESSAGES[result];
}

/** HTTP status a route should return for a given result. */
export function httpStatusFor(result: DomainEligibilityResult): number {
  if (eligibleResults.has(result)) return 200;
  if (result === 'CLAIMED_DOMAIN') return 409;
  return 400;
}
