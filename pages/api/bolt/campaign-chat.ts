/**
 * POST /api/bolt/campaign-chat
 * AI chat to brainstorm and refine campaign topics for the BOLT strategy builder.
 * Uses the same aiGateway (runCompletionWithOperation) as the rest of the platform.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, message, history, context } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : [];

    // Build context block from current form state
    const ctx = context && typeof context === 'object' ? context as Record<string, unknown> : {};
    const contextParts: string[] = [];
    if (ctx.topic) contextParts.push(`Current campaign topic: "${ctx.topic}"`);
    if (ctx.goal) contextParts.push(`Campaign goal: ${ctx.goal}`);
    if (ctx.audience) contextParts.push(`Target audience: ${ctx.audience}`);
    if (ctx.strategicFocus && Array.isArray(ctx.strategicFocus) && ctx.strategicFocus.length > 0) {
      contextParts.push(`Strategic focus: ${(ctx.strategicFocus as string[]).join(', ')}`);
    }
    if (ctx.duration) contextParts.push(`Duration: ${ctx.duration} weeks`);

    const contextBlock = contextParts.length > 0
      ? `Current campaign context:\n${contextParts.join('\n')}\n\n`
      : '';

    const systemPrompt = `You are a campaign strategy advisor helping a marketer brainstorm and refine their campaign topic using the BOLT strategy builder.

Your role:
- Suggest specific, compelling campaign titles or topic angles
- Help refine vague ideas into focused campaign concepts
- Ask clarifying questions when the topic is too broad
- Keep responses concise and actionable (2-4 sentences)
- If suggesting a campaign title, make it concrete and specific

Return a JSON object with:
{
  "reply": "Your conversational response here",
  "suggested_topic": "Optional: a specific campaign title if you're suggesting one, otherwise omit this field"
}

Return only JSON.`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const turn of chatHistory.slice(-8)) {
      messages.push({ role: turn.role, content: turn.text });
    }

    messages.push({
      role: 'user',
      content: `${contextBlock}${message.trim()}`,
    });

    const result = await runCompletionWithOperation({
      companyId,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages,
      operation: 'generatePlatformVariants',
    });

    let parsed: { reply?: string; suggested_topic?: string } = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return res.status(500).json({ error: 'AI returned malformed response' });
    }

    return res.status(200).json({
      reply: parsed.reply?.trim() || 'Let me help you refine that.',
      suggested_topic: parsed.suggested_topic?.trim() || null,
    });
  } catch (err: unknown) {
    console.error('[bolt/campaign-chat]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process request',
    });
  }
}
