import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/engagement/message/bulk-like
 * Like multiple messages. Accepts message_ids or thread_ids (resolves to latest message per thread).
 * Body: message_ids or thread_ids, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../../backend/db/supabaseClient';
import { executeAction } from '../../../../backend/services/communityAiActionExecutor';
import { listPlaybooks } from '../../../../backend/services/playbooks/playbookService';
import { incrementReplyLike } from '../../../../backend/services/responsePerformanceService';

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

/**
 * OPT-010 W2-7: the three lookups that previously ran PER MESSAGE (message
 * select, thread select, listPlaybooks — the last identical on every call)
 * now come from batched prefetches. The decision sequence is byte-identical:
 * message missing → false; thread missing or foreign org → false; no active
 * playbook → false. The platform executeAction below stays SERIAL.
 */
async function likeMessage(
  organizationId: string,
  messageId: string,
  platform: string,
  ctx: LikeContext
): Promise<boolean> {
  const message = ctx.messageById.get(messageId);
  if (!message) return false;

  const threadOrg = ctx.threadOrgById.get(message.thread_id);
  if (!threadOrg || threadOrg !== organizationId) return false;

  const playbookId = ctx.playbookId;
  if (!playbookId) return false;

  const normalizedPlatform = ((platform || 'linkedin').toLowerCase() === 'x') ? 'twitter' : (platform || 'linkedin');
  const result = await executeAction(
    {
      id: crypto.randomUUID(),
      tenant_id: organizationId,
      organization_id: organizationId,
      platform: normalizedPlatform,
      action_type: 'like',
      target_id: message.platform_message_id ?? messageId,
      suggested_text: null,
      playbook_id: playbookId,
      execution_mode: 'manual',
    },
    true,
    { source: 'bulk', persist: true, auto_insert: true }
  );

  if (result.ok) {
    void incrementReplyLike(messageId).catch(() => {});
    return true;
  }
  return false;
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

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    let messageIds: Array<{ id: string; platform: string }> = [];

    if (Array.isArray(body.message_ids) && body.message_ids.length > 0) {
      const ids = body.message_ids.slice(0, MAX_BATCH);
      const { data: msgs } = await supabase
        .from('engagement_messages')
        .select('id, platform')
        .in('id', ids);
      messageIds = (msgs ?? []).map((m: { id: string; platform?: string }) => ({
        id: m.id,
        platform: m.platform ?? 'linkedin',
      }));
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
        .in('thread_id', validThreadIds)
        .order('platform_created_at', { ascending: false });
      const seenThreads = new Set<string>();
      for (const m of msgs ?? []) {
        const msg = m as { id: string; thread_id: string; platform?: string };
        if (!seenThreads.has(msg.thread_id)) {
          seenThreads.add(msg.thread_id);
          messageIds.push({ id: msg.id, platform: msg.platform ?? 'linkedin' });
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

    let liked = 0;
    for (const { id, platform } of messageIds) {
      const ok = await likeMessage(organizationId, id, platform, ctx);
      if (ok) liked += 1;
    }

    return res.status(200).json({ success: true, liked });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/message/bulk-like]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/message/bulk-like' });
