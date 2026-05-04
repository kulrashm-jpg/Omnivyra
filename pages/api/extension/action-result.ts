import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/extension/action-result
 *
 * The extension submits the outcome of a dispatched command here. The body
 * carries the NORMALIZED result contract from shared/resultContract.js:
 *
 * {
 *   commandId: string,
 *   status: 'success' | 'failed',
 *   leaseId?: string,         // required when holder validation is strict
 *   result: {
 *     success: boolean,
 *     mode: string,
 *     confirmed: boolean,
 *     platform_id: string | null,
 *     verified_at: string | null,
 *     error_code: string | null,
 *     error_message: string | null
 *   }
 * }
 *
 * Trust rules:
 *   - A command can only be acked by the session whose derived holder_id
 *     matches community_ai_actions.dispatch_lease_holder_id, AND whose
 *     leaseId matches community_ai_actions.dispatch_lease_id. A mismatch
 *     returns 409 LEASE_MISMATCH so racing/stale extensions cannot close
 *     commands they do not own.
 *   - Only result.confirmed === true produces status='executed'. Any other
 *     success shape is recorded as 'sent_unverified'.
 *   - On any terminal status the lease fields are cleared so no executed
 *     row leaks stale lease metadata.
 *   - Idempotency: the Idempotency-Key header (if present) dedupes repeated
 *     submissions of the SAME result payload from a retrying extension.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomUUID } from 'crypto';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { recordOutcome } from '@/backend/services/extensionReliabilityService';
import { persistExecutionResult, recordExecutionMetric } from '@/backend/services/communityAiActionExecutor';
import { mirrorOutboundDmAction } from '@/backend/services/engagementOutboundMirrorService';

