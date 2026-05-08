/**
 * Drift Summary — single aggregate of every operational drift indicator.
 *
 * Composes the existing detection services so an operator dashboard or
 * paging job has one canonical "is the platform healthy?" surface:
 *
 *   - ledger drift (creditReconciliation)
 *   - orphan organizations (orphanOrgDetector)
 *   - dead-letter queue volume (jobInspection)
 *   - bridge-authoritative usage (recent capability_audit_log rows
 *     where via_legacy_bridge = true — surfaces dependence on the
 *     legacy super-admin cookie before its hard expiry)
 *   - stuck users (lightweight count from the recovery-state surface)
 *
 * Read-only. Returns severity-classified counts so monitoring can
 * threshold on them; full row-level detail lives in the source-specific
 * detectors.
 *
 * Severity classifications:
 *   ok       — zero indicators
 *   warn     — at least one bucket non-zero but below alert threshold
 *   alert    — at least one bucket above its alert threshold
 *
 * Thresholds are conservative and intentionally separate from
 * environment-specific monitoring rules — alert here means "an operator
 * should look at this within an hour", not "page somebody at 3am".
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { reconcileAll } from './creditReconciliation';
import { detectOrphans } from './orphanOrgDetector';
import { summarizeDeadLetters } from './jobInspection';

export type DriftSeverity = 'ok' | 'warn' | 'alert';

export interface DriftIndicator {
  name: string;
  count: number;
  severity: DriftSeverity;
  /** Free-text explanation an operator can read at a glance. */
  detail: string;
}

export interface DriftSummaryResult {
  generatedAt: string;
  windowStartedAt: string;
  /** Worst severity across all indicators. */
  overall: DriftSeverity;
  indicators: ReadonlyArray<DriftIndicator>;
}

const DEFAULT_WINDOW_HOURS = 24;
const ALERT_THRESHOLDS = {
  driftedOrgs:        1,
  orphanOrgs:         1,
  dlqRecent:          50,
  bridgeUsageRecent:  20,
  stuckUsersOlderThan24h: 5,
};
const WARN_THRESHOLDS = {
  driftedOrgs:        0, // any non-zero is warn
  orphanOrgs:         0,
  dlqRecent:          1,
  bridgeUsageRecent:  1,
  stuckUsersOlderThan24h: 1,
};

function severityFor(count: number, alertAt: number, warnAt: number): DriftSeverity {
  if (count >= alertAt) return 'alert';
  if (count > warnAt)   return 'warn';
  return 'ok';
}

function combineSeverity(...severities: DriftSeverity[]): DriftSeverity {
  if (severities.includes('alert')) return 'alert';
  if (severities.includes('warn'))  return 'warn';
  return 'ok';
}

interface BridgeRow {
  occurred_at: string;
}
interface UserRow {
  id: string;
}

async function countBridgeUsageInWindow(sinceIso: string): Promise<number> {
  const { data, error } = await ownedDbTable('capability_audit_log')
    .select('occurred_at')
    .eq('via_legacy_bridge', true)
    .gte('occurred_at', sinceIso)
    .limit(10_000);
  if (error) {
    logger.warn('drift_bridge_query_failed', { message: error.message });
    return 0;
  }
  return ((data ?? []) as BridgeRow[]).length;
}

async function countStuckUsersOlderThan(sinceIso: string): Promise<number> {
  // "Stuck" = unverified email AND created earlier than the window.
  // Lighter probe than recovery-state's full classifier; surface only
  // the count for the dashboard.
  const { data, error } = await ownedDbTable('users')
    .select('id')
    .eq('is_deleted', false)
    .eq('is_email_verified', false)
    .lt('created_at', sinceIso)
    .limit(1000);
  if (error) {
    logger.warn('drift_stuck_users_query_failed', { message: error.message });
    return 0;
  }
  return ((data ?? []) as UserRow[]).length;
}

/**
 * Aggregate every drift detector into one report. Read-only. The
 * underlying queries are bounded so this is cheap enough to run on a
 * dashboard refresh.
 */
