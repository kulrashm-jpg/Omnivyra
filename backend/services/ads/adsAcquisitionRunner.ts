/**
 * PO-3 F1 — the ONE production composition of the Ads Transparency acquisition cycle.
 *
 * ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * There are two ways a cycle can start: the daily cron tick, and the authenticated operational
 * trigger on the worker health server. If each built its own dependencies, the trigger could
 * drift from the scheduled path — a different session factory, a different sink, or a bound
 * applied in one place and not the other. That is exactly the class of defect the PO-3 identity
 * work exists to prevent, so both callers import this and neither composes its own.
 *
 * ─── PUBLIC AND ANONYMOUS ─────────────────────────────────────────────────
 * The session factory opens a FRESH unauthenticated context per page. The authenticated
 * `rpaPlaywrightRunner` `storageState` path is not reachable from here: there is no parameter
 * through which a session could be supplied, which is what keeps this evidence public-domain.
 *
 * ─── THE FLAG IS NOT READ HERE ────────────────────────────────────────────
 * `runAdsAcquisitionCycle` reads `ADS_TRANSPARENCY_ACQUISITION_ENABLED` itself, before it calls
 * `listDueSubjects` or opens a session. Deliberately not duplicated: a second read is a second
 * thing that can disagree with the first.
 */
import { runAdsAcquisitionCycle } from './adsAcquisitionScheduler';

/**
 * Run exactly one production acquisition cycle.
 *
 * Never throws — a caller (cron tick or operational trigger) must not be taken down by a
 * provider or browser failure. Returns the scheduler-shaped counters either way.
 */
export async function runProductionAdsAcquisitionCycle(): Promise<Record<string, number>> {
  try {
    const { listDueAdsSubjects } = await import('./adsDueSubjects');
    const { createAdsEvidenceSink } = await import('./adsEvidenceStore');
    return await runAdsAcquisitionCycle({
      listDueSubjects: listDueAdsSubjects,
      openSession: async () => {
        // Imported HERE, not at composition time: with the flag off (or with nothing due)
        // `runAdsAcquisitionCycle` returns before opening a session, and a disabled worker
        // should not pay to load a browser driver it will never use.
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        return {
          session: {
            async withPage(fn) {
              const ctx = await browser.newContext();
              const page = await ctx.newPage();
              try {
                return await fn(page as unknown as Parameters<typeof fn>[0]);
              } finally {
                await ctx.close().catch(() => undefined);
              }
            },
          },
          close: async () => { await browser.close().catch(() => undefined); },
        };
      },
      sink: createAdsEvidenceSink(),
      vantage: process.env.RAILWAY_REGION ? `railway:${process.env.RAILWAY_REGION}` : 'railway',
    });
  } catch (err: unknown) {
    console.warn('[adsTransparencyAcquisition] exception:', err instanceof Error ? err.message : String(err));
    return { errors: 1 };
  }
}

/**
 * Process-local single-flight guard.
 *
 * SCOPE, STATED PLAINLY: this is per worker PROCESS, not distributed. It is the right boundary
 * here because acquisition runs only on the Railway worker and `scheduleWorker` already serialises
 * the scheduled path; the gap it closes is an operator triggering a second cycle while one is in
 * flight. If acquisition is ever run on more than one replica, this must be revisited — a second
 * process would not see this flag.
 */
let inFlight = false;

/** True while a cycle started through `runGuardedAdsAcquisitionCycle` has not yet settled. */
export function adsAcquisitionInFlight(): boolean {
  return inFlight;
}

/**
 * Both members carry `result`, so callers never depend on narrowing to read it. A boolean-literal
 * discriminant did not narrow under every tsconfig in this repo; `status` plus a always-present
 * `result` compiles the same way everywhere.
 */
export type GuardedCycleResult =
  | { status: 'completed'; result: Record<string, number> }
  | { status: 'already_running'; result: null };

/**
 * Run one cycle unless one is already running in this process.
 *
 * Returns `already_running` rather than queueing: an operator asking for a cycle while one is
 * running wants to know that, not to schedule a second fan-out behind it.
 */
export async function runGuardedAdsAcquisitionCycle(
  run: () => Promise<Record<string, number>> = runProductionAdsAcquisitionCycle,
): Promise<GuardedCycleResult> {
  if (inFlight) return { status: 'already_running', result: null };
  inFlight = true;
  try {
    return { status: 'completed', result: await run() };
  } finally {
    inFlight = false;
  }
}
