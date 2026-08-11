/**
 * Engagement — abandoned browser-dispatch recovery.
 *
 * PROBLEM (Case E)
 *   A browser-mode send (every supported DM) is "queued" purely by its
 *   community_ai_actions row: status='pending' + execution_mode='browser' is
 *   exactly what /api/extension/commands claims. The bulk in-flight guard
 *   refuses a new dispatch while such a row exists — deliberately preferring a
 *   delayed reply over a duplicate external message. If the extension never
 *   claims that row (account disconnected, extension removed, browser never
 *   reopened), the reservation is held forever and the thread can never be
 *   replied to in bulk again.
 *
 * THE SAFETY QUESTION
 *   Releasing the reservation is only safe if we can prove the action was never
 *   claimed — otherwise the extension may already have delivered the message
 *   and we would be re-sending it. The lifecycle already records this:
 *
 *     dispatch_lease_id          set by /api/extension/commands on claim
 *     dispatch_lease_holder_id   the claiming session
 *     dispatch_acknowledged_at   set when the extension acknowledges
 *
 *   A row with ALL THREE still NULL was never handed to any extension, so no
 *   platform call can have occurred. That is the only case this service acts
 *   on. A row that WAS claimed but never reported back has unknown delivery
 *   state and is deliberately left alone — see the note at the bottom.
 *
 * WHAT THIS DOES NOT DO
 *   It never writes an engagement_messages row, never sets author_self /
 *   direction='outgoing', never invents a platform_message_id, and never marks
 *   anything delivered. It releases a *reservation*; it does not assert an
 *   outcome. The thread simply becomes eligible for a future reply again.
 */

import { supabase } from '../db/supabaseClient';
import { logAuditEvent } from './auditLoggingService';

/**
 * The extension's server-issued polling interval (see /api/extension/redeem and
 * /api/extension/validate, both `polling_interval: 60` seconds). A never-claimed
 * action means the extension has not polled — the threshold below is expressed
 * as a number of consecutive missed polls rather than an invented duration.
 */
export const EXTENSION_POLLING_INTERVAL_MS = 60 * 1000;

/** 60 consecutive missed polls (= 1 hour). Overridable per deployment. */
const DEFAULT_MISSED_POLLS = 60;
const DEFAULT_THRESHOLD_MS = DEFAULT_MISSED_POLLS * EXTENSION_POLLING_INTERVAL_MS;

/** Terminal state used for the release. */
const RELEASE_STATUS = 'skipped';

export function resolveThresholdMs(): number {
  const raw = process.env.ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS;
  if (!raw) return DEFAULT_THRESHOLD_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_MS;
}

export type DispatchRecoveryResult = {
  scanned: number;
  released: number;
  skipped_claimed: number;
  errors: string[];
  threshold_ms: number;
  cutoff: string;
};

/**
 * Release dispatch reservations for browser actions that were never claimed.
 *
 * Bounded by `batchSize`; idempotent; safe to run concurrently with itself and
 * with a live bulk dispatch (see the CAS note inline).
 */
