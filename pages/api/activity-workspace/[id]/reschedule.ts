import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/activity-workspace/[id]/reschedule
 *
 * Reschedule an attachment-required row that's already in `scheduled`
 * state. Supports three independently-optional operations:
 *
 *   1. **Replace media via URL** — `media_url` field. Re-validates via
 *      `validateMediaUpload`, transitions `scheduled → media_uploaded →
 *      ready_for_schedule`, and (when also retiming) onward to `scheduled`.
 *   2. **Retime only** — `scheduled_at` field. No media change; row stays
 *      in `scheduled` after updating the `scheduled_posts` row's
 *      `scheduled_for`.
 *   3. **Combined** — both fields. Media is replaced, then the row is
 *      re-scheduled.
 *
 * For direct (file) replacement, callers use the existing
 * `/api/activity-workspace/[id]/upload-media-direct` endpoint (which now
 * accepts `scheduled` as a starting state thanks to the FSM extension).
 *
 * R2-P3 — FULL-MOVE RESCHEDULING (Strategic Mix, SPEC-001 §3.4): optional
 * `platform`, `week_number`, `day_of_week`, `publication_slot` fields move
 * the item across week/day/platform/slot (individually or combined) while
 * preserving execution integrity. Moves REQUIRE `scheduled_at` (the
 * deterministic landing time), enforce the now+1h floor, delegate lock
 * eligibility to the blueprint guard (per-item doctrine when its flag is
 * on — never duplicated here), validate platform capability (fail-closed)
 * and the one-post-per-platform-per-day rule, and re-resolve the social
 * account on platform moves. Requests without move fields are BYTE-
 * IDENTICAL to the legacy contract below.
 *
 * NOT supported here (out of scope per the brief):
 *   - cancellation / unscheduling
 *
 * Concurrency: optional `expected_revision` body field rejects stale
 * tabs with 409 CONCURRENT_UPLOAD_CONFLICT.
 *
 * Cleanup: when media is replaced, the prior storage object is removed
 * (best-effort) after the new state is persisted.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  normalizeCreatorFormat,
  isAttachmentRequiredFormat,
  CREATOR_LIFECYCLE_STATES,
} from '@/lib/shared/creatorGovernanceRegistry';
import {
  applyTransition,
  readLifecycleState,
  readLifecycleRevision,
  CreatorLifecycleTransitionError,
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import { validateMediaUpload } from '@/backend/services/mediaUploadValidationService';
import {
  atomicCancelAndReEnqueueScheduledPost,
  cancelScheduledPostQueueEntry,
  enqueueScheduledPostAt,
} from '@/backend/scheduler/schedulerService';
import { emitCreatorEvent, CREATOR_EVENTS } from '@/backend/services/creatorOperationalTelemetryService';
import { recordAuditEntry } from '@/backend/services/creatorAuditTrailService';
import {
  assertBlueprintMutable,
  BlueprintExecutionFreezeError,
  BlueprintImmutableError,
} from '@/backend/services/campaignBlueprintService';
import {
  getPlatformCapability,
  normalizePlatformKey,
  platformSupportsCapability,
} from '@/lib/shared/social/platformCapabilities';
import { normalizeContentCapability } from '@/lib/shared/social/contentCapability';

const UPLOAD_BUCKET = 'media-uploads';

/** R2-P3 — minimum scheduling window for MOVE operations (the repo's
 *  schedule-floor law). Legacy retime-only requests keep their original
 *  future-only check for byte-identical behavior. */
const MOVE_MIN_WINDOW_MS = 60 * 60 * 1000;

const MOVE_DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

type RescheduleBody = {
  media_url?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  scheduled_at?: unknown;
  source?: unknown;
  expected_revision?: unknown;
  // R2-P3 — full-move fields (all optional; presence of any makes the
  // request a MOVE with the stricter validation path)
  platform?: unknown;
  week_number?: unknown;
  day_of_week?: unknown;
  publication_slot?: unknown;
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

function extractStorageObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    const idx = url.pathname.indexOf(`/${UPLOAD_BUCKET}/`);
    if (idx === -1) return null;
    return url.pathname.slice(idx + UPLOAD_BUCKET.length + 2);
  } catch {
    return null;
  }
}

