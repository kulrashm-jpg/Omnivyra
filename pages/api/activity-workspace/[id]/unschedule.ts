import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/activity-workspace/[id]/unschedule
 *
 * User-initiated unschedule for an attachment-required row that's
 * currently in `scheduled` state. Transitions:
 *
 *     scheduled → upload_failed   (reason: user_unscheduled)
 *
 * Operationally:
 *   1. Cancels the BullMQ publish job for the row's scheduled_post.
 *   2. Updates the scheduled_posts row to `status='cancelled'` so the
 *      safety-net cron won't pick it back up.
 *   3. Transitions the daily_content_plans row to `upload_failed` via
 *      the FSM with reason `user_unscheduled`.
 *   4. Preserves `uploaded_media_url`, `theme_treatment`, `creator_guidance`,
 *      `marketing_package` so the user can re-upload / re-schedule from
 *      the same row without losing context.
 *
 * Concurrency: optional `expected_revision` body field rejects stale
 * tabs with 409 CONCURRENT_UPLOAD_CONFLICT.
 *
 * The brief specifies `scheduled → upload_failed` as the unschedule
 * transition (rather than introducing a new `unscheduled` state) so the
 * existing retry-from-failed UI affordances continue to work uniformly.
 * The reason field on the lifecycle history entry disambiguates.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  normalizeCreatorFormat,
  isAttachmentRequiredFormat,
} from '@/lib/shared/creatorGovernanceRegistry';
import {
  applyTransition,
  readLifecycleState,
  readLifecycleRevision,
  CreatorLifecycleTransitionError,
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import { cancelScheduledPostQueueEntry, tryAcquireScheduledPostQueueLock } from '@/backend/scheduler/schedulerService';
import { emitCreatorEvent, CREATOR_EVENTS } from '@/backend/services/creatorOperationalTelemetryService';
import { recordAuditEntry } from '@/backend/services/creatorAuditTrailService';

type UnscheduleBody = {
  reason?: unknown;
  expected_revision?: unknown;
};

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  const body = (req.body || {}) as UnscheduleBody;
  const userReason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
  const expectedRevision = typeof body.expected_revision === 'number' && Number.isFinite(body.expected_revision)
    ? body.expected_revision
    : null;

  // ── Load row + assert attachment-required + currently scheduled ──────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform')
    .eq('id', id)
    .maybeSingle();
  if (rowError) {
    console.warn('[unschedule] daily_content_plans lookup failed', { id, error: rowError.message });
    return res.status(500).json({ error: 'Failed to load row.' });
  }
  if (!rowData) return res.status(404).json({ error: `Row not found: ${id}` });
  const row = rowData as {
    id: string;
    campaign_id: string;
    content_type: string;
    content: unknown;
    content_status: string | null;
    platform: string | null;
  };
  const contentType = normalizeCreatorFormat(row.content_type || '');
  if (!isAttachmentRequiredFormat(contentType)) {
    return res.status(409).json({
      error: `Unschedule is only valid for attachment-required formats. Got "${contentType}".`,
      code: 'UNSCHEDULE_NOT_VALID_FOR_FORMAT',
    });
  }
  const currentContent = safeObject(row.content);
  const currentState = readLifecycleState(currentContent);
  if (currentState !== 'scheduled') {
    return res.status(409).json({
      error: `Unschedule requires lifecycle state 'scheduled'; got '${currentState ?? 'unknown'}'.`,
      code: 'UNSCHEDULE_INVALID_STATE',
      current_state: currentState,
    });
  }
  if (expectedRevision !== null) {
    const actualRevision = readLifecycleRevision(currentContent);
    if (expectedRevision !== actualRevision) {
      return res.status(409).json({
        error: `Row revision changed since fetch: expected ${expectedRevision}, actual ${actualRevision}.`,
        code: 'CONCURRENT_UPLOAD_CONFLICT',
        expected_revision: expectedRevision,
        actual_revision: actualRevision,
      });
    }
  }

  // ── Resolve company + auth ──────────────────────────────────────────
  let companyId: string | null = null;
  try {
    const { data: campaignRow } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch {
    /* fall through */
  }
  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const scheduledPostId = typeof currentContent.scheduled_post_id === 'string'
    ? (currentContent.scheduled_post_id as string)
    : null;

  // ── Cancel queue job (under advisory lock to serialize with concurrent reschedule) ──
  let queueResult: Awaited<ReturnType<typeof cancelScheduledPostQueueEntry>> = { db_cancelled: 0, queue_removed: 0, errors: [] };
  if (scheduledPostId) {
    const lock = await tryAcquireScheduledPostQueueLock(scheduledPostId);
    if (!lock.acquired) {
      return res.status(409).json({
        error: 'Another reschedule / unschedule is in progress for this post. Refresh and retry.',
        code: 'CONCURRENT_QUEUE_MUTATION',
        scheduled_post_id: scheduledPostId,
      });
    }
    try {
      queueResult = await cancelScheduledPostQueueEntry(scheduledPostId, {
        reason: userReason ? `user_unscheduled:${userReason}` : 'user_unscheduled',
      });
    } catch (cancelError) {
      console.warn('[unschedule] queue cancel threw (non-fatal)', { scheduledPostId, message: (cancelError as Error)?.message });
    } finally {
      await lock.release();
    }
  }

  // ── Mark the scheduled_posts row as cancelled ───────────────────────
  if (scheduledPostId) {
    try {
      await ownedDbTable('scheduled_posts')
        .update({
          status: 'cancelled',
          error_message: userReason ? `user_unscheduled:${userReason}` : 'user_unscheduled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduledPostId);
    } catch (postError) {
      console.warn('[unschedule] scheduled_posts mark-cancelled failed (non-fatal)', { scheduledPostId, message: (postError as Error)?.message });
    }
  }

  // ── Transition the daily plan row to upload_failed ──────────────────
  // The brief specifies `scheduled → upload_failed` with reason
  // `user_unscheduled`. Preserve uploaded_media_url, theme_treatment,
  // creator_guidance, marketing_package so the user can re-upload /
  // re-schedule from the same row without losing context.
  let transition;
  try {
    transition = applyTransition(currentContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
      contentPatch: {
        unscheduled_at: new Date().toISOString(),
        unschedule_reason: userReason || 'user_unscheduled',
      },
      reason: userReason ? `user_unscheduled:${userReason}` : 'user_unscheduled',
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        from: error.from,
        to: error.to,
      });
    }
    throw error;
  }

  const { error: writeError } = await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify(transition.content),
      content_status: transition.contentStatus,
      failure_reason: 'user_unscheduled',
      failure_type: 'transient',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (writeError) {
    return res.status(500).json({ error: `Failed to record unschedule: ${writeError.message}` });
  }

  emitCreatorEvent({
    event: CREATOR_EVENTS.UNSCHEDULE_REQUESTED,
    dailyPlanId: id,
    scheduledPostId: scheduledPostId,
    lifecycleState: transition.to,
    metadata: { from: currentState, queue_db_cancelled: queueResult.db_cancelled, queue_removed: queueResult.queue_removed },
  });
  recordAuditEntry({
    action: 'schedule_unscheduled',
    actorKind: 'user',
    source: 'api',
    dailyPlanId: id,
    scheduledPostId: scheduledPostId,
    previousState: { lifecycle_state: currentState },
    newState: { lifecycle_state: transition.to },
    metadata: { queue: queueResult },
  });

  return res.status(200).json({
    success: true,
    from: currentState,
    to: transition.to,
    daily_plan_id: id,
    scheduled_post_id: scheduledPostId,
    queue: {
      db_cancelled: queueResult.db_cancelled,
      queue_removed: queueResult.queue_removed,
      had_errors: queueResult.errors.length > 0,
    },
    revision: readLifecycleRevision(transition.content),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/unschedule' });
