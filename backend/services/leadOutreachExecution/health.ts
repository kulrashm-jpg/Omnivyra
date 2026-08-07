/**
 * WS-3 Milestone-6 — complete runtime health.
 *
 * Aggregates the state of all nine WS-3 stages into one answer an operator can
 * act on. It READS the existing observability registry and configuration; it
 * mutates nothing, dispatches nothing, and cannot change how the runtime
 * behaves.
 *
 * ─── WHY THIS IS COUNTER-BASED, NOT PROBE-BASED ────────────────────────────
 * A health check that issues its own queries measures the health check, not the
 * runtime. These indicators read what the runtime actually recorded while doing
 * real work, so "healthy" means work succeeded rather than "a synthetic probe
 * succeeded". It mirrors `checkPersistenceHealth` in the WS-2 health module for
 * exactly that reason.
 *
 * ─── DEGRADED IS NOT UNHEALTHY ─────────────────────────────────────────────
 * `degraded` means work is completing with problems; `unhealthy` means a stage
 * cannot do its job. Conflating them produces either an alert that never fires
 * when it matters or one that fires constantly when it does not. The split is
 * per-stage and deliberate: a rejected provider message is degraded (some sends
 * are failing), an unreadable suppression list is unhealthy (we cannot
 * establish who may be contacted).
 *
 * ─── COLD IS NOT BROKEN ────────────────────────────────────────────────────
 * A stage that has done no work reports `unknown`, never `healthy` and never
 * `unhealthy`. A freshly started process has not proven anything, and claiming
 * either would be a lie an operator would act on.
 */

import { getObservabilitySnapshot } from '../../observability/snapshot';
import { OUTREACH_METRICS, recordHealthComponent } from './telemetry';
import { RUNTIME_STAGES, type RuntimeStage } from './failureTaxonomy';
import { isEmailTransportEnabled } from './emailTransport';
import { isLeadOutreachGloballyDisabled } from './governanceService';
import { supportedChannels } from './transport';

export type OutreachHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface OutreachHealthIndicator {
  name: string;
  status: OutreachHealthStatus;
  /** Why it is in this state. Always populated, including when healthy. */
  detail: string;
  data?: Record<string, unknown>;
}

export interface OutreachHealthReport {
  /** Worst-of rollup across every indicator. */
  status: OutreachHealthStatus;
  checkedAt: string;
  executionRuntimeVersion: string;
  governanceVersion: string;
  /** Per-process, like every other registry-derived signal in this platform. */
  processScoped: true;
  indicators: OutreachHealthIndicator[];
  /** Names of every indicator that is not healthy. Empty when all clear. */
  degradedComponents: string[];
}

type CounterEntry = { name: string; value: number; labels?: Record<string, unknown> };

/** Read counters defensively — a broken snapshot must not break health. */
function readCounters(): CounterEntry[] {
  try {
    const snap = getObservabilitySnapshot() as unknown as { counters?: CounterEntry[] };
    return Array.isArray(snap?.counters) ? snap.counters : [];
  } catch {
    return [];
  }
}

const sum = (counters: CounterEntry[], name: string, match: (l: Record<string, unknown>) => boolean = () => true): number =>
  counters
    .filter((c) => c?.name === name && match((c.labels ?? {}) as Record<string, unknown>))
    .reduce((a, c) => a + (typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : 0), 0);

/** Worst-of, with `unknown` treated as "no information", never as a problem. */
const RANK: Record<OutreachHealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unhealthy: 3 };
const worseOf = (a: OutreachHealthStatus, b: OutreachHealthStatus): OutreachHealthStatus => (RANK[b] > RANK[a] ? b : a);

/**
 * One stage's health from its recorded outcomes.
 *
 * The ratio, not the count, decides: 3 failures out of 5 is a broken stage,
 * 3 out of 5,000 is noise, and a threshold on absolute counts would call both
 * the same thing.
 */
