/**
 * Define Campaign Purpose & Strategic Intent.
 * Guided conversation to capture campaign_purpose_intent JSONB.
 * Reuses same pattern as define-target-customer.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

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
      ? `Company: ${profile.name || companyId}. Industry: ${profile.industry || 'Not set'}. Target: ${profile.target_customer_segment || 'Not set'}.`
      : 'Company not yet profiled.';

    const systemPrompt =
      'You are a campaign strategy assistant. Capture campaign purpose and strategic intent through a short guided conversation.\n\n' +
      'Ask the user (one question at a time):\n' +
      '1. Why are you using social media for this business?\n' +
      '2. What do you ultimately want to achieve through campaigns?\n' +
      '3. What kind of problems do you want to be known for solving?\n' +
      '4. What type of campaigns do you intend to run consistently?\n\n' +
      'Response format (JSON only, no markdown, no explanation):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough: { "done": true, "campaign_purpose_intent": { "primary_objective": "...", "campaign_intent": "...", "monetization_intent": "...", "dominant_problem_domains": ["...", "..."], "brand_positioning_angle": "..." } }\n' +
      'Map answers: primary_objective=why social media; campaign_intent=what to achieve; monetization_intent=how campaigns support revenue; dominant_problem_domains=array of problems to solve; brand_positioning_angle=how to be perceived. Always valid JSON.';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Context: ${companyContext}\n\n${
          conversation.length === 0
            ? 'Start the questionnaire. Ask the first question about campaign purpose.'
            : 'Conversation so far:\n' +
              conversation
                .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
                .join('\n')
        }`,
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
    let parsed: {
      nextQuestion?: string;
      done?: boolean;
      campaign_purpose_intent?: {
        primary_objective?: string;
        campaign_intent?: string;
        monetization_intent?: string;
        dominant_problem_domains?: string[];
        brand_positioning_angle?: string;
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.campaign_purpose_intent) {
      const cpi = parsed.campaign_purpose_intent;
      const campaignPurposeIntent = {
        primary_objective: String(cpi.primary_objective ?? '').trim() || null,
        campaign_intent: String(cpi.campaign_intent ?? '').trim() || null,
        monetization_intent: String(cpi.monetization_intent ?? '').trim() || null,
        dominant_problem_domains: Array.isArray(cpi.dominant_problem_domains)
          ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string').slice(0, 10)
          : [],
        brand_positioning_angle: String(cpi.brand_positioning_angle ?? '').trim() || null,
      };
      return res.status(200).json({
        done: true,
        campaign_purpose_intent: campaignPurposeIntent,
      });
    }
    return res.status(200).json({
      nextQuestion:
        parsed.nextQuestion ||
        'Anything else you’d like to add about your campaign purpose?',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error: 'Failed to run define campaign purpose',
      details: message,
    });
  }
}
