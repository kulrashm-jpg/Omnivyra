/**
 * Replay worker (opt-in, idempotent). Drains durably-captured replay payloads
 * whose target is a whitelisted IDEMPOTENT op and re-dispatches them through
 * the existing replayOrchestrationService (atomic-locked + deduped). NOT
 * auto-registered in cron — operational decision. Safe to run repeatedly:
 * dedupe + idempotent targets guarantee no duplicate writes.
 */
import {
  listReplayPayloads,
  markReplayPayloadOutcome,
} from '../services/intelligence/rawReplayCaptureService';
import {
  executeReplay,
  type ReplayTarget,
} from '../services/intelligence/replayOrchestrationService';

let running = false;
const REPLAYABLE: ReplayTarget[] = ['api_base_rediscovery', 'connection_revalidate', 'normalization'];
const MAX_PER_RUN = 50;

export async function runReplayWorker(
  companyId: string,
): Promise<{ scanned: number; replayed: number; failed: number; skipped: number } | { skipped: true; reason: string }> {
  if (running) return { skipped: true, reason: 'replay worker already in progress' };
  running = true;
  let replayed = 0;
  let failed = 0;
  let skipped = 0;
  try {
    const pending = (await listReplayPayloads(companyId, 'pending', MAX_PER_RUN)) as Array<{
      id: string; target: string; dedupe_key: string; payload?: Record<string, unknown>;
    }>;
    for (const p of pending) {
      if (!REPLAYABLE.includes(p.target as ReplayTarget)) { skipped += 1; continue; }
      const res = await executeReplay({
        companyId,
        target: p.target as ReplayTarget,
        dedupeKey: p.dedupe_key,
        payload: (p.payload ?? {}) as Record<string, unknown>,
      });
      if (res.status === 'succeeded') { replayed += 1; await markReplayPayloadOutcome(companyId, p.id, 'replayed'); }
      else if (res.status === 'deduped') { skipped += 1; await markReplayPayloadOutcome(companyId, p.id, 'replayed'); }
      else if (res.status === 'throttled') { skipped += 1; }
      else { failed += 1; await markReplayPayloadOutcome(companyId, p.id, 'failed'); }
    }
    console.warn(`[replayWorker] done ${JSON.stringify({ companyId, scanned: pending.length, replayed, failed, skipped })}`);
    return { scanned: pending.length, replayed, failed, skipped };
  } catch (err) {
    console.error(`[replayWorker] failed ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    running = false;
  }
}
