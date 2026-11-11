/**
 * The WhatsApp unconfirmed-send sweep, SCHEDULED (owner approval 2026-11-11, with S;
 * migration 20270128000007 observed unapplied in prod by C10 and on S's apply list).
 *
 * The sweep itself (services/whatsappUnconfirmedSendSweep.ts, Follow-up A to L-4) resolves
 * broadcast recipients whose send outcome is unknown - `sending` after a crash, or
 * `send_uncertain` - from verified provider evidence, never by resending. Until now nothing
 * called it, so such rows had no resolver except a status webhook carrying their marker.
 *
 * This job runs it for every tenant that HAS such rows. Tenants are found by one bounded
 * cross-tenant read of the unconfirmed recipients (served by 0007's partial index
 * idx_whatsapp_broadcast_recipients_unconfirmed) and their broadcasts; every write the
 * sweep makes is tenant-scoped inside its database functions. One tenant's failure never
 * stops the others. Never throws.
 *
 * Registered in scheduler/cron.ts and in ALWAYS_RUN_JOBS (a recovery job must not depend
 * on recorded company activity - see readinessSnapshot).
 *
 * LOAD (05): it runs unconditionally every 10 minutes, and touches NO Redis - one bounded
 * DB read to find tenants, the sweep's DB functions per tenant, and metrics into the
 * in-process registry (observability/metrics.ts). It runs inside the cron tick, whose
 * CronGuard lock is already taken every tick, so it adds no lock or lease either.
 */

import { ownedDbTable } from '../db/writeOwner';
import { recordRawCounter, recordRawHistogram } from '../observability/metrics';
import {
  sweepUnconfirmedWhatsAppSends,
  type UnconfirmedSendSweepOptions,
  type UnconfirmedSendSweepResult,
} from '../services/whatsappUnconfirmedSendSweep';

/** Upper bound on the recipient rows read to find tenants in one run. */
export const TENANT_SCAN_ROWS = 1000;
/**
 * Every call this job makes is reached from the cron timer, so each is BOUNDED (05;
 * standing rule: one hang freezes the timer for every job after it, and the tick's lease
 * keeps renewing, so nothing else takes over). A try/catch bounds a throw, not a hang:
 *   - the tenant scan and each tenant's sweep are raced against a timeout; a timed-out
 *     sweep is abandoned (its writes are compare-and-set inside DB functions, so a late
 *     finish is harmless) and counted as failed;
 *   - the whole run has a time budget: tenants not started within it are DEFERRED to the
 *     next run (logged), so a slow tenant costs one run, never the cycle.
 */
export const TENANT_SCAN_TIMEOUT_MS = 15_000;
export const TENANT_SWEEP_TIMEOUT_MS = 30_000;
export const JOB_BUDGET_MS = 120_000;

class SweepTimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SweepTimeoutError(`${what} timed out after ${ms} ms`)), ms);
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

export interface WhatsAppSweepJobResult {
  ok: boolean;
  tenants: number;
  examined: number;
  attached: number;
  markedUncertain: number;
  flaggedForReview: number;
  conflicting: number;
  failedTenants: string[];
  /** Tenants not started because the run's time budget was spent; swept next run. */
  deferredTenants: number;
}

export interface WhatsAppSweepJobDeps {
  listTenants?: () => Promise<string[]>;
  sweep?: (opts: UnconfirmedSendSweepOptions) => Promise<UnconfirmedSendSweepResult>;
  /** Test seams for the bounds above. */
  scanTimeoutMs?: number;
  sweepTimeoutMs?: number;
  budgetMs?: number;
  clock?: () => number;
}

/** Tenants that have at least one unconfirmed send (no message id yet). Throws on a read error. */
export async function listTenantsWithUnconfirmedSends(): Promise<string[]> {
  const { data: rows, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('broadcast_id')
    .in('status', ['sending', 'send_uncertain'])
    .is('wa_message_id', null)
    .limit(TENANT_SCAN_ROWS);
  if (error) throw new Error(`unconfirmed recipients unreadable: ${error.message}`);
  const broadcastIds = [...new Set((rows ?? []).map((r: { broadcast_id: string }) => r.broadcast_id))];
  if (broadcastIds.length === 0) return [];

  const { data: broadcasts, error: bErr } = await ownedDbTable('whatsapp_broadcasts')
    .select('company_id')
    .in('id', broadcastIds);
  if (bErr) throw new Error(`broadcasts unreadable: ${bErr.message}`);
  return [...new Set((broadcasts ?? []).map((b: { company_id: string }) => b.company_id).filter(Boolean))];
}

export async function runWhatsAppUnconfirmedSendSweepJob(deps: WhatsAppSweepJobDeps = {}): Promise<WhatsAppSweepJobResult> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const listTenants = deps.listTenants ?? listTenantsWithUnconfirmedSends;
  const sweep = deps.sweep ?? sweepUnconfirmedWhatsAppSends;
  const scanTimeoutMs = deps.scanTimeoutMs ?? TENANT_SCAN_TIMEOUT_MS;
  const sweepTimeoutMs = deps.sweepTimeoutMs ?? TENANT_SWEEP_TIMEOUT_MS;
  const budgetMs = deps.budgetMs ?? JOB_BUDGET_MS;
  const out: WhatsAppSweepJobResult = {
    ok: true, tenants: 0, examined: 0, attached: 0, markedUncertain: 0, flaggedForReview: 0, conflicting: 0, failedTenants: [], deferredTenants: 0,
  };

  let tenants: string[];
  try {
    tenants = await withTimeout(listTenants(), scanTimeoutMs, 'tenant scan');
  } catch (err) {
    console.error('[whatsapp-unconfirmed-sweep] tenant scan failed; nothing swept this run', {
      error: err instanceof Error ? err.message : String(err),
    });
    recordRawCounter('whatsapp.unconfirmed_sweep.failures', 1);
    return { ...out, ok: false };
  }

  for (let i = 0; i < tenants.length; i += 1) {
    const companyId = tenants[i];
    if (clock() - started >= budgetMs) {
      out.deferredTenants = tenants.length - i;
      console.warn('[whatsapp-unconfirmed-sweep] run budget spent; remaining tenants deferred to the next run', {
        deferred: out.deferredTenants, budget_ms: budgetMs,
      });
      break;
    }
    try {
      const r = await withTimeout(sweep({ companyId }), sweepTimeoutMs, `sweep of tenant ${companyId}`);
      out.tenants += 1;
      out.examined += r.examined;
      out.attached += r.attached;
      out.markedUncertain += r.markedUncertain;
      out.flaggedForReview += r.flaggedForReview;
      out.conflicting += r.conflicting;
      if (r.errors.length > 0) {
        console.error('[whatsapp-unconfirmed-sweep] rows failed for a tenant', { company_id: companyId, errors: r.errors.length, run_id: r.runId });
      }
    } catch (err) {
      out.ok = false;
      out.failedTenants.push(companyId);
      console.error('[whatsapp-unconfirmed-sweep] tenant sweep failed; continuing with the next tenant', {
        company_id: companyId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (out.conflicting > 0) recordRawCounter('whatsapp.unconfirmed_sweep.conflicting', out.conflicting);
  if (out.failedTenants.length > 0) recordRawCounter('whatsapp.unconfirmed_sweep.failures', out.failedTenants.length);
  if (out.deferredTenants > 0) recordRawCounter('whatsapp.unconfirmed_sweep.deferred_tenants', out.deferredTenants);
  recordRawHistogram('whatsapp.unconfirmed_sweep.duration_ms', clock() - started);
  return out;
}
