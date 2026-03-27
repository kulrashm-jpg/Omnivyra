/**
 * Server-side auth validation helpers.
 * These run in Next.js API routes only — never imported by client code.
 */

import { supabase as supabaseAdmin } from '../../backend/db/supabaseClient';

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

export async function verifySupabaseAuthHeader(
  authHeader: string | undefined,
): Promise<VerifiedSupabaseUser> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header.');
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired session.');
  if (!user.email) throw new Error('No email associated with this account.');
  return {
    id:            user.id,
    email:         user.email,
    emailVerified: !!user.email_confirmed_at,
  };
}

// Legacy alias — kept so callers migrating from Firebase still compile
export const verifyAuthHeader = async (authHeader: string | undefined) => {
  const u = await verifySupabaseAuthHeader(authHeader);
  return { uid: u.id, email: u.email, emailVerified: u.emailVerified };
};
