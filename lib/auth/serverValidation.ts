/**
 * Server-side auth validation helpers.
 * These run in Next.js API routes only — never imported by client code.
 *
 * Canonical auth-resolver entry points live in
 * backend/services/authResolver — use those (resolveAuthenticatedUser
 * for routes that require a public.users row; extractAccessToken +
 * validateAuthToken for routes that create the row).
 *
 * This file is now scoped to the work-email blocklist. The previous
 * Bearer-only `verifySupabaseAuthHeader` validator was deleted during
 * the Phase 3 auth-standardization pass.
 */

// ── Domain blocklist ──────────────────────────────────────────────────────────
// Canonical list lives in lib/auth/publicEmailDomains.ts (AUTH-001 Section 5) —
// shared with the client pre-check and companyMatchService so the personal
// blocklist truly has a single definition. Supports env extension via
// PUBLIC_EMAIL_EXTRA_DOMAINS; DB extension (public_email_providers /
// disposable_domains tables) is layered on by domainEligibilityService.
import { isPublicEmailDomain } from './publicEmailDomains';

/**
 * True if the domain is a known personal/consumer email provider. Shared with
 * the domain-eligibility engine (classified as PUBLIC_EMAIL there) so the personal
 * blocklist has a single definition.
 */
export function isPersonalEmailDomain(domain: string): boolean {
  return isPublicEmailDomain(domain);
}

export function validateWorkEmail(email: string): void {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) throw new Error('Invalid email address.');
  if (isPersonalEmailDomain(domain)) {
    throw new Error(`${domain} is a personal email domain. Please use your work email address.`);
  }
}
