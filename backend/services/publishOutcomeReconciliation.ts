/**
 * Human reconciliation of an uncertain publish outcome.
 *
 * A row recorded as PUBLISH_OUTCOME_UNCERTAIN (or carrying a leftover
 * PUBLISH_CALL_STARTED marker, or — thread nodes from before the marker
 * existed — failed with no code) may already be live on the platform. Nothing
 * retries it automatically. An operator checks the platform and records ONE of:
 *
 *   'published'     — the post is live. Its platform post id is recorded and the
 *                     row becomes 'published'; thread resume then uses it as the
 *                     reply target and skips the node.
 *   'not_published' — no post exists. The row stays 'failed' with
 *                     PUBLISH_RECONCILED_NOT_PUBLISHED, which every reader
 *                     treats as an ordinary, retryable failure; the operator then
 *                     retries the post (scheduler retry) or resumes the thread.
 *
 * Never inferred: the caller supplies the evidence (and, for 'published', the
 * id seen on the platform). Every write is compare-and-set on the exact
 * uncertain state that was read, so a concurrent change wins and is reported.
 * The note and actor are stamped on the row; the route writes the audit log.
 */

import { supabase } from '../db/supabaseClient';
import { getScheduledPost, updateScheduledPostOnPublish } from '../db/queries';
import { publishOutcomeBlocksAttempt, PUBLISH_RECONCILED_NOT_PUBLISHED } from '../queue/publishOutcome';

export type PublishReconciliationResolution = 'published' | 'not_published';

export type ReconcileUncertainPublishInput = {
  scheduledPostId: string;
  resolution: PublishReconciliationResolution;
  /** Required for 'published': the id of the post as seen on the platform. */
  platformPostId?: string | null;
  postUrl?: string | null;
  actorUserId: string;
  /** Required: what the operator checked, for the audit trail. */
  note: string;
};

export type ReconcileUncertainPublishResult =
  | { status: 'reconciled'; resolution: PublishReconciliationResolution; previous_error_code: string | null }
  | { status: 'invalid'; reason: string }
  | { status: 'not_found' }
  | { status: 'not_uncertain'; current_status: string | null; current_error_code: string | null }
  | { status: 'changed' };

export async function reconcileUncertainPublish(
  input: ReconcileUncertainPublishInput,
): Promise<ReconcileUncertainPublishResult> {
  const scheduledPostId = String(input.scheduledPostId ?? '').trim();
  const note = String(input.note ?? '').trim();
  const platformPostId = String(input.platformPostId ?? '').trim();
  if (!scheduledPostId) return { status: 'invalid', reason: 'scheduled_post_id is required' };
  if (input.resolution !== 'published' && input.resolution !== 'not_published') {
    return { status: 'invalid', reason: "resolution must be 'published' or 'not_published'" };
  }
  if (!note) return { status: 'invalid', reason: 'note is required (what was checked on the platform)' };
  if (input.resolution === 'published' && !platformPostId) {
    return { status: 'invalid', reason: "platform_post_id is required for resolution 'published'" };
  }

  const row = await getScheduledPost(scheduledPostId);
  if (!row) return { status: 'not_found' };
  const evidence = row as { status?: string | null; error_code?: string | null; platform_post_id?: string | null; error_message?: string | null };
  if (publishOutcomeBlocksAttempt(evidence, { missingCodeIsUncertain: true }) !== 'uncertain') {
    return {
      status: 'not_uncertain',
      current_status: evidence.status ?? null,
      current_error_code: evidence.error_code ?? null,
    };
  }

  const previousCode = evidence.error_code ?? null;
  const stamp =
    `[reconciled ${new Date().toISOString()} by ${input.actorUserId}: ${input.resolution}] ${note.slice(0, 500)}` +
    (evidence.error_message ? ` | previously: ${String(evidence.error_message).slice(0, 500)}` : '');

  // Compare-and-set on the exact uncertain state read above. The row lands on
  // 'failed' whatever status it was read in (an uncertain post can have been
  // moved to 'scheduled' by an older build): reconciling 'not_published' never
  // re-queues anything by itself — the retry is the operator's next, separate
  // step — and 'published' is recorded from 'failed' below.
  let query = supabase
    .from('scheduled_posts')
    .update({
      status: 'failed',
      error_code: input.resolution === 'published' ? null : PUBLISH_RECONCILED_NOT_PUBLISHED,
      error_message: stamp,
      updated_at: new Date().toISOString(),
    })
    .eq('id', scheduledPostId)
    .eq('status', String(evidence.status ?? ''))
    .is('platform_post_id', null);
  query = previousCode === null ? query.is('error_code', null) : query.eq('error_code', previousCode);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`Failed to reconcile scheduled post ${scheduledPostId}: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return { status: 'changed' };

  if (input.resolution === 'published') {
    // Records the id, status and published_at, and syncs the planning row —
    // the same writer every success path uses. CAS on 'failed'.
    const write = await updateScheduledPostOnPublish(
      scheduledPostId,
      platformPostId,
      String(input.postUrl ?? '').trim(),
      undefined,
      'failed',
    );
    if (!write.applied) return { status: 'changed' };
  }

  return { status: 'reconciled', resolution: input.resolution, previous_error_code: previousCode };
}
