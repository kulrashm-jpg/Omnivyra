/**
 * Phase 8E — Credit-economy SHADOW adoption (telemetry only, dark by default).
 *
 * At a launch point, before any execution, this evaluates the completed credit
 * economy stack WITHOUT touching billing:
 *   • resolveActivityEconomics(activity)  → activityClass, entry, max, reservation
 *   • canStartActivity(org, activity)      → effective/required/shortfall (read-only)
 * and emits a `credit_economy_shadow_evaluation` event + would_allow/would_block
 * counters, plus an in-process aggregator for dashboards.
 *
 * GUARANTEES (Phase 8E guardrails):
 *   • NEVER blocks, NEVER throws — fully fire-and-forget; all errors swallowed.
 *   • NO billing mutation, NO ledger write — canStartActivity is a pure wallet
 *     READ; this module only logs + increments in-process counters.
 *   • DARK — gated by PHASE2_CREDIT_ECONOMY_SHADOW (default OFF). When OFF the
 *     helper returns immediately (not even a wallet read), so production
 *     behavior — including latency — is unchanged.
 */

import { canStartActivity } from './admissionControl';
import { resolveActivityEconomics } from '../activityEconomyCatalog';
import { incrCounter } from './billingMetrics';
import { recordShadowObservation } from './creditEconomyObservability';
import { logger } from '../logger';

const FLAG = 'PHASE2_CREDIT_ECONOMY_SHADOW';

/** Shadow telemetry switch — default OFF. Pure observability; never enforces. */
export function isCreditEconomyShadowEnabled(): boolean {
  return String(process.env[FLAG] ?? '').toLowerCase() === 'true';
}

/** The `credit_economy_shadow_evaluation` event payload (TASK 4). */
export interface CreditEconomyShadowEvent {
  organizationId: string;
  activity: string;
  activityClass: string;
  entryConsumption: number;
  maximumCredits: number;
  reservationCredits: number;
  effectiveCredits: number;
  requiredCredits: number;
  wouldBlock: boolean;
  shortfall: number;
}

// ── In-process aggregator (TASK 5) ───────────────────────────────────────────
interface ActivityAgg {
  evaluations: number;
  wouldBlock: number;
  shortfallSum: number;     // summed over would-block events
  maximumCredits: number;   // last-seen catalog max for this activity
}
const byActivity = new Map<string, ActivityAgg>();
let totalEvaluations = 0;
let totalWouldBlock = 0;
let totalShortfall = 0; // summed over would-block events

function record(e: CreditEconomyShadowEvent): void {
  totalEvaluations += 1;
  if (e.wouldBlock) {
    totalWouldBlock += 1;
    totalShortfall += e.shortfall;
  }
  const a = byActivity.get(e.activity) ?? { evaluations: 0, wouldBlock: 0, shortfallSum: 0, maximumCredits: e.maximumCredits };
  a.evaluations += 1;
  if (e.wouldBlock) {
    a.wouldBlock += 1;
    a.shortfallSum += e.shortfall;
  }
  a.maximumCredits = e.maximumCredits;
  byActivity.set(e.activity, a);
}

export interface ShadowAggregateSnapshot {
  totalEvaluations: number;
  wouldBlockCount: number;
  /** Mean shortfall across would-block events (0 if none). */
  averageShortfall: number;
  mostBlockedActivities: Array<{ activity: string; wouldBlock: number; evaluations: number }>;
  mostExpensiveActivities: Array<{ activity: string; maximumCredits: number }>;
}

/** Aggregated dashboard snapshot. Pure read of in-process counters. */
export function snapshotCreditEconomyShadow(topN = 5): ShadowAggregateSnapshot {
  const entries = Array.from(byActivity.entries());
  const mostBlockedActivities = entries
    .filter(([, a]) => a.wouldBlock > 0)
    .sort((x, y) => y[1].wouldBlock - x[1].wouldBlock)
    .slice(0, topN)
    .map(([activity, a]) => ({ activity, wouldBlock: a.wouldBlock, evaluations: a.evaluations }));
  const mostExpensiveActivities = entries
    .sort((x, y) => y[1].maximumCredits - x[1].maximumCredits)
    .slice(0, topN)
    .map(([activity, a]) => ({ activity, maximumCredits: a.maximumCredits }));
  return {
    totalEvaluations,
    wouldBlockCount: totalWouldBlock,
    averageShortfall: totalWouldBlock === 0 ? 0 : totalShortfall / totalWouldBlock,
    mostBlockedActivities,
    mostExpensiveActivities,
  };
}

