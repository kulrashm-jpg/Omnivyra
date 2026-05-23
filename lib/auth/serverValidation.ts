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
const BLOCKED_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'protonmail.com', 'mail.com', 'yandex.com', '163.com',
  'qq.com', 'foxmail.com', '1and1.com', 'btinternet.com', 'gmx.com',
  'mail.ru', 'tutanota.com', 'protonmail.ch', 'mailbox.org',
]);

export function validateWorkEmail(email: string): void {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) throw new Error('Invalid email address.');
  if (BLOCKED_DOMAINS.has(domain)) {
    throw new Error(`${domain} is a personal email domain. Please use your work email address.`);
  }
}