export async function summarizeDrift(input?: {
  windowHours?: number;
  /** Pass through to creditReconciliation so a small org subset can be probed cheaply. */
  reconciliationLimit?: number;
}): Promise<DriftSummaryResult> {
  const windowHours = input?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStartedAt = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  // Run every detector in parallel — they touch independent tables.
  const [recon, orphans, dlqSummary, bridgeUsage, stuckUsers] = await Promise.all([
    reconcileAll({ limit: input?.reconciliationLimit ?? 200 }).catch((err) => {
      logger.warn('drift_recon_failed', { message: err instanceof Error ? err.message : String(err) });
      return { orgsScanned: 0, orgsInSync: 0, orgsDrifted: 0, drifted: [] };
    }),
    detectOrphans({ limit: 500 }).catch((err) => {
      logger.warn('drift_orphan_detect_failed', { message: err instanceof Error ? err.message : String(err) });
      return [] as Awaited<ReturnType<typeof detectOrphans>>;
    }),
    summarizeDeadLetters({ since: windowStartedAt }).catch((err) => {
      logger.warn('drift_dlq_summary_failed', { message: err instanceof Error ? err.message : String(err) });
      return [] as Awaited<ReturnType<typeof summarizeDeadLetters>>;
    }),
    countBridgeUsageInWindow(windowStartedAt),
    countStuckUsersOlderThan(windowStartedAt),
  ]);

  const dlqRecentCount = dlqSummary.reduce((sum, e) => sum + e.count, 0);

  const indicators: DriftIndicator[] = [
    {
      name:     'wallet_ledger_drift',
      count:    recon.orgsDrifted,
      severity: severityFor(recon.orgsDrifted, ALERT_THRESHOLDS.driftedOrgs, WARN_THRESHOLDS.driftedOrgs),
      detail:   `${recon.orgsDrifted} of ${recon.orgsScanned} scanned orgs have wallet/ledger drift`,
    },
    {
      name:     'orphan_organizations',
      count:    orphans.length,
      severity: severityFor(orphans.length, ALERT_THRESHOLDS.orphanOrgs, WARN_THRESHOLDS.orphanOrgs),
      detail:   orphans.length === 0
        ? 'no orphan / headless / abandoned organizations detected'
        : `${orphans.length} orgs flagged: ${orphans.map((o) => `${(o.organizationName ?? o.organizationId).slice(0, 32)} [${o.classifications.join(',')}]`).slice(0, 3).join('; ')}${orphans.length > 3 ? ` +${orphans.length - 3} more` : ''}`,
    },
    {
      name:     'dead_letter_queue_recent',
      count:    dlqRecentCount,
      severity: severityFor(dlqRecentCount, ALERT_THRESHOLDS.dlqRecent, WARN_THRESHOLDS.dlqRecent),
      detail:   dlqRecentCount === 0
        ? `no DLQ entries in the last ${windowHours}h`
        : `${dlqRecentCount} DLQ entries in the last ${windowHours}h: ${dlqSummary.slice(0, 3).map((e) => `${e.workerName}=${e.count}`).join(', ')}${dlqSummary.length > 3 ? ` +${dlqSummary.length - 3} more workers` : ''}`,
    },
    {
      name:     'legacy_bridge_usage_recent',
      count:    bridgeUsage,
      severity: severityFor(bridgeUsage, ALERT_THRESHOLDS.bridgeUsageRecent, WARN_THRESHOLDS.bridgeUsageRecent),
      detail:   bridgeUsage === 0
        ? `no legacy super-admin bridge calls in the last ${windowHours}h`
        : `${bridgeUsage} bridge-authoritative actions in the last ${windowHours}h — bridge expires hard at 2026-08-05`,
    },
    {
      name:     'stuck_users_unverified',
      count:    stuckUsers,
      severity: severityFor(stuckUsers, ALERT_THRESHOLDS.stuckUsersOlderThan24h, WARN_THRESHOLDS.stuckUsersOlderThan24h),
      detail:   stuckUsers === 0
        ? 'no users stuck in unverified state'
        : `${stuckUsers} unverified users older than ${windowHours}h — operator can use /api/auth/resend-verification`,
    },
  ];

  const overall = combineSeverity(...indicators.map((i) => i.severity));

  return {
    generatedAt:     new Date().toISOString(),
    windowStartedAt,
    overall,
    indicators,
  };
}
