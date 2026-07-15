import { ownedDbTable } from '../db/writeOwner';
import {
  tolerantUserSelect,
  type LifecycleUserRow,
} from './userColumnProjection';
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
import { singleFlight } from '../../lib/auth/singleFlightRefresh';
import { logger } from './logger';
import {
  getCachedValidation,
  setCachedValidation,
  recordValidationLatency,
} from './authValidationCache';

// ── Public types ──────────────────────────────────────────────────────────────

export type AuthFailureCode =
  | 'NO_TOKEN'           // No Authorization Bearer header and no auth cookie
  | 'INVALID_TOKEN'      // Token rejected by supabase.auth.getUser
  | 'NO_EMAIL'           // Token valid but auth.users has no email
  | 'USER_NOT_FOUND'     // Token valid, but public.users has no row yet
  | 'ACCOUNT_DELETED'    // public.users.is_deleted === true OR status='deleted'
  | 'ACCOUNT_SUSPENDED'  // Phase 2.B — public.users.status='suspended'
  | 'SESSION_REVOKED';   // Phase 2.B — JWT iat predates users.session_revoked_after
  // Note: status='invited' users are returned with user.status='invited' (success
  // path). Routes opt-in to blocking them by inspecting AuthenticatedUser.status.

/**
 * The canonical user lifecycle state. Surfaced on AuthenticatedUser so
 * callers can render the right UX. `invited` callers may continue if the
 * route is in the invite-safe allowlist; `active` is the normal state;
 * `suspended` and `deleted` should NEVER appear here (they fail closed
 * inside resolveAuthenticatedUser).
 */
export type UserLifecycleStatus = 'invited' | 'active' | 'suspended' | 'deleted';

export interface AuthenticatedUser {
  /** public.users.id — application profile PK. */
  id: string;
  /** auth.users.id — Supabase auth identity. Mirrors users.supabase_uid. */
  supabaseUid: string;
  email: string;
  emailVerified: boolean;
  /** Phase 2.B — canonical lifecycle state (always 'active' or 'invited' here). */
  status: UserLifecycleStatus;
}

export type ResolveAuthenticatedUserResult =
  | { user: AuthenticatedUser; error: null }
  | { user: null; error: AuthFailureCode };

let authBootScheduled = false;
let authBootInFlight: Promise<unknown> | null = null;

