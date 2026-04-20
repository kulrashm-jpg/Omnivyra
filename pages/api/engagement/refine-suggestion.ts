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
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
            'You refine social engagement replies. Keep the response concise, human, and directly grounded in the conversation. Output only the revised reply text.',
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
