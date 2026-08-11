/**
 * Bulk Engagement Service
 * Execute bulk reply actions with safety limits.
 *
 * F5-P1.2 — this service is the send boundary for BOTH bulk routes
 * (thread/bulk-ai-reply and thread/bulk-pattern-reply). It previously diverged
 * from /api/engagement/reply in three ways that mattered:
 *
 *   1. It passed `execution_mode: 'manual'`, which the executor routes to
 *      `recordManualSimulation` — a no-op that returns ok:true with
 *      `simulated: true`. Every bulk reply was counted as `sent` while nothing
 *      was ever posted. The `source: 'bulk'` option shows real dispatch was the
 *      intent; 'manual' as an EXECUTION MODE is the simulation lane, distinct
 *      from `source: 'manual'` (a human-initiated send).
 *   2. It never resolved platform capability, so unsupported (platform, action)
 *      pairs were "sent" too.
 *   3. It never re-checked canonical actionability at the write, so a stale
 *      client selection could dispatch onto a thread the company had already
 *      answered.
 *
 * Ownership and actionability are NOT decided here — they are read from
 * engagementThreadService, the single canonical source. Tenant authorization
 * stays where it already was: thread.organization_id.
 */


import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { listPlaybooks } from './playbooks/playbookService';
import { recordReplyPerformance } from './responsePerformanceService';
import { resolveOpportunityByReply } from './engagementOpportunityResolutionService';
import { recordMetric } from './systemHealthMetricsService';
import { resolveEngagementCapability } from './engagementCapabilityMap';
import { logAuditEvent } from './auditLoggingService';
import { isThreadActionable } from './engagementThreadService';
import { isDmMessageType } from '../../lib/engagement/messageRoles';
import { createHash } from 'crypto';

const MAX_BULK_BATCH = 20;

/**
 * Matches the executor's own idempotency bucket. Two dispatches to the same
 * target inside one bucket are the same intent; a later one is a new intent.
 */
const DISPATCH_BUCKET_MS = 5 * 60 * 1000;

/**
 * Deterministic action id for a browser-mode dispatch.
 *
 * The read guard below blocks a SEQUENTIAL repeat, but a read-then-insert is
 * not atomic: N truly simultaneous requests can all observe "nothing queued"
 * and each insert its own claimable row, which the extension would deliver as N
 * DMs. Deriving the action id from (org, platform, action_type, target, bucket)
 * makes the primary key itself the serialisation point — `auto_insert` already
 * treats a 23505 unique violation as benign, so concurrent callers converge on
 * ONE row. Since a browser dispatch IS its row, that means one delivered DM.
 *
 * Bucketed rather than permanent: a fixed id would collide with the terminal
 * row of an earlier conversation and prevent a legitimate later reply.
 */
