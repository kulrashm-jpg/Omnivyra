import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/engagement/suggestions
 * Returns AI-suggested replies for an engagement message.
 * Query: message_id, organization_id
 * Returns minimum 3 suggestions with id, text, explanation_tag.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getControls } from '../../../backend/services/engagementGovernanceService';
import {
  generateReplySuggestions,
  isThreadNotActionableError,
} from '../../../backend/services/engagementAiAssistantService';
import { supabase } from '../../../backend/db/supabaseClient';

const FALLBACK_SUGGESTIONS = [
  { text: 'Thanks for sharing this. Send me the key details and I will take a proper look.', tone: 'accept' },
  { text: 'Can you share the specific context or next step you have in mind so I respond correctly?', tone: 'clarify' },
  { text: 'I may not be able to act on this immediately, but send the relevant details and I will review them.', tone: 'defer' },
];

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
    const padded: Array<{ text: string; tone?: string }> = [...replies];
    while (padded.length < 3) {
      padded.push(FALLBACK_SUGGESTIONS[padded.length % FALLBACK_SUGGESTIONS.length]);
    }

    const suggestions = padded.slice(0, 3).map((r, i) => ({
      id: `sug-${crypto.randomUUID()}`,
      text: (r.text ?? '').toString().trim() || FALLBACK_SUGGESTIONS[i % FALLBACK_SUGGESTIONS.length].text,
      explanation_tag: r.tone ? r.tone.replace(/_/g, ' ') : undefined,
    }));

    return res.status(200).json({ suggestions });
  } catch (err) {
    // F5: "this thread is already answered" is a deterministic refusal, not a
    // server fault. It must NOT fall through to the generic 500 path, and it
    // must NOT be padded with FALLBACK_SUGGESTIONS — returning canned replies
    // here would hand the user a sendable draft for a thread that needs none,
    // which is precisely the defect this guard exists to close.
    if (isThreadNotActionableError(err)) {
      return res.status(409).json({
        error:
          'This conversation has already been answered. A reply suggestion is only ' +
          'offered while the other person is waiting on you.',
        code: 'THREAD_NOT_ACTIONABLE',
        suggestions: [],
      });
    }
    const msg = (err as Error)?.message ?? 'Failed to generate suggestions';
    console.error('[engagement/suggestions]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/suggestions' });