async function deleteStorageObject(objectPath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([objectPath]);
    if (error) {
      console.warn('[reschedule] storage delete failed', { objectPath, error: error.message });
    }
  } catch (error) {
    console.warn('[reschedule] storage delete threw', { objectPath, message: (error as Error)?.message });
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  const body = (req.body || {}) as RescheduleBody;
  const mediaUrl = typeof body.media_url === 'string' ? body.media_url.trim() : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : undefined;
  const sizeBytes = typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes) ? body.size_bytes : undefined;
  const scheduledAtRaw = typeof body.scheduled_at === 'string' ? body.scheduled_at.trim() : '';
  const sourceRaw = typeof body.source === 'string' ? body.source.trim() : '';
  const source = (sourceRaw === 'user_upload' || sourceRaw === 'external_link') ? sourceRaw : 'external_link';
  const expectedRevision = typeof body.expected_revision === 'number' && Number.isFinite(body.expected_revision)
    ? body.expected_revision
    : null;

  // ── R2-P3: parse move fields (their presence makes this a MOVE) ────────
  const movePlatformRaw = typeof body.platform === 'string' ? body.platform.trim() : '';
  const moveWeekRaw = body.week_number;
  const moveDayRaw = typeof body.day_of_week === 'string' ? body.day_of_week.trim() : '';
  const movePublicationSlotRaw = typeof body.publication_slot === 'string' ? body.publication_slot.trim() : '';
  const isMove =
    movePlatformRaw !== '' || moveDayRaw !== '' || movePublicationSlotRaw !== '' || moveWeekRaw !== undefined;

  if (!mediaUrl && !scheduledAtRaw && !isMove) {
    return res.status(400).json({ error: 'At least one of media_url or scheduled_at is required.' });
  }
  if (isMove && !scheduledAtRaw) {
    return res.status(400).json({
      error: 'Moves require scheduled_at — the deterministic landing time for the item.',
      code: 'MOVE_REQUIRES_TIME',
    });
  }
  let scheduledAt: Date | null = null;
  if (scheduledAtRaw) {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'scheduled_at must be a valid ISO timestamp.' });
    }
    if (parsed.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'scheduled_at must be in the future.' });
    }
    // Minimum scheduling window applies to MOVES (legacy retimes keep the
    // original future-only contract, byte-identical).
    if (isMove && parsed.getTime() < Date.now() + MOVE_MIN_WINDOW_MS) {
      return res.status(422).json({
        error: 'Moves must land at least 1 hour in the future.',
        code: 'MOVE_SCHEDULE_FLOOR',
      });
    }
    scheduledAt = parsed;
  }

  // Deterministic move-field validation (before any read or write).
  let movePlatform: string | null = null;
  if (movePlatformRaw) {
    movePlatform = normalizePlatformKey(movePlatformRaw);
    if (!getPlatformCapability(movePlatform)) {
      return res.status(422).json({
        error: `Unknown or unsupported platform "${movePlatformRaw}".`,
        code: 'MOVE_UNSUPPORTED_PLATFORM',
      });
    }
  }
  let moveWeek: number | null = null;
  if (moveWeekRaw !== undefined) {
    const parsedWeek = Number(moveWeekRaw);
    if (!Number.isInteger(parsedWeek) || parsedWeek < 1 || parsedWeek > 52) {
      return res.status(400).json({ error: 'week_number must be an integer between 1 and 52.', code: 'MOVE_INVALID_WEEK' });
    }
    moveWeek = parsedWeek;
  }
  let moveDay: string | null = null;
  if (moveDayRaw) {
    const matched = MOVE_DAYS_OF_WEEK.find((d) => d.toLowerCase() === moveDayRaw.toLowerCase());
    if (!matched) {
      return res.status(400).json({ error: `day_of_week must be one of ${MOVE_DAYS_OF_WEEK.join(', ')}.`, code: 'MOVE_INVALID_DAY' });
    }
    moveDay = matched;
  }
  if (movePublicationSlotRaw.length > 60) {
    return res.status(400).json({ error: 'publication_slot must be 60 characters or fewer.', code: 'MOVE_INVALID_SLOT' });
  }

  // ── Load row + assert attachment-required + currently scheduled-ish ────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform, scheduled_time, date, execution_id, week_number')
    .eq('id', id)
    .maybeSingle();
  if (rowError) {
    console.warn('[reschedule] daily_content_plans lookup failed', { id, error: rowError.message });
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
    scheduled_time: string | null;
    date: string | null;
    execution_id: string | null;
    week_number: number | null;
  };
  const contentType = normalizeCreatorFormat(row.content_type || '');
  if (!isAttachmentRequiredFormat(contentType)) {
    return res.status(409).json({
      error: `Reschedule is only valid for attachment-required formats. Got "${contentType}".`,
      code: 'RESCHEDULE_NOT_VALID_FOR_FORMAT',
    });
  }
  const currentContent = safeObject(row.content);
  const currentState = readLifecycleState(currentContent);
  // Reschedule entry is allowed from scheduled OR ready_for_schedule (the
  // latter so callers can "retime before publish" without a media swap).
  if (currentState !== 'scheduled' && currentState !== 'ready_for_schedule') {
    return res.status(409).json({
      error: `Reschedule requires lifecycle state 'scheduled' or 'ready_for_schedule'; got '${currentState ?? 'unknown'}'.`,
      code: 'RESCHEDULE_INVALID_STATE',
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

  // ── Resolve company + auth ────────────────────────────────────────────
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

  // ── Find the existing scheduled_post (for media_urls / scheduled_for update) ──
  const priorScheduledPostId = typeof currentContent.scheduled_post_id === 'string'
    ? (currentContent.scheduled_post_id as string)
    : null;

  // ── R2-P3: MOVE validation (all checks before any write) ───────────────
  const targetPlatform = movePlatform ?? normalizePlatformKey(row.platform ?? '');
  const platformChanged = movePlatform !== null && movePlatform !== normalizePlatformKey(row.platform ?? '');
  let moveSocialAccountId: string | null = null;
  if (isMove) {
    // 1. Movement eligibility via the EXISTING blueprint lock guard — the
    //    single lock authority (per-item doctrine when its flag is on;
    //    legacy doctrine otherwise). Never duplicated here.
    try {
      await assertBlueprintMutable(
        row.campaign_id,
        row.execution_id ? { affectedSlots: [row.execution_id] } : undefined,
      );
    } catch (lockError) {
      if (lockError instanceof BlueprintExecutionFreezeError) {
        return res.status(409).json({
          error: 'Item is inside its execution freeze window and cannot be moved.',
          code: 'MOVE_FREEZE_WINDOW',
          hours_until_execution: lockError.hoursUntilExecution,
          freeze_window_hours: lockError.freezeWindowHours,
        });
      }
      if (lockError instanceof BlueprintImmutableError) {
        return res.status(409).json({
          error: 'Item is locked by execution and cannot be moved.',
          code: 'MOVE_ITEM_LOCKED',
        });
      }
      throw lockError;
    }

    // 2. Platform capability (fail-closed): the row's content must resolve
    //    to a capability the target platform supports.
    if (platformChanged) {
      const capability = normalizeContentCapability({ contentType: row.content_type });
      if (!capability) {
        return res.status(422).json({
          error: `Content type "${row.content_type}" could not be resolved to a platform capability.`,
          code: 'MOVE_CAPABILITY_UNRESOLVED',
        });
      }
      if (!platformSupportsCapability(targetPlatform, capability)) {
        return res.status(422).json({
          error: `Platform "${targetPlatform}" does not support ${capability} content.`,
          code: 'MOVE_PLATFORM_INCOMPATIBLE',
        });
      }
    }

    // 3. Scheduling integrity: one post per platform per day + duplicate
    //    prevention. The target (platform, date) slot must be free.
    const targetDate = scheduledAt!.toISOString().slice(0, 10);
    const { data: occupants, error: occupancyError } = await supabase
      .from('daily_content_plans')
      .select('id')
      .eq('campaign_id', row.campaign_id)
      .eq('platform', targetPlatform)
      .eq('date', targetDate)
      .neq('id', id)
      .limit(1);
    if (occupancyError) {
      return res.status(500).json({ error: `Failed to validate target slot: ${occupancyError.message}` });
    }
    if (Array.isArray(occupants) && occupants.length > 0) {
      return res.status(409).json({
        error: `Another item already occupies ${targetPlatform} on ${targetDate} (one post per platform per day).`,
        code: 'MOVE_SLOT_OCCUPIED',
        conflicting_row_id: (occupants[0] as { id: string }).id,
      });
    }

    // 4. Platform moves re-target the scheduled post's social account —
    //    resolved the same way the schedule endpoint resolves it.
    if (platformChanged && priorScheduledPostId) {
      const platformAlias = targetPlatform === 'x' ? 'twitter' : targetPlatform;
      const { data: account } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('is_active', true)
        .eq('company_id', companyId)
        .in('platform', Array.from(new Set([targetPlatform, platformAlias])))
        .limit(1)
        .maybeSingle();
      moveSocialAccountId = (account as { id?: string } | null)?.id ?? null;
      if (!moveSocialAccountId) {
        return res.status(422).json({
          error: `No active connected account for "${targetPlatform}" — connect one before moving this item.`,
          code: 'MOVE_NO_CONNECTED_ACCOUNT',
        });
      }
    }
  }

  // ── Branch 1: Replace media via URL ───────────────────────────────────
  // Order: validate first → if valid, transition lifecycle → update DB
  //  → delete prior storage object best-effort.
  let updatedContent = currentContent;
  let mediaReplaced = false;
  if (mediaUrl) {
    const validation = await validateMediaUpload({
      mediaUrl,
      contentType,
      mimeType,
      sizeBytes,
      skipLiveness: false,
    });
    if (!validation.valid) {
      const failureValidation = validation as { valid: false; validated_at: string; errors: string[]; details: unknown };
      const errs = Array.isArray(failureValidation.errors) ? failureValidation.errors : ['Validation failed'];
      // Move to upload_failed; preserve scheduled_post linkage so the
      // workspace can retry without losing the audit trail.
      let transition;
      try {
        transition = applyTransition(updatedContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
          contentPatch: {
            upload_validated_at: validation.validated_at,
            upload_validation: validation,
            upload_error: errs.join(' | '),
          },
          reason: 'reschedule_replace_media_validation_failed',
        });
      } catch (error) {
        if (error instanceof CreatorLifecycleTransitionError) {
          return res.status(409).json({ error: error.message, code: error.code, from: error.from, to: error.to });
        }
        throw error;
      }
      await ownedDbTable('daily_content_plans')
        .update({
          content: JSON.stringify(transition.content),
          content_status: transition.contentStatus,
          failure_reason: errs.join(' | '),
          failure_type: 'transient',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return res.status(200).json({
        success: false,
        validation,
        from: currentState,
        to: transition.to,
        message: 'Replace-media validation failed.',
      });
    }

    // scheduled → media_uploaded → ready_for_schedule
    const priorUploadedUrl = typeof updatedContent.uploaded_media_url === 'string'
      ? (updatedContent.uploaded_media_url as string)
      : null;
    const uploadPatch: Record<string, unknown> = {
      uploaded_media_url: mediaUrl,
      upload_source: source,
      uploaded_mime_type: validation.details.detected_mime ?? mimeType ?? null,
      uploaded_size_bytes: validation.details.detected_size_bytes ?? sizeBytes ?? null,
      upload_validated_at: validation.validated_at,
      upload_validation: validation,
      upload_error: null,
    };
    let toUploaded;
    try {
      toUploaded = applyTransition(updatedContent, CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED, {
        contentPatch: uploadPatch,
        reason: 'reschedule_replace_media',
      });
    } catch (error) {
      if (error instanceof CreatorLifecycleTransitionError) {
        return res.status(409).json({ error: error.message, code: error.code, from: error.from, to: error.to });
      }
      throw error;
    }
    const toReady = applyTransition(toUploaded.content, CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE, {
      reason: 'auto_transition_after_reschedule_replace_media',
    });
    updatedContent = toReady.content;
    mediaReplaced = true;

    // Best-effort delete of the prior object now that the new URL is
    // about to be persisted. We delete BEFORE the scheduled_posts /
    // daily_content_plans update so a successful delete doesn't strand
    // anything in storage; the row's state still points at the new URL.
    const priorObjectPath = extractStorageObjectPath(priorUploadedUrl);
    if (priorObjectPath && priorUploadedUrl !== mediaUrl) {
      void deleteStorageObject(priorObjectPath);
    }
  }

  // ── Branch 2: Retime (if scheduled_at provided) ───────────────────────
  // After a media swap the row is in `ready_for_schedule`. We transition
  // back to `scheduled` here. If only retime was requested, the row
  // starts in `scheduled` already; we skip the FSM call and only patch
  // the scheduled_posts row's `scheduled_for`.
  const newScheduledAtIso = scheduledAt?.toISOString() ?? null;
  if (mediaReplaced) {
    const scheduledTransition = applyTransition(updatedContent, CREATOR_LIFECYCLE_STATES.SCHEDULED, {
      contentPatch: newScheduledAtIso ? {
        scheduled_at: newScheduledAtIso,
        rescheduled_at: new Date().toISOString(),
      } : {
        rescheduled_at: new Date().toISOString(),
      },
      reason: scheduledAt ? 'reschedule_replace_media_and_retime' : 'reschedule_replace_media_only',
    });
    updatedContent = scheduledTransition.content;
  } else if (newScheduledAtIso) {
    // Retime-only — the lifecycle stays `scheduled` (no transition row
    // appended). We still patch metadata so the audit trail records the
    // retime event under content.rescheduled_at_history.
    const history = Array.isArray(updatedContent.rescheduled_at_history)
      ? [...(updatedContent.rescheduled_at_history as unknown[])]
      : [];
    history.push({ at: new Date().toISOString(), new_scheduled_at: newScheduledAtIso });
    updatedContent = {
      ...updatedContent,
      scheduled_at: newScheduledAtIso,
      rescheduled_at: new Date().toISOString(),
      rescheduled_at_history: history.slice(-12),
    };
  }

  // ── Persist daily_content_plans state ─────────────────────────────────
  const contentStatusValue = mediaReplaced
    ? CREATOR_LIFECYCLE_STATES.SCHEDULED
    : (currentState === 'ready_for_schedule' ? CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE : CREATOR_LIFECYCLE_STATES.SCHEDULED);
  const dailyPlanPatch: Record<string, unknown> = {
    content: JSON.stringify(updatedContent),
    content_status: contentStatusValue,
    failure_reason: null,
    failure_type: null,
    updated_at: new Date().toISOString(),
  };
  if (newScheduledAtIso) {
    // Keep the daily_content_plans.date / scheduled_time columns aligned so
    // the calendar surface reflects the retime.
    dailyPlanPatch.date = newScheduledAtIso.slice(0, 10);
    dailyPlanPatch.scheduled_time = newScheduledAtIso.slice(11, 16);
  }
  // ── R2-P3: apply the move to the canonical plan row ────────────────────
  if (isMove) {
    if (platformChanged) dailyPlanPatch.platform = targetPlatform;
    if (moveWeek !== null) dailyPlanPatch.week_number = moveWeek;
    if (moveDay !== null) dailyPlanPatch.day_of_week = moveDay;
    const moveRecord = {
      at: new Date().toISOString(),
      from: { platform: row.platform, date: row.date, week_number: row.week_number },
      to: { platform: targetPlatform, date: newScheduledAtIso?.slice(0, 10) ?? row.date, week_number: moveWeek ?? row.week_number, day_of_week: moveDay ?? undefined },
    };
    const moveHistory = Array.isArray(updatedContent.move_history)
      ? [...(updatedContent.move_history as unknown[])]
      : [];
    moveHistory.push(moveRecord);
    updatedContent = {
      ...updatedContent,
      ...(movePublicationSlotRaw ? { publication_slot: movePublicationSlotRaw } : {}),
      move_history: moveHistory.slice(-12),
    };
    dailyPlanPatch.content = JSON.stringify(updatedContent);
  }
  const { error: dailyUpdateError } = await ownedDbTable('daily_content_plans')
    .update(dailyPlanPatch)
    .eq('id', id);
  if (dailyUpdateError) {
    return res.status(500).json({ error: `Failed to update row: ${dailyUpdateError.message}` });
  }

  // ── Update scheduled_posts (media + time) ─────────────────────────────
  let scheduledPostUserId: string | null = null;
  let scheduledPostSocialAccountId: string | null = null;
  if (priorScheduledPostId) {
    const scheduledPostPatch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (mediaReplaced) {
      scheduledPostPatch.media_urls = [mediaUrl];
    }
    if (newScheduledAtIso) {
      scheduledPostPatch.scheduled_for = newScheduledAtIso;
    }
    // R2-P3: platform move re-targets the post (account resolved above).
    if (platformChanged && moveSocialAccountId) {
      scheduledPostPatch.platform = targetPlatform;
      scheduledPostPatch.social_account_id = moveSocialAccountId;
    }
    const { error: postUpdateError } = await ownedDbTable('scheduled_posts')
      .update(scheduledPostPatch)
      .eq('id', priorScheduledPostId);
    if (postUpdateError) {
      console.warn('[reschedule] scheduled_posts update failed', { id, priorScheduledPostId, error: postUpdateError.message });
      return res.status(500).json({
        error: `Row state advanced but scheduled_post update failed: ${postUpdateError.message}`,
        code: 'SCHEDULED_POST_UPDATE_FAILED',
        partial: true,
      });
    }

    // ── Queue re-enqueue: cancel old job, enqueue a fresh one at the new
    // scheduled_for. Only when the time actually changed (retime path or
    // combined). Pure media replacement at the same time keeps the
    // existing queue entry, since `publishNow` will re-resolve
    // `media_urls` from the DB at fire time.
    //
    // Uses `atomicCancelAndReEnqueueScheduledPost` for serialization:
    //   - acquires an advisory lock on the scheduled_post so concurrent
    //     reschedules from two tabs can't race
    //   - rolls back the cancel if the new enqueue fails (the old job is
    //     restored to `pending` so the safety-net cron still publishes)
    //   - includes an idempotency key derived from the new scheduled_for
    if (newScheduledAtIso) {
      try {
        const { data: postLookup } = await supabase
          .from('scheduled_posts')
          .select('user_id, social_account_id')
          .eq('id', priorScheduledPostId)
          .maybeSingle();
        scheduledPostUserId = (postLookup as any)?.user_id ?? null;
        scheduledPostSocialAccountId = (postLookup as any)?.social_account_id ?? null;
      } catch (lookupError) {
        console.warn('[reschedule] scheduled_post user/account lookup failed', { id, message: (lookupError as Error)?.message });
      }
      // R2-P3: a platform move re-enqueues against the NEW account.
      if (moveSocialAccountId) scheduledPostSocialAccountId = moveSocialAccountId;
      if (scheduledPostUserId && scheduledPostSocialAccountId) {
        const atomicResult = await atomicCancelAndReEnqueueScheduledPost({
          scheduledPostId: priorScheduledPostId,
          userId: scheduledPostUserId,
          socialAccountId: scheduledPostSocialAccountId,
          newScheduledFor: newScheduledAtIso,
          reason: isMove ? 'reschedule_full_move' : 'reschedule_retime',
        });
        if (!atomicResult.locked) {
          emitCreatorEvent({
            event: CREATOR_EVENTS.QUEUE_LOCK_CONTENTION,
            severity: 'warning',
            scheduledPostId: priorScheduledPostId,
            dailyPlanId: id,
            metadata: { operation: 'reschedule_retime' },
          });
          return res.status(409).json({
            error: 'Another reschedule is in progress for this post. Refresh and retry.',
            code: 'CONCURRENT_QUEUE_MUTATION',
            scheduled_post_id: priorScheduledPostId,
          });
        }
        emitCreatorEvent({
          event: atomicResult.ok ? CREATOR_EVENTS.QUEUE_REENQUEUE_SUCCESS : CREATOR_EVENTS.QUEUE_REENQUEUE_FAILURE,
          severity: atomicResult.ok ? 'info' : 'warning',
          scheduledPostId: priorScheduledPostId,
          dailyPlanId: id,
          metadata: { enqueue: atomicResult.enqueue, rollback: atomicResult.rollback, idempotency_key: atomicResult.idempotency_key },
        });
        if (!atomicResult.ok) {
          console.warn('[reschedule] atomic queue mutation failed (rollback attempted)', {
            priorScheduledPostId,
            enqueue: atomicResult.enqueue,
            rollback: atomicResult.rollback,
          });
        }
      } else {
        // Couldn't resolve user/account — fall back to the legacy
        // cancel-only path so the queue at least doesn't fire twice.
        try {
          await cancelScheduledPostQueueEntry(priorScheduledPostId, { reason: 'reschedule_retime_no_account' });
        } catch (cancelError) {
          console.warn('[reschedule] fallback cancel failed (non-fatal)', { priorScheduledPostId, message: (cancelError as Error)?.message });
        }
      }
    }

    // Tighten the FK on daily_content_plans so future rollbacks use the
    // direct column lookup. Idempotent + tolerant of the column not yet
    // existing in environments where the migration hasn't run.
    try {
      await ownedDbTable('daily_content_plans')
        .update({ scheduled_post_id: priorScheduledPostId })
        .eq('id', id);
    } catch (fkError) {
      console.warn('[reschedule] FK column update skipped (likely pre-migration)', { id, message: (fkError as Error)?.message });
    }
  }

  emitCreatorEvent({
    event: CREATOR_EVENTS.RESCHEDULE_REQUESTED,
    dailyPlanId: id,
    scheduledPostId: priorScheduledPostId,
    metadata: {
      media_replaced: mediaReplaced,
      rescheduled_at: newScheduledAtIso,
      from: currentState,
      to: contentStatusValue,
      ...(isMove ? { move: { platform: platformChanged ? targetPlatform : null, week_number: moveWeek, day_of_week: moveDay } } : {}),
    },
  });
  recordAuditEntry({
    action: 'schedule_rescheduled',
    actorKind: 'user',
    source: 'api',
    dailyPlanId: id,
    scheduledPostId: priorScheduledPostId,
    previousState: { lifecycle_state: currentState },
    newState: { lifecycle_state: contentStatusValue, rescheduled_at: newScheduledAtIso, media_replaced: mediaReplaced },
  });

  return res.status(200).json({
    success: true,
    from: currentState,
    to: contentStatusValue,
    media_replaced: mediaReplaced,
    rescheduled_at: newScheduledAtIso,
    daily_plan_id: id,
    scheduled_post_id: priorScheduledPostId,
    uploaded_media_url: mediaReplaced ? mediaUrl : (typeof updatedContent.uploaded_media_url === 'string' ? updatedContent.uploaded_media_url : null),
    revision: readLifecycleRevision(updatedContent),
    queue: newScheduledAtIso ? 're_enqueued' : 'unchanged',
    // R2-P3 — present only for MOVE requests (legacy responses unchanged).
    ...(isMove
      ? {
          moved: {
            platform: platformChanged ? targetPlatform : undefined,
            week_number: moveWeek ?? undefined,
            day_of_week: moveDay ?? undefined,
            publication_slot: movePublicationSlotRaw || undefined,
            social_account_id: moveSocialAccountId ?? undefined,
          },
        }
      : {}),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/reschedule' });
