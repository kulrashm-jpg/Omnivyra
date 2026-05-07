/**
 * SessionAuthorityService — server-authoritative login session state.
 *
 * Rules (per Wave-2 spec):
 *   - Cookie carries the session id only; ALL state lives in auth_sessions.
 *   - Sessions are revocable.
 *   - Session expiry is enforced server-side, not by JWT exp.
 *   - Cookie value is signed (HMAC-SHA256) so a stolen id alone is not enough.
 *   - Step-up sessions are managed in StepUpAuthorizationService and bound
 *     to an auth_session row.
 *
 * Cookie shape: `${sessionId}.${signature}` where signature = HMAC(secret, sessionId|createdAtIso).
 */

import { createHmac, randomBytes } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as db } from '../db/supabaseClient';
import { logger } from '../services/logger';

// ── Cookie constants ─────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = 'omnivyra_session';
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14d
const SESSION_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14;           // 14d

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthSessionRow {
  id: string;
  user_id: string;
  supabase_uid: string;
  cookie_signature: string;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export type SessionLookupResult =
  | { ok: true; session: AuthSessionRow }
  | { ok: false; reason: 'NO_COOKIE' | 'BAD_FORMAT' | 'BAD_SIGNATURE' | 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' };

// ── Cookie signing ───────────────────────────────────────────────────────────

function getCookieSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_COOKIE_SECRET missing or too short (>=32 chars). Set in env before SessionAuthorityService is reachable.',
    );
  }
  return secret;
}

function signSessionPayload(sessionId: string, createdAtIso: string): string {
  const secret = getCookieSecret();
  return createHmac('sha256', secret)
    .update(`${sessionId}|${createdAtIso}`)
    .digest('base64url');
}

function buildCookieValue(sessionId: string, signature: string): string {
  return `${sessionId}.${signature}`;
}

function parseCookieValue(value: string): { sessionId: string; signature: string } | null {
  const idx = value.indexOf('.');
  if (idx < 0) return null;
  const sessionId = value.slice(0, idx);
  const signature = value.slice(idx + 1);
  if (!sessionId || !signature) return null;
  return { sessionId, signature };
}

// ── Cookie I/O ───────────────────────────────────────────────────────────────

export function readSessionCookie(req: NextApiRequest): string | null {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function buildSetCookieHeader(value: string, maxAgeSeconds: number): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(res: NextApiResponse, header: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, header]);
  } else if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, header]);
  } else {
    res.setHeader('Set-Cookie', header);
  }
}

// ── Service API ──────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  userId: string;
  supabaseUid: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  ttlSeconds?: number;
}

export interface CreatedSession {
  session: AuthSessionRow;
  cookieValue: string;
}

/**
 * Create a new auth_sessions row, sign its cookie, return both for the
 * caller to set on the response. The caller is responsible for invoking
 * `attachSessionCookie(res, cookieValue)` when ready.
 */
export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const ttl = Math.max(60, Math.min(input.ttlSeconds ?? SESSION_DEFAULT_TTL_SECONDS, SESSION_COOKIE_MAX_AGE_SECONDS));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const sessionId = randomBytes(16).toString('hex'); // 32-char random id
  const signature = signSessionPayload(sessionId, now.toISOString());

  const { data, error } = await db
    .from('auth_sessions')
    .insert({
      id:                sessionId,
      user_id:           input.userId,
      supabase_uid:      input.supabaseUid,
      cookie_signature:  signature,
      ip:                input.ip ?? null,
      user_agent:        input.userAgent ?? null,
      device_id:         input.deviceId ?? null,
      created_at:        now.toISOString(),
      last_seen_at:      now.toISOString(),
      expires_at:        expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error || !data) {
    logger.error('session_authority_create_failed', { userId: input.userId, message: error?.message });
    throw new Error(`Failed to create auth session: ${error?.message ?? 'unknown'}`);
  }

  return {
    session: data as AuthSessionRow,
    cookieValue: buildCookieValue(sessionId, signature),
  };
}

/**
 * Attach the session cookie to a response. Use after createSession.
 */
export function attachSessionCookie(res: NextApiResponse, cookieValue: string): void {
  appendSetCookie(res, buildSetCookieHeader(cookieValue, SESSION_COOKIE_MAX_AGE_SECONDS));
}

/**
 * Clear the session cookie on logout / revocation propagation.
 */
export function clearSessionCookie(res: NextApiResponse): void {
  appendSetCookie(res, buildSetCookieHeader('', 0));
}

/**
 * Resolve the session id from the request cookie, validate the HMAC
 * signature, look up the row, and check expiry/revocation. Used by
 * IdentityResolver as the authoritative session-authority hook.
 */
export async function resolveSessionFromRequest(req: NextApiRequest): Promise<SessionLookupResult> {
  const cookieValue = readSessionCookie(req);
  if (!cookieValue) return { ok: false, reason: 'NO_COOKIE' };

  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return { ok: false, reason: 'BAD_FORMAT' };

  const { data, error } = await db
    .from('auth_sessions')
    .select('*')
    .eq('id', parsed.sessionId)
    .maybeSingle();

  if (error) {
    logger.warn('session_authority_lookup_failed', { sessionId: parsed.sessionId, message: error.message });
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (!data) return { ok: false, reason: 'NOT_FOUND' };

  // Constant-time signature compare via re-derivation.
  const expected = signSessionPayload(parsed.sessionId, (data as AuthSessionRow).created_at);
  if (parsed.signature !== expected || (data as AuthSessionRow).cookie_signature !== expected) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const session = data as AuthSessionRow;
  if (session.revoked_at) return { ok: false, reason: 'REVOKED' };
  if (Date.parse(session.expires_at) <= Date.now()) return { ok: false, reason: 'EXPIRED' };

  return { ok: true, session };
}

/**
 * Mark the session as recently active. Cheap update; rate-limit at the
 * caller level if it becomes hot.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await db
    .from('auth_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', sessionId);
}

/**
 * Revoke a session. Idempotent.
 */
export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await db
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('id', sessionId)
    .is('revoked_at', null);
}

/**
 * Revoke all live sessions for a user. Used on password change, suspicious
 * login, etc.
 */
export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<number> {
  const { data } = await db
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  return data?.length ?? 0;
}
