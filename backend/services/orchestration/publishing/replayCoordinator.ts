/**
 * replayCoordinator — Phase-2 Step-35.
 *
 * Coordinates autonomous deferred-execution replay: scans the canonical
 * state of previously-deferred executions, applies dedupe + per-execution
 * cooldown + per-campaign concurrency safety, and produces a canonical
 * ReplayExecutionSummary. It NEVER itself enqueues — the scheduler's
 * per-run canonical re-resolution (Step-33/34) is what physically replays
 * a now-ready execution; this coordinator is the safe, observable,
 * cooldown-guarded recovery brain that prevents permanent stranding.
 *
 * Process-local guards (mirror the Step-19 generation queue pattern):
 *  - dedupe/concurrency: one in-flight coordination per campaign
 *  - cooldown: an execution re-scanned inside the window is skipped
 *  - fail-soft: any failure ⇒ empty summary, never throws/blocks runtime
 */

import { scanReplayCandidates } from './deferredExecutionReplay';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

const REPLAY_COOLDOWN_MS = 5 * 60_000;
const inflight = new Map<string, Promise<ReplayExecutionSummary>>();
const lastReplayAt = new Map<string, number>(); // key: `${campaign}:${exec}`
const attemptCount = new Map<string, number>();

export interface ReplayExecutionSummary {
  campaign_id: string;
  scheduler_mode: string;
  orchestration_version: string;
  replayed_ids: string[];
  deferred_ids: string[];
  permanently_blocked_ids: string[];
  replay_failures: string[];
  replay_attempts: Record<string, number>;
  replay_cooldowns: string[];
  fallback_active: boolean;
}

function emptySummary(campaignId: string, fallback: boolean): ReplayExecutionSummary {
  return {
    campaign_id: campaignId,
    scheduler_mode: 'SHADOW',
    orchestration_version: 'unknown',
    replayed_ids: [],
    deferred_ids: [],
    permanently_blocked_ids: [],
    replay_failures: [],
    replay_attempts: {},
    replay_cooldowns: [],
    fallback_active: fallback,
  };
}

/**
 * Coordinate replay for a set of previously-deferred execution ids.
 * Idempotent per campaign (joins an in-flight coordination). Cooldown +
 * dedupe applied per execution. Never throws.
 */
export async function coordinateReplay(
  campaignId: string,
  deferredIds: string[],
): Promise<ReplayExecutionSummary> {
  if (!campaignId || !Array.isArray(deferredIds) || deferredIds.length === 0) {
    return emptySummary(campaignId, false);
  }

  const existing = inflight.get(campaignId);
  if (existing) {
    LOG('REPLAY_COOLDOWN', { campaign_id: campaignId, reason: 'coordination_in_flight', cooldown_active: true });
    try {
      return await existing;
    } catch {
      return emptySummary(campaignId, true);
    }
  }

  const run = (async (): Promise<ReplayExecutionSummary> => {
    const now = Date.now();
    const summary = emptySummary(campaignId, false);

    // Cooldown filter (dedupe rapid re-scans of the same execution).
    const eligibleIds: string[] = [];
    for (const eid of deferredIds) {
      const key = `${campaignId}:${eid}`;
      const last = lastReplayAt.get(key);
      if (last != null && now - last < REPLAY_COOLDOWN_MS) {
        summary.replay_cooldowns.push(eid);
        LOG('REPLAY_COOLDOWN', {
          campaign_id: campaignId, execution_id: eid,
          since_last_ms: now - last, cooldown_active: true,
        });
        continue;
      }
      eligibleIds.push(eid);
    }
    if (eligibleIds.length === 0) return summary;

    let scan;
    try {
      scan = await scanReplayCandidates(campaignId, eligibleIds);
    } catch {
      eligibleIds.forEach((id) => summary.replay_failures.push(id));
      summary.fallback_active = true;
      LOG('DEFERRED_REPLAY', { campaign_id: campaignId, fallback_active: true, reason: 'scan_failed' });
      return summary;
    }

    summary.scheduler_mode = scan.scheduler_mode;
    summary.orchestration_version =
      scan.records.find((r) => r.orchestration_version !== 'unknown')?.orchestration_version ??
      'unknown';

    for (const eid of scan.replay_ready) {
      const key = `${campaignId}:${eid}`;
      const attempts = (attemptCount.get(key) ?? 0) + 1;
      attemptCount.set(key, attempts);
      lastReplayAt.set(key, Date.now());
      summary.replayed_ids.push(eid);
      summary.replay_attempts[eid] = attempts;
      LOG('REPLAY_REQUEUED', {
        campaign_id: campaignId, execution_id: eid,
        replay_state: 'replay_ready', replay_attempt: attempts,
        scheduler_mode: scan.scheduler_mode, cooldown_active: false,
      });
    }
    for (const eid of scan.still_deferred) {
      summary.deferred_ids.push(eid);
      LOG('REPLAY_DEFERRED', {
        campaign_id: campaignId, execution_id: eid,
        replay_state: 'still_deferred', scheduler_mode: scan.scheduler_mode,
      });
    }
    for (const eid of scan.permanently_blocked) {
      summary.permanently_blocked_ids.push(eid);
      LOG('REPLAY_BLOCKED', {
        campaign_id: campaignId, execution_id: eid,
        replay_state: 'permanently_blocked', scheduler_mode: scan.scheduler_mode,
      });
    }
    return summary;
  })();

  inflight.set(campaignId, run);
  try {
    return await run;
  } catch {
    return emptySummary(campaignId, true);
  } finally {
    inflight.delete(campaignId);
  }
}

/** Test/operational hook — clear process-local replay guard state. */
export function __resetReplayCoordinator(): void {
  inflight.clear();
  lastReplayAt.clear();
  attemptCount.clear();
}
