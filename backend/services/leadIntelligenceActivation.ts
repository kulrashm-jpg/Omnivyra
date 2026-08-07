/**
 * INT-002 Wave 1 — Lead Intelligence generation ACTIVATION.
 *
 * The ONE wiring seam between the lead lifecycle and the INT-001 orchestrator.
 * Pure plumbing: no algorithm, scoring, recommendation, or persistence-schema
 * logic lives here — the existing createLeadIntelligenceOrchestrator is used
 * exactly as implemented (fingerprint skip, engine/schema versioning, and
 * fail-open persistence are all its behaviour).
 *
 * Contract:
 *   • fire-and-forget: callers never await; a trigger can NEVER throw into,
 *     slow down, or change the response of a capture/tracking request.
 *   • fail-open: any error (including a missing lead_intelligence_profiles
 *     table — the durable ports already degrade) is swallowed.
 *   • duplicate-suppressing: a per-(company,lead) in-process cooldown absorbs
 *     rapid re-triggers (tracking batches); the orchestrator's fingerprint
 *     skip is the durable dedupe underneath.
 *   • kill switch: LEAD_INTELLIGENCE_GENERATION_DISABLED=true disables all
 *     triggers (activation is ON by default — that is Wave 1's purpose).
 */

import {
  createLeadIntelligenceOrchestrator,
  type LeadIntelligenceOrchestrator,
} from './leadIntelligenceOrchestration';
import { ownedDbTable } from '../db/writeOwner';
import {
  recordActivationDecision,
  recordActivationFanout,
} from './leadIntelligenceTelemetry';
import { logger } from './logger';
import { keepAliveAfterResponse } from '../../lib/runtime/keepAlive';

/**
 * HARDEN-INT-002 (6) — SERVERLESS DETACHED EXECUTION.
 *
 * Production Runtime Validation flagged an unproven assumption: these triggers
 * detach work AFTER the HTTP response, and the API tier runs as stateless
 * Vercel functions, where the execution context is frozen once the response is
 * sent. A bare `void promise` is therefore not guaranteed to complete — the
 * failure mode being that generation silently never runs in production.
 *
 * The remedy is the platform's canonical keep-alive abstraction,
 * `lib/runtime/keepAlive` ▸ `keepAliveAfterResponse` (STABILIZE-INT-001 (4) —
 * this module previously carried its own copy of the Vercel detection, which
 * is exactly the duplicated runtime abstraction that has now been removed):
 *   • on Vercel  → the promise is registered via `waitUntil` and reliably
 *                  completes after the response is flushed;
 *   • elsewhere  → the helper awaits the work, which is correct on long-lived
 *                  processes (worker/local/jest).
 * The caller is never blocked in either case, because the helper's promise is
 * deliberately not awaited here, and errors never propagate.
 */
export function detachBackgroundWork(work: Promise<unknown>): void {
  // STABILIZE-INT-001 (4): the waitUntil resolution itself is NOT reimplemented
  // here — `lib/runtime/keepAlive` is the platform's canonical abstraction for
  // work that must outlive the response, and it already owns the Vercel
  // detection, the optional-dependency import and the non-Vercel fallback.
  // This function remains only as the two adapters that helper deliberately
  // does not provide, and that the activation contract requires:
  //   1. never-reject — keepAliveAfterResponse documents that `work` must not
  //      throw, so failures are absorbed and logged here first;
  //   2. never-block — the helper AWAITS the work when no platform waitUntil
  //      exists, so the returned promise is intentionally not awaited. On
  //      Vercel the work is registered and the caller returns immediately; on
  //      long-lived runtimes (worker, local, jest) it simply runs detached.
  //      Either way the capture/tracking response is never delayed.
  const settled: Promise<void> = work.then(
    () => undefined,
    (e) => {
      // STABILIZE-INT-002 (D8): guard the handler itself. On Vercel the helper
      // hands `settled` to waitUntil and returns immediately, so a throw here
      // would reject `settled` with nothing left to catch it — an
      // unhandledRejection, which terminates the process by default on Node
      // ≥15. In the capture tier that is an outage, so it must be impossible.
      try {
        logger.warn('intel_background_work_failed', {
          detail: e instanceof Error ? e.message : String(e),
        });
      } catch {
        /* never convert a handled failure into a rejection */
      }
    },
  );
  void keepAliveAfterResponse(settled).catch(() => undefined);
}

export type ActivationReason =
  | 'lead_captured'
  | 'tracking_events'
  | 'attribution_updated'
  | 'enrichment_updated';

/** Rapid re-trigger absorption window (per company:lead / company:session). */
export const ACTIVATION_COOLDOWN_MS = 60_000;
/** Max leads regenerated per visitor-session trigger (bounded lookup). */
const SESSION_LEAD_CAP = 5;

type Deps = {
  orchestrator: LeadIntelligenceOrchestrator;
  now: () => number;
};

let defaultOrchestrator: LeadIntelligenceOrchestrator | null = null;
let overrides: Partial<Deps> | null = null;
const lastRun = new Map<string, number>();

