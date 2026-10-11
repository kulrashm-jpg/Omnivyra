/**
 * Phase 1B.2.2 — Thread publish orchestrator.
 *
 * Publishes a multi-row thread (one root + N children, all in scheduled_posts
 * linked by parent_post_id + thread_position) as a single sequential operation.
 *
 * ARCHITECTURE (per 1B.2.0 RFC, Model B "root-orchestrates-all"):
 *
 *   1. Cron picks up the multi-row ROOT (status='scheduled') via its existing
 *      direct scan of scheduled_posts.
 *   2. Cron calls publishNow() per existing path.
 *   3. publishNow() detects is_thread_start=true on the loaded row and DELEGATES
 *      to publishThread() (this module). publishNow does NOT proceed with its
 *      own single-row pipeline for thread roots.
 *   4. publishThread() loads root + children ordered by thread_position.
 *   5. For each row in order, the orchestrator:
 *      - Transitions row.status to 'publishing' (atomic UPDATE)
 *      - For X/Twitter only: passes the PREVIOUS published row's
 *        platform_post_id as in_reply_to_tweet_id
 *      - Calls publishToPlatform(rowId, socialAccountId, { replyToPlatformPostId })
 *      - On success: transitions to 'published' via updateScheduledPostOnPublish
 *      - On failure: transitions to 'failed', marks all DOWNSTREAM children as
 *        'blocked', BREAKS the loop
 *   6. Aggregates final root status:
 *      - All published → root status='published'
 *      - Any failure → root status='failed'
 *
 * IDEMPOTENCY: each row's platform_post_id is checked before publish. Rows
 * already published are skipped (and their platform_post_id is still used as
 * the reply_to for the next sibling). That alone does NOT make resume safe: a
 * node whose platform call was interrupted (worker crash, Vercel timeout) has
 * no platform_post_id even when the post went live, and no adapter can make
 * the call idempotent. So every node also carries the durable per-row evidence
 * of backend/queue/publishOutcome.ts — PUBLISH_CALL_STARTED immediately before
 * its platform call, PUBLISH_OUTCOME_UNCERTAIN when the outcome is unknown —
 * and BOTH queue re-delivery and operator resume refuse to call the platform
 * for a node that is 'publishing', uncertain, or (pre-change rows) failed with
 * no code. Such a node stops the thread until a person reconciles it
 * (backend/services/publishOutcomeReconciliation.ts).
 *
 * REPLY CHAIN POLICY (per 1B.2.0 RFC):
 *   - Twitter/X: native chain via in_reply_to_tweet_id (1B.2.2 ships this)
 *   - LinkedIn / Instagram / Facebook / others: sequential standalone posts;
 *     replyToPlatformPostId option is ignored by their adapters (1B.2.3 polish)
 *
 * FAILURE MODEL (1B.2.2 baseline; 1B.2.4 extends):
 *   - Single attempt per row per orchestrator run
 *   - On failure: downstream rows go to 'blocked' (terminal for cron; resume
 *     endpoint in 1B.2.4 can revive)
 *   - Already-published siblings (before the failure) stay 'published' — we do
 *     NOT roll back already-published posts on the platform
 *   - Stale 'publishing' rows (orchestrator crashed mid-sweep): the
 *     stuck-publishing sweeper marks them failed + PUBLISH_OUTCOME_UNCERTAIN;
 *     the orchestrator never re-runs them on its own.
 *   - An ambiguous adapter failure (classifyPublishAttempt) is recorded as
 *     PUBLISH_OUTCOME_UNCERTAIN, never as an ordinary retryable failure.
 */

import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';
import {
  getScheduledPost,
  updateScheduledPostOnPublish,
  updateScheduledPostOnFailure,
  markScheduledPostPlatformCallStarted,
  markScheduledPostOutcomeUncertain,
} from '../../db/queries';
import { publishToPlatform } from '../../adapters/platformAdapter';
import {
  classifyPublishAttempt,
  publishOutcomeBlocksAttempt,
  PUBLISH_NOT_ATTEMPTED,
  PUBLISH_OUTCOME_UNCERTAIN,
  PUBLISH_OUTCOME_UNCERTAIN_MESSAGE,
} from '../../queue/publishOutcome';
import {
  assertCanTransition,
  type ThreadPublishStatus,
  classifyThreadOutcome,
} from '../../../lib/thread/threadPublishStates';
import { logger } from '../logger';

