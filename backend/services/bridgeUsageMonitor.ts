/**
 * Bridge Usage Monitor — surfaces every action satisfied via the legacy
 * super-admin cookie path (`viaLegacyBridge=true` on capability_audit_log).
 *
 * Why this matters: the legacy bridge has a hard expiry at
 * 2026-08-05T00:00Z (see `legacyCookieSuperAdminBridge.ts`). Every
 * route that still depends on the bridge will start failing on that
 * date unless the capability is migrated to the canonical DB-backed
 * super-admin chain. This monitor lets ops see which routes still need
 * migration, ranked by recency + frequency.
 *
 * Read-only.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

export interface BridgeUsageEntry {
  /** capability + reason form a unique-enough key for the user-facing rollup. */
  capability: string;
  /** Number of bridge-authoritative invocations in the window. */
  count: number;
  /** Most recent occurrence; helps operators triage by "still being hit today" vs "last hit a week ago". */
  lastSeenAt: string;
  /** First (oldest) occurrence in the window. */
  firstSeenAt: string;
  /** Sample of the last 3 free-text reasons recorded with this capability. */
  recentReasons: ReadonlyArray<string>;
  /** Sample of the last 3 unique IPs recorded with this capability. */
  recentIps: ReadonlyArray<string>;
}

export interface BridgeUsageReport {
  generatedAt: string;
  windowStartedAt: string;
  totalEvents: number;
  uniqueCapabilities: number;
  /** Days remaining until the legacy bridge hard expiry (informational). */
  daysUntilHardExpiry: number;
  entries: ReadonlyArray<BridgeUsageEntry>;
}

const DEFAULT_WINDOW_HOURS = 24 * 30; // 30 days
// Aligned with legacyCookieSuperAdminBridge.ts hard-expiry constant.
const HARD_EXPIRY_ISO = '2026-08-05T00:00:00.000Z';

interface AuditRow {
  occurred_at: string;
  capability: string | null;
  reason: string | null;
  ip: string | null;
}

export async function reportBridgeUsage(input?: {
  windowHours?: number;
  /** Cap on rows scanned. Default: 5000. */
  rowLimit?: number;
}): Promise<BridgeUsageReport> {
  const windowHours = input?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStartedAt = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const limit = Math.min(Math.max(input?.rowLimit ?? 5000, 100), 50_000);

  const { data, error } = await ownedDbTable('capability_audit_log')
    .select('occurred_at, capability, reason, ip')
    .eq('via_legacy_bridge', true)
    .gte('occurred_at', windowStartedAt)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.warn('bridge_usage_query_failed', { message: error.message });
    return {
      generatedAt:        new Date().toISOString(),
      windowStartedAt,
      totalEvents:        0,
      uniqueCapabilities: 0,
      daysUntilHardExpiry: daysBetween(new Date(), new Date(HARD_EXPIRY_ISO)),
      entries:            [],
    };
  }

  const rows = (data ?? []) as AuditRow[];

  // Roll up by capability. Track the rolling sample of reasons + ips
  // for operator triage without paging through the raw rows.
  const byCapability = new Map<string, {
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
    reasons: string[];
    ips: string[];
  }>();

  for (const row of rows) {
    const cap = row.capability ?? '<unknown>';
    const cur = byCapability.get(cap) ?? {
      count: 0,
      firstSeenAt: row.occurred_at,
      lastSeenAt:  row.occurred_at,
      reasons: [],
      ips: [],
    };
    cur.count += 1;
    if (row.occurred_at < cur.firstSeenAt) cur.firstSeenAt = row.occurred_at;
    if (row.occurred_at > cur.lastSeenAt)  cur.lastSeenAt  = row.occurred_at;
    if (row.reason && cur.reasons.length < 3 && !cur.reasons.includes(row.reason)) {
      cur.reasons.push(row.reason);
    }
    if (row.ip && cur.ips.length < 3 && !cur.ips.includes(row.ip)) {
      cur.ips.push(row.ip);
    }
    byCapability.set(cap, cur);
  }

  const entries: BridgeUsageEntry[] = Array.from(byCapability.entries())
    .map(([capability, cur]) => ({
      capability,
      count:        cur.count,
      lastSeenAt:   cur.lastSeenAt,
      firstSeenAt:  cur.firstSeenAt,
      recentReasons: cur.reasons,
      recentIps:    cur.ips,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt:         new Date().toISOString(),
    windowStartedAt,
    totalEvents:         rows.length,
    uniqueCapabilities:  entries.length,
    daysUntilHardExpiry: daysBetween(new Date(), new Date(HARD_EXPIRY_ISO)),
    entries,
  };
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 3_600_000));
}
