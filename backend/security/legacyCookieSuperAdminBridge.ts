/**
 * legacyCookieSuperAdminBridge — temporary, audited bridge.
 *
 * Wave 3 will delete this file. Until then, we keep the existing
 * `super_admin_session=1` cookie path working, but:
 *   - every use is audited via SecurityAuditService.logCookieSuperAdminUsage
 *   - the bridge synthesizes a special AuthenticatedPrincipal whose
 *     `legacyCookieSuperAdmin` flag is true
 *   - the principal can NEVER satisfy step-up requirements
 *   - the bridge HARD-EXPIRES at LEGACY_BRIDGE_HARD_EXPIRY_AT (a constant
 *     defined here; bumping it requires a code change)
 *   - if the env-var SUPER_ADMIN_USERNAME or SUPER_ADMIN_PASSWORD is unset
 *     in production, the bridge is rejected
 *
 * Operator runbook: provision a DB-backed SUPER_ADMIN
 * (user_company_roles.role='SUPER_ADMIN') BEFORE Wave 3 deletes this file.
 * Until then, every cookie use produces an audit row with
 * via_legacy_bridge=true so the operator can verify nothing depends on
 * the cookie path.
 */

import type { NextApiRequest } from 'next';
import { logger } from '../services/logger';
import { logCookieSuperAdminUsage } from './audit/SecurityAuditService';
import { legacyCookieSuperAdminCapabilities } from './capabilityRegistry';
import { parseSignedBridgeCookie, type BridgeCookieParseFailure } from './bridgeCookie';
import type { AuthenticatedPrincipal } from '../../shared/contracts/security';

// ── Hard-expiry knob ─────────────────────────────────────────────────────────
/**
 * After this date, the bridge always returns null (i.e., the cookie path
 * is dead). Bumping the date requires a code change AND a reason in the
 * commit message — make this hard to do unintentionally.
 *
 * Default: 90 days from Wave-2A landing. Operations must replace the cookie
 * path with a DB-backed SUPER_ADMIN before then.
 */
export const LEGACY_BRIDGE_HARD_EXPIRY_AT = new Date('2026-08-05T00:00:00Z');

// ── Dry-run knob (Wave 3A bridge collapse pre-audit) ────────────────────────
/**
 * When LEGACY_BRIDGE_DRY_RUN=1 (or =true), the bridge ALWAYS returns null
 * — simulating Wave 3 removal — but still emits a `bridge_authority_rejected`
 * audit row whenever a cookie is present. This lets operators observe what
 * would break if the bridge were deleted, without actually deleting it.
 *
 * Wave 3A spec: "fail-closed simulation mode; bridge deprecation warnings;
 * NO bridge removal yet; NO hidden fallback authority; all bridge consumers
 * observable."
 */
