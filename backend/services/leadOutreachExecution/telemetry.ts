/**
 * WS-3 — Lead Outreach Execution telemetry.
 *
 * Plugs into the EXISTING HARDEN-001 registry. No new infrastructure, no new
 * transport, no parallel monitoring framework — new names flow into the
 * observability snapshot and the Prometheus exporter automatically because both
 * enumerate the registry generically.
 *
 * Same rules the WS-2 telemetry module enforces, for the same reasons:
 *  - FAIL-SAFE: every recorder is wrapped; telemetry can never break a caller.
 *  - BOUNDED CARDINALITY: labels come from small closed sets only. Company,
 *    lead and task ids are NEVER labels — they would be unbounded.
 *  - NO SENSITIVE DATA: no email, phone, handle or suppression value is ever
 *    recorded here. A suppression VALUE is exactly the personal data the
 *    suppression exists to protect; it belongs in the database row, not in a
 *    metric an exporter will publish.
 */

import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import { classifyFailure, type FailureClass, type RuntimeStage } from './failureTaxonomy';

/** `<domain>.<subject>.<unit>`, matching the HARDEN-001 convention. */
export const OUTREACH_METRICS = {
  governance: {
    evaluations: 'outreach.governance.evaluations',
    gate: 'outreach.governance.gate',
    failures: 'outreach.governance.failures',
  },
  // WS-3 M5A: the first executable runtime. `dispatch` answers "is work
  // actually leaving the planner?", `quota` answers "is the durable limiter
  // healthy, and is its fast path drifting from the truth?".
  dispatch: {
    outcome: 'outreach.dispatch.outcome',
    duration: 'outreach.dispatch.duration_ms',
  },
  quota: {
    reserved: 'outreach.quota.reserved',
    reconciled: 'outreach.quota.reconciled',
  },
  // WS-3 M5B: the external boundary. `external.dispatch` separates sends that
  // leave the platform from internal ones — they carry different risk and must
  // be alertable independently. `provider` answers "is the provider healthy?".
  external: {
    dispatch: 'outreach.external.dispatch',
  },
  provider: {
    response: 'outreach.provider.response',
    latency: 'outreach.provider.latency_ms',
    errors: 'outreach.transport.errors',
  },
  // WS-3 M6: the stages that previously emitted nothing, plus one taxonomy
  // counter every failure in the runtime funnels through, and the health
  // rollup. Together these make every stage of the pipeline observable rather
  // than only the ones that happened to be built with metrics.
  stage: {
    outcome: 'outreach.stage.outcome',
    failures: 'outreach.stage.failures',
  },
  lifecycle: {
    transition: 'outreach.lifecycle.transition',
  },
  health: {
    component: 'outreach.health.component',
  },
  // WS-3 M7: the feedback boundary. `result` answers "are webhooks landing?",
  // and its `duplicate` series is expected to be LARGE — at-least-once
  // transports redeliver constantly, so a duplicate rate near zero is more
  // suspicious than a high one: it usually means the provider is not retrying
  // because it never received our 2xx.
  feedback: {
    result: 'outreach.feedback.result',
    routed: 'outreach.feedback.routed',
  },
} as const;

const counter = (name: string, labels?: Record<string, string | number | boolean>): void => {
  try {
    recordRawCounter(name, 1, labels);
  } catch {
    /* telemetry must never break the caller */
  }
};

/** Overall outcome of one governance evaluation. 3 series. */
export function recordGovernanceEvaluation(decision: 'allowed' | 'blocked' | 'deferred'): void {
  counter(OUTREACH_METRICS.governance.evaluations, { decision });
}

/**
 * One gate's verdict within an evaluation. Bounded at 6 gates × 3 decisions =
 * 18 series regardless of traffic — this is the rule-distribution signal.
 */
export function recordGovernanceGate(gate: string, decision: 'allowed' | 'blocked' | 'deferred'): void {
  counter(OUTREACH_METRICS.governance.gate, { gate, decision });
}

/**
 * An evaluation could not complete. Distinct from `blocked`: blocked means the
 * rules said no, failure means we could not ask. Conflating them would let a
 * broken governance layer look like a quiet one.
 */
export function recordGovernanceFailure(stage: 'context_load' | 'evaluation' | 'persistence'): void {
  counter(OUTREACH_METRICS.governance.failures, { stage });
}

// ── WS-3 M5A: dispatch + quota ──────────────────────────────────────────────

/** One dispatch outcome. Closed set — 6 series regardless of traffic. */
export type DispatchMetricOutcome = 'started' | 'sent' | 'skipped' | 'blocked' | 'deferred' | 'failed';

export function recordDispatchOutcome(outcome: DispatchMetricOutcome): void {
  counter(OUTREACH_METRICS.dispatch.outcome, { outcome });
}

/** End-to-end dispatch latency, successful sends only. */
export function recordDispatchDuration(durationMs: number): void {
  try {
    if (Number.isFinite(durationMs)) recordRawHistogram(OUTREACH_METRICS.dispatch.duration, durationMs);
  } catch {
    /* telemetry must never break the caller */
  }
}

