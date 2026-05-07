/**
 * resolveAuthenticatedUser — the canonical identity-spine auth resolver.
 *
 * Authority rules:
 *   - auth.users.id is the auth identity (returned as supabaseUid).
 *   - public.users.id is the application profile PK (returned as id).
 *   - users.supabase_uid mirrors auth.users.id; back-filled here on first
 *     encounter via email match (the only place backfill is allowed).
 *   - users.is_deleted is enforced — soft-deleted accounts cannot
 *     authenticate.
 *
 * Inputs accepted: Authorization: Bearer <token>  OR  Supabase auth cookie
 * (sb-*-auth-token / auth-token / supabase-auth, base64+JSON envelope).
 *
 * NO dev / JWT-claims fallback. If supabase.auth.getUser cannot validate
 * the token, the request fails closed.
 */

import type { NextApiRequest } from 'next';
import { supabase as db } from '../db/supabaseClient';
import { logger } from './logger';

// ── Public types ──────────────────────────────────────────────────────────────

export type AuthFailureCode =
  | 'NO_TOKEN'         // No Authorization Bearer header and no auth cookie
  | 'INVALID_TOKEN'    // Token rejected by supabase.auth.getUser
  | 'NO_EMAIL'         // Token valid but auth.users has no email
  | 'USER_NOT_FOUND'   // Token valid, but public.users has no row yet
  | 'ACCOUNT_DELETED'; // public.users.is_deleted === true

export interface AuthenticatedUser {
  /** public.users.id — application profile PK. */
  id: string;
  /** auth.users.id — Supabase auth identity. Mirrors users.supabase_uid. */
  supabaseUid: string;
  email: string;
  emailVerified: boolean;
}

export type ResolveAuthenticatedUserResult =
  | { user: AuthenticatedUser; error: null }
  | { user: null; error: AuthFailureCode };

// ── Token extraction ──────────────────────────────────────────────────────────

const COOKIE_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /sb-[a-z0-9]+-auth-token=([^;]+)/i,
  /auth-token=([^;]+)/i,
  /supabase-auth=([^;]+)/i,
];

/** Read `Authorization: Bearer <token>` if present. */
export function extractBearerToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return null;
}

/** Read the Supabase auth-session cookie envelope and unwrap the access_token. */
export function extractCookieToken(req: NextApiRequest): string | null {
  const cookies = req.headers.cookie || '';
  for (const pattern of COOKIE_TOKEN_PATTERNS) {
    const match = cookies.match(pattern);
    if (!match?.[1]) continue;

    try {
      let cookieValue = decodeURIComponent(match[1]);
      if (cookieValue.startsWith('base64-')) {
        cookieValue = cookieValue.slice(7);
      }

      if (cookieValue.startsWith('eyJ')) {
        try {
          cookieValue = Buffer.from(cookieValue, 'base64').toString('utf-8');
        } catch (error) {
          logger.warn('auth_resolver_cookie_base64_decode_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const parsed = JSON.parse(cookieValue);
      if (parsed?.access_token) {
        return parsed.access_token as string;
      }
    } catch (error) {
      logger.warn('auth_resolver_cookie_parse_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/** Bearer first, then cookie. Returns null if neither path produces a token. */
export function extractAccessToken(req: NextApiRequest): string | null {
  return extractBearerToken(req) ?? extractCookieToken(req);
}

// ── Token validation (Supabase) ───────────────────────────────────────────────

const SUPABASE_AUTH_TIMEOUT_MS = 5_000;

export interface ValidatedAuthIdentity {
  supabaseUid: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Validate a Supabase JWT against `supabase.auth.getUser`. Returns the auth
 * identity (auth.users.id + email + emailVerified) or null on any failure.
 *
 * Hard fails closed — there is no JWT-claims fallback.
 */
export async function validateAuthToken(token: string): Promise<ValidatedAuthIdentity | null> {
  return validateTokenWithSupabase(token);
}

async function validateTokenWithSupabase(token: string): Promise<ValidatedAuthIdentity | null> {
  let result: Awaited<ReturnType<typeof db.auth.getUser>>;
  try {
    result = await Promise.race([
      db.auth.getUser(token),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase auth timeout')), SUPABASE_AUTH_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    logger.warn('auth_resolver_supabase_lookup_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const authUser = result.data?.user;
  if (result.error || !authUser) {
    logger.warn('auth_resolver_token_invalid', {
      message: result.error?.message ?? 'unknown',
    });
    return null;
  }

  return {
    supabaseUid: authUser.id,
    email: authUser.email ?? null,
    emailVerified: !!authUser.email_confirmed_at,
  };
}

// ── DB resolution + backfill ──────────────────────────────────────────────────

interface ResolvedUserRow {
  id: string;
  email: string | null;
  is_deleted: boolean;
}

/**
 * Resolve public.users row by supabase_uid first, falling back to email
 * (with one-shot supabase_uid back-fill).
 *
 * Soft-deleted rows are returned with is_deleted=true so the caller can map
 * to ACCOUNT_DELETED — they are NOT silently treated as missing.
 */
async function resolveUserRow(
  supabaseUid: string,
  email: string | null,
): Promise<ResolvedUserRow | null> {
  const { data: byUid } = await db
    .from('users')
    .select('id, email, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (byUid) {
    return {
      id: (byUid as any).id,
      email: (byUid as any).email ?? null,
      is_deleted: !!(byUid as any).is_deleted,
    };
  }

  if (!email) return null;

  const { data: byEmail } = await db
    .from('users')
    .select('id, email, is_deleted')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!byEmail) return null;

  // Back-fill supabase_uid if the row was matched by email (one-shot).
  // Skipped for soft-deleted rows so the auth flow surfaces ACCOUNT_DELETED
  // before any state mutation.
  if (!(byEmail as any).is_deleted) {
    await db
      .from('users')
      .update({ supabase_uid: supabaseUid })
      .eq('id', (byEmail as any).id);
  }

  return {
    id: (byEmail as any).id,
    email: (byEmail as any).email ?? null,
    is_deleted: !!(byEmail as any).is_deleted,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * The canonical auth resolver. Every auth-protected request flows through
 * this function (directly or via the legacy facades in
 * backend/middleware/authMiddleware.ts, backend/services/supabaseAuthService.ts,
 * and lib/auth/serverValidation.ts).
 */
export async function resolveAuthenticatedUser(
  req: NextApiRequest,
): Promise<ResolveAuthenticatedUserResult> {
  const token = extractAccessToken(req);
  if (!token) return { user: null, error: 'NO_TOKEN' };

  const identity = await validateTokenWithSupabase(token);
  if (!identity) return { user: null, error: 'INVALID_TOKEN' };

  if (!identity.email) return { user: null, error: 'NO_EMAIL' };

  const row = await resolveUserRow(identity.supabaseUid, identity.email);
  if (!row) return { user: null, error: 'USER_NOT_FOUND' };
  if (row.is_deleted) return { user: null, error: 'ACCOUNT_DELETED' };

  return {
    user: {
      id: row.id,
      supabaseUid: identity.supabaseUid,
      email: (row.email ?? identity.email) as string,
      emailVerified: identity.emailVerified,
    },
    error: null,
  };
}
