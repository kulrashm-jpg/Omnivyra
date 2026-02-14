import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

const FIELDS_DESCRIPTION = [
  'marketing_channels: primary channels (e.g. social, email, events, paid)',
  'content_strategy: high-level content approach and formats',
  'campaign_focus: what campaigns typically focus on',
  'key_messages: core messages to convey',
  'brand_positioning: how the brand wants to be perceived',
  'competitive_advantages: differentiators vs competitors',
  'growth_priorities: marketing/growth priorities',
].join('\n');

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
  const currentFields = (req.body?.currentFields ?? req.body?.currentMarketingIntelligence) as Record<string, string> | undefined;

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const isAdmin = await isSuperAdmin(user.id);
  if (!isAdmin) {
    const { role, error: roleError } = await getUserRole(user.id, companyId);
    if (roleError || !role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }

  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    const companyContext = profile
      ? `Company: ${profile.name || companyId}. Industry: ${profile.industry || 'Not set'}. Category: ${profile.category || 'Not set'}. Commercial: ${[profile.target_customer_segment, profile.pricing_model, profile.sales_motion].filter(Boolean).join(', ') || 'Not set'}.`
      : 'Company not yet profiled.';

    const currentFieldsText =
      currentFields && typeof currentFields === 'object'
        ? 'Current marketing intelligence (refine these based on conversation):\n' +
          [
            'marketing_channels',
            'content_strategy',
            'campaign_focus',
            'key_messages',
            'brand_positioning',
            'competitive_advantages',
            'growth_priorities',
          ]
            .map((k) => `${k}: ${String(currentFields[k] ?? '').trim() || '(empty)'}`)
            .join('\n')
        : '';

    const systemPrompt =
      'You are a marketing intelligence assistant. Your goal is to REFINE the existing marketing intelligence fields using a short guided conversation with the user.\n\n' +
      'You will be given: (1) company context, (2) current values for all 7 fields, (3) the conversation.\n' +
      'Rules:\n' +
      '- Ask ONE short, clear question at a time to clarify or improve the fields.\n' +
      '- Consider both the current field values AND what the user says in the chat. Refine each field accordingly (keep, improve, or replace).\n' +
      '- Cover all 7 fields: ' +
      FIELDS_DESCRIPTION +
      '\n\n' +
      'Response format (JSON only, no markdown):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough to output refined values for all 7 fields: { "done": true, "structuredFields": { "marketing_channels": "...", "content_strategy": "...", "campaign_focus": "...", "key_messages": "...", "brand_positioning": "...", "competitive_advantages": "...", "growth_priorities": "..." } }\n' +
      'In structuredFields: merge current values with user input; do not leave a field empty unless the user explicitly clears it. Keep values concise (1–2 sentences max where needed).';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `Context: ${companyContext}`,
          currentFieldsText,
          conversation.length === 0
            ? 'Start the refinement. Ask the first question (e.g. which field to refine first, or a general marketing question).'
            : 'Conversation so far:\n' +
              conversation
                .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
                .join('\n'),
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { nextQuestion?: string; done?: boolean; structuredFields?: Record<string, string> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.structuredFields) {
      return res.status(200).json({
        done: true,
        structuredFields: parsed.structuredFields,
      });
    }
    return res.status(200).json({
      nextQuestion:
        parsed.nextQuestion ||
        'Anything else you’d like to add about your marketing strategy?',
    });
  } catch (err: any) {
    console.error('Define marketing intelligence failed:', err);
    return res.status(500).json({
      error: 'Failed to run define marketing intelligence',
      details: err?.message || null,
    });
  }
}