function scheduleAuthSubsystemBoot(): void {
  if (authBootScheduled) return;
  authBootScheduled = true;

  const run = () => {
    if (!authBootInFlight) {
      authBootInFlight = import('../security/startup/authSubsystemBoot')
        .then(({ bootAuthSubsystem }) => bootAuthSubsystem())
        .catch((error) => {
          logger.warn('auth_subsystem_boot_deferred_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
  };

  if (typeof setImmediate === 'function') {
    setImmediate(run);
  } else {
    setTimeout(run, 0);
  }
}

// ── Token extraction ──────────────────────────────────────────────────────────

/**
 * Full-name patterns for the Supabase auth cookie (chunk suffix `.<n>`
 * stripped before matching). Priority order: project-scoped cookie first,
 * then the two legacy names. Preserves the exact set the old regex list
 * recognised — only the matching strategy changed (name-based, so chunked
 * `@supabase/ssr` cookies are now supported).
 */
const COOKIE_BASE_PATTERNS: ReadonlyArray<RegExp> = [
  /^sb-[a-z0-9]+-auth-token$/i,
  /^auth-token$/i,
  /^supabase-auth$/i,
];

// Defensive upper bound — @supabase/ssr realistically emits ≤5 chunks; an
// envelope claiming more is treated as malformed rather than concatenated.
const MAX_AUTH_COOKIE_CHUNKS = 32;

// One-time success breadcrumb so the "chunk reconstruction works" signal is
// observable without logging on every authenticated request (spam guard).
let loggedChunkSuccessOnce = false;

interface ParsedCookie { name: string; value: string; }

/** Parse a raw `Cookie:` header into ordered name/value pairs. */
function parseCookieHeader(header: string): ParsedCookie[] {
  const out: ParsedCookie[] = [];
  for (const segment of header.split(';')) {
    const part = segment.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/** Return the numeric chunk index if `name` is `base.<digits>`, else null. */
function chunkIndexOf(name: string, base: string): number | null {
  if (!name.startsWith(base + '.')) return null;
  const suffix = name.slice(base.length + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

/** decodeURIComponent that never throws (malformed %xx → raw value). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Build the ordered list of candidate envelope strings for one base cookie
 * name. Unchunked single cookie is tried FIRST (zero behaviour change for
 * existing deployments); a validated, contiguous chunk set is tried next.
 * Corrupt chunk sets (gaps, conflicting duplicates, over-limit) are dropped
 * with a structured diagnostic — never concatenated blindly.
 */
function reconstructEnvelopes(cookies: ParsedCookie[], base: string): string[] {
  const candidates: string[] = [];

  const single = cookies.find((c) => c.name === base);
  if (single) candidates.push(safeDecode(single.value));

  // index → distinct decoded values seen (duplicate-detection).
  const chunkMap = new Map<number, Set<string>>();
  for (const c of cookies) {
    const idx = chunkIndexOf(c.name, base);
    if (idx === null) continue;
    const set = chunkMap.get(idx) ?? new Set<string>();
    set.add(safeDecode(c.value));
    chunkMap.set(idx, set);
  }

  if (chunkMap.size === 0) return candidates;

  const indices = Array.from(chunkMap.keys()).sort((a, b) => a - b);
  let usable = true;

  if (indices.length > MAX_AUTH_COOKIE_CHUNKS) {
    logger.warn('auth_resolver_cookie_chunk_overflow', { base, count: indices.length });
    usable = false;
  }

  // Conflicting duplicate index (same .n present twice with different values).
  if (usable) {
    for (const [idx, values] of chunkMap) {
      if (values.size > 1) {
        logger.warn('auth_resolver_cookie_chunk_duplicate', { base, idx });
        usable = false;
        break;
      }
    }
  }

  // Must be exactly contiguous 0..n-1 — any gap means a lost chunk.
  if (usable) {
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        logger.warn('auth_resolver_cookie_chunk_gap', {
          base, expectedIndex: i, gotIndex: indices[i], total: indices.length,
        });
        usable = false;
        break;
      }
    }
  }

  if (usable) {
    const reconstructed = indices
      .map((i) => Array.from(chunkMap.get(i) as Set<string>)[0])
      .join('');
    if (!loggedChunkSuccessOnce) {
      loggedChunkSuccessOnce = true;
      logger.info('auth_resolver_cookie_chunk_reconstructed', { base, chunks: indices.length });
    }
    candidates.push(reconstructed);
  }

  return candidates;
}

/** Decode one envelope string → access_token. Mirrors the legacy pipeline. */
function envelopeToAccessToken(envelopeRaw: string): string | null {
  let value = envelopeRaw;
  if (value.startsWith('base64-')) value = value.slice(7);

  if (value.startsWith('eyJ')) {
    try {
      value = Buffer.from(value, 'base64').toString('utf-8');
    } catch (error) {
      logger.warn('auth_resolver_cookie_base64_decode_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  try {
    const parsed = JSON.parse(value);
    if (
      parsed && typeof parsed === 'object' &&
      typeof (parsed as { access_token?: unknown }).access_token === 'string' &&
      (parsed as { access_token: string }).access_token
    ) {
      return (parsed as { access_token: string }).access_token;
    }
    return null;
  } catch (error) {
    logger.warn('auth_resolver_cookie_parse_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
  const header = req.headers.cookie || '';
  if (!header) return null;

  const cookies = parseCookieHeader(header);
  if (cookies.length === 0) return null;

  let sawAuthCookie = false;

  for (const basePattern of COOKIE_BASE_PATTERNS) {
    // Distinct base names matching this pattern (chunk suffix stripped).
    const bases = new Set<string>();
    for (const c of cookies) {
      const baseName = c.name.replace(/\.\d+$/, '');
      if (basePattern.test(baseName)) bases.add(baseName);
    }

    for (const base of bases) {
      sawAuthCookie = true;
      const candidates = reconstructEnvelopes(cookies, base);
      for (const envelope of candidates) {
        const token = envelopeToAccessToken(envelope);
        if (token) return token;
      }
    }
  }

  // Only diagnose when an auth cookie WAS present but yielded no token —
  // never log for ordinary anonymous requests (no auth cookie at all).
  if (sawAuthCookie) {
    logger.warn('auth_resolver_cookie_token_unresolved', {
      reason: 'auth_cookie_present_but_no_access_token',
    });
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
  // PERF-001: short-TTL cache. A hit skips the redundant GoTrue round-trip for
  // repeated validations of the SAME token during one activation chain. Only
  // successful validations are cached, entry lifetime is capped to the JWT exp,
  // and account-lifecycle enforcement still runs on the DB row every request
  // (see authValidationCache.ts) — so revocation/deletion behavior is unchanged.
  const cached = getCachedValidation(token);
  if (cached) {
    recordValidationLatency(0, true);
    return cached;
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof db.auth.getUser>>;
  try {
    // W2-2 (audit B-46): single-flight — concurrent validations of the SAME
    // token (bursty multi-endpoint page loads on a cache miss) share ONE
    // in-flight GoTrue call instead of each paying the round-trip. Pure
    // dedupe: identical inputs, identical result, no auth-logic change.
    // TTL alignment is operational: AUTH_VALIDATION_CACHE_TTL_MS (already
    // capped to JWT exp in authValidationCache.ts).
    result = await singleFlight(`auth:getUser:${token}`, () => Promise.race([
      db.auth.getUser(token),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase auth timeout')), SUPABASE_AUTH_TIMEOUT_MS),
      ),
    ]));
  } catch (error) {
    logger.warn('auth_resolver_supabase_lookup_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    recordValidationLatency(Date.now() - startedAt, false);
  }

  const authUser = result.data?.user;
  if (result.error || !authUser) {
    logger.warn('auth_resolver_token_invalid', {
      message: result.error?.message ?? 'unknown',
    });
    return null;
  }

  const identity: ValidatedAuthIdentity = {
    supabaseUid: authUser.id,
    email: authUser.email ?? null,
    emailVerified: !!authUser.email_confirmed_at,
  };
  setCachedValidation(token, identity);
  return identity;
}

// ── JWT iat extraction (Phase 2.B — session revocation epoch check) ─────────
//
// supabase.auth.getUser(token) already validated the signature + expiry, so
// decoding the middle segment for `iat` is safe (we do NOT trust unsigned
// claims; we trust that Supabase already validated this exact string).
function decodeJwtIat(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 → utf-8 JSON
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(json) as { iat?: number };
    if (typeof claims.iat === 'number' && Number.isFinite(claims.iat)) {
      return claims.iat;
    }
    return null;
  } catch {
    return null;
  }
}

// ── DB resolution + backfill ──────────────────────────────────────────────────

interface ResolvedUserRow {
  id: string;
  email: string | null;
  is_deleted: boolean;
  /** Phase 2.B — lifecycle status. NULL on legacy rows treated as 'active'. */
  status: UserLifecycleStatus | null;
  /** Phase 2.B — JWT epoch. JWT iat must be ≥ this value. */
  session_revoked_after: string | null;
}

/**
 * Resolve public.users row by supabase_uid first, falling back to email
 * (with one-shot supabase_uid back-fill).
 *
 * Soft-deleted rows are returned with is_deleted=true so the caller can map
 * to ACCOUNT_DELETED — they are NOT silently treated as missing.
 *
 * Schema tolerance: the underlying SELECT uses {@link tolerantUserSelect},
 * which retries with a base column set when PostgREST reports missing
 * lifecycle columns (PGRST204). This keeps auth working in environments
 * where the Phase 2.B lifecycle migrations have not been applied yet.
 */
function toResolvedUserRow(row: LifecycleUserRow): ResolvedUserRow {
  return {
    id: row.id,
    email: row.email,
    is_deleted: row.is_deleted,
    status: row.status,
    session_revoked_after: row.session_revoked_after,
  };
}

async function resolveUserRow(
  supabaseUid: string,
  email: string | null,
): Promise<ResolvedUserRow | null> {
  const byUid = await tolerantUserSelect({
    resolver: 'resolveUserRow.by_uid',
    filterColumn: 'supabase_uid',
    filterValue: supabaseUid,
  });
  if (byUid.row) return toResolvedUserRow(byUid.row);

  if (!email) return null;

  const byEmail = await tolerantUserSelect({
    resolver: 'resolveUserRow.by_email',
    filterColumn: 'email',
    filterValue: email.toLowerCase(),
  });
  if (!byEmail.row) return null;

  // Back-fill supabase_uid if the row was matched by email (one-shot).
  // Skipped for soft-deleted rows so the auth flow surfaces ACCOUNT_DELETED
  // before any state mutation.
  if (!byEmail.row.is_deleted) {
    await ownedDbTable('users')
      .update({ supabase_uid: supabaseUid })
      .eq('id', byEmail.row.id);
  }

  return toResolvedUserRow(byEmail.row);
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
  // Run the auth subsystem boot on the first authenticated request and let
  // the result cache for the process lifetime. The probe is fire-and-forget
  // for performance — auth resolution does NOT block on it; we just want
  // the structured boot fingerprint + "your migrations are behind" log to
  // land somewhere visible the first time a request touches the resolver
  // after a deploy.
  scheduleAuthSubsystemBoot();

  const token = extractAccessToken(req);
  if (!token) return { user: null, error: 'NO_TOKEN' };

  const identity = await validateTokenWithSupabase(token);
  if (!identity) return { user: null, error: 'INVALID_TOKEN' };

  if (!identity.email) return { user: null, error: 'NO_EMAIL' };

  const row = await resolveUserRow(identity.supabaseUid, identity.email);
  if (!row) return { user: null, error: 'USER_NOT_FOUND' };

  // ── Phase 2.B lifecycle enforcement ─────────────────────────────────────
  // Order: deleted → suspended → session-revoked → invited (allowed-through
  // with status marker). Each check fails closed and emits a distinct error
  // code so the caller can map to the appropriate HTTP response.
  if (row.is_deleted || row.status === 'deleted') {
    return { user: null, error: 'ACCOUNT_DELETED' };
  }
  if (row.status === 'suspended') {
    return { user: null, error: 'ACCOUNT_SUSPENDED' };
  }

  // JWT epoch check — invalidates all access tokens issued before the
  // last revocation. Supabase already validated signature + expiry, so
  // we trust the decoded iat claim.
  if (row.session_revoked_after) {
    const iatSec = decodeJwtIat(token);
    if (iatSec !== null) {
      const iatMs = iatSec * 1000;
      const revokedAtMs = Date.parse(row.session_revoked_after);
      if (Number.isFinite(revokedAtMs) && iatMs < revokedAtMs) {
        logger.warn('auth_resolver_session_revoked', {
          userId: row.id,
          iat: new Date(iatMs).toISOString(),
          revokedAfter: row.session_revoked_after,
        });
        return { user: null, error: 'SESSION_REVOKED' };
      }
    }
    // If we cannot decode iat (extremely rare — Supabase JWTs always carry it),
    // fail closed: a non-NULL revoked_after means we MUST be able to compare.
    else {
      logger.warn('auth_resolver_jwt_iat_undecodable', { userId: row.id });
      return { user: null, error: 'SESSION_REVOKED' };
    }
  }

  // Treat NULL status (rows that predate the 20260638 migration) as 'active'.
  // The migration backfills 'active' as the default, so this only matters in
  // a torn-deploy window where the column has not yet been added.
  const resolvedStatus: UserLifecycleStatus = row.status ?? 'active';

  return {
    user: {
      id: row.id,
      supabaseUid: identity.supabaseUid,
      email: (row.email ?? identity.email) as string,
      emailVerified: identity.emailVerified,
      status: resolvedStatus,
    },
    error: null,
  };
}
