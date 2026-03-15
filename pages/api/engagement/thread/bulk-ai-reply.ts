/**
 * POST /api/engagement/thread/bulk-ai-reply
 * Generate AI suggestion and send top reply to selected threads.
 * Body: thread_ids, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getControls } from '../../../../backend/services/engagementGovernanceService';
import { bulkReplyThreads } from '../../../../backend/services/bulkEngagementService';
import { generateReplySuggestions } from '../../../../backend/services/engagementAiAssistantService';

const MAX_BATCH = 20;

type Body = {
  thread_ids?: string[];
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const rawThreadIds = Array.isArray(body.thread_ids) ? body.thread_ids : [];
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (rawThreadIds.length === 0) {
      return res.status(400).json({ error: 'thread_ids required' });
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

    const controls = await getControls(organizationId);
    if (!controls.bulk_reply_enabled) {
      return res.status(403).json({ error: 'Bulk reply is disabled for this organization' });
    }

    const getReplyText = async (
      _threadId: string,
      messageId: string,
      _platform: string
    ): Promise<string | null> => {
      try {
        const result = await generateReplySuggestions(messageId, organizationId);
        const replies = result.suggested_replies ?? [];
        const top = replies[0]?.text?.trim();
        return top ?? null;
      } catch {
        return null;
      }
    };

    const { sent, skipped, errors } = await bulkReplyThreads(
      organizationId,
      rawThreadIds.slice(0, MAX_BATCH),
      getReplyText,
      roleGate?.userId
    );

    return res.status(200).json({
      success: true,
      sent,
      skipped,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/bulk-ai-reply]', msg);
    return res.status(500).json({ error: msg });
  }
}