/** Quota reservation outcome and which durable layer answered. 4 series. */
export function recordQuotaReserved(outcome: 'granted' | 'refused', layer: 'redis' | 'db'): void {
  counter(OUTREACH_METRICS.quota.reserved, { outcome, layer });
}

/**
 * Reconciliation of the Redis fast path against the durable truth.
 *
 * `drifted` is the signal that matters: a persistent drift means the fast path
 * is diverging from what actually happened, which would eventually authorize a
 * send the truth would refuse.
 */
export function recordQuotaReconciled(outcome: 'reconciled' | 'unavailable', drifted: boolean): void {
  counter(OUTREACH_METRICS.quota.reconciled, { outcome, drifted });
}

// ── WS-3 M5B: external transport ────────────────────────────────────────────

/**
 * A dispatch outcome, split by whether it left the platform.
 *
 * `external=true` is the series that matters operationally: an internal work
 * item failing is an inconvenience, an external send failing is a lead nobody
 * contacted. Bounded at 2 × 6 = 12 series.
 */
export function recordExternalOutcome(external: boolean, outcome: string): void {
  counter(OUTREACH_METRICS.external.dispatch, { external, outcome });
}

/**
 * Provider verdict. `provider` is a closed set of registered transports, never
 * a message id or recipient.
 */
export function recordProviderResponse(provider: string, outcome: string): void {
  counter(OUTREACH_METRICS.provider.response, { provider, outcome });
  if (outcome === 'provider_error' || outcome === 'transport_error' || outcome === 'timeout') {
    counter(OUTREACH_METRICS.provider.errors, { provider, kind: outcome });
  }
}

/** Provider round-trip latency. The canary for a degrading provider. */
export function recordProviderLatency(latencyMs: number): void {
  try {
    if (Number.isFinite(latencyMs)) recordRawHistogram(OUTREACH_METRICS.provider.latency, latencyMs);
  } catch {
    /* telemetry must never break the caller */
  }
}

// ── WS-3 M6: stage, failure taxonomy, lifecycle and health ──────────────────

/**
 * One stage outcome. `outcome` is a small closed vocabulary shared across
 * stages (`ok`, `skipped`, `duplicate`, `refused`, `failed`) so a dashboard can
 * compare stages without knowing each stage's private vocabulary.
 *
 * Bounded at 9 stages × 5 outcomes = 45 series.
 */
export type StageOutcome = 'ok' | 'skipped' | 'duplicate' | 'refused' | 'failed';

export function recordStageOutcome(stage: RuntimeStage, outcome: StageOutcome): void {
  counter(OUTREACH_METRICS.stage.outcome, { stage, outcome });
}

/**
 * THE failure counter. Every WS-3 failure funnels through here classified into
 * the closed taxonomy, so "what is broken right now" is one query rather than a
 * union over per-stage metrics that each spell failure differently.
 *
 * Deliberately separate from `recordStageOutcome(stage,'failed')`: that answers
 * "which stage", this answers "what kind" — and the second determines who gets
 * paged. Bounded at 9 classes × 9 stages = 81 series worst case.
 */
export function recordFailure(stage: RuntimeStage, error?: unknown): FailureClass {
  const klass = classifyFailure(stage, error);
  counter(OUTREACH_METRICS.stage.failures, { stage, class: klass });
  return klass;
}

/**
 * A lifecycle transition that actually happened. `from`/`to` are lifecycle
 * states, a closed set — never a task id.
 */
export function recordLifecycleTransition(from: string, to: string): void {
  counter(OUTREACH_METRICS.lifecycle.transition, { from, to });
}

/** One health component's status, recorded when health is evaluated. */
export function recordHealthComponent(component: string, status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'): void {
  counter(OUTREACH_METRICS.health.component, { component, status });
}

// ── WS-3 M7 — feedback ingestion ────────────────────────────────────────────
//
// Labels are the signal vocabulary and the source vocabulary, both small closed
// sets. The provider's event id, the recipient's address and the reply body are
// never recorded here — a reply body is the most sensitive payload in the whole
// runtime, and a metric label is the last place it may appear.

/** Outcome of one ingestion. Bounded at 3 results × 10 signals × 7 sources. */
export function recordFeedbackIngestion(
  result: 'accepted' | 'duplicate' | 'rejected',
  signal: string,
  source?: string,
): void {
  counter(OUTREACH_METRICS.feedback.result, { result, signal, source: source ?? 'unknown' });
}

/**
 * Which axis a signal was routed to. 2 axes × 9 signals.
 *
 * Separate from the result counter because routing is the part most likely to
 * be wrong in a new provider integration: a provider that starts reporting
 * bounces as a business outcome shows up here immediately.
 */
export function recordFeedbackRouting(axis: 'delivery' | 'business', signal: string): void {
  counter(OUTREACH_METRICS.feedback.routed, { axis, signal });
}
