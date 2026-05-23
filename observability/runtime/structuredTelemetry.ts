/**
 * Structured telemetry envelope — single canonical emission helper for
 * planner-related operational events.
 *
 * Contract guarantees (per the stabilization-governance spec):
 *   - One JSON.stringify per emission.
 *   - One console.X call per emission (no duplicate writes).
 *   - Provenance fields (deployment_id, git_sha, worker_pid) read once
 *     at module load via WORKER_PROVENANCE; never re-read per emission.
 *   - Severity drives the log level mapping (warn/error vs info).
 *   - Caller passes payload as a plain object — no spread/clone happens
 *     beyond the single envelope literal.
 *
 * Use this for any structured event that should be aggregation-ready
 * (drift dashboards, alerting, post-mortem reconstruction). Freeform
 * console.log strings remain valid for one-off diagnostic breadcrumbs
 * — this helper is for events that have a stable schema across
 * environments and need to be queryable.
 */

import { WORKER_PROVENANCE } from './workerProvenance';

/**
 * Canonical severity vocabulary for structured operational events.
 *
 * Semantics (aligned with docs/telemetry-taxonomy.md):
 *   debug    — extra-fine-grained signal; off by default in production
 *              log routing; useful during a focused investigation.
 *   info     — normal lifecycle markers (e.g. worker pickup, run
 *              completed). Not alert-worthy on their own.
 *   warn     — degraded but recoverable; operator review preferred but
 *              not required.
 *   error    — runtime error path; operator review required.
 *   critical — severe / data-integrity-affecting / SLA-breach event.
 *              Page-worthy.
 *
 * `blocking` is a DEPRECATED alias for `critical` retained for one
 * release cycle so any external consumer that snapshotted the prior
 * type keeps working. New emitters MUST use `critical`. Removal is
 * tracked in docs/planner-cleanup-inventory.md.
 *
 * TODO(remove-after-severity-vocabulary-stable): drop the `blocking`
 * variant once no caller passes it.
 */
export type TelemetrySeverity =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'critical'
  | 'blocking';

export interface TelemetryContext {
  /** BOLT run id when available; null for non-BOLT planner paths. */
  run_id?: string | null;
  /** Planner pipeline stage marker (e.g. 'ai/plan', 'commit-plan'). */
  planner_stage?: string | null;
}

/**
 * Emit a single canonical structured event. The envelope shape is
 * stable across the codebase so log aggregators can group / filter
 * by any field without per-event schema awareness.
 *
 * Field order (kept consistent so visual scanning of stringified
 * output stays predictable):
 *   event, severity, deployment_id, git_sha, worker_pid, run_id,
 *   planner_stage, timestamp, …payload
 *
 * @param event       Stable event name (e.g. 'planner_contract_violation').
 *                    Snake_case lowercase per existing convention.
 * @param severity    'info' / 'warn' / 'error' / 'blocking'.
 *                    'info' → console.log; everything else → console.warn
 *                    (we deliberately avoid console.error for severity
 *                    'error' / 'blocking' to keep noise consistent for
 *                    log scrapers; severity field carries the level).
 * @param context     Caller-supplied correlation IDs in scope at the
 *                    emission point.
 * @param payload     Event-specific fields. Merged into the envelope
 *                    via a single object literal (no spread allocation
 *                    overhead beyond what JSON.stringify already costs).
 */
export function emitStructuredEvent(
  event: string,
  severity: TelemetrySeverity,
  context: TelemetryContext,
  payload: Record<string, unknown>,
): void {
  // Normalize deprecated `blocking` to canonical `critical` on the
  // way out. The event's emitted `severity` field is ALWAYS one of
  // the canonical five (debug/info/warn/error/critical) so log
  // aggregators don't have to special-case the legacy variant.
  const normalizedSeverity: Exclude<TelemetrySeverity, 'blocking'> =
    severity === 'blocking' ? 'critical' : severity;

  const envelope = {
    event,
    severity: normalizedSeverity,
    deployment_id: WORKER_PROVENANCE.deploymentId,
    git_sha: WORKER_PROVENANCE.gitSha,
    worker_pid: WORKER_PROVENANCE.workerPid,
    run_id: context.run_id ?? null,
    planner_stage: context.planner_stage ?? null,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  const line = JSON.stringify(envelope);
  // Log-level routing. debug/info → console.log (low-noise); warn →
  // console.warn; error/critical → console.error so the host runtime
  // can prioritize them in any stderr-based filters. The structured
  // `severity` field remains the real signal — log levels are a
  // bonus for environments without a JSON parser in the routing layer.
  if (normalizedSeverity === 'debug' || normalizedSeverity === 'info') {
    // eslint-disable-next-line no-console
    console.log(line);
  } else if (normalizedSeverity === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // error / critical
    // eslint-disable-next-line no-console
    console.error(line);
  }
}