// ── Duplicate protection (Phase 8G-A, TASK 4) ────────────────────────────────
// A launch may be reachable from more than one instrumented chokepoint (e.g. a
// direct route AND a downstream wirePhase2Route). A bounded FIFO seen-set keyed
// on a stable per-launch dedupeKey guarantees exactly one event per launch.
// Distinct launches carry distinct referenceIds, so legitimate repeats are not
// suppressed; only true same-launch duplicates are. Cap-evicted (no clock).
const DEDUPE_CAP = 5000;
const seenDedupeKeys = new Set<string>();
const seenOrder: string[] = [];
function markSeen(key: string): boolean {
  if (seenDedupeKeys.has(key)) return false; // already emitted for this launch
  seenDedupeKeys.add(key);
  seenOrder.push(key);
  if (seenOrder.length > DEDUPE_CAP) {
    const evicted = seenOrder.shift();
    if (evicted !== undefined) seenDedupeKeys.delete(evicted);
  }
  return true;
}

/** Test-only reset of the in-process aggregator + dedupe set. */
export function _resetCreditEconomyShadowForTests(): void {
  byActivity.clear();
  totalEvaluations = 0;
  totalWouldBlock = 0;
  totalShortfall = 0;
  seenDedupeKeys.clear();
  seenOrder.length = 0;
}

/**
 * Evaluate the credit economy in shadow at a launch point. Fire-and-forget:
 * callers do `void emitCreditEconomyShadowEvaluation(...)` and never await it on
 * the hot path. Returns immediately when the flag is OFF.
 */
export async function emitCreditEconomyShadowEvaluation(input: {
  organizationId: string;
  activity: string;
  surface?: string;
  /** Stable per-launch key; if seen already, the event is suppressed (TASK 4). */
  dedupeKey?: string;
}): Promise<void> {
  if (!isCreditEconomyShadowEnabled()) return;
  if (input.dedupeKey && !markSeen(input.dedupeKey)) return; // exactly-once per launch
  try {
    const econ = resolveActivityEconomics(input.activity); // throws on unknown
    const decision = await canStartActivity({
      organizationId: input.organizationId,
      activity: input.activity,
    });
    const event: CreditEconomyShadowEvent = {
      organizationId: input.organizationId,
      activity: input.activity,
      activityClass: econ.activityClass,
      entryConsumption: econ.entryConsumption,
      maximumCredits: econ.maximumCredits,
      reservationCredits: econ.reservationCredits,
      effectiveCredits: decision.effectiveCredits,
      requiredCredits: decision.requiredCredits,
      wouldBlock: !decision.allowed,
      shortfall: decision.shortfall,
    };
    incrCounter(event.wouldBlock ? 'credit_economy_shadow_would_block' : 'credit_economy_shadow_would_allow');
    record(event);
    // Phase 11C — durable mirror of the in-process aggregator (fire-and-forget;
    // the recorder swallows all errors and never blocks the shadow hot path).
    void recordShadowObservation({
      activity:       event.activity,
      wouldBlock:     event.wouldBlock,
      shortfall:      event.shortfall,
      maximumCredits: event.maximumCredits,
    });
    logger.info('credit_economy_shadow_evaluation', { surface: input.surface ?? null, ...event });
  } catch (err) {
    // Shadow is best-effort: unknown activity or any failure must not surface.
    logger.warn('credit_economy_shadow_eval_failed', {
      org: input.organizationId,
      activity: input.activity,
      message: (err as Error)?.message ?? 'unknown',
    });
  }
}
