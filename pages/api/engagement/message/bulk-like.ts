import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/engagement/message/bulk-like
 * Like multiple messages. Accepts message_ids or thread_ids (resolves to latest message per thread).
 * Body: message_ids or thread_ids, organization_id
 * Header (optional): Idempotency-Key — 8-200 chars of [A-Za-z0-9._:-].
 *
 * ── Request idempotency (engagementRequestIdempotency, scope 'like') ───────
 *   Every ITEM is its own durable request record — there is no random action
 *   id any more:
 *     - with an Idempotency-Key: item key = deriveBulkItemRequestKey(key,
 *       {kind, id}) where (kind, id) is what the client named (message id or
 *       thread id). Same bulk key + same item → same record → same action id.
 *     - without a key: the ordinary derived, unbucketed key
 *       (`derived:<fingerprint>`) — the same record the single /like route
 *       uses for that message, actor and tenant.
 *   item fingerprint = computeRequestFingerprint({scope:'like', platform,
 *   messageId, account: organization}) — identical to /like.
 *
 *   Phase 1 (read-only, before any action): every item is inspected. If ANY
 *   item's key is bound to a different payload → 422 IDEMPOTENCY_KEY_REUSED for
 *   the whole request, nothing sent. Store unavailable → 503, nothing sent.
 *   Replayed / in-progress / uncertain items are answered from their record
 *   and never acted again.
 *   Phase 2 (serial): remaining items pass the route gates (message, tenant,
 *   active playbook), are RESERVED (primary key) before executeAction runs
 *   with the record's action id (executor gates: approvals, kill switch,
 *   limits all still apply), and are finalized from the outcome.
 *   A failed_not_acted item is retried by the SAME key (new attempt, all gates
 *   again); an uncertain item is never resent.
 *
 * Response: { success, liked } — plus `items` (per-item request outcomes)
 * whenever at least one item was answered by the request ledger or did not
 * complete. `liked` counts fresh successful likes and replayed handed-off ones.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../../backend/db/supabaseClient';
import { executeAction } from '../../../../backend/services/communityAiActionExecutor';
import { listPlaybooks } from '../../../../backend/services/playbooks/playbookService';
import { incrementReplyLike } from '../../../../backend/services/responsePerformanceService';
import {
  readClientIdempotencyKey,
  computeRequestFingerprint,
  requestActorId,
  inspectEngagementRequest,
  reserveEngagementRequest,
  classifyExecutionOutcome,
  finalizeEngagementRequest,
  replayAnswer,
  deriveBulkItemRequestKey,
  type HttpAnswer,
} from '../../../../backend/services/engagementRequestIdempotency';

const MAX_BATCH = 20;

type Body = {
  message_ids?: string[];
  thread_ids?: string[];
  organization_id?: string;
};

type LikeContext = {
  messageById: Map<string, { id: string; thread_id: string; platform_message_id: string | null }>;
  threadOrgById: Map<string, string>;
  playbookId: string | null;
};

/** One requested item: the message to like + the identity the client named. */
type BulkItem = { id: string; platform: string; itemKind: 'message' | 'thread'; itemId: string };

type ItemReport = {
  item: { kind: 'message' | 'thread'; id: string };
  message_id: string;
  status: number;
  code?: string;
  request_state?: string;
  replayed?: boolean;
  liked: boolean;
};

const normalizePlatform = (platform: string) =>
  ((platform || 'linkedin').toLowerCase() === 'x') ? 'twitter' : (platform || 'linkedin');

function itemContext(
  base: { organizationId: string; actorId: string; bulkKey: string | null },
  item: BulkItem
) {
  return {
    db: supabase,
    organizationId: base.organizationId,
    actorId: base.actorId,
    scope: 'like' as const,
    clientKey: base.bulkKey ? deriveBulkItemRequestKey(base.bulkKey, { kind: item.itemKind, id: item.itemId }) : null,
    fingerprint: computeRequestFingerprint({
      scope: 'like',
      platform: normalizePlatform(item.platform),
      messageId: item.id,
      account: base.organizationId,
    }),
  };
}

