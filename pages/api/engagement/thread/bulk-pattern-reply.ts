
/**
 * POST /api/engagement/thread/bulk-pattern-reply
 * Apply response pattern and send AI-generated reply to selected threads.
 * Body: thread_ids, pattern_id, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../../backend/db/supabaseClient';
import { bulkReplyThreads } from '../../../../backend/services/bulkEngagementService';
import { generateResponse } from '../../../../backend/services/responseGenerationService';
import { SUPPORTED_TAGS } from '../../../../backend/services/taggedResponseInterpreter';

const MAX_BATCH = 20;
const TAG_SET = new Set(SUPPORTED_TAGS.map((t) => t.toLowerCase()));

type Body = {
  thread_ids?: string[];
  pattern_id?: string;
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
    const patternId = body.pattern_id?.trim();
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (rawThreadIds.length === 0) {
      return res.status(400).json({ error: 'thread_ids required' });
    }
    if (!patternId) {
      return res.status(400).json({ error: 'pattern_id required' });
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

    const { data: pattern } = await supabase
      .from('response_patterns')
      .select('id, pattern_structure, pattern_category')
      .eq('id', patternId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    const structure = (pattern as { pattern_structure?: { blocks?: { type?: string; label?: string }[] } }).pattern_structure;
    const blocks = structure?.blocks ?? [];
    const templateStructure =
      blocks
        .map((b) => {
          const t = (b.type || 'answer').toLowerCase();
          const tag = TAG_SET.has(t) ? t : 'answer';
          const content = (b.label || '').trim() || ' ';
          return `<${tag}>${content}</${tag}>`;
        })
        .join('\n') || '<acknowledgement>Acknowledge the message</acknowledgement>\n<answer>Provide helpful info</answer>';

    const getReplyText = async (
      _threadId: string,
      messageId: string,
      platform: string
    ): Promise<string | null> => {
      const { data: msg } = await supabase
        .from('engagement_messages')
        .select('id, content, thread_id')
        .eq('id', messageId)
        .maybeSingle();
      if (!msg) return null;
      const result = await generateResponse({
        message_id: messageId,
        thread_id: (msg as { thread_id: string }).thread_id,
        organization_id: organizationId,
        platform,
        original_message: ((msg as { content?: string }).content ?? '').toString(),
        template_structure: templateStructure || 'greeting\nacknowledgement\nhelpful_info',
        tone: 'professional',
      });
      return result.text?.trim() ?? null;
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
    console.error('[engagement/thread/bulk-pattern-reply]', msg);
    return res.status(500).json({ error: msg });
  }
}
