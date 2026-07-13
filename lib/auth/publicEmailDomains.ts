/**
 * publicEmailDomains.ts — SINGLE SOURCE OF TRUTH for the public/free/personal
 * email-provider blocklist (AUTH-001, Section 5).
 *
 * Before AUTH-001 this list existed three times with divergent contents:
 *   - lib/auth/domainValidation.ts        (client pre-check, 19 domains)
 *   - lib/auth/serverValidation.ts        (server gate, same 19)
 *   - backend/services/companyMatchService.ts (different 22-domain list)
 * plus a fourth in lib/leadIntelligence/companyIntelligence.ts. All four now
 * import from here. The canonical set is the UNION of all prior lists plus
 * the providers the audit found missing everywhere (rediff).
 *
 * Extension layers (checked in this order by callers):
 *   1. This static set (code — ships with the build, works client + server).
 *   2. Env extension — PUBLIC_EMAIL_EXTRA_DOMAINS / NEXT_PUBLIC_EMAIL_EXTRA_DOMAINS,
 *      comma-separated. Read at call time so runtime config changes apply on
 *      the next request without a rebuild.
 *   3. DB extension — the `public_email_providers` and `disposable_domains`
 *      tables, consulted by backend/services/domainEligibilityService.ts.
 *      (Server-only; unchanged by AUTH-001.)
 *
 * This module is imported by client code — keep it dependency-free.
 */

export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca',
  // Microsoft
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Proton
  'protonmail.com', 'protonmail.ch', 'proton.me',
  // Others (union of the pre-consolidation lists)
  'aol.com', 'mail.com', 'yandex.com', '163.com', 'qq.com', 'foxmail.com',
  '1and1.com', 'btinternet.com', 'gmx.com', 'gmx.net', 'mail.ru',
  'tutanota.com', 'mailbox.org', 'zoho.com',
  // Missing from every prior list (audit finding)
  'rediff.com', 'rediffmail.com',
]);

/** Friendly provider names for contextual error copy. */
export const PUBLIC_EMAIL_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  'gmail.com': 'Gmail',
  'googlemail.com': 'Gmail',
  'yahoo.com': 'Yahoo',
  'hotmail.com': 'Hotmail',
  'outlook.com': 'Outlook',
  'live.com': 'Outlook',
  'msn.com': 'MSN',
  'aol.com': 'AOL',
  'icloud.com': 'iCloud',
  'me.com': 'iCloud',
  'mac.com': 'iCloud',
  'protonmail.com': 'ProtonMail',
  'protonmail.ch': 'ProtonMail',
  'proton.me': 'Proton',
  'yandex.com': 'Yandex',
  'zoho.com': 'Zoho',
  'rediff.com': 'Rediffmail',
  'rediffmail.com': 'Rediffmail',
};

/**
 * Env-var extension: comma-separated extra domains. Server routes read
 * PUBLIC_EMAIL_EXTRA_DOMAINS; client bundles can only see the NEXT_PUBLIC_
 * variant (inlined at build time). Both are honored; invalid entries are
 * ignored. Never throws.
 */
export function getConfiguredExtraPublicEmailDomains(): ReadonlySet<string> {
  const raw = [
    typeof process !== 'undefined' ? process.env?.PUBLIC_EMAIL_EXTRA_DOMAINS : undefined,
    typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_EMAIL_EXTRA_DOMAINS : undefined,
  ]
    .filter(Boolean)
    .join(',');
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const d = part.trim().toLowerCase();
    if (d && d.includes('.')) out.add(d);
  }
  return out;
}

/**
 * True when `domain` is a known public/free/personal email provider —
 * static set OR env extension. Callers needing the DB extension layer go
 * through domainEligibilityService (server only).
 */
export function isPublicEmailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return true;
  return getConfiguredExtraPublicEmailDomains().has(d);
}
