/**
 * Server-side auth validation helpers.
 * These run in Next.js API routes only — never imported by client code.
 *
 * verifySupabaseAuthHeader is the Bearer-only token validator used by call
 * sites that need auth identity BEFORE a public.users row may exist (e.g.,
 * /api/auth/sync-supabase-user). It delegates to the canonical resolver
 * (backend/services/authResolver) for the actual Supabase token check —
 * NO duplicate auth.getUser call lives here.
 */

import { validateAuthToken } from '../../backend/services/authResolver';

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

export interface VerifiedSupabaseUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Bearer-only token validation. Returns auth.users.id + email + emailVerified.
 * Throws on any failure (legacy contract). For request-level auth resolution
 * with cookie support, soft-delete enforcement and supabase_uid backfill,
 * use {@link resolveAuthenticatedUser} from backend/services/authResolver.
 */
export async function verifySupabaseAuthHeader(
  authHeader: string | undefined,
): Promise<VerifiedSupabaseUser> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header.');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error('Missing or malformed Authorization header.');

  const identity = await validateAuthToken(token);
  if (!identity) throw new Error('Invalid or expired session.');
  if (!identity.email) throw new Error('No email associated with this account.');

  return {
    id:            identity.supabaseUid,
    email:         identity.email,
    emailVerified: identity.emailVerified,
  };
}

