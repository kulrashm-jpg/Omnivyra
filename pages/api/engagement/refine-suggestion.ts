import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getThreadMessages } from '../../../backend/services/engagementMessageService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

type RefineBody = {
  organization_id?: string;
  organizationId?: string;
  thread_id?: string;
  draft?: string;
  instruction?: string;
  selected_intent?: string | null;
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
    const selectedIntent = (body.selected_intent || '').toString().trim();

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

    const messages = await getThreadMessages(threadId);
    const threadContext = messages
      .map((message) => `${message.author?.display_name ?? message.author?.username ?? 'User'}: ${message.content ?? ''}`)
      .join('\n')
      .slice(0, 2500);

    const result = await runCompletionWithOperation({
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
            [
              'You refine one selected engagement reply option.',
              'Do not merely paraphrase the draft.',
              'Use the conversation and the user instruction to produce a better outcome for that selected option.',
              'Preserve the selected intent unless the instruction explicitly asks to change it.',
              'If the selected intent is Yes, make the reply helpful/accepting.',
              'If the selected intent is No, make the reply a clear but respectful boundary or decline.',
              'If the selected intent is Maybe, ask for the missing detail or defer with a concrete next step.',
              'Keep it concise, human, specific to the thread, and ready to send.',
              'Output only the revised reply text.',
            ].join(' '),
        },
        {
          role: 'user',
          content:
            `Conversation:\n${threadContext || '(no prior context)'}\n\n` +
            `Selected option intent:\n${selectedIntent || 'Unknown'}\n\n` +
            `Current draft:\n${draft}\n\n` +
            `Refinement request:\n${instruction}\n\n` +
            'Return one improved reply that meaningfully changes the selected option according to the request. Do not return a cosmetic rewrite.',
        },
      ],
    });

    const refined = (result.output ?? '').toString().trim();
    if (!refined) {
      return res.status(500).json({ error: 'AI returned an empty refinement' });
    }

    return res.status(200).json({ refined });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to refine suggestion';
    console.error('[engagement/refine-suggestion]', message);
    return res.status(500).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