function deterministicBrowserActionId(input: {
  organizationId: string;
  platform: string;
  actionType: string;
  targetId: string;
  nowMs?: number;
}): string {
  const bucket = Math.floor((input.nowMs ?? Date.now()) / DISPATCH_BUCKET_MS);
  const basis = [input.organizationId, input.platform, input.actionType, input.targetId, bucket].join(':');
  const h = createHash('sha256').update(basis).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

/** Deterministic terminal outcomes for a bulk dispatch attempt. */
export type BulkSendOutcome =
  | 'sent'
  | 'skipped_not_actionable'
  | 'skipped_unauthorized'
  | 'skipped_capability'
  /** A browser-mode send for this exact target is already queued for delivery. */
  | 'skipped_already_dispatched'
  | 'failed_dispatch';

export async function sendReply(
  organizationId: string,
  threadId: string,
  messageId: string,
  replyText: string,
  platform: string,
  aiGenerated: boolean,
  userId?: string | null
): Promise<{ ok: boolean; error?: string; outcome?: BulkSendOutcome }> {
  const { data: message } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform_message_id, post_comment_id, platform, message_type')
    .eq('id', messageId)
    .maybeSingle();

  if (!message) return { ok: false, error: 'Message not found', outcome: 'skipped_unauthorized' };

  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .eq('id', message.thread_id)
    .maybeSingle();

  if (!thread || thread.organization_id !== organizationId) {
    return { ok: false, error: 'Access denied', outcome: 'skipped_unauthorized' };
  }

  // ── Send-time canonical actionability ───────────────────────────────────
  //    Authoritative, exactly as in /api/engagement/reply. The caller's
  //    pre-filter closes the window as far as a pre-filter can, but selection,
  //    generation and dispatch are not atomic: an operator may answer the
  //    thread from another surface in between. Bulk text is machine-generated
  //    and sent without per-thread review, so it is gated here regardless of
  //    which bulk route produced it. The manual human reply path in reply.ts is
  //    deliberately NOT gated and is untouched by this.
  if (!(await isThreadActionable(organizationId, String(message.thread_id)))) {
    void logAuditEvent({
      operation: 'INSERT',
      table: 'engagement_bulk_reply_rejected',
      companyId: organizationId,
      userId: userId ?? 'unknown',
      success: false,
      errorMessage: 'Bulk reply rejected: thread no longer awaiting a reply',
      metadata: { platform, thread_id: message.thread_id, code: 'THREAD_NOT_ACTIONABLE' },
    }).catch(() => {});
    return { ok: false, error: 'Thread is not awaiting a reply', outcome: 'skipped_not_actionable' };
  }

  const playbooks = (await listPlaybooks(organizationId, organizationId)).filter(
    (p: { status?: string }) => p.status === 'active'
  );
  const playbookId = playbooks[0]?.id ?? null;
  if (!playbookId) return { ok: false, error: 'No active playbook', outcome: 'skipped_capability' };

  const normalizedPlatform = ((platform || 'linkedin').toLowerCase() === 'x') ? 'twitter' : (platform || 'linkedin');

  // ── Capability + execution mode ─────────────────────────────────────────
  //    Same resolution /api/engagement/reply performs. Without it this path
  //    "sent" replies on platforms that have no verified reply capability, and
  //    — because execution_mode was hardcoded to 'manual' — routed every send
  //    into recordManualSimulation, which reports ok:true and posts nothing.
  const isDm = isDmMessageType((message as { message_type?: string | null }).message_type);
  const capabilityAction: 'reply' | 'dm' = isDm ? 'dm' : 'reply';
  const capability = resolveEngagementCapability(normalizedPlatform, capabilityAction);
  if (capability.status !== 'api_verified') {
    void logAuditEvent({
      operation: 'INSERT',
      table: 'engagement_bulk_reply_rejected',
      companyId: organizationId,
      userId: userId ?? 'unknown',
      success: false,
      errorMessage: capability.reason ?? 'Unsupported action',
      metadata: {
        platform: normalizedPlatform,
        action: capabilityAction,
        thread_id: message.thread_id,
        code: 'ACTION_NOT_SUPPORTED',
      },
    }).catch(() => {});
    return {
      ok: false,
      error: capability.reason ?? `${capabilityAction} is not supported on ${normalizedPlatform}.`,
      outcome: 'skipped_capability',
    };
  }

  const executionMode = capability.mode ?? (isDm ? 'browser' : 'api');
  const targetId = message.platform_message_id ?? messageId;

  // ── In-flight browser-dispatch guard (P1.1) ─────────────────────────────
  //    A browser-mode action (every supported DM) is "queued" purely by its
  //    community_ai_actions row: prepareBrowserDispatch has no side effect, and
  //    persistExecutionResult maps 'dispatched' → status 'pending', which is
  //    exactly what /api/extension/commands claims.
  //
  //    The executor's idempotency key does NOT protect this. Dedup is detected
  //    at PERSIST time, which runs AFTER runExecution and — critically — after
  //    auto_insert has already written a fresh `pending` + `browser` row. On a
  //    second invocation the unique-index collision prevents that new row from
  //    being STAMPED, but leaves it pending and claimable. The extension then
  //    sends a second DM. The key protects the ledger, not the person's inbox.
  //
  //    So before dispatching we ask whether this exact target already has an
  //    unclaimed/unfinished browser action. Uses existing state only — no new
  //    table, no fabricated message, no invented platform_message_id. The
  //    partial index idx_community_ai_actions_dispatch_pending
  //    (organization_id, status, execution_mode, …) WHERE status='pending' AND
  //    execution_mode='browser' makes this a bounded, company-scoped lookup.
  //
  //    Comments are untouched: they dispatch via 'api' and close through the
  //    self-reply mirror below, which already prevents a second send.
  if (executionMode === 'browser') {
    const { data: inFlight } = await supabase
      .from('community_ai_actions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .eq('execution_mode', 'browser')
      .eq('platform', normalizedPlatform)
      .eq('action_type', capabilityAction)
      .eq('target_id', targetId)
      .limit(1)
      .maybeSingle();
    if (inFlight) {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'engagement_bulk_reply_rejected',
        companyId: organizationId,
        userId: userId ?? 'unknown',
        success: false,
        errorMessage: 'Bulk dispatch skipped: an identical send is already queued for delivery',
        metadata: {
          platform: normalizedPlatform,
          action: capabilityAction,
          thread_id: message.thread_id,
          target_id: targetId,
          prior_action_id: (inFlight as { id?: string }).id ?? null,
          code: 'DISPATCH_ALREADY_IN_FLIGHT',
        },
      }).catch(() => {});
      return {
        ok: false,
        error: 'A reply to this conversation is already queued for delivery',
        outcome: 'skipped_already_dispatched',
      };
    }
  }

  const result = await executeAction(
    {
      // Browser dispatch converges on one row per (target, bucket); API replies
      // keep a fresh id so each attempt remains individually auditable.
      id:
        executionMode === 'browser'
          ? deterministicBrowserActionId({
              organizationId,
              platform: normalizedPlatform,
              actionType: capabilityAction,
              targetId: String(targetId),
            })
          : crypto.randomUUID(),
      tenant_id: organizationId,
      organization_id: organizationId,
      platform: normalizedPlatform,
      action_type: capabilityAction,
      target_id: targetId,
      suggested_text: replyText,
      playbook_id: playbookId,
      acting_user_id: userId ?? null,
      execution_mode: executionMode,
    },
    true,
    { source: 'bulk', persist: true, auto_insert: true, final_text: replyText }
  );

  // A browser-mode action is queued for the extension and reports 'dispatched'
  // — a successful hand-off, not a confirmed post. Anything else that is not
  // 'executed' is a failure. 'sent_unverified' is specifically NOT accepted:
  // that is the simulation lane's status and must never count as sent again.
  const status = String(result.status ?? '');
  const dispatched = result.ok && (status === 'executed' || status === 'dispatched');
  if (!dispatched) {
    return {
      ok: false,
      outcome: 'failed_dispatch',
      error:
        typeof result.error === 'string'
          ? result.error
          : JSON.stringify(result.error ?? `unexpected status=${status || 'none'}`),
    };
  }

  // Mirror the sent reply back into engagement_messages so the thread stops
  // being actionable — the same write /api/engagement/reply performs. Without
  // it the latest turn stays external, the thread remains in the work queue,
  // and the NEXT bulk run replies to it all over again. DMs are excluded for
  // the same reason as in reply.ts: they dispatch through the extension and
  // have no confirmed platform id yet.
  if (!isDm) {
    const replyPlatformId = result.platform_id || `local:bulk-reply:${messageId}:${crypto.randomUUID()}`;
    const { error: mirrorError } = await supabase
      .from('engagement_messages')
      .upsert(
        {
          thread_id: message.thread_id as string,
          source_id: null,
          platform: normalizedPlatform,
          platform_message_id: replyPlatformId,
          message_type: 'comment',
          content: replyText,
          direction: 'outgoing',
          parent_message_id: messageId,
          platform_created_at: new Date().toISOString(),
          like_count: 0,
          reply_count: 0,
          raw_payload: { author_self: true, ingested_via: 'bulk_reply', confirmed: Boolean(result.platform_id) },
        },
        { onConflict: 'thread_id,platform_message_id' },
      );
    if (mirrorError) {
      console.warn('[bulkEngagementService] self-reply mirror insert failed:', mirrorError.message);
    }
  }

  void recordReplyPerformance({
    organization_id: organizationId,
    thread_id: message.thread_id,
    message_id: messageId,
    platform,
    ai_generated: aiGenerated,
  }).catch(() => {});

  void resolveOpportunityByReply(message.thread_id, null, userId ?? null).catch(() => {});

  return { ok: true, outcome: 'sent' };
}

