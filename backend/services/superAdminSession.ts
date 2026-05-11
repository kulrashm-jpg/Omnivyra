/**
 * superAdminSession — centralized helper for reading the legacy
 * `super_admin_session=1` bridge cookie outside of `requireCapability`.
 *
 * Phase 1 — Direct-Cookie Route Audit Guardrails. Routes that have not
 * yet been migrated to `requireCapability` use this helper. The helper:
 *   1. Honors `LEGACY_BRIDGE_DRY_RUN=1` — returns null when set so dry-run
 *      reflects reality (the older inline `req.cookies?.super_admin_session`
 *      reads ignored this flag, masking the bridge dependency).
 *   2. Honors `LEGACY_BRIDGE_HARD_EXPIRY_AT` — returns null past the date.
 *   3. Increments an in-process counter per call so we can quantify the
 *      bridge-bypass surface from a single read of `getBridgeBypassMetrics()`.
 *   4. Emits a one-line `legacy_bridge_bypass_used` warn log on each
 *      authoritative use AND a `bridge_authority_used` audit row.
 *
 * NOT a security boundary on its own — `requireCapability` remains the
 * authoritative gate. This helper exists so legacy direct-cookie reads
 * are observable, deprecation-safe, and removable in one step later.
 */
import type { NextApiRequest } from 'next';
import { logger } from './logger';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import {
  LEGACY_BRIDGE_HARD_EXPIRY_AT,
  isLegacyBridgeDryRun,
} from '../security/legacyCookieSuperAdminBridge';
import { parseSignedBridgeCookie } from '../security/bridgeCookie';

export const LEGACY_SUPER_ADMIN_USER_ID = 'super_admin_session';

export interface LegacySuperAdminSession {
  userId: typeof LEGACY_SUPER_ADMIN_USER_ID;
  role: 'SUPER_ADMIN';
}

// ── Per-process bridge-bypass counters ──────────────────────────────────────
// Cleared on cold start. Surfaced via `getBridgeBypassMetrics()` for ad-hoc
// diagnostics + a future /api/diagnostics surface. We intentionally don't
// ship a pull-based counter to a metrics backend yet — Phase 1 keeps the
// observability minimal but present.

interface BridgeBypassCounters {
  totalReads: number;
  granted: number;
  rejectedDryRun: number;
  rejectedHardExpired: number;
  /** Per-route attribution. Keyed by `req.url` path (no query string). */
  byRoute: Record<string, number>;
}

const counters: BridgeBypassCounters = {
  totalReads: 0,
  granted: 0,
  rejectedDryRun: 0,
  rejectedHardExpired: 0,
  byRoute: {},
};

/** Snapshot of bridge-bypass counters since process start. */
export function getBridgeBypassMetrics(): Readonly<BridgeBypassCounters> {
  return {
    totalReads: counters.totalReads,
    granted: counters.granted,
    rejectedDryRun: counters.rejectedDryRun,
    rejectedHardExpired: counters.rejectedHardExpired,
    byRoute: { ...counters.byRoute },
  };
}

/** Test/CI hook: clear counters between cases. */
export function resetBridgeBypassMetrics(): void {
  counters.totalReads = 0;
  counters.granted = 0;
  counters.rejectedDryRun = 0;
  counters.rejectedHardExpired = 0;
  counters.byRoute = {};
}

function routeKey(req: NextApiRequest): string {
  const url = req.url ?? '<unknown>';
  // Strip query — group by path so the per-route metric is stable.
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
  return req.socket?.remoteAddress ?? null;
}

/**
 * Read the legacy bridge cookie. Returns the synthetic session OR null.
 * Routes using this helper automatically participate in dry-run /
 * hard-expiry / counters; routes that read `req.cookies?.super_admin_session`
 * directly do not — those are a known migration gap to be closed later.
 */
export function getLegacySuperAdminSession(req: NextApiRequest): LegacySuperAdminSession | null {
  // Phase 2: bridge cookie is now an HMAC-signed payload. Static `=1`
  // is rejected here AND audited as legacy_format so operators see when
  // stale Phase-1 cookies are still being presented.
  const raw = req.cookies?.super_admin_session ?? null;
  if (!raw) return null;

  const parsed = parseSignedBridgeCookie(raw);
  if (parsed.ok !== true) {
    counters.totalReads += 1;
    counters.byRoute[routeKey(req)] = (counters.byRoute[routeKey(req)] ?? 0) + 1;
    logger.warn('legacy_bridge_bypass_rejected_signature', {
      route: routeKey(req),
      reason: parsed.reason,
      ip: clientIp(req),
    });
    void logSecurityEvent({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: `direct-cookie helper rejected bridge cookie (${parsed.reason}) for ${routeKey(req)}`,
      viaLegacyBridge: true,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    }).catch(() => { /* never propagate */ });
    return null;
  }

  counters.totalReads += 1;
  const route = routeKey(req);
  counters.byRoute[route] = (counters.byRoute[route] ?? 0) + 1;

  // Dry-run: simulate Wave-3 removal.
  if (isLegacyBridgeDryRun()) {
    counters.rejectedDryRun += 1;
    logger.warn('legacy_bridge_bypass_rejected_dry_run', {
      route,
      ip: clientIp(req),
      consequence: 'route falls through as if bridge were absent.',
    });
    void logSecurityEvent({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: `LEGACY_BRIDGE_DRY_RUN=1 — direct-cookie helper rejected bridge for ${route}`,
      viaLegacyBridge: true,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    }).catch(() => { /* never propagate */ });
    return null;
  }

  // Hard expiry: the bridge is dead after this date.
  if (Date.now() >= LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime()) {
    counters.rejectedHardExpired += 1;
    logger.warn('legacy_bridge_bypass_rejected_hard_expired', {
      route,
      ip: clientIp(req),
      hardExpiryAt: LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString(),
    });
    void logSecurityEvent({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_rejected',
      reason: `legacy bridge hard-expired at ${LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString()} (route ${route})`,
      viaLegacyBridge: true,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    }).catch(() => { /* never propagate */ });
    return null;
  }

  counters.granted += 1;
  logger.warn('legacy_bridge_bypass_used', {
    route,
    ip: clientIp(req),
    note: 'Direct-cookie bridge read outside requireCapability. Migrate when possible.',
  });
  void logSecurityEvent({
    capability: 'super_admin.legacy',
    decision: 'bridge_authority_used',
    reason: `direct-cookie bridge accepted for ${route}`,
    viaLegacyBridge: true,
    ip: clientIp(req),
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  }).catch(() => { /* never propagate */ });

  return { userId: LEGACY_SUPER_ADMIN_USER_ID, role: 'SUPER_ADMIN' };
}
