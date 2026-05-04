import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/engagement/suggestions
 * Returns AI-suggested replies for an engagement message.
 * Query: message_id, organization_id
 * Returns exactly 3 intent suggestions with id, text, explanation_tag.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getControls } from '../../../backend/services/engagementGovernanceService';
import { generateReplySuggestions } from '../../../backend/services/engagementAiAssistantService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const messageId = (req.query.message_id ?? req.query.messageId) as string | undefined;
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }
    if (!messageId) {
      return res.status(400).json({ error: 'message_id or messageId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: message } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, content, platform')
      .eq('id', messageId)
      .maybeSingle();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('organization_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (!thread || thread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Message thread not found or access denied' });
    }

    const controls = await getControls(organizationId);
    if (!controls.ai_suggestions_enabled) {
      return res.status(403).json({ error: 'AI suggestions are disabled for this organization' });
    }

    const result = await generateReplySuggestions(messageId, organizationId);
    const replies = (result.suggested_replies ?? []).filter((reply) =>
      (reply.text ?? '').toString().trim().length > 0
    );

    if (replies.length !== 3) {
      console.error('[engagement/suggestions] Expected exactly 3 intent suggestions but received', replies.length);
      return res.status(500).json({ error: 'AI suggestion flow returned an invalid suggestion set' });
    }

    const suggestions = replies.map((r) => ({
      id: `sug-${crypto.randomUUID()}`,
      text: (r.text ?? '').toString().trim(),
      explanation_tag: r.tone ? r.tone.replace(/_/g, ' ') : undefined,
    }));

    return res.status(200).json({ suggestions });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to generate suggestions';
    console.error('[engagement/suggestions]', msg);
    return res.status(500).json({ error: msg });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