export type ThreadPublishResult = {
  status: 'PUBLISHED' | 'FAILED';
  root_id: string;
  total_nodes: number;
  published_count: number;
  failed_count: number;
  blocked_count: number;
  failed_at_position?: number;
  message?: string;
  timestamp: string;
  /**
   * Set when the run stopped at a node whose outcome is unknown (or still in
   * flight). Nothing was published for it in this run, and callers must NOT
   * retry automatically: a person reconciles the node first.
   */
  uncertain?: true;
};

/**
 * Loads root + children for a thread, ordered by thread_position ascending.
 * Returns null when the root is not found or is not a valid thread start.
 */
async function loadThreadRows(rootId: string): Promise<Array<Record<string, any>> | null> {
  const { data: root, error: rootErr } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', rootId)
    .maybeSingle();

  if (rootErr || !root) {
    console.error('[threadPublishOrchestrator] root not found', { rootId, error: rootErr?.message });
    return null;
  }

  if (root.is_thread_start !== true) {
    console.warn('[threadPublishOrchestrator] row is not a thread start', { rootId });
    return null;
  }

  const { data: children, error: childErr } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('parent_post_id', rootId)
    .order('thread_position', { ascending: true });

  if (childErr) {
    console.error('[threadPublishOrchestrator] failed to load children', { rootId, error: childErr.message });
    return null;
  }

  // Root is position 0; children are positions 1..N. Return as an ordered array.
  const ordered: Array<Record<string, any>> = [root, ...(children ?? [])];
  return ordered;
}

/**
 * Transition a row's status atomically with the helper's validation. Uses a
 * direct UPDATE rather than updateScheduledPostOnPublish/OnFailure because
 * those helpers set status='published'/'failed' implicitly — here we want
 * explicit intermediate states ('publishing', 'blocked').
 *
 * G12 — compare-and-set on the `status` column. The UPDATE only applies when
 * the row's CURRENT status matches `fromStatus`. Detects in-flight divergence
 * (e.g. operator cancellation, concurrent orchestrator run) and surfaces it
 * to the caller via `applied: false` rather than silently overwriting.
 */
type TransitionResult =
  | { applied: true }
  | { applied: false; reason: 'cas_mismatch' };