export async function bulkReplyThreads(
  organizationId: string,
  threadIds: string[],
  getReplyText: (threadId: string, messageId: string, platform: string) => Promise<string | null>,
  userId?: string | null
): Promise<{
  sent: number;
  skipped: number;
  errors: string[];
  /**
   * §11: every attempted dispatch gets an explainable terminal outcome.
   * Additive — `sent`/`skipped`/`errors` keep their existing meaning and both
   * routes' response shapes are unchanged.
   */
  outcomes: Record<BulkSendOutcome | 'skipped_no_message' | 'failed_generation', number>;
}> {
  const ids = threadIds.slice(0, MAX_BULK_BATCH);
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const outcomes: Record<string, number> = {
    sent: 0,
    skipped_not_actionable: 0,
    skipped_unauthorized: 0,
    skipped_capability: 0,
    skipped_already_dispatched: 0,
    skipped_no_message: 0,
    failed_generation: 0,
    failed_dispatch: 0,
  };
  const tally = (o: string) => { outcomes[o] = (outcomes[o] ?? 0) + 1; };

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform')
    .in('thread_id', ids)
    .order('platform_created_at', { ascending: false });

  const latestByThread = new Map<string, { id: string; platform: string }>();
  for (const m of messages ?? []) {
    const msg = m as { id: string; thread_id: string; platform: string };
    if (!latestByThread.has(msg.thread_id)) {
      latestByThread.set(msg.thread_id, { id: msg.id, platform: msg.platform ?? 'linkedin' });
    }
  }

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .in('id', ids)
    .eq('organization_id', organizationId);

  const validThreadIds = new Set((threads ?? []).map((t: { id: string }) => t.id));

  for (const threadId of ids) {
    if (!validThreadIds.has(threadId)) {
      // Previously `continue` — a thread id the caller supplied but this company
      // does not own vanished from BOTH counters, so `sent + skipped` did not
      // account for the batch and the caller could not tell the id had been
      // dropped. It is a refusal, so it is counted as one.
      skipped += 1;
      tally('skipped_unauthorized');
      continue;
    }
    const latest = latestByThread.get(threadId);
    if (!latest) {
      skipped += 1;
      tally('skipped_no_message');
      continue;
    }
    const replyText = await getReplyText(threadId, latest.id, latest.platform);
    if (!replyText?.trim()) {
      skipped += 1;
      tally('failed_generation');
      continue;
    }
    const result = await sendReply(
      organizationId,
      threadId,
      latest.id,
      replyText,
      latest.platform,
      true,
      userId
    );
    if (result.ok) {
      sent += 1;
      tally('sent');
    } else {
      skipped += 1;
      tally(result.outcome ?? 'failed_dispatch');
      if (result.error) errors.push(result.error);
    }
  }

  void recordMetric('engagement', 'bulk_reply_count', sent, null, {
    organization_id: organizationId,
    threads_requested: ids.length,
    sent,
    skipped,
    ...outcomes,
  }).catch(() => {});

  return {
    sent,
    skipped,
    errors,
    outcomes: outcomes as Awaited<ReturnType<typeof bulkReplyThreads>>['outcomes'],
  };
}
