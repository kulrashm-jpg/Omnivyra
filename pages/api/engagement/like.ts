/**
 * POST /api/engagement/like
 * Like an engagement message.
 * Inserts into comment_likes when post_comment_id exists, then executes via communityAiActionExecutor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole } from '../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../backend/db/supabaseClient';
import { executeAction } from '../../../backend/services/communityAiActionExecutor';
import { listPlaybooks } from '../../../backend/services/playbooks/playbookService';
import { incrementReplyLike } from '../../../backend/services/responsePerformanceService';

type LikeBody = {
  organization_id?: string;
  message_id?: string;
  platform?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as LikeBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const messageId = body.message_id;
    const platform = (body.platform ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!messageId) {
      return res.status(400).json({ error: 'message_id required' });
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

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('id, organization_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (!thread || thread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Message thread not found or access denied' });
    }

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

    const playbooks = (await listPlaybooks(organizationId, organizationId)).filter(
      (p: { status?: string }) => p.status === 'active'
    );
    const playbookId = playbooks[0]?.id ?? null;
    if (!playbookId) {
      return res.status(400).json({
        error: 'No active playbook found for organization. Create an active playbook to execute likes.',
      });
    }

    const actionId = uuidv4();
    const result = await executeAction(
      {
        id: actionId,
        tenant_id: organizationId,
        organization_id: organizationId,
        platform,
        action_type: 'like',
        target_id: message.platform_message_id ?? messageId,
        suggested_text: null,
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

    void incrementReplyLike(messageId).catch((err) =>
      console.warn('[engagement/like] incrementReplyLike', (err as Error)?.message)
    );

    return res.status(200).json({
      success: true,
      status: result.status,
      response: result.response,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to like message';
    console.error('[engagement/like]', message);
    return res.status(500).json({ error: message });
  }
}
