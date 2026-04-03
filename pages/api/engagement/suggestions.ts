
/**
 * GET /api/engagement/suggestions
 * Returns AI-suggested replies for an engagement message.
 * Query: message_id, organization_id
 * Returns minimum 3 suggestions with id, text, explanation_tag.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getControls } from '../../../backend/services/engagementGovernanceService';
import { generateReplySuggestions } from '../../../backend/services/engagementAiAssistantService';
import { supabase } from '../../../backend/db/supabaseClient';

const FALLBACK_SUGGESTIONS = [
  'Thank you for your message. We appreciate your feedback.',
  'Thanks for reaching out! Happy to help.',
  'Great question. Here\'s some context that might help.',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const replies = result.suggested_replies ?? [];
    const min3 = Math.max(3, replies.length);
    const padded: Array<{ text: string; tone?: string }> = [...replies];
    while (padded.length < min3) {
      padded.push({ text: FALLBACK_SUGGESTIONS[padded.length % FALLBACK_SUGGESTIONS.length], tone: 'professional' });
    }

    const suggestions = padded.slice(0, Math.max(3, padded.length)).map((r, i) => ({
      id: `sug-${crypto.randomUUID()}`,
      text: (r.text ?? '').toString().trim() || FALLBACK_SUGGESTIONS[i % FALLBACK_SUGGESTIONS.length],
      explanation_tag: r.tone ? ` ${r.tone}` : undefined,
    }));

    return res.status(200).json({ suggestions });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to generate suggestions';
    console.error('[engagement/suggestions]', msg);
    return res.status(500).json({ error: msg });
  }
}