export async function recoverAbandonedBrowserDispatches(options?: {
  batchSize?: number;
  organizationId?: string | null;
}): Promise<DispatchRecoveryResult> {
  const thresholdMs = resolveThresholdMs();
  const batchSize = Math.min(500, Math.max(1, options?.batchSize ?? 100));
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();

  const result: DispatchRecoveryResult = {
    scanned: 0,
    released: 0,
    skipped_claimed: 0,
    errors: [],
    threshold_ms: thresholdMs,
    cutoff,
  };

  // Candidate scan. The partial index idx_community_ai_actions_dispatch_pending
  // (organization_id, status, execution_mode, dispatch_lease_expires_at)
  // WHERE status='pending' AND execution_mode='browser' covers this exactly, so
  // the scan is bounded to genuinely queued browser work.
  let query = supabase
    .from('community_ai_actions')
    .select('id, organization_id, platform, action_type, target_id, created_at, dispatch_lease_id, dispatch_acknowledged_at')
    .eq('status', 'pending')
    .eq('execution_mode', 'browser')
    .is('dispatch_lease_id', null)
    .is('dispatch_acknowledged_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (options?.organizationId) {
    query = query.eq('organization_id', options.organizationId);
  }

  const { data: candidates, error } = await query;
  if (error) {
    result.errors.push(`scan failed: ${error.message}`);
    return result;
  }
  if (!candidates?.length) return result;

  result.scanned = candidates.length;

  for (const row of candidates as Array<Record<string, unknown>>) {
    const actionId = String(row.id);
    // ── Atomicity ────────────────────────────────────────────────────────
    //   The claim in /api/extension/commands is itself a CAS that sets
    //   dispatch_lease_id while leaving status='pending'. Repeating the
    //   never-claimed predicate in the WHERE clause means that if an extension
    //   claimed this row between our scan and this write, the update matches
    //   zero rows and we leave it alone. Two concurrent recovery runs collapse
    //   the same way — the second sees status != 'pending' and no-ops. No
    //   transaction, lock, RPC, index or schema change is required; the
    //   guarantee comes from the database's own conditional update.
    const { data: updated, error: updateError } = await supabase
      .from('community_ai_actions')
      .update({
        status: RELEASE_STATUS,
        execution_result: {
          ok: false,
          status: RELEASE_STATUS,
          reason: 'dispatch_reservation_expired',
          // Stated explicitly so no downstream reader can mistake this for a
          // delivery. Nothing was sent; nothing was even claimed.
          delivered: false,
          never_claimed: true,
          threshold_ms: thresholdMs,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', actionId)
      .eq('status', 'pending')
      .eq('execution_mode', 'browser')
      .is('dispatch_lease_id', null)
      .is('dispatch_acknowledged_at', null)
      .select('id');

    if (updateError) {
      result.errors.push(`[${actionId}] ${updateError.message}`);
      continue;
    }

    if (Array.isArray(updated) && updated.length > 0) {
      result.released += 1;
      void logAuditEvent({
        operation: 'UPDATE',
        table: 'community_ai_actions',
        companyId: String(row.organization_id ?? ''),
        userId: 'system:dispatch-recovery',
        success: true,
        // Wording matters: this is a released reservation, NOT a send.
        errorMessage: 'DISPATCH RESERVATION EXPIRED — never claimed by any extension; no message was sent',
        metadata: {
          action_id: actionId,
          platform: row.platform ?? null,
          action_type: row.action_type ?? null,
          target_id: row.target_id ?? null,
          created_at: row.created_at ?? null,
          stale_at: cutoff,
          threshold_ms: thresholdMs,
          reason: 'dispatch_reservation_expired',
          delivered: false,
        },
      }).catch(() => {});
    } else {
      // Claimed (or already terminal) in the meantime — correctly left alone.
      result.skipped_claimed += 1;
    }
  }

  return result;
}

export type ClaimedUnknownDispatch = {
  action_id: string;
  organization_id: string | null;
  platform: string | null;
  action_type: string | null;
  target_id: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  acknowledged: boolean;
  terminal: false;
  /** Always 'unknown'. There is no evidence either way, and inventing one is the failure mode. */
  delivery: 'unknown';
};

/**
 * READ-ONLY operator contract for claimed-but-unreported dispatches.
 *
 * These are actions an extension claimed and may have executed, whose result
 * never arrived — the claimant crashed, the tab closed, or its late callback
 * was rejected. The platform action may or may not have happened, and nothing
 * in the system can tell which.
 *
 * They are deliberately excluded from every automatic path:
 *   - the recovery sweep above refuses them (it requires lease_id IS NULL);
 *   - a renewal-capable client is never re-offered them;
 *   - they are NOT marked failed, because that would imply nothing was sent;
 *   - they are NOT retried, because that would risk sending twice.
 *
 * This function only lists them so an operator can decide. It performs no
 * writes of any kind.
 */
export async function listClaimedUnknownDispatches(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<ClaimedUnknownDispatch[]> {
  const limit = Math.min(500, Math.max(1, options?.limit ?? 100));
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('community_ai_actions')
    .select('id, organization_id, platform, action_type, target_id, created_at, dispatch_lease_expires_at, dispatch_acknowledged_at')
    .eq('status', 'pending')
    .eq('execution_mode', 'browser')
    .not('dispatch_lease_id', 'is', null)      // claimed — the distinguishing fact
    .lt('dispatch_lease_expires_at', nowIso)   // and no longer being worked on
    .order('dispatch_lease_expires_at', { ascending: true })
    .limit(limit);

  if (options?.organizationId) query = query.eq('organization_id', options.organizationId);

  const { data, error } = await query;
  if (error) {
    console.warn('[engagementDispatchRecovery] claimed-unknown listing failed:', error.message);
    return [];
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    action_id: String(r.id),
    organization_id: (r.organization_id as string) ?? null,
    platform: (r.platform as string) ?? null,
    action_type: (r.action_type as string) ?? null,
    target_id: (r.target_id as string) ?? null,
    claimed_at: (r.created_at as string) ?? null,
    lease_expires_at: (r.dispatch_lease_expires_at as string) ?? null,
    acknowledged: Boolean(r.dispatch_acknowledged_at),
    terminal: false as const,
    delivery: 'unknown' as const,
  }));
}

/**
 * DELIBERATELY NOT HANDLED: an action that WAS claimed (dispatch_lease_id set)
 * but never reported a result. Its delivery state is unknown — the extension
 * may have posted the message and lost the callback. Auto-releasing it would
 * risk sending the same DM twice, which is the one outcome this whole design
 * exists to prevent. Those rows need an operator decision, not a timer.
 *
 * Related pre-existing behaviour worth knowing about: /api/extension/commands
 * re-offers rows whose dispatch_lease_expires_at has passed, so a claimed-then-
 * lost action can already be re-claimed after the 90s lease TTL. That is
 * outside this service and is reported as a finding rather than changed here.
 */
