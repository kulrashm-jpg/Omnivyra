/**
 * What an ingestion cycle actually did, as a value an operator can act on.
 *
 * WHY THIS EXISTS
 * ---------------
 * Engagement ingestion failed every post on every 10-minute cycle for weeks and
 * nothing surfaced it. The cycle summary said:
 *
 *     processed: 11, total_ingested: 0, errors: 11
 *
 * which is three numbers that cannot tell you WHICH provider failed, WHY, or
 * whether anything is recoverable. The only way anyone found out was reading
 * worker logs by hand and counting lines.
 *
 * Phase 87 already made each failure carry a typed reason. This turns those
 * reasons into a per-cycle breakdown, so the single summary line is enough to
 * answer "what is broken, for whom, and is it my problem or the provider's".
 *
 * THE DISTINCTION THAT MATTERS MOST
 * ---------------------------------
 * `processed: 0` is NOT a failure. It means the 30-day window found no eligible
 * post — the correct, healthy behaviour for an account that has not published
 * recently, and the state production is in right now. Alerting on zero would
 * fire forever on a perfectly healthy pipeline and teach everyone to ignore it.
 *
 * The genuinely unhealthy signal is different and specific: eligible work
 * EXISTS and every single item failed. That is `failing`, and it is the one
 * state worth waking someone for.
 *
 * Pure and I/O-free on purpose: the classification is the part that must be
 * exactly right, so it is testable without a database, a provider, or a clock.
 */

import type { IngestFailureKind } from '../engagementIngestionService';

/**
 * Cycle verdict.
 *
 *   idle      no eligible work — healthy, never alertable
 *   healthy   every attempted post succeeded
 *   degraded  some succeeded, some failed
 *   failing   eligible work existed and NOTHING succeeded
 */
export type IngestionCycleHealth = 'idle' | 'healthy' | 'degraded' | 'failing';

/** One post's outcome, reduced to what the summary needs. */
export interface IngestOutcome {
  platform: string | null;
  success: boolean;
  failure?: IngestFailureKind | null;
}

export interface IngestionCycleSummary {
  health: IngestionCycleHealth;
  processed: number;
  succeeded: number;
  failed: number;
  totalIngested: number;
  /** Failure counts keyed by provider, e.g. { linkedin: 8, x: 3 }. */
  byProvider: Record<string, number>;
  /** Failure counts keyed by typed reason, e.g. { needs_reauth: 8 }. */
  byFailureKind: Record<string, number>;
  /**
   * Connections parked for reconnection this cycle. This is the number an
   * operator acts on: it means a human must reconnect an account, and no
   * amount of retrying will fix it.
   */
  needsReauth: number;
  /**
   * True when eligible work existed and every item failed — the only state
   * that should page anyone. Deliberately false for an idle cycle.
   */
  actionable: boolean;
}

const UNKNOWN_PROVIDER = 'unknown';

function classify(processed: number, succeeded: number, failed: number): IngestionCycleHealth {
  // No eligible work is not a fault. Production sits here whenever nothing has
  // been published inside the ingestion window.
  if (processed === 0) return 'idle';
  if (failed === 0) return 'healthy';
  if (succeeded === 0) return 'failing';
  return 'degraded';
}

/**
 * Reduce a cycle's per-post outcomes to an operator-facing summary.
 *
 * `totalIngested` is passed separately because a post can succeed while
 * ingesting zero comments — a real and common outcome that must not be
 * confused with failure.
 */
export function summarizeIngestionCycle(
  outcomes: readonly IngestOutcome[],
  totalIngested: number,
): IngestionCycleSummary {
  const processed = outcomes.length;
  let succeeded = 0;
  const byProvider: Record<string, number> = {};
  const byFailureKind: Record<string, number> = {};

  for (const o of outcomes) {
    if (o.success) { succeeded += 1; continue; }
    // Failures are attributed; successes are not, so the breakdown reads as
    // "what went wrong" rather than "what happened".
    const provider = (o.platform || '').trim().toLowerCase() || UNKNOWN_PROVIDER;
    byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    const kind = o.failure ?? 'provider';
    byFailureKind[kind] = (byFailureKind[kind] ?? 0) + 1;
  }

  const failed = processed - succeeded;
  const health = classify(processed, succeeded, failed);

  return {
    health,
    processed,
    succeeded,
    failed,
    totalIngested,
    byProvider,
    byFailureKind,
    needsReauth: byFailureKind.needs_reauth ?? 0,
    // Only `failing` is actionable. `degraded` is worth seeing in the summary
    // but one bad connection among several must not page anyone.
    actionable: health === 'failing',
  };
}

/**
 * The single log line an operator reads.
 *
 * Carries no post ids, no account ids, no URLs and no provider bodies — only
 * counts and typed reasons, so it is safe to ship anywhere logs go.
 */
export function ingestionCycleLogPayload(summary: IngestionCycleSummary): Record<string, unknown> {
  return {
    health: summary.health,
    actionable: summary.actionable,
    processed: summary.processed,
    succeeded: summary.succeeded,
    failed: summary.failed,
    total_ingested: summary.totalIngested,
    needs_reauth: summary.needsReauth,
    by_provider: summary.byProvider,
    by_failure_kind: summary.byFailureKind,
  };
}
