
/**
 * Define Campaign Purpose & Strategic Intent.
 * Guided conversation to capture campaign_purpose_intent JSONB.
 * Reuses same pattern as define-target-customer.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getProfile } from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

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

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

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
      '4. What type of campaigns do you intend to run consistently? (examples: lead_generation, brand_awareness, authority_positioning, network_expansion, engagement_growth, product_promotion)\n\n' +
      'Also capture (ask only if missing / not clear from answers):\n' +
      '- reader_emotion_target: what should the reader feel after consuming the content (e.g. confident, curious, urgent, relieved).\n' +
      '- narrative_flow_seed: a 3-step or 4-step weekly progression seed (pattern + steps).\n' +
      '- recommended_cta_style: recommended CTA style aligned to campaign type (e.g. Soft, Direct, Engagement prompts, Light).\n\n' +
      'Response format (JSON only, no markdown, no explanation):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough: { "done": true, "campaign_purpose_intent": { "primary_objective": "...", "campaign_intent": "...", "monetization_intent": "...", "dominant_problem_domains": ["...", "..."], "brand_positioning_angle": "...", "reader_emotion_target": "...", "narrative_flow_seed": { "pattern": "...", "steps": ["...", "...", "..."] }, "recommended_cta_style": "..." } }\n' +
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
        reader_emotion_target?: string;
        narrative_flow_seed?: unknown;
        recommended_cta_style?: string;
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.campaign_purpose_intent) {
      const cpi = parsed.campaign_purpose_intent;
      const normalizeString = (value: unknown): string | null => {
        const s = typeof value === 'string' ? value : String(value ?? '');
        const t = s.trim();
        return t ? t : null;
      };
      const normalizeStringArray = (value: unknown, max?: number): string[] => {
        if (!Array.isArray(value)) return [];
        const out = value
          .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
          .filter(Boolean);
        return max != null ? out.slice(0, max) : out;
      };
      const normalizeNarrativeSeed = (value: unknown): { pattern?: string | null; steps?: string[] | null } | null => {
        if (value == null) return null;
        if (typeof value === 'string') {
          const pattern = normalizeString(value);
          return pattern ? { pattern } : null;
        }
        if (typeof value !== 'object') return null;
        const pattern = normalizeString((value as any)?.pattern);
        const steps = normalizeStringArray((value as any)?.steps, 8);
        if (!pattern && steps.length === 0) return null;
        return {
          pattern: pattern ?? null,
          steps: steps.length > 0 ? steps : null,
        };
      };
      const campaignPurposeIntent = {
        primary_objective: normalizeString(cpi.primary_objective) ?? null,
        campaign_intent: normalizeString(cpi.campaign_intent) ?? null,
        monetization_intent: normalizeString(cpi.monetization_intent) ?? null,
        dominant_problem_domains: Array.isArray(cpi.dominant_problem_domains)
          ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string')
          : [],
        brand_positioning_angle: normalizeString(cpi.brand_positioning_angle) ?? null,
        reader_emotion_target: normalizeString(cpi.reader_emotion_target) ?? null,
        narrative_flow_seed: normalizeNarrativeSeed(cpi.narrative_flow_seed),
        recommended_cta_style: normalizeString(cpi.recommended_cta_style) ?? null,
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