type NormalizedResult = {
  success: boolean;
  mode?: string;
  confirmed?: boolean;
  platform_id?: string | null;
  verified_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

const TERMINAL_STATUSES = new Set(['executed', 'sent_unverified', 'failed', 'skipped', 'blocked']);

function deriveHolderId(session: { userId: string; orgId: string; hmacNonce: string }): string {
  const basis = `${session.userId}:${session.orgId}:${session.hmacNonce}`;
  return createHash('sha256').update(`lease-holder:${basis}`).digest('hex').slice(0, 32);
}

function readIdempotencyKey(req: NextApiRequest): string | null {
  const headerVal = req.headers['idempotency-key'];
  const candidate = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const trimmed = (candidate || '').toString().trim();
  return trimmed.length > 0 ? trimmed : null;
}


async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;

  if (!session.hmacNonce) {
    return res.status(401).json({ success: false, error: 'INVALID_SESSION', reason: 'SESSION_MISSING_HMAC_NONCE' });
  }

  const body = (req.body || {}) as {
    commandId?: string;
    command_id?: string;
    status?: string;
    leaseId?: string;
    lease_id?: string;
    correlationId?: string;
    correlation_id?: string;
    execution_correlation_id?: string;
    result?: NormalizedResult;
  };
  const commandId = String(body.commandId || body.command_id || '').trim();
  const status = String(body.status || '').toLowerCase().trim();
  const submittedLeaseId = String(body.leaseId || body.lease_id || '').trim();
  const submittedCorrelationId = String(
    body.correlationId || body.correlation_id || body.execution_correlation_id || ''
  ).trim();
  const result = (body.result || {}) as NormalizedResult;
  const idempotencyKey = readIdempotencyKey(req);

  if (!commandId) return res.status(400).json({ success: false, error: 'commandId required' });
  if (!['success', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be success or failed' });
  }

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('community_ai_actions')
      .select('id, organization_id, status, platform, action_type, target_id, suggested_text, final_text, dispatch_lease_id, dispatch_lease_holder_id, dispatch_lease_expires_at, idempotency_key, execution_result, execution_correlation_id, command_chain, command_chain_index')
      .eq('id', commandId)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, error: 'COMMAND_NOT_FOUND' });
    }
    if (existing.organization_id !== session.orgId) {
      return res.status(403).json({ success: false, error: 'TENANT_SCOPE_VIOLATION' });
    }

    // Idempotency replay: same key already recorded a terminal outcome.
    if (idempotencyKey && existing.idempotency_key === idempotencyKey && TERMINAL_STATUSES.has(existing.status || '')) {
      return res.status(200).json({ success: true, idempotent: true, status: existing.status });
    }

    // Idempotent no-op: command already in terminal state.
    if (TERMINAL_STATUSES.has(existing.status || '')) {
      return res.status(200).json({ success: true, idempotent: true, status: existing.status });
    }

    // This deployment stores leased browser commands as `pending` because
    // the DB status constraint does not include the newer dispatched /
    // acknowledged intermediate states. The active lease is the claim signal.
    if (existing.status !== 'pending' && existing.status !== 'dispatched' && existing.status !== 'acknowledged') {
      return res.status(409).json({ success: false, error: 'INVALID_STATE', current_status: existing.status });
    }

    // Lease holder + id validation. Only the session that holds the lease
    // may close the command. A stale/racing extension is rejected here.
    const callerHolderId = deriveHolderId({
      userId: session.userId,
      orgId: session.orgId,
      hmacNonce: session.hmacNonce as string,
    });
    const rowHolderId = (existing as any).dispatch_lease_holder_id as string | null;
    const rowLeaseId = (existing as any).dispatch_lease_id as string | null;
    const rowLeaseExpiresAt = (existing as any).dispatch_lease_expires_at as string | null;

    if (!rowLeaseId || !rowHolderId) {
      return res.status(409).json({ success: false, error: 'NO_ACTIVE_LEASE' });
    }
    if (rowHolderId !== callerHolderId) {
      return res.status(409).json({ success: false, error: 'LEASE_HOLDER_MISMATCH' });
    }
    if (submittedLeaseId && submittedLeaseId !== rowLeaseId) {
      return res.status(409).json({ success: false, error: 'LEASE_ID_MISMATCH' });
    }
    if (rowLeaseExpiresAt && new Date(rowLeaseExpiresAt).getTime() < Date.now()) {
      return res.status(409).json({ success: false, error: 'LEASE_EXPIRED' });
    }

    const isConfirmed = status === 'success' && result?.confirmed === true;
    const finalStatus: 'executed' | 'sent_unverified' | 'failed' =
      status === 'success' ? (isConfirmed ? 'executed' : 'sent_unverified') : 'failed';

    // Surface the row's existing correlation id if one was stamped earlier
    // in the lifecycle (at /execute or at extension dispatch). If not,
    // generate one now so the trigger's invariant holds.
    const rowCorrelationId = (existing as any).execution_correlation_id as string | null;
    const correlationId = rowCorrelationId || randomUUID();

    // Lifecycle validation: if the row already has a correlation id AND the
    // caller submitted one, they must match. A mismatch means the extension
    // is closing a lifecycle that does not belong to this command â€” reject
    // and record the attempt.
    if (submittedCorrelationId && rowCorrelationId && submittedCorrelationId !== rowCorrelationId) {
      console.warn(
        '[extension/action-result] correlation_id mismatch:',
        'row=', rowCorrelationId, 'submitted=', submittedCorrelationId, 'actionId=', commandId,
      );
      return res.status(409).json({
        success: false,
        error: 'CORRELATION_ID_MISMATCH',
        expected_correlation_id: rowCorrelationId,
      });
    }

    // â”€â”€ Chain-aware dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // When the row carries a command_chain AND the just-completed step
    // is NOT the last one AND the outcome is success, advance the index
    // and re-open the row for the next /api/extension/commands poll
    // rather than writing a terminal status. Failures short-circuit the
    // chain: the entire action is marked failed below.
    const rawChain = (existing as any).command_chain as Array<{ action_type: string }> | null;
    const chain = Array.isArray(rawChain) ? rawChain : null;
    const chainIndex = Number((existing as any).command_chain_index ?? 0);
    const isIntermediateStep = !!(chain && chainIndex < chain.length - 1);

    if (isIntermediateStep && status === 'success') {
      const rowCorrelationIdForChain = (existing as any).execution_correlation_id as string | null;
      const correlationIdForChain = rowCorrelationIdForChain || randomUUID();
      // Release the lease + advance, atomically.
      const { data: released } = await supabase
        .from('community_ai_actions')
        .update({
          status: 'pending',
          command_chain_index: chainIndex + 1,
          dispatch_lease_id: null,
          dispatch_lease_expires_at: null,
          dispatch_lease_holder_id: null,
          dispatch_acknowledged_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', commandId)
        .eq('dispatch_lease_id', rowLeaseId)
        .eq('dispatch_lease_holder_id', rowHolderId)
        .select('id')
        .maybeSingle();
      if (!released) {
        return res.status(409).json({ success: false, error: 'LEASE_MISMATCH' });
      }
      // Metric event for the intermediate transition. Best-effort; the
      // chain state is already durable via the UPDATE above.
      await recordExecutionMetric({
        organization_id: session.orgId,
        action_id: commandId,
        correlation_id: correlationIdForChain,
        event_type: 'execution_started',
        platform: existing.platform ?? null,
        action_type: existing.action_type ?? null,
        execution_mode: 'browser',
        metadata: { phase: 'chain_advance', next_index: chainIndex + 1 },
      });
      return res.status(200).json({
        success: true,
        chain_advanced: true,
        next_index: chainIndex + 1,
        chain_total: chain!.length,
      });
    }

    // All row writes flow through the executor's central pipeline. It
    // guards on (lease_id, holder_id), clears lease fields on terminal
    // transitions, stamps idempotency key, and emits success/failed metric
    // events â€” all atomically.
    const persistOutcome = await persistExecutionResult({
      actionId: commandId,
      organizationId: session.orgId,
      correlationId,
      idempotencyKey: idempotencyKey ?? existing.idempotency_key ?? null,
      leaseGuard: { expectedLeaseId: rowLeaseId, expectedHolderId: rowHolderId },
      rowHint: {
        platform: existing.platform ?? null,
        action_type: existing.action_type ?? null,
        target_id: (existing as any).target_id ?? null,
      },
      result: {
        ok: finalStatus !== 'failed',
        status: finalStatus,
        platform_id: result?.platform_id ?? null,
        execution_mode: 'browser',
        response: {
          source: 'extension',
          confirmed: Boolean(result?.confirmed),
          platform_id: result?.platform_id ?? null,
          verified_at: result?.verified_at ?? null,
          mode: result?.mode ?? null,
          error_code: result?.error_code ?? null,
          error_message: result?.error_message ?? null,
        },
        error: finalStatus === 'failed'
          ? (result?.error_code || result?.error_message || 'EXTENSION_REPORTED_FAILURE')
          : undefined,
      },
    });

    if (!persistOutcome.ok) {
      return res.status(409).json({
        success: false,
        error: 'LEASE_MISMATCH',
        current_status: persistOutcome.current_status ?? null,
      });
    }

    if (finalStatus === 'executed' && String(existing.action_type || '').toLowerCase() === 'dm') {
      const mirrorResult = await mirrorOutboundDmAction({
        organizationId: session.orgId,
        actionId: commandId,
        platform: existing.platform ?? null,
        targetId: (existing as { target_id?: string | null }).target_id ?? null,
        text:
          (existing as { final_text?: string | null }).final_text
          ?? (existing as { suggested_text?: string | null }).suggested_text
          ?? null,
        sentAt: result?.verified_at ?? null,
        platformId: result?.platform_id ?? null,
        confirmed: isConfirmed,
      });
      if (mirrorResult.error) {
        console.warn('[extension/action-result] outbound DM mirror warning:', mirrorResult.error, {
          actionId: commandId,
          threadId: mirrorResult.thread_id,
        });
      }
    }

    try {
      recordOutcome(
        String(existing.platform || ''),
        String(existing.action_type || ''),
        isConfirmed ? 'confirmed' : status === 'success' ? 'unconfirmed' : 'failed',
      );
    } catch (telemetryErr) {
      console.warn('[extension/action-result] reliability record failed:', (telemetryErr as Error)?.message);
    }

    return res.status(200).json({ success: true, status: finalStatus });
  } catch (error) {
    console.error('[extension/action-result]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'action-result failed' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

