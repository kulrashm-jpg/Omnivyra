/**
 * Phase 1B.1 — Thread multi-row runtime mode flag.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RUNTIME PUBLISH-OWNERSHIP SEMANTICS (READ BEFORE TOUCHING THIS FILE)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `scheduled_posts.status='scheduled'` IS THE AUTHORITATIVE PUBLISH TRIGGER.
 *
 * The cron at pages/api/cron/process-scheduled-posts.ts scans scheduled_posts
 * directly (NOT via queue_jobs) for rows where:
 *   - status = 'scheduled'
 *   - scheduled_for <= now
 * ANY row matching these conditions WILL be published by the cron, regardless
 * of whether enqueueScheduledPostAt was ever called.
 *
 * `queue_jobs` is ADVISORY ONLY — it accelerates the BullMQ-driven hot path.
 * Missing or failed enqueueScheduledPostAt calls do NOT block publish; the
 * cron's direct scan is the safety net.
 *
 * Therefore: ANY ROW THAT MUST NOT PUBLISH MUST HAVE status != 'scheduled'.
 *   - Dormant multi-row child rows use status='draft' to stay invisible.
 *   - In shadow mode, the multi-row ROOT also uses status='draft' so that the
 *     legacy joined row is the only publish trigger and there is NO duplicate
 *     publish through the cron's direct scan.
 *
 * Future developers: do NOT enqueue dormant rows. Do NOT assume queue
 * ownership equals publish ownership. Verify status='draft' for any row that
 * exists for topology/observability purposes only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FLAG SEMANTICS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Server-side env-var gate, mirroring the `PLANNER_CONTRACT_ENFORCEMENT_MODE`
 * pattern (see backend/services/campaignAiCapacity.ts). Three values:
 *
 *   - 'off'     (default): legacy joined-content single-row inserts only.
 *                          Multi-row payload (if sent by client) is ignored.
 *   - 'shadow'           : legacy single-row insert still runs and IS the
 *                          publish source-of-truth (status='scheduled').
 *                          Multi-row representation ALSO inserted but the ROOT
 *                          is created with status='draft' so the cron cannot
 *                          double-publish. Children also status='draft'.
 *   - 'enforce'          : multi-row insert ONLY. Hard-gated by the orchestrator
 *                          flag (see checkEnforceGate); rejected with 422 when
 *                          THREAD_ORCHESTRATOR_ENABLED != 'true' to prevent
 *                          first-segment-only data loss before 1B.2 ships.
 *
 * Read direct from process.env on every call (no caching) so a runtime flip
 * via vercel env update / restart takes effect on the next request.
 */

export type ThreadRuntimeMode = 'off' | 'shadow' | 'enforce';

export function getThreadRuntimeMode(): ThreadRuntimeMode {
  const raw = String(process.env.THREAD_MULTI_ROW_RUNTIME ?? 'off').toLowerCase().trim();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'enforce') return 'enforce';
  return 'off';
}

/** True when the multi-row insert path should run alongside or instead of legacy. */
export function isMultiRowWriteEnabled(): boolean {
  const mode = getThreadRuntimeMode();
  return mode === 'shadow' || mode === 'enforce';
}

/** True when the legacy joined-content insert should be SKIPPED in favor of multi-row. */
export function isLegacyJoinedWriteSkipped(): boolean {
  return getThreadRuntimeMode() === 'enforce';
}

/**
 * Phase 1B.1A — Enforce-mode hard gate.
 *
 * Enforce mode without a thread orchestrator publishes ONLY the root segment
 * of a multi-node thread (children sit dormant in status='draft' indefinitely).
 * That is a data-loss event for users. We block enforce mode at the request
 * boundary until 1B.2 ships AND the operator explicitly opts in by setting
 * THREAD_ORCHESTRATOR_ENABLED=true.
 *
 * Default: false. Operator must set both env vars to enable enforce mode.
 */
export function isThreadOrchestratorEnabled(): boolean {
  return String(process.env.THREAD_ORCHESTRATOR_ENABLED ?? 'false').toLowerCase().trim() === 'true';
}

export type EnforceGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Call at the top of any code path that would insert a multi-row thread under
 * enforce mode. Returns `allowed: false` when enforce is active but the
 * orchestrator flag is not, with a clear operator-facing reason.
 *
 * Shadow and off modes are always allowed by this gate — they have their own
 * safety properties (legacy row remains the publish source-of-truth).
 */
export function checkEnforceGate(): EnforceGateResult {
  const mode = getThreadRuntimeMode();
  if (mode !== 'enforce') return { allowed: true };
  if (isThreadOrchestratorEnabled()) return { allowed: true };
  return {
    allowed: false,
    reason: 'Multi-row thread publish orchestration is not enabled yet. Enforce mode is blocked until Phase 1B.2.',
  };
}