function stageIndicator(counters: CounterEntry[], stage: RuntimeStage): OutreachHealthIndicator {
  const total = sum(counters, OUTREACH_METRICS.stage.outcome, (l) => l.stage === stage);
  const failed = sum(counters, OUTREACH_METRICS.stage.outcome, (l) => l.stage === stage && l.outcome === 'failed');
  const failures = sum(counters, OUTREACH_METRICS.stage.failures, (l) => l.stage === stage);

  if (total === 0 && failures === 0) {
    return { name: stage, status: 'unknown', detail: `no ${stage} activity observed in this process yet` };
  }
  const ratio = total > 0 ? failed / total : 1;
  const data = { total, failed, failures, failureRate: Math.round(ratio * 100) / 100 };

  if (ratio >= 0.5) {
    return { name: stage, status: 'unhealthy', detail: `${Math.round(ratio * 100)}% of ${stage} operations failed`, data };
  }
  if (failed > 0 || failures > 0) {
    return { name: stage, status: 'degraded', detail: `${failed} of ${total} ${stage} operations failed`, data };
  }
  return { name: stage, status: 'healthy', detail: `${total} ${stage} operation(s), no failures`, data };
}

/**
 * Provider health, read from provider responses rather than stage outcomes:
 * a provider can reject every message while the transport works perfectly, and
 * those are different problems with different owners.
 */
function providerIndicator(counters: CounterEntry[]): OutreachHealthIndicator {
  const total = sum(counters, OUTREACH_METRICS.provider.response);
  const accepted = sum(counters, OUTREACH_METRICS.provider.response, (l) => l.outcome === 'accepted');
  const errors = sum(counters, OUTREACH_METRICS.provider.errors);

  if (total === 0) return { name: 'provider', status: 'unknown', detail: 'no provider responses observed in this process yet' };

  const acceptRate = accepted / total;
  const data = { total, accepted, errors, acceptRate: Math.round(acceptRate * 100) / 100 };
  if (acceptRate === 0) return { name: 'provider', status: 'unhealthy', detail: `the provider accepted none of ${total} message(s)`, data };
  if (acceptRate < 0.9 || errors > 0) return { name: 'provider', status: 'degraded', detail: `provider accepted ${Math.round(acceptRate * 100)}% of ${total} message(s), ${errors} error(s)`, data };
  return { name: 'provider', status: 'healthy', detail: `provider accepted ${accepted}/${total}`, data };
}

/**
 * Quota health. A refused reservation is NORMAL — it is the limiter working —
 * so only reservations that could not be evaluated, or a fast path that keeps
 * drifting from the durable truth, count against health.
 */
function quotaIndicator(counters: CounterEntry[]): OutreachHealthIndicator {
  const reserved = sum(counters, OUTREACH_METRICS.quota.reserved);
  const reconciled = sum(counters, OUTREACH_METRICS.quota.reconciled);
  const drifted = sum(counters, OUTREACH_METRICS.quota.reconciled, (l) => l.drifted === true);
  const unavailable = sum(counters, OUTREACH_METRICS.quota.reconciled, (l) => l.outcome === 'unavailable');
  const failures = sum(counters, OUTREACH_METRICS.stage.failures, (l) => l.stage === 'quota');

  if (reserved === 0 && reconciled === 0) return { name: 'quota', status: 'unknown', detail: 'no quota activity observed in this process yet' };

  const driftRate = reconciled > 0 ? drifted / reconciled : 0;
  const data = { reserved, reconciled, drifted, unavailable, failures, driftRate: Math.round(driftRate * 100) / 100 };

  if (failures > 0) return { name: 'quota', status: 'unhealthy', detail: `${failures} quota evaluation failure(s)`, data };
  if (unavailable > 0) {
    // The fast path could not be reconciled at all — the durable truth still
    // governs, but the optimization is blind.
    return { name: 'quota', status: 'degraded', detail: `${unavailable} reconciliation(s) could not reach the fast path`, data };
  }
  /**
   * OCCASIONAL drift is normal and self-correcting: reservations increment
   * ahead of the attempts they anticipate, so a reconciliation landing between
   * a reservation and its attempt legitimately sees a difference. Degrading on
   * ANY drift would leave every busy tenant permanently degraded, and an
   * indicator that is always amber is one nobody reads.
   *
   * PERSISTENT drift is different — it means the fast path is genuinely
   * diverging from what happened, and would eventually authorize a send the
   * durable truth would refuse. Threshold on the RATE, over a sample big
   * enough to distinguish the two.
   */
  if (reconciled >= 4 && driftRate > 0.5) {
    return { name: 'quota', status: 'degraded', detail: `${Math.round(driftRate * 100)}% of ${reconciled} reconciliations corrected drift`, data };
  }
  return {
    name: 'quota',
    status: 'healthy',
    detail: drifted > 0
      ? `${reserved} reservation(s); ${drifted} transient drift(s) corrected`
      : `${reserved} reservation(s), no drift`,
    data,
  };
}