function deps(): Deps {
  if (!defaultOrchestrator) defaultOrchestrator = createLeadIntelligenceOrchestrator();
  return {
    orchestrator: overrides?.orchestrator ?? defaultOrchestrator,
    now: overrides?.now ?? Date.now,
  };
}

function activationEnabled(): boolean {
  if (process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED === 'true') return false;
  // SAFETY GATE: under jest/NODE_ENV=test the default orchestrator would run
  // against the REAL database client from unit tests exercising capture
  // routes. Activation therefore only runs in tests when a suite explicitly
  // injects its own orchestrator via __setActivationOverridesForTests.
  if (process.env.NODE_ENV === 'test' && !overrides) return false;
  return true;
}

function underCooldown(key: string, now: number): boolean {
  const last = lastRun.get(key);
  if (last !== undefined && now - last < ACTIVATION_COOLDOWN_MS) return true;
  lastRun.set(key, now);
  if (lastRun.size > 5000) lastRun.clear(); // bounded memory, worst case = extra skipped-unchanged runs
  return false;
}

/** Test hooks — production code never calls these. */
export function __setActivationOverridesForTests(next: Partial<Deps> | null): void {
  overrides = next;
  lastRun.clear();
}

/**
 * Generate (or fingerprint-skip) intelligence for one lead. Awaitable core —
 * exported for tests; production callers use the fire-and-forget trigger.
 */
export async function runLeadIntelligenceGeneration(
  companyId: string,
  leadId: string,
  reason: ActivationReason,
): Promise<'ran' | 'disabled' | 'cooldown' | 'failed_open'> {
  if (!activationEnabled()) {
    recordActivationDecision('disabled', reason);
    return 'disabled';
  }
  if (!companyId || !leadId) {
    recordActivationDecision('failed_open', reason);
    return 'failed_open';
  }
  const d = deps();
  // Capture-time triggers always run (the fingerprint skip is the dedupe);
  // high-frequency tracking triggers additionally respect the cooldown.
  if (reason === 'tracking_events' && underCooldown(`lead:${companyId}:${leadId}`, d.now())) {
    recordActivationDecision('cooldown', reason);
    return 'cooldown';
  }
  try {
    await d.orchestrator.generate({ companyId, leadId });
    recordActivationDecision('ran', reason);
    return 'ran';
  } catch {
    recordActivationDecision('failed_open', reason);
    return 'failed_open'; // never propagates — activation must not break capture
  }
}

/** Fire-and-forget trigger for one lead. */
export function triggerLeadIntelligence(companyId: string, leadId: string, reason: ActivationReason): void {
  detachBackgroundWork(runLeadIntelligenceGeneration(companyId, leadId, reason));
}

/**
 * Awaitable core for session-driven regeneration: find the (bounded) set of
 * leads stitched to this visitor session and regenerate each. Used after
 * tracking-event ingestion and attribution/session updates.
 */
export async function runVisitorSessionRegeneration(
  companyId: string,
  visitorSessionId: string,
  reason: ActivationReason,
): Promise<number> {
  if (!activationEnabled()) {
    recordActivationDecision('disabled', reason);
    return 0;
  }
  if (!companyId || !visitorSessionId) return 0;
  const d = deps();
  if (underCooldown(`session:${companyId}:${visitorSessionId}`, d.now())) {
    recordActivationDecision('cooldown', reason);
    return 0;
  }
  let leadIds: string[] = [];
  try {
    const { data, error } = await ownedDbTable('leads')
      .select('id')
      .eq('company_id', companyId)
      .eq('visitor_session_id', visitorSessionId)
      .order('created_at', { ascending: true })
      .limit(SESSION_LEAD_CAP);
    leadIds = !error && Array.isArray(data)
      ? (data as Array<{ id?: unknown }>).map((r) => String(r.id ?? '')).filter(Boolean)
      : [];
  } catch {
    return 0; // fail-open
  }
  // Fan-out is the capacity driver for tracking ingestion: one batched POST can
  // reach SESSION_LEAD_CAP leads per session. Measured so the ceiling is
  // observable rather than inferred.
  recordActivationFanout('session_leads', leadIds.length);
  let ran = 0;
  for (const leadId of leadIds) {
    const outcome = await runLeadIntelligenceGeneration(companyId, leadId, reason);
    if (outcome === 'ran') ran += 1;
  }
  return ran;
}

/** Fire-and-forget trigger for every lead stitched to a visitor session. */
export function triggerVisitorSessionIntelligence(
  companyId: string,
  visitorSessionId: string,
  reason: ActivationReason,
): void {
  detachBackgroundWork(runVisitorSessionRegeneration(companyId, visitorSessionId, reason));
}

/** Designated hook for enrichment writers (CRM ingestion today; vendors later). */
export function onLeadEnrichmentChanged(companyId: string, leadId: string): void {
  triggerLeadIntelligence(companyId, leadId, 'enrichment_updated');
}
