/**
 * POST /api/engagement/reply
 * Reply to an engagement message.
 * Inserts into comment_replies when post_comment_id exists, then executes via communityAiActionExecutor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole } from '../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../backend/db/supabaseClient';
import { executeAction } from '../../../backend/services/communityAiActionExecutor';
import { listPlaybooks } from '../../../backend/services/playbooks/playbookService';
import { recordReplyPerformance } from '../../../backend/services/responsePerformanceService';
import { resolveOpportunityByReply } from '../../../backend/services/engagementOpportunityResolutionService';

type ReplyBody = {
  organization_id?: string;
  thread_id?: string;
  message_id?: string;
  reply_text?: string;
  platform?: string;
  ai_generated?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as ReplyBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const threadId = body.thread_id;
    const messageId = body.message_id;
    const replyText = (body.reply_text ?? '').toString().trim();
    const platform = (body.platform ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!messageId) {
      return res.status(400).json({ error: 'message_id required' });
    }
    if (!replyText) {
      return res.status(400).json({ error: 'reply_text required' });
    }
    if (!platform) {
      return res.status(400).json({ error: 'platform required' });
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

    const { data: message, error: msgError } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, platform_message_id, post_comment_id, platform')
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (threadId && message.thread_id !== threadId) {
      return res.status(400).json({ error: 'message_id does not belong to thread_id' });
    }

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('id, organization_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (!thread || thread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Message thread not found or access denied' });
    }

    if (message.post_comment_id && roleGate.userId) {
      const { error: insertError } = await supabase.from('comment_replies').insert({
        comment_id: message.post_comment_id,
        user_id: roleGate.userId,
        content: replyText,
        status: 'pending',
      });
      if (insertError) {
        console.warn('[engagement/reply] comment_replies insert failed:', insertError.message);
      }
    }

    const playbooks = (await listPlaybooks(organizationId, organizationId)).filter(
      (p: { status?: string }) => p.status === 'active'
    );
    const playbookId = playbooks[0]?.id ?? null;
    if (!playbookId) {
      return res.status(400).json({
        error: 'No active playbook found for organization. Create an active playbook to execute replies.',
      });
    }

    const actionId = crypto.randomUUID();
    const result = await executeAction(
      {
        id: actionId,
        tenant_id: organizationId,
        organization_id: organizationId,
        platform,
        action_type: 'reply',
        target_id: message.platform_message_id ?? messageId,
        suggested_text: replyText,
        playbook_id: playbookId,
        execution_mode: 'manual',
      },
      true,
      { source: 'manual' }
    );

    if (!result.ok) {
      return res.status(500).json({
        error: result.error ?? 'Execution failed',
        status: result.status,
      });
    }

    void recordReplyPerformance({
      organization_id: organizationId,
      thread_id: message.thread_id,
      message_id: messageId,
      platform,
      ai_generated: Boolean(body.ai_generated),
    }).catch((err) => console.warn('[engagement/reply] recordReplyPerformance', (err as Error)?.message));

    void resolveOpportunityByReply(
      message.thread_id,
      null,
      roleGate?.userId ?? null
    ).catch((err) => console.warn('[engagement/reply] resolveOpportunityByReply', (err as Error)?.message));

    return res.status(200).json({
      success: true,
      status: result.status,
      response: result.response,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to reply';
    console.error('[engagement/reply]', msg);
    return res.status(500).json({ error: msg });
  }
}
