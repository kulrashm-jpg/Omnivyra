import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getThreadMessages } from '../../../backend/services/engagementMessageService';
import { isThreadActionable } from '../../../backend/services/engagementThreadService';
import { supabase } from '../../../backend/db/supabaseClient';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { resolveCompanyGroundingGuard } from '../../../backend/services/context/canonicalContentContextResolver';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../backend/services/billing/phase2EnforcementGate';

type RefineBody = {
  organization_id?: string;
  organizationId?: string;
  thread_id?: string;
  draft?: string;
  instruction?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as RefineBody;
    const organizationId = (body.organization_id ?? body.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const threadId = (body.thread_id || '').toString().trim();
    const draft = (body.draft || '').toString().trim();
    const instruction = (body.instruction || '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!threadId) {
      return res.status(400).json({ error: 'thread_id required' });
    }
    if (!draft) {
      return res.status(400).json({ error: 'draft required' });
    }
    if (!instruction) {
      return res.status(400).json({ error: 'instruction required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Resource-ownership authorization: enforceCompanyAccess only proves the
    // caller owns `organizationId`. `thread_id` is a separate client-supplied
    // resource id, loaded below via the RLS-bypassing service-role client — so a
    // member of company X could otherwise pass company Y's thread and pull Y's
    // conversation into the prompt. Ownership lives on
    // engagement_threads.organization_id (engagement_messages has no org column);
    // verify it BEFORE any message content is read.
    const { data: ownerThread } = await supabase
      .from('engagement_threads')
      .select('organization_id')
      .eq('id', threadId)
      .maybeSingle();
    if (!ownerThread || ownerThread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Thread not found or access denied' });
    }

    // F5: refinement is AI generation too — it returns text the operator can
    // paste into the composer and send. Gating it on the same canonical
    // actionability the rest of the Engagement Center consumes keeps every AI
    // path aligned; leaving it open would make "refine" the way around the
    // guard on "suggest".
    if (!(await isThreadActionable(organizationId, threadId))) {
      return res.status(409).json({
        error:
          'This conversation has already been answered. Refinement is only offered ' +
          'while the other person is waiting on you.',
        code: 'THREAD_NOT_ACTIONABLE',
      });
    }

    const messages = await getThreadMessages(threadId);
    const threadContext = messages
      .map((message) => `${message.author?.display_name ?? message.author?.username ?? 'User'}: ${message.content ?? ''}`)
      .join('\n')
      .slice(0, 2500);

    // Deterministic company grounding: constrain the reply to the active company
    // and forbid naming any other company not present in this thread/draft.
    const grounding = await resolveCompanyGroundingGuard(organizationId);

    const result = await wirePhase2Route({
      surface:        'engagement.refine-suggestion',
      organizationId,
      action:         'engagement_refine',
      referenceType:  'engagement_refine',
      referenceId:    createHash('sha256')
        .update([organizationId, threadId, instruction, draft].join('|'))
        .digest('hex').slice(0, 40),
      run: () => runCompletionWithOperation({
      companyId: organizationId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      operation: 'responseGeneration',
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content:
            'You refine social engagement replies. Keep the response concise, human, and directly grounded in the conversation. Output only the revised reply text.\n\n' +
            grounding.directive,
        },
        {
          role: 'user',
          content:
            `Conversation:\n${threadContext || '(no prior context)'}\n\n` +
            `Current draft:\n${draft}\n\n` +
            `Refinement request:\n${instruction}\n\n` +
            'Return one improved reply only.',
        },
      ],
      }),
    });

    const refined = (result.output ?? '').toString().trim();
    if (!refined) {
      return res.status(500).json({ error: 'AI returned an empty refinement' });
    }

    return res.status(200).json({ refined });
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    const message = (err as Error)?.message ?? 'Failed to refine suggestion';
    console.error('[engagement/refine-suggestion]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/refine-suggestion' });
