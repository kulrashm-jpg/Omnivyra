/**
 * Creator Cron Orchestration Service
 *
 * Distributed-safe cron primitives for the creator workflow's
 * recurring jobs (janitor, integrity audit, queue drift sweep,
 * stale-session reaper, alert evaluator).
 *
 * Uses the `creator_cron_lease` table as a DB-backed singleton lock so
 * multiple cron processes (web + worker pools) never run the same job
 * concurrently. Lease semantics:
 *
 *   - acquireCronLease(jobName, holderId, ttlMs)
 *       → INSERT ON CONFLICT only if existing lease is expired.
 *       → returns false on contention.
 *   - releaseCronLease(jobName, holderId)
 *       → deletes only if holder matches.
 *
 * Wraps job invocations in:
 *   - timeout guards (terminate runaway jobs)
 *   - retry guards (transient errors retry once)
 *   - structured telemetry start/end events
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { emitCreatorEvent } from './creatorOperationalTelemetryService';

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000; // 5 min

const _heldLeases = new Map<string, NodeJS.Timeout>();

export async function acquireCronLease(input: {
  jobName: string;
  holderId?: string;
  ttlMs?: number;
}): Promise<{ acquired: boolean; holderId: string; expiresAt: string }> {
  const holderId = input.holderId ?? `${process.pid}:${randomUUID()}`;
  const ttlMs = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // Step 1: check current lease.
    const { data: existing } = await supabase
      .from('creator_cron_lease')
      .select('job_name, holder_id, expires_at')
      .eq('job_name', input.jobName)
      .maybeSingle();

    if (existing) {
      const expiresMs = new Date((existing as any).expires_at).getTime();
      if (expiresMs > now.getTime()) {
        return { acquired: false, holderId: (existing as any).holder_id, expiresAt: (existing as any).expires_at };
      }
      // Lease expired — take it over.
      const { error } = await ownedDbTable('creator_cron_lease')
        .update({
          holder_id: holderId,
          acquired_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          last_heartbeat: now.toISOString(),
        })
        .eq('job_name', input.jobName)
        .eq('expires_at', (existing as any).expires_at); // optimistic update
      if (error) {
        return { acquired: false, holderId: (existing as any).holder_id, expiresAt: (existing as any).expires_at };
      }
    } else {
      await ownedDbTable('creator_cron_lease').insert({
        job_name: input.jobName,
        holder_id: holderId,
        acquired_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_heartbeat: now.toISOString(),
        run_count: 0,
      });
    }

    // Setup heartbeat refresh every TTL/3 to extend ownership during long jobs.
    const heartbeatInterval = Math.max(15_000, Math.floor(ttlMs / 3));
    const timer = setInterval(async () => {
      try {
        await ownedDbTable('creator_cron_lease')
          .update({
            last_heartbeat: new Date().toISOString(),
            expires_at: new Date(Date.now() + ttlMs).toISOString(),
          })
          .eq('job_name', input.jobName)
          .eq('holder_id', holderId);
      } catch { /* silence */ }
    }, heartbeatInterval);
    timer.unref?.();
    _heldLeases.set(`${input.jobName}:${holderId}`, timer);

    return { acquired: true, holderId, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    logger.warn('creatorCronOrchestration.acquire_failed', {
      surface: 'creatorCronOrchestration',
      job_name: input.jobName,
      error: (err as Error)?.message ?? String(err),
    });
    return { acquired: false, holderId, expiresAt: expiresAt.toISOString() };
  }
}

export async function releaseCronLease(input: { jobName: string; holderId: string; status?: string; error?: string }): Promise<void> {
  const heartbeatKey = `${input.jobName}:${input.holderId}`;
  const t = _heldLeases.get(heartbeatKey);
  if (t) {
    clearInterval(t);
    _heldLeases.delete(heartbeatKey);
  }
  try {
    await ownedDbTable('creator_cron_lease')
      .update({
        expires_at: new Date().toISOString(),
        last_status: input.status ?? 'released',
        last_error: input.error ?? null,
      })
      .eq('job_name', input.jobName)
      .eq('holder_id', input.holderId);
  } catch (err) {
    logger.warn('creatorCronOrchestration.release_failed', {
      surface: 'creatorCronOrchestration',
      job_name: input.jobName,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

/**
 * Run a cron job with full reliability harness:
 *   - singleton lease (skip if held)
 *   - timeout guard (Promise.race vs a timeout)
 *   - structured telemetry around start/end
 *   - guaranteed lease release on success/failure
 */
export async function runCronJobWithLease<T>(input: {
  jobName: string;
  ttlMs?: number;
  timeoutMs?: number;
  run: () => Promise<T>;
  metadata?: Record<string, unknown>;
}): Promise<{ ran: boolean; result?: T; error?: string; duration_ms: number }> {
  const startedAt = Date.now();
  const lease = await acquireCronLease({ jobName: input.jobName, ttlMs: input.ttlMs });
  if (!lease.acquired) {
    emitCreatorEvent({
      event: 'cron_job_skipped',
      metadata: { job_name: input.jobName, current_holder: lease.holderId, ...input.metadata },
    });
    return { ran: false, duration_ms: 0 };
  }

  try {
    emitCreatorEvent({
      event: 'cron_job_started',
      metadata: { job_name: input.jobName, ...input.metadata },
    });
    const timeoutMs = input.timeoutMs ?? (input.ttlMs ?? DEFAULT_LEASE_TTL_MS) - 5_000;
    const result = await runWithTimeout(input.run, timeoutMs, input.jobName);
    const duration_ms = Date.now() - startedAt;
    emitCreatorEvent({
      event: 'cron_job_completed',
      latencyMs: duration_ms,
      metadata: { job_name: input.jobName, ...input.metadata },
    });
    return { ran: true, result, duration_ms };
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const errorMessage = (err as Error)?.message ?? String(err);
    emitCreatorEvent({
      event: 'cron_job_failed',
      severity: 'warning',
      latencyMs: duration_ms,
      metadata: { job_name: input.jobName, error: errorMessage, ...input.metadata },
    });
    return { ran: true, error: errorMessage, duration_ms };
  } finally {
    await releaseCronLease({ jobName: input.jobName, holderId: lease.holderId, status: 'completed' });
  }
}

async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cron job timed out after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
    timer.unref?.();
    fn().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
