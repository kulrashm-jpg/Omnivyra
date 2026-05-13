/**
 * GET /api/super-admin/invitations/[invitationId]/delivery
 *
 * Phase 2.A.1 — read-only delivery state for an invitation.
 *
 * Returns:
 *   - current_state: aggregated derived state ('queued' | 'sending' |
 *     'sent' | 'retrying' | 'failed' | 'dead' | 'none')
 *   - latest_job: snapshot of the most recent email_jobs row for this
 *     invitation (job_id, status, retry_count, max_retries,
 *     next_attempt_at, last_attempt_at, sent_at, dead_lettered_at,
 *     last_error). NO payload, NO encrypted fields surfaced.
 *   - events: ordered email_events for the invitation (most recent first,
 *     capped at 50). Used by the UI delivery timeline.
 *
 * Auth: requireCapability(SUPER_ADMIN_DASHBOARD_VIEW) — bridge-compatible.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { logger } from '../../../../../backend/services/logger';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../../shared/contracts/security';

type DeliveryState = 'queued' | 'sending' | 'sent' | 'retrying' | 'failed' | 'dead' | 'none';

function deriveState(latestJobStatus: string | null, retryCount: number | null): DeliveryState {
  if (!latestJobStatus) return 'none';
  if (latestJobStatus === 'pending') return 'queued';
  if (latestJobStatus === 'processing') return 'sending';
  if (latestJobStatus === 'sent') return 'sent';
  if (latestJobStatus === 'dead') return 'dead';
  if (latestJobStatus === 'failed') {
    return (retryCount ?? 0) > 0 ? 'retrying' : 'failed';
  }
  return 'none';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const invitationId = String(req.query.invitationId || '').trim();
  if (!invitationId) {
    return res.status(400).json({ error: 'MISSING_INVITATION_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: `super-admin reads invitation delivery state ${invitationId}`,
    resourceId: invitationId,
  });
  if (guard.ok !== true) return;

  // Latest job row for the invitation.
  const { data: latestJob, error: jobErr } = await supabase
    .from('email_jobs')
    .select('id, status, retry_count, max_retries, next_attempt_at, last_attempt_at, sent_at, dead_lettered_at, last_error, template_key, recipient_email, created_at')
    .eq('invitation_id', invitationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobErr) {
    logger.warn('super_admin_invite_delivery_job_lookup_failed', { invitationId, message: jobErr.message });
  }

  // Event timeline (most recent first, capped at 50).
  const { data: events, error: evtErr } = await supabase
    .from('email_events')
    .select('id, event_type, retry_count, provider_message_id, failure_reason, correlation_id, created_at, template_key')
    .eq('invitation_id', invitationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (evtErr) {
    logger.warn('super_admin_invite_delivery_events_lookup_failed', { invitationId, message: evtErr.message });
  }

  const latestStatus = (latestJob as any)?.status ?? null;
  const latestRetry = (latestJob as any)?.retry_count ?? null;

  return res.status(200).json({
    invitation_id: invitationId,
    current_state: deriveState(latestStatus, latestRetry),
    latest_job: latestJob
      ? {
          job_id: (latestJob as any).id,
          status: latestStatus,
          retry_count: latestRetry,
          max_retries: (latestJob as any).max_retries,
          next_attempt_at: (latestJob as any).next_attempt_at,
          last_attempt_at: (latestJob as any).last_attempt_at,
          sent_at: (latestJob as any).sent_at,
          dead_lettered_at: (latestJob as any).dead_lettered_at,
          last_error: (latestJob as any).last_error,
          template_key: (latestJob as any).template_key,
          recipient_email: (latestJob as any).recipient_email,
          created_at: (latestJob as any).created_at,
        }
      : null,
    events: (events ?? []).map((e) => ({
      id: (e as any).id,
      event_type: (e as any).event_type,
      retry_count: (e as any).retry_count,
      provider_message_id: (e as any).provider_message_id,
      failure_reason: (e as any).failure_reason,
      correlation_id: (e as any).correlation_id,
      template_key: (e as any).template_key,
      created_at: (e as any).created_at,
    })),
  });
}
