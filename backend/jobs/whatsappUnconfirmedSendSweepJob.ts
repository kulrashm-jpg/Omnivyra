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

export interface WhatsAppSweepJobResult {
  ok: boolean;
  tenants: number;
  examined: number;
  attached: number;
  markedUncertain: number;
  flaggedForReview: number;
  conflicting: number;
  failedTenants: string[];
}

export interface WhatsAppSweepJobDeps {
  listTenants?: () => Promise<string[]>;
  sweep?: (opts: UnconfirmedSendSweepOptions) => Promise<UnconfirmedSendSweepResult>;
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
  const started = Date.now();
  const listTenants = deps.listTenants ?? listTenantsWithUnconfirmedSends;
  const sweep = deps.sweep ?? sweepUnconfirmedWhatsAppSends;
  const out: WhatsAppSweepJobResult = {
    ok: true, tenants: 0, examined: 0, attached: 0, markedUncertain: 0, flaggedForReview: 0, conflicting: 0, failedTenants: [],
  };

  let tenants: string[];
  try {
    tenants = await listTenants();
  } catch (err) {
    console.error('[whatsapp-unconfirmed-sweep] tenant scan failed; nothing swept this run', {
      error: err instanceof Error ? err.message : String(err),
    });
    recordRawCounter('whatsapp.unconfirmed_sweep.failures', 1);
    return { ...out, ok: false };
  }

  for (const companyId of tenants) {
    try {
      const r = await sweep({ companyId });
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
  recordRawHistogram('whatsapp.unconfirmed_sweep.duration_ms', Date.now() - started);
  return out;
}