export function isLegacyBridgeDryRun(): boolean {
  const v = (process.env.LEGACY_BRIDGE_DRY_RUN ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// ── Canonical lifecycle evaluator ────────────────────────────────────────────
/**
 * SEC-001C — THE single decision procedure for "may this bridge cookie grant
 * authority right now". Every bridge consumer must reach its verdict through
 * this function; none may re-implement the sequence.
 *
 * Before SEC-001C the sequence existed twice, in two different orders:
 * `superAdminSession` checked signature → dry-run → hard-expiry, while
 * `contentArchitectService` (SEC-001A) checked dry-run → hard-expiry →
 * signature. The outcome agreed in every case, but the ATTRIBUTION did not: a
 * forged cookie presented under `LEGACY_BRIDGE_DRY_RUN=1` was recorded as a
 * dry-run rejection by one and a signature rejection by the other. Dry-run
 * exists to answer "what real usage would Wave-3 removal break", so counting
 * forgeries in that number corrupts the very signal it produces.
 *
 * Signature is therefore evaluated FIRST: a cookie that was never valid is not
 * evidence of a bridge dependency. Only genuinely valid cookies reach the
 * dry-run and hard-expiry arms.
 *
 * This function is deliberately PURE — no logging, no audit, no counters. Each
 * caller owns its own observability (route counters in `superAdminSession`,
 * capability audit rows here), which is why the two can share the decision
 * without sharing their side effects.
 */
export type BridgeLifecycleVerdict =
  | { ok: true; issuedAtUnix: number }
  | { ok: false; reason: BridgeCookieParseFailure | 'dry_run' | 'hard_expired' };

export function evaluateBridgeCookieLifecycle(
  raw: string | null | undefined,
): BridgeLifecycleVerdict {
  const parsed = parseSignedBridgeCookie(raw ?? null);
  // Narrow via `in` — a truthy test on the discriminant does not reliably
  // narrow this union under the repo's TS settings.
  if (parsed.ok !== true) {
    return { ok: false, reason: 'reason' in parsed ? parsed.reason : 'malformed' };
  }
  if (isLegacyBridgeDryRun()) return { ok: false, reason: 'dry_run' };
  if (Date.now() >= LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime()) {
    return { ok: false, reason: 'hard_expired' };
  }
  return { ok: true, issuedAtUnix: parsed.issuedAtUnix };
}

// ── Cookie name (matches existing /api/super-admin/login.ts) ─────────────────
const SUPER_ADMIN_COOKIE = 'super_admin_session';
const CONTENT_ARCHITECT_COOKIE = 'content_architect_session';

// ── Synthetic principal ids ──────────────────────────────────────────────────
/**
 * Bridge-mode principal has no real users.id / supabase_uid. We use this
 * sentinel string so audit rows still group correctly, and so any code
 * accidentally treating the principal id as a UUID fails fast.
 */
export const LEGACY_BRIDGE_USER_ID = 'legacy:cookie-super-admin';
export const LEGACY_BRIDGE_SUPABASE_UID = 'legacy:cookie-super-admin';

// ── Cookie reading ───────────────────────────────────────────────────────────

function readCookie(req: NextApiRequest, name: string): string | null {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m?.[1] ?? null;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
  return req.socket?.remoteAddress ?? null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * If the request carries a valid legacy super-admin cookie AND the bridge
 * is not hard-expired AND env credentials are configured, return a
 * synthetic principal. Otherwise return null. The audit row is written
 * for both success and rejection cases, so absence of the cookie is the
 * only path that produces no audit.
 */
export async function resolveLegacyCookieSuperAdminPrincipal(
  req: NextApiRequest,
): Promise<AuthenticatedPrincipal | null> {
  const superAdminCookie = readCookie(req, SUPER_ADMIN_COOKIE);
  const contentArchitectCookie = readCookie(req, CONTENT_ARCHITECT_COOKIE);
  // Phase 2: bridge cookie is now signed (see backend/security/bridgeCookie.ts).
  // Static `=1` is the legacy Phase 1 format and is rejected here AFTER
  // emitting an audit row so operators see when stale cookies persist.
  const ip = clientIp(req);
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

  // SEC-001D: both cookies go through the ONE lifecycle evaluator. This used to
  // call parseSignedBridgeCookie directly and then re-implement the dry-run and
  // hard-expiry arms below — a second copy of the sequence living in the same
  // module as the first.
  const bridgeParse = evaluateBridgeCookieLifecycle(superAdminCookie);
  // SEC-001A: the content-architect cookie is held to the SAME standard as the
  // super-admin one. It previously granted bridge authority on the static `=1`
  // value, so anyone able to set a cookie could mint this principal — the exact
  // hole Phase 2 closed for super_admin but left open here.
  const contentArchitectParse = evaluateBridgeCookieLifecycle(contentArchitectCookie);

  /**
   * A cookie that was STRUCTURALLY valid but denied by a lifecycle arm
   * (dry-run / hard expiry) still counts as "presented". Without this the
   * function would return null at the `!hasBridgeCookie` guard below and never
   * emit the dry-run audit row — silently destroying the very observability the
   * dry-run rehearsal depends on.
   */
  // Narrow via `=== true`, not a truthy test — a truthy check on the
  // discriminant does not reliably narrow this union under the repo's TS
  // settings (the trap SEC-001A and SEC-001C both hit).
  const reasonOf = (v: BridgeLifecycleVerdict): string | null => (v.ok === true ? null : v.reason);
  const presented = (v: BridgeLifecycleVerdict): boolean => {
    const r = reasonOf(v);
    return r === null || r === 'dry_run' || r === 'hard_expired';
  };
  /** Denied for signature/format reasons, i.e. never a genuine bridge use. */
  const rejectedOnSignature = (v: BridgeLifecycleVerdict, raw: string | null): boolean => {
    const r = reasonOf(v);
    return raw != null && r !== null && !presented(v) && r !== 'no_value';
  };

  const hasContentArchitect = contentArchitectParse.ok === true;
  const hasBridgeCookie = presented(bridgeParse) || presented(contentArchitectParse);

  if (rejectedOnSignature(contentArchitectParse, contentArchitectCookie)) {
    const caReason = reasonOf(contentArchitectParse) ?? 'unknown';
    await logCookieSuperAdminUsage({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: `content-architect bridge cookie rejected: ${caReason}`,
      ip,
      userAgent,
    });
    logger.warn('legacy_content_architect_bridge_cookie_rejected', {
      reason: caReason,
      action:
        caReason === 'legacy_format'
          ? 'operator must re-login to receive the SEC-001A signed cookie'
          : 'possible tamper / wrong signing secret / forged cookie',
    });
  }

  // Tamper / legacy-format detection: log the failure mode before
  // returning null so the resolver attribution shows up in audit even
  // when the cookie is rejected.
  if (rejectedOnSignature(bridgeParse, superAdminCookie)) {
    const saReason = reasonOf(bridgeParse) ?? 'unknown';
    await logCookieSuperAdminUsage({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: `bridge cookie rejected: ${saReason}`,
      ip,
      userAgent,
    });
    logger.warn('legacy_super_admin_bridge_cookie_rejected', {
      reason: saReason,
      ip,
      action: saReason === 'legacy_format'
        ? 'operator must re-login to receive the Phase-2 signed bridge cookie'
        : saReason === 'bad_signature'
          ? 'possible tamper / wrong signing secret / forged cookie'
          : 'see reason',
    });
  }

  if (!hasBridgeCookie) return null;

  // Dry-run simulation: emit a rejection audit row so operators can see
  // every bridge dependency that WOULD break under Wave 3 removal, without
  // actually granting authority. Runs BEFORE the hard-expiry check so the
  // simulation is deterministic regardless of clock state.
  if (reasonOf(bridgeParse) === 'dry_run' || reasonOf(contentArchitectParse) === 'dry_run') {
    await logCookieSuperAdminUsage({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: 'LEGACY_BRIDGE_DRY_RUN=1 — simulating Wave 3 removal',
      ip,
      userAgent,
    });
    logger.warn('legacy_super_admin_bridge_dry_run_rejection', {
      // SEC-001B: attribute by VERDICT, not by the Phase-1 literal. A signed
      // super-admin cookie is never `'1'`, so the old test mislabelled every
      // legitimate super-admin session as content-architect in this audit line.
      cookie: presented(bridgeParse) ? 'super_admin_session' : 'content_architect_session',
      ip,
    });
    return null;
  }

  // Hard expiry.
  if (reasonOf(bridgeParse) === 'hard_expired' || reasonOf(contentArchitectParse) === 'hard_expired') {
    await logCookieSuperAdminUsage({
      capability: 'super_admin.legacy',
      decision: 'bridge_rejected',
      reason: `legacy bridge hard-expired at ${LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString()}`,
      ip,
      userAgent,
    });
    logger.warn('legacy_super_admin_bridge_hard_expired', {
      expiresAt: LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString(),
    });
    return null;
  }

  // Env-credential present?
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SUPER_ADMIN_USERNAME || !process.env.SUPER_ADMIN_PASSWORD) {
      await logCookieSuperAdminUsage({
        capability: 'super_admin.legacy',
        decision: 'bridge_rejected',
        reason: 'SUPER_ADMIN_USERNAME or SUPER_ADMIN_PASSWORD missing in production',
        ip,
        userAgent,
      });
      return null;
    }
  }

  // Audit the use.
  await logCookieSuperAdminUsage({
    capability: 'super_admin.legacy',
    decision: 'bridge_used',
    reason: bridgeParse.ok === true
      ? `super_admin_session cookie (signed; issued ${new Date(bridgeParse.issuedAtUnix * 1000).toISOString()})`
      : 'content_architect_session cookie',
    ip,
    userAgent,
  });

  // Synthesize a principal.
  const capabilities = legacyCookieSuperAdminCapabilities();

  const principal: AuthenticatedPrincipal = {
    userId: LEGACY_BRIDGE_USER_ID,
    supabaseUid: LEGACY_BRIDGE_SUPABASE_UID,
    email: 'legacy-bridge@local',
    emailVerified: false,
    sessionId: null,
    sessionAgeSeconds: 0,
    sessionStaleSeconds: 0,
    organizations: [],
    activeOrgId: null,
    capabilities,
    mfa: {
      enrolled: false,
      factors: [],
      lastVerifiedAt: null,
      phishingResistant: false,
    },
    device: {
      deviceId: null,
      trusted: false,
      fingerprint: 'legacy-bridge',
    },
    stepUp: {
      active: false,
      expiresAt: null,
      factor: null,
      sessionId: null,
    },
    legacyCookieSuperAdmin: true,
  };

  return principal;
}

/**
 * Startup hook: emit a single warning if the DB has no SUPER_ADMIN row but
 * the bridge env-credentials are set. Call from server bootstrap.
 *
 * This is a NO-OP when env-credentials are absent (since the bridge is
 * already disabled in production).
 */
export async function warnIfNoDbBackedSuperAdmin(opts: {
  fetchSuperAdminCount: () => Promise<number>;
}): Promise<void> {
  if (!process.env.SUPER_ADMIN_USERNAME || !process.env.SUPER_ADMIN_PASSWORD) return;
  try {
    const n = await opts.fetchSuperAdminCount();
    if (n === 0) {
      logger.warn('legacy_super_admin_bridge_active_but_no_db_super_admin', {
        message: 'Legacy cookie super-admin path is enabled but no DB-backed SUPER_ADMIN exists. Wave 3 cannot remove the bridge until at least one user_company_roles row with role=SUPER_ADMIN is provisioned.',
        bridgeHardExpiresAt: LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString(),
      });
    }
  } catch (err) {
    logger.warn('legacy_super_admin_bridge_count_check_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
