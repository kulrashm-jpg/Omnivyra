import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/engagement/like
 * Like an engagement message.
 *
 * Contract (post-hardening):
 *   - Every (platform, like) pair is resolved against engagementCapabilityMap
 *     before dispatch. Unsupported pairs return 400 with code
 *     ACTION_NOT_SUPPORTED; never a silent success.
 *   - Verified pairs execute via executeAction({ execution_mode: 'api' });
 *     the connector's response is returned verbatim. No manual-mode simulation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole } from '../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../backend/db/supabaseClient';
import { executeAction } from '../../../backend/services/communityAiActionExecutor';
import { incrementReplyLike } from '../../../backend/services/responsePerformanceService';
import { resolveEngagementCapability } from '../../../backend/services/engagementCapabilityMap';
import { logAuditEvent } from '../../../backend/services/auditLoggingService';
import {
  readClientIdempotencyKey,
  computeRequestFingerprint,
  requestActorId,
  inspectEngagementRequest,
  reserveEngagementRequest,
  classifyExecutionOutcome,
  finalizeEngagementRequest,
  replayAnswer,
} from '../../../backend/services/engagementRequestIdempotency';

type LikeBody = {
  organization_id?: string;
  message_id?: string;
  platform?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as LikeBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const messageId = body.message_id;
    // Normalize 'x' → 'twitter' on entry so downstream paths never see the alias.
    const rawPlatform = (body.platform ?? '').toString().trim().toLowerCase();
    const platform = rawPlatform === 'x' ? 'twitter' : rawPlatform;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!messageId) {
      return res.status(400).json({ error: 'message_id required' });
    }
    if (!platform) {
      return res.status(400).json({ error: 'platform required' });
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

    // ── Request-level idempotency (durable; engagementRequestIdempotency) ──
    //    Read-only check FIRST: a replay / key-reuse / in-progress / uncertain
    //    request is answered before any gate runs or any state changes.
    const idem = {
      db: supabase,
      organizationId,
      actorId: requestActorId(roleGate.userId),
      scope: 'like' as const,
      clientKey: clientIdempotency.key,
      fingerprint: computeRequestFingerprint({
        scope: 'like',
        platform,
        messageId,
        account: organizationId,
      }),
    };
    const early = await inspectEngagementRequest(idem);
    if (early) return res.status(early.status).json(early.body);

    const capability = resolveEngagementCapability(platform, 'like');
    if (capability.status !== 'api_verified') {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'engagement_like_rejected',
        companyId: organizationId,
        userId: roleGate.userId ?? 'unknown',
        success: false,
        errorMessage: capability.reason ?? 'Unsupported action',
        metadata: { platform, action: 'like', code: 'ACTION_NOT_SUPPORTED' },
      }).catch(() => {});
      return res.status(400).json({
        error: capability.reason ?? `Like is not supported on ${platform}.`,
        code: 'ACTION_NOT_SUPPORTED',
        platform,
        action: 'like',
      });
    }

    const { data: message, error: msgError } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, platform_message_id, post_comment_id, platform, raw_payload')
      .eq('organization_id', organizationId)
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('id, organization_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (!thread || thread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Message thread not found or access denied' });
    }

    // Reject Like on placeholder seed rows — their platform_message_id is
    // synthetic ("urn:li:activity:...#demo-comment-N") and LinkedIn rejects
    // it with "TargetUrn ... is not valid". Mirrors the same guard in
    // reply.ts so the operator sees a clean error instead of a 502 chain.
    const messageRawPayload = (message as { raw_payload?: Record<string, unknown> } | null)?.raw_payload;
    if (messageRawPayload?.placeholder === true) {
      return res.status(409).json({
        error:
          'This is a demo seed row — likes require a real LinkedIn comment URN. ' +
          'Visit the LinkedIn post to let the extension scrape real comment IDs, then like those.',
        code: 'PLACEHOLDER_TARGET',
        platform,
      });
    }

    // comment_likes is upserted only after the platform confirms — same
    // invariant as reply: local state only reflects platform-acknowledged
    // actions. Upsert is idempotent so this is safe on retry.
    //
    // Atomic reservation BEFORE any external call: exactly one concurrent
    // caller proceeds; the others are answered from the record.
    const likeTargetId = String(message.platform_message_id ?? messageId);
    const reservation = await reserveEngagementRequest({
      ...idem,
      platform,
      actionType: 'like',
      targetId: likeTargetId,
    });
    if (reservation.kind === 'answer') {
      return res.status(reservation.answer.status).json(reservation.answer.body);
    }
    const actionId = reservation.actionId;
    let result: Awaited<ReturnType<typeof executeAction>>;
    try {
      result = await executeAction(
        {
          id: actionId,
          tenant_id: organizationId,
          organization_id: organizationId,
          platform,
          action_type: 'like',
          target_id: likeTargetId,
          suggested_text: null,
          playbook_id: null,
          execution_mode: capability.mode ?? 'api',
          // Attribution: operator who initiated the like (server-derived).
          acting_user_id: roleGate.userId ?? null,
        },
        true,
        { source: 'manual', persist: true, auto_insert: true }
      );
    } catch (execErr) {
      // A throw may follow a platform call: uncertain unless provably not acted.
      await finalizeEngagementRequest(supabase, reservation.record, classifyExecutionOutcome(undefined, execErr));
      throw execErr;
    }
    const outcome = classifyExecutionOutcome(result);
    await finalizeEngagementRequest(supabase, reservation.record, outcome);

    // The attempt's action row already existed (a reconciled/fenced attempt):
    // nothing was liked; answer from the live row, never act again.
    if ((result as { deduplicated?: boolean }).deduplicated === true) {
      const replay = await replayAnswer(supabase, reservation.record);
      return res.status(replay.status).json(replay.body);
    }

    if (!result.ok || result.status !== 'executed') {
      return res.status(502).json({
        error: typeof result.error === 'string' ? result.error : (result.error as any)?.code ?? 'Execution failed',
        code: 'PLATFORM_EXECUTION_FAILED',
        status: result.status,
        response: result.response,
        // failed_not_acted: provably never reached the platform — the SAME
        // Idempotency-Key may be retried. uncertain: never resent.
        request_state: outcome.state,
        retry_with_same_key: outcome.state === 'failed_not_acted',
      });
    }

    const confirmed = typeof result.platform_id === 'string' && result.platform_id.length > 0;

    if (message.post_comment_id && roleGate.userId) {
      const { error: insertError } = await supabase.from('comment_likes').upsert(
        {
          comment_id: message.post_comment_id,
          user_id: roleGate.userId,
        },
        { onConflict: 'comment_id,user_id' }
      );
      if (insertError) {
        console.warn('[engagement/like] comment_likes upsert failed:', insertError.message);
      }
    }

    void incrementReplyLike(messageId).catch((err) =>
      console.warn('[engagement/like] incrementReplyLike', (err as Error)?.message)
    );

    return res.status(200).json({
      success: true,
      status: result.status,
      confirmed,
      platform_id: result.platform_id ?? null,
      response: result.response,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to like message';
    console.error('[engagement/like]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/like' });