/** Configuration state. Reports switches; never changes them. */
function configurationIndicator(): OutreachHealthIndicator {
  const globallyDisabled = isLeadOutreachGloballyDisabled();
  const emailEnabled = isEmailTransportEnabled();
  const channels = supportedChannels();
  const data = { globalKillSwitch: globallyDisabled, emailEnabled, registeredChannels: channels };

  if (globallyDisabled) {
    // A deliberate switch is not a fault; it IS something an operator must see
    // before spending an hour asking why nothing is sending.
    return { name: 'configuration', status: 'degraded', detail: 'the global lead-outreach kill switch is engaged; nothing will dispatch', data };
  }
  if (channels.length === 0) {
    return { name: 'configuration', status: 'unhealthy', detail: 'no transports are registered; no channel is dispatchable', data };
  }
  return {
    name: 'configuration',
    status: 'healthy',
    detail: `${channels.length} channel(s) registered (${channels.join(', ')}); email ${emailEnabled ? 'enabled' : 'disabled'}`,
    data,
  };
}

/**
 * The complete WS-3 runtime health report. Never throws — every indicator is
 * individually guarded, and a failure inside one degrades that indicator to
 * `unknown` rather than taking the report down.
 */
export function getOutreachRuntimeHealth(evaluatedAt?: string): OutreachHealthReport {
  const counters = readCounters();
  const indicators: OutreachHealthIndicator[] = [];

  const safely = (name: string, fn: () => OutreachHealthIndicator): OutreachHealthIndicator => {
    try {
      return fn();
    } catch (e) {
      return { name, status: 'unknown', detail: e instanceof Error ? e.message : String(e) };
    }
  };

  for (const stage of RUNTIME_STAGES) {
    if (stage === 'provider' || stage === 'quota') continue; // specialised below
    indicators.push(safely(stage, () => stageIndicator(counters, stage)));
  }
  indicators.push(safely('quota', () => quotaIndicator(counters)));
  indicators.push(safely('provider', () => providerIndicator(counters)));
  indicators.push(safely('configuration', configurationIndicator));

  const status = indicators.map((i) => i.status).reduce(worseOf, 'healthy' as OutreachHealthStatus);

  // Recording health is itself observability, and is fail-safe.
  for (const i of indicators) {
    try {
      recordHealthComponent(i.name, i.status);
    } catch {
      /* never break a health read */
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EXECUTION_RUNTIME_VERSION, GOVERNANCE_VERSION } = require('./runtimeVersion') as typeof import('./runtimeVersion');

  return {
    status,
    checkedAt: evaluatedAt ?? new Date().toISOString(),
    executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
    governanceVersion: GOVERNANCE_VERSION,
    processScoped: true,
    indicators,
    degradedComponents: indicators.filter((i) => i.status !== 'healthy').map((i) => i.name),
  };
}