async function transitionRowStatus(
  rowId: string,
  fromStatus: ThreadPublishStatus,
  toStatus: ThreadPublishStatus,
): Promise<TransitionResult> {
  assertCanTransition(fromStatus, toStatus);
  const { data, error } = await ownedDbTable('scheduled_posts')
    .update({ status: toStatus, updated_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('status', fromStatus)
    .select('id');
  if (error) {
    throw new Error(`Failed to transition ${rowId} from ${fromStatus} to ${toStatus}: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { applied: false, reason: 'cas_mismatch' };
  }
  return { applied: true };
}

/**
 * Mark all rows in `rows` (from a given index onward) as 'blocked'. Used when
 * an earlier sibling fails — every later child that has not yet been picked up
 * for publishing transitions draft → blocked so the cron / future replays know
 * they were not skipped accidentally.
 */
async function markDownstreamBlocked(
  rows: Array<Record<string, any>>,
  startIndex: number,
): Promise<number> {
  let blocked = 0;
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const fromStatus = row.status as ThreadPublishStatus;
    // Only transition rows that are still dormant. Rows that have already
    // started publishing or are terminal stay as-is.
    if (fromStatus !== 'draft' && fromStatus !== 'scheduled') continue;
    try {
      assertCanTransition(fromStatus, 'blocked');
    } catch {
      // Invalid transition (e.g., 'scheduled' → 'blocked' not in the graph);
      // skip silently — the row stays in its current state.
      continue;
    }
    try {
      const result = await transitionRowStatus(row.id, fromStatus, 'blocked');
      if (result.applied) {
        blocked++;
      } else {
        // CAS mismatch: row was mutated between snapshot and this update.
        // Likely operator cancellation or a concurrent orchestrator run. Do
        // not overwrite — leave the row in its new state.
        console.warn('[threadPublishOrchestrator] markDownstreamBlocked CAS mismatch — row mutated externally', {
          rowId: row.id, expectedFrom: fromStatus,
        });
      }
    } catch (err) {
      console.warn('[threadPublishOrchestrator] failed to mark blocked', {
        rowId: row.id, error: (err as Error).message,
      });
    }
  }
  return blocked;
}

/**
 * Publish a single thread node. Wraps publishToPlatform with idempotency,
 * status transitions, and the publish-success / failure post-actions that
 * publishNowService runs in the single-row path.
 */
type PublishOneNodeOutcome =
  | { ok: true; platform_post_id: string; post_url?: string }
  | { ok: false; message: string; abort?: 'cas_diverged' | 'in_flight'; uncertain?: true };

async function publishOneNode(input: {
  row: Record<string, any>;
  socialAccountId: string;
  userId: string;
  replyToPlatformPostId: string | undefined;
}): Promise<PublishOneNodeOutcome> {
  const { row, socialAccountId, replyToPlatformPostId } = input;

  // Idempotency: row may already be published (e.g., resume-from-failed
  // re-running the orchestrator). Skip publish; reuse existing platform_post_id.
  if (row.platform_post_id) {
    return {
      ok: true,
      platform_post_id: row.platform_post_id,
      post_url: row.post_url,
    };
  }

  // Durable outcome evidence — the SAME check for a queue re-delivery and an
  // operator resume, both of which arrive here. A node that is 'publishing'
  // is held by a live run or was interrupted mid-call and not yet swept; a
  // failed node that is uncertain (or, from before this change, failed with no
  // code at all) may already be live. Neither is published again here.
  const blockedBy = publishOutcomeBlocksAttempt(row, { missingCodeIsUncertain: true });
  if (blockedBy === 'in_flight') {
    return {
      ok: false,
      abort: 'in_flight',
      uncertain: true,
      message: `Node ${row.id} is still 'publishing' (in flight, or interrupted before its result was saved) — not publishing it again`,
    };
  }
  if (blockedBy === 'uncertain') {
    if (row.error_code !== PUBLISH_OUTCOME_UNCERTAIN) {
      // Normalise to the one label guards and operators read. Best-effort:
      // the refusal below does not depend on it.
      const previous = typeof row.error_message === 'string' && row.error_message ? ` (previous: ${row.error_message})` : '';
      try {
        await markScheduledPostOutcomeUncertain(row.id, `${PUBLISH_OUTCOME_UNCERTAIN_MESSAGE}${previous}`);
      } catch (err) {
        console.warn('[threadPublishOrchestrator] could not normalise uncertain node label', {
          rowId: row.id, error: (err as Error).message,
        });
      }
    }
    return {
      ok: false,
      uncertain: true,
      message: `Node ${row.id}: publish outcome uncertain — check the platform and reconcile before retrying`,
    };
  }

  const fromStatus = row.status as ThreadPublishStatus;
  // Transition into 'publishing'. Root comes in as 'scheduled' (or 'failed' /
  // 'blocked' on resume); children as 'draft' (or 'blocked'/'failed' on resume).
  // All valid per threadPublishStates. CAS ensures we don't overwrite a row
  // an operator (or concurrent run) just mutated.
  let entryTransition: TransitionResult;
  try {
    entryTransition = await transitionRowStatus(row.id, fromStatus, 'publishing');
  } catch (err) {
    return { ok: false, message: `Status transition failed: ${(err as Error).message}` };
  }
  if (!entryTransition.applied) {
    // CAS mismatch: row's actual status changed between snapshot and now.
    // Do NOT proceed to publish. Surface `abort` so the orchestrator stops
    // the whole sweep — partial progress with an externally-mutated row is
    // unsafe (could cause platform-side double-publish if we proceed).
    return {
      ok: false,
      abort: 'cas_diverged',
      message: `Row state diverged before publish (expected status=${fromStatus}); aborting node`,
    };
  }

  // Re-resolve this node's creator asset refs at publish time through the SAME
  // shared resolution path the single-row publishers use (no thread-specific
  // resolver). On success the node's media snapshot is refreshed so the adapter
  // uploads the CURRENT rendering payload; on failure the snapshot is retained
  // (fail-open). Dynamic import avoids the publishNowService ↔ orchestrator cycle.
  try {
    const { refreshScheduledPostMediaFromRefs } = await import('../publishNowService');
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: row.id, userId: input.userId, post: row });
  } catch {
    /* fail-open — never block a node publish on snapshot refresh */
  }

  // Record — immediately before the call, compare-and-set on 'publishing' —
  // that this node's platform call is starting. Without it a crash during the
  // call would look like one before it. No marker, no call.
  let callRecorded: boolean;
  try {
    callRecorded = await markScheduledPostPlatformCallStarted(row.id);
  } catch (err) {
    const message = `Platform-call marker could not be recorded; not publishing: ${(err as Error).message}`;
    // Nothing was sent: give the node back as an ordinary (retryable) failure.
    // If even this write fails the node stays 'publishing' and the sweeper
    // labels it uncertain — the fail-closed direction.
    try {
      await updateScheduledPostOnFailure(row.id, message, 'publishing', PUBLISH_NOT_ATTEMPTED);
    } catch { /* see above */ }
    return { ok: false, message };
  }
  if (!callRecorded) {
    return {
      ok: false,
      abort: 'cas_diverged',
      message: `Row state diverged before the platform call (no longer 'publishing'); aborting node`,
    };
  }

  // Call the canonical publish path. The adapter accepts the optional reply
  // context (Twitter uses it; others ignore).
  let publishResult;
  try {
    publishResult = await publishToPlatform(row.id, socialAccountId, { replyToPlatformPostId });
  } catch (err) {
    publishResult = {
      success: false as const,
      error: {
        code: 'PUBLISH_THREW',
        message: (err as Error).message,
        retryable: false as const,
      },
    };
  }

  const attemptOutcome = classifyPublishAttempt(publishResult);
  if (attemptOutcome === 'published' && publishResult.platform_post_id) {
    // CAS-guarded success write. Only flips 'publishing' → 'published' when
    // the row is still 'publishing'. If it diverged (operator cancelled
    // between the platform call and now), we have a split-brain: the post
    // IS on the platform but we cannot record success here. Log loud — this
    // requires operator reconciliation — but still return the platform_post_id
    // so the orchestrator's reply chain stays correct for siblings.
    const writeResult = await updateScheduledPostOnPublish(
      row.id,
      publishResult.platform_post_id,
      publishResult.post_url || '',
      publishResult.published_at,
      'publishing',
    );
    if (!writeResult.applied) {
      console.error('[threadPublishOrchestrator] SPLIT-BRAIN: publish succeeded on platform but row diverged from publishing', {
        rowId: row.id,
        platform_post_id: publishResult.platform_post_id,
        post_url: publishResult.post_url,
      });
    }
    // P1-B — advance variant experiment tracker per node. Each thread
    // node is its own scheduled_posts row, so we resolve attribution
    // per row id. Mirrors the pattern from publishNowService.
    // Best-effort; failures never block publish success.
    try {
      const { resolveStrategyAttributionForScheduledPost } = await import('../creator/strategyAttributionResolver');
      const { notifyExperimentAssetPublished } = await import('../creator/variantExperimentLifecycle');
      const attribution = await resolveStrategyAttributionForScheduledPost(row.id);
      if (attribution?.variantId && attribution.companyId) {
        notifyExperimentAssetPublished({
          companyId: attribution.companyId,
          variantId: attribution.variantId,
          scheduledPostId: row.id,
        });
      }
    } catch (err) {
      console.warn('[threadPublishOrchestrator] experiment publish-notify failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
    return {
      ok: true,
      platform_post_id: publishResult.platform_post_id,
      post_url: publishResult.post_url,
    };
  }

  // The request may have created the post (5xx, network loss, timeout, an
  // escaped throw, a success with no id): record the uncertainty and stop —
  // never an ordinary failure a retry or resume would run again.
  if (attemptOutcome !== 'not_created') {
    const detail = publishResult.error?.message
      ? ` Adapter said: ${publishResult.error.message}`
      : publishResult.success ? ' The platform reported success without a post id.' : '';
    const message = `${PUBLISH_OUTCOME_UNCERTAIN_MESSAGE}${detail}`;
    try {
      const recorded = await markScheduledPostOutcomeUncertain(row.id, message);
      if (!recorded) {
        console.warn('[threadPublishOrchestrator] uncertain-outcome write matched no row — row mutated externally during publish', {
          rowId: row.id,
        });
      }
    } catch (err) {
      // The row keeps PUBLISH_CALL_STARTED, which every reader treats as
      // uncertain — the refusal does not depend on this write.
      console.error('[threadPublishOrchestrator] uncertain-outcome write failed', { rowId: row.id, error: (err as Error).message });
    }
    return { ok: false, uncertain: true, message };
  }

  // A confirmed rejection (or pre-send failure): CAS-guarded failure write,
  // WITH its code in the same update. Only flips 'publishing' → 'failed' when
  // still 'publishing'. If diverged, do not overwrite (operator likely cancelled).
  const message = publishResult.error?.message || 'Unknown publish failure';
  const failResult = await updateScheduledPostOnFailure(
    row.id,
    message,
    'publishing',
    publishResult.error?.code || PUBLISH_NOT_ATTEMPTED,
  );
  if (!failResult.applied) {
    console.warn('[threadPublishOrchestrator] failure-write CAS mismatch — row mutated externally during publish', {
      rowId: row.id, attemptedMessage: message,
    });
  }
  return { ok: false, message };
}

/**
 * MAIN ENTRY: publish a thread sequentially from root through children.
 *
 * Called by publishNowService.publishNow() when a row with is_thread_start=true
 * is loaded. Returns a structured outcome describing the per-node result of
 * the run.
 */
export async function publishThread(input: {
  root_scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
}): Promise<ThreadPublishResult> {
  const timestamp = new Date().toISOString();
  const rows = await loadThreadRows(input.root_scheduled_post_id);

  if (!rows || rows.length === 0) {
    return {
      status: 'FAILED',
      root_id: input.root_scheduled_post_id,
      total_nodes: 0,
      published_count: 0,
      failed_count: 0,
      blocked_count: 0,
      message: 'Thread root not found or not a thread start',
      timestamp,
    };
  }

  const finalStatuses: ThreadPublishStatus[] = [];
  let publishedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let failedAtPosition: number | undefined;
  let previousPlatformPostId: string | undefined;
  let failureMessage: string | undefined;
  let stoppedUncertain = false;

  // Phase E — structured telemetry. Per-thread tags carried on every log
  // line in this run so they aggregate cleanly in observability tooling.
  const threadTags = {
    root_id: input.root_scheduled_post_id,
    total_nodes: rows.length,
    platform: String(rows[0]?.platform ?? ''),
    has_per_node_attachments: rows.some((r) => Array.isArray(r.media_urls) && r.media_urls.length > 0),
  };
  logger.info('thread_publish_start', threadTags);
  console.log('[threadPublishOrchestrator] publishThread start', threadTags);

  // Determine whether this platform uses native reply chains. Twitter/X is
  // the only platform with in_reply_to_tweet_id today; others publish
  // sequentially as independent posts. The adapter ignores the option for
  // non-Twitter platforms (1B.2.3 polish), so this gate is informational
  // only — the option flows through regardless.
  const platform = String(rows[0]?.platform ?? '').toLowerCase();
  const platformUsesReplyChain = platform === 'twitter' || platform === 'x';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const position = typeof row.thread_position === 'number' ? row.thread_position : i;

    const replyToPlatformPostId = platformUsesReplyChain && previousPlatformPostId
      ? previousPlatformPostId
      : undefined;

    const nodeMediaCount = Array.isArray(row.media_urls) ? row.media_urls.length : 0;
    const nodeTags = {
      ...threadTags,
      row_id: row.id,
      position,
      reply_to: replyToPlatformPostId ?? null,
      media_count: nodeMediaCount,
      is_resume: row.status === 'failed' || row.status === 'blocked',
    };
    logger.info('thread_node_attempt', nodeTags);
    console.log('[threadPublishOrchestrator] node publish attempt', nodeTags);

    const result = await publishOneNode({
      row,
      socialAccountId: input.social_account_id,
      userId: input.user_id,
      replyToPlatformPostId,
    });

    if (result.ok) {
      publishedCount++;
      finalStatuses.push('published');
      previousPlatformPostId = result.platform_post_id;
      logger.info('thread_node_published', { ...nodeTags, platform_post_id: result.platform_post_id });
      console.log('[threadPublishOrchestrator] node published', {
        row_id: row.id,
        position,
        platform_post_id: result.platform_post_id,
      });
    } else if (result.ok === false) {
      failedCount++;
      finalStatuses.push('failed');
      failedAtPosition = position;
      failureMessage = result.message;
      if (result.uncertain) stoppedUncertain = true;

      if (result.abort === 'in_flight') {
        // Another run may be live on this node: leave the rest of the thread
        // exactly as it is (marking its dormant rows 'blocked' would break
        // that run's own compare-and-set transitions).
        logger.warn('thread_sweep_stopped_node_in_flight', { ...nodeTags, reason: result.message });
        console.warn('[threadPublishOrchestrator] stopping — node still publishing', { row_id: row.id, position });
        break;
      }

      if (result.abort === 'cas_diverged') {
        logger.warn('thread_sweep_aborted_cas_diverged', { ...nodeTags, reason: result.message });
        console.warn('[threadPublishOrchestrator] aborting sweep — row state diverged externally', {
          row_id: row.id,
          position,
          message: result.message,
        });
        break;
      }

      logger.error('thread_node_failed_blocking_downstream', { ...nodeTags, reason: result.message });
      console.error('[threadPublishOrchestrator] node failed; stopping and blocking downstream', {
        row_id: row.id,
        position,
        message: result.message,
      });

      // Mark all subsequent rows as 'blocked' so they're visible as
      // "would have published if upstream succeeded" rather than left as
      // dormant 'draft' rows indistinguishable from the pre-orchestrator
      // baseline state.
      blockedCount = await markDownstreamBlocked(rows, i + 1);
      for (let j = i + 1; j < rows.length; j++) finalStatuses.push('blocked');
      break;
    }
  }

  // Aggregate the root's final status. The root's row was either already
  // updated by publishOneNode (if it itself published or failed) or left at
  // 'publishing' if the orchestrator's iteration started at the root. In
  // either case, the per-row updates have correctly set the root's status —
  // we don't double-update it. Aggregate is for the response only.
  const aggregateStatus = classifyThreadOutcome(finalStatuses);

  const result: ThreadPublishResult = {
    status: aggregateStatus === 'published' ? 'PUBLISHED' : 'FAILED',
    root_id: input.root_scheduled_post_id,
    total_nodes: rows.length,
    published_count: publishedCount,
    failed_count: failedCount,
    blocked_count: blockedCount,
    failed_at_position: failedAtPosition,
    message: failureMessage,
    timestamp,
    ...(stoppedUncertain ? { uncertain: true as const } : {}),
  };

  logger.info('thread_publish_complete', {
    ...threadTags,
    aggregate: aggregateStatus,
    published_count: publishedCount,
    failed_count: failedCount,
    blocked_count: blockedCount,
    failed_at_position: failedAtPosition ?? null,
  });
  console.log('[threadPublishOrchestrator] publishThread complete', result);
  return result;
}

/**
 * G13 — Resume a partially-published thread.
 *
 * Used by the operator-driven resume endpoint and the stuck-publishing
 * sweeper's optional retry path. Loads the root to recover the social
 * account + user context (which the original orchestrator run carried), then
 * re-invokes `publishThread`.
 *
 * Resume runs the SAME per-node checks as a queue re-delivery (publishOneNode):
 *   - Already-published nodes (`platform_post_id` set): skipped, their id is
 *     used as the reply target for the next sibling.
 *   - Nodes still 'publishing', failed with PUBLISH_OUTCOME_UNCERTAIN /
 *     PUBLISH_CALL_STARTED, or failed with no code (pre-change rows): NOT
 *     published — the run stops there and reports `uncertain`. Such a node may
 *     already be live; a person reconciles it first
 *     (backend/services/publishOutcomeReconciliation.ts), after which resume
 *     continues from it.
 *   - Other 'failed' nodes (a confirmed rejection, or reconciled as not
 *     published) and 'blocked' nodes: transitioned 'failed→publishing' /
 *     'blocked→publishing' (both valid per the state machine), republished.
 *   - 'cancelled' nodes: cannot be transitioned to 'publishing' (not in the
 *     state machine graph); the orchestrator's CAS aborts the sweep at that
 *     point — operator must un-cancel before resume can complete the thread.
 *
 * Returns `{ status: 'NOT_FOUND' }` when the root is missing or is not a
 * thread start, so callers can map to a clean 404 without leaking details.
 */
export type ResumeThreadResult =
  | ThreadPublishResult
  | { status: 'NOT_FOUND'; root_id: string; message: string; timestamp: string };

export async function resumeThreadPublish(input: {
  root_scheduled_post_id: string;
}): Promise<ResumeThreadResult> {
  const timestamp = new Date().toISOString();
  const root = await getScheduledPost(input.root_scheduled_post_id);
  if (!root || (root as any).is_thread_start !== true) {
    return {
      status: 'NOT_FOUND',
      root_id: input.root_scheduled_post_id,
      message: 'Thread root not found or not a thread start',
      timestamp,
    };
  }
  const socialAccountId = (root as any).social_account_id as string | null;
  const userId = (root as any).user_id as string | null;
  if (!socialAccountId || !userId) {
    return {
      status: 'FAILED',
      root_id: input.root_scheduled_post_id,
      total_nodes: 0,
      published_count: 0,
      failed_count: 0,
      blocked_count: 0,
      message: 'Thread root is missing social_account_id or user_id; cannot resume',
      timestamp,
    };
  }
  console.log('[threadPublishOrchestrator] resumeThreadPublish invoked', {
    root_id: input.root_scheduled_post_id,
  });
  return publishThread({
    root_scheduled_post_id: input.root_scheduled_post_id,
    social_account_id: socialAccountId,
    user_id: userId,
  });
}