function reportFromAnswer(item: BulkItem, answer: HttpAnswer): ItemReport {
  const b = answer.body as { code?: string; request_state?: string; replayed?: boolean; success?: boolean };
  return {
    item: { kind: item.itemKind, id: item.itemId },
    message_id: item.id,
    status: answer.status,
    code: b.code,
    request_state: b.request_state,
    replayed: b.replayed === true || undefined,
    // A replayed, handed-off like (executed / sent_unverified / queued) counts.
    liked: b.success === true && (answer.status === 200 || answer.status === 202),
  };
}

/**
 * OPT-010 W2-7: the three lookups that previously ran PER MESSAGE (message
 * select, thread select, listPlaybooks — the last identical on every call)
 * now come from batched prefetches. The decision sequence is byte-identical:
 * message missing → false; thread missing or foreign org → false; no active
 * playbook → false. The platform executeAction below stays SERIAL.
 *
 * Returns null when a route gate skipped the item (nothing reserved, nothing
 * sent), otherwise the item's request outcome.
 */
async function likeMessage(
  organizationId: string,
  item: BulkItem,
  idem: ReturnType<typeof itemContext>,
  ctx: LikeContext
): Promise<ItemReport | null> {
  const messageId = item.id;
  const message = ctx.messageById.get(messageId);
  if (!message) return null;

  const threadOrg = ctx.threadOrgById.get(message.thread_id);
  if (!threadOrg || threadOrg !== organizationId) return null;

  const playbookId = ctx.playbookId;
  if (!playbookId) return null;

  const normalizedPlatform = normalizePlatform(item.platform);
  const targetId = String(message.platform_message_id ?? messageId);

  // Reserve BEFORE the external call: exactly one concurrent caller proceeds.
  const reservation = await reserveEngagementRequest({
    ...idem,
    platform: normalizedPlatform,
    actionType: 'like',
    targetId,
  });
  if (reservation.kind === 'answer') return reportFromAnswer(item, reservation.answer);

  let result: Awaited<ReturnType<typeof executeAction>>;
  try {
    result = await executeAction(
      {
        id: reservation.actionId,
        tenant_id: organizationId,
        organization_id: organizationId,
        platform: normalizedPlatform,
        action_type: 'like',
        target_id: targetId,
        suggested_text: null,
        playbook_id: playbookId,
        execution_mode: 'manual',
      },
      true,
      { source: 'bulk', persist: true, auto_insert: true }
    );
  } catch (execErr) {
    // A throw may follow a platform call: uncertain unless provably not acted.
    await finalizeEngagementRequest(supabase, reservation.record, classifyExecutionOutcome(undefined, execErr));
    throw execErr;
  }
  const outcome = classifyExecutionOutcome(result);
  await finalizeEngagementRequest(supabase, reservation.record, outcome);

  // The attempt's action row already existed (a fenced/reconciled attempt):
  // nothing was liked now; answer from the live row, never act again.
  if ((result as { deduplicated?: boolean }).deduplicated === true) {
    return reportFromAnswer(item, await replayAnswer(supabase, reservation.record));
  }

  if (result.ok) {
    void incrementReplyLike(messageId).catch(() => {});
    return { item: { kind: item.itemKind, id: item.itemId }, message_id: messageId, status: 200, request_state: outcome.state, liked: true };
  }
  return {
    item: { kind: item.itemKind, id: item.itemId },
    message_id: messageId,
    status: 502,
    code: 'PLATFORM_EXECUTION_FAILED',
    request_state: outcome.state,
    liked: false,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    const clientIdempotency = readClientIdempotencyKey(req);
    if (clientIdempotency.ok === false) {
      return res.status(400).json({
        error: 'Idempotency-Key must be 8-200 characters of [A-Za-z0-9._:-]',
        code: clientIdempotency.error,
      });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    let messageIds: BulkItem[] = [];

    if (Array.isArray(body.message_ids) && body.message_ids.length > 0) {
      const ids = body.message_ids.slice(0, MAX_BATCH);
      const { data: msgs } = await supabase
        .from('engagement_messages')
        .select('id, platform')
        .eq('organization_id', organizationId)
        .in('id', ids);
      const seenMessages = new Set<string>();
      for (const m of (msgs ?? []) as Array<{ id: string; platform?: string }>) {
        if (seenMessages.has(m.id)) continue;
        seenMessages.add(m.id);
        messageIds.push({ id: m.id, platform: m.platform ?? 'linkedin', itemKind: 'message', itemId: m.id });
      }
    } else if (Array.isArray(body.thread_ids) && body.thread_ids.length > 0) {
      const threadIds = body.thread_ids.slice(0, MAX_BATCH);
      const { data: threads } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('organization_id', organizationId)
        .in('id', threadIds);
      const validThreadIds = (threads ?? []).map((t: { id: string }) => t.id);
      if (validThreadIds.length === 0) {
        return res.status(200).json({ success: true, liked: 0 });
      }
      const { data: msgs } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, platform')
        .eq('organization_id', organizationId)
        .in('thread_id', validThreadIds)
        .order('platform_created_at', { ascending: false });
      const seenThreads = new Set<string>();
      for (const m of msgs ?? []) {
        const msg = m as { id: string; thread_id: string; platform?: string };
        if (!seenThreads.has(msg.thread_id)) {
          seenThreads.add(msg.thread_id);
          messageIds.push({ id: msg.id, platform: msg.platform ?? 'linkedin', itemKind: 'thread', itemId: msg.thread_id });
        }
      }
    } else {
      return res.status(400).json({ error: 'message_ids or thread_ids required' });
    }

    // OPT-010 W2-7: prefetch once — full message rows, their threads' org
    // ids, and the org's active playbook (loop-invariant). 3 queries total
    // instead of 3 per message; platform executeAction calls remain serial.
    const idList = messageIds.map((m) => m.id);
    const { data: fullMessages } =
      idList.length > 0
        ? await supabase
            .from('engagement_messages')
            .select('id, thread_id, platform_message_id, post_comment_id, platform')
            .eq('organization_id', organizationId)
            .in('id', idList)
        : { data: [] as any[] };
    const messageById = new Map(
      (fullMessages ?? []).map((m: any) => [m.id as string, m])
    );
    const threadIdList = Array.from(
      new Set((fullMessages ?? []).map((m: any) => m.thread_id as string).filter(Boolean))
    );
    const { data: threadRows } =
      threadIdList.length > 0
        ? await supabase
            .from('engagement_threads')
            .select('id, organization_id')
            .in('id', threadIdList)
        : { data: [] as any[] };
    const threadOrgById = new Map(
      (threadRows ?? []).map((t: any) => [t.id as string, t.organization_id as string])
    );
    const activePlaybooks = (await listPlaybooks(organizationId, organizationId)).filter(
      (p: { status?: string }) => p.status === 'active'
    );
    const ctx: LikeContext = {
      messageById,
      threadOrgById,
      playbookId: activePlaybooks[0]?.id ?? null,
    };

    const idemBase = {
      organizationId,
      actorId: requestActorId(roleGate.userId),
      bulkKey: clientIdempotency.key,
    };

    // Phase 1 — read-only inspection of EVERY item before anything is sent.
    const early = new Map<number, HttpAnswer>();
    for (let i = 0; i < messageIds.length; i += 1) {
      const answer = await inspectEngagementRequest(itemContext(idemBase, messageIds[i]));
      if (!answer) continue;
      if (answer.status === 503) return res.status(503).json(answer.body);
      if (answer.status === 422) {
        return res.status(422).json({
          ...answer.body,
          item: { kind: messageIds[i].itemKind, id: messageIds[i].itemId },
        });
      }
      early.set(i, answer);
    }

    // Phase 2 — serial: gates → reserve → executeAction → finalize.
    let liked = 0;
    const items: ItemReport[] = [];
    let needsItems = false;
    for (let i = 0; i < messageIds.length; i += 1) {
      const item = messageIds[i];
      const answered = early.get(i);
      const report = answered
        ? reportFromAnswer(item, answered)
        : await likeMessage(organizationId, item, itemContext(idemBase, item), ctx);
      if (!report) continue; // route gate skipped the item: nothing reserved or sent
      items.push(report);
      if (report.liked) liked += 1;
      if (answered || !(report.liked && report.status === 200)) needsItems = true;
    }

    return res.status(200).json(needsItems ? { success: true, liked, items } : { success: true, liked });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/message/bulk-like]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/message/bulk-like' });
