/**
 * Server-side auth validation helpers.
 *
 * These run in Next.js API routes only — never imported by client code.
 * They use the Firebase Admin SDK for authoritative token verification.
 */

import { verifyFirebaseIdToken } from '../firebaseAdmin';
import type { DecodedIdToken } from 'firebase-admin/auth';

// ── Domain blocklist (mirrors client-side domainValidation.ts) ────────────────
// Kept in sync manually; the server-side check is the authoritative one.
const BLOCKED_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'mail.com',
  'yandex.com',
  '163.com',
  'qq.com',
  'foxmail.com',
  '1and1.com',
  'btinternet.com',
  'gmx.com',
  'mail.ru',
  'tutanota.com',
  'protonmail.ch',
  'mailbox.org',
]);

// ── Domain validation ─────────────────────────────────────────────────────────

/**
 * Validates that the email domain is not a known personal/consumer domain.
 * Throws with a user-readable message if blocked.
 */
export function validateWorkEmail(email: string): void {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) throw new Error('Invalid email address.');
  if (BLOCKED_DOMAINS.has(domain)) {
    throw new Error(
      `${domain} is a personal email domain. Please use your work email address.`,
    );
  }
}

// ── Firebase token verification ───────────────────────────────────────────────

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Extracts and validates a Firebase Bearer token from an Authorization header.
 *
 * Accepts:  "Bearer <idToken>"
 * Returns:  The verified Firebase user identity.
 * Throws:   Descriptive string error on any failure.
 *
 * @param checkRevoked  When true, Firebase Admin performs an extra network call
 *   to verify the token has not been explicitly revoked via revokeRefreshTokens().
 *   Use on high-security endpoints (session probe, deletion flows).
 *   Default false for performance — the is_deleted DB check provides defence-in-depth.
 */
export async function verifyAuthHeader(
  authHeader: string | undefined,
  checkRevoked = false,
): Promise<VerifiedFirebaseUser> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header.');
  }
  const idToken = authHeader.slice(7);
  return verifyToken(idToken, checkRevoked);
}

/**
 * Verifies a raw Firebase ID token string.
 * Returns the verified user identity; throws on failure.
 *
 * @param checkRevoked  See verifyAuthHeader above.
 */
export async function verifyToken(idToken: string, checkRevoked = false): Promise<VerifiedFirebaseUser> {
  let decoded: DecodedIdToken;
  try {
    decoded = await verifyFirebaseIdToken(idToken, checkRevoked);
  } catch (err: any) {
    // Translate Firebase Admin error codes into readable messages
    const code: string = err?.errorInfo?.code ?? err?.code ?? '';
    if (code === 'auth/id-token-expired') throw new Error('Firebase token has expired.');
    if (code === 'auth/id-token-revoked') throw new Error('Firebase token has been revoked.');
    if (code === 'auth/argument-error')   throw new Error('Invalid Firebase token format.');
    throw new Error('Firebase token verification failed.');
  }

  const email = decoded.email;
  if (!email) throw new Error('Firebase token does not contain an email address.');

  return {
    uid: decoded.uid,
    email,
    emailVerified: decoded.email_verified ?? false,
  };
}
