import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

// Commercial fields collected in Phase 1. Field naming matches company_profiles DB columns.
const FIELDS_DESCRIPTION = [
  'target_customer_segment: who they sell to (e.g. SMB, enterprise, vertical)',
  'ideal_customer_profile: 1–2 sentence description of the ideal buyer',
  'pricing_model: e.g. subscription, one-time, usage-based, freemium',
  'sales_motion: e.g. self-serve, sales-led, hybrid, product-led',
  'avg_deal_size: typical deal or contract value (e.g. $5k, $50k)',
  'sales_cycle: e.g. days, weeks, months',
  'key_metrics: 2–4 metrics they care about (e.g. MRR, CAC, LTV)',
].join('\n');

// Phase 2: Campaign purpose questions. Parsed into campaign_purpose_intent JSONB.
const CAMPAIGN_PURPOSE_QUESTIONS = [
  'Why are you using social media for this business?',
  'What do you ultimately want to achieve through campaigns?',
  'What kind of problems do you want to be known for solving?',
  'What type of campaigns do you intend to run consistently?',
];

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
      ? `Company: ${profile.name || companyId}. Industry: ${profile.industry || 'Not set'}. Category: ${profile.category || 'Not set'}.`
      : 'Company not yet profiled.';

    const systemPrompt =
      'You are a commercial strategy assistant. Your goal is to capture structured commercial and target-customer information through a short guided conversation.\n\n' +
      'Rules:\n' +
      '- Ask ONE short, clear question at a time.\n' +
      '- Phase 1: Cover these fields (you may combine related questions): ' +
      FIELDS_DESCRIPTION +
      '\n\n' +
      '- Phase 2: After the 7 commercial fields, ask these campaign purpose questions (one at a time):\n' +
      CAMPAIGN_PURPOSE_QUESTIONS.map((q) => `  • ${q}`).join('\n') +
      '\n\n' +
      'Response format (JSON only, no markdown, no explanation):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough to fill all 7 commercial fields AND campaign purpose: { "done": true, "structuredFields": { "target_customer_segment": "...", "ideal_customer_profile": "...", "pricing_model": "...", "sales_motion": "...", "avg_deal_size": "...", "sales_cycle": "...", "key_metrics": "..." }, "campaign_purpose_intent": { "primary_objective": "...", "campaign_intent": "...", "monetization_intent": "...", "dominant_problem_domains": ["...", "..."], "brand_positioning_angle": "..." } }\n' +
      'Use empty string for any commercial field you could not infer. Keep values concise (1–2 sentences max for ideal_customer_profile).\n' +
      'In campaign_purpose_intent: primary_objective = why social media for this business; campaign_intent = what they want to achieve; monetization_intent = how campaigns support revenue; dominant_problem_domains = array of problems they want to solve; brand_positioning_angle = how they want to be perceived. Always return valid JSON.';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Context: ${companyContext}\n\n${
          conversation.length === 0
            ? 'Start the guided questionnaire. Ask the first question to define the target customer and commercial strategy.'
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
      structuredFields?: Record<string, string>;
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

    if (parsed.done && parsed.structuredFields) {
      const cpi = parsed.campaign_purpose_intent;
      const campaignPurposeIntent =
        cpi && typeof cpi === 'object'
          ? {
              primary_objective: String(cpi.primary_objective ?? '').trim() || null,
              campaign_intent: String(cpi.campaign_intent ?? '').trim() || null,
              monetization_intent: String(cpi.monetization_intent ?? '').trim() || null,
              dominant_problem_domains: Array.isArray(cpi.dominant_problem_domains)
                ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string').slice(0, 10)
                : [],
              brand_positioning_angle: String(cpi.brand_positioning_angle ?? '').trim() || null,
            }
          : null;
      return res.status(200).json({
        done: true,
        structuredFields: parsed.structuredFields,
        campaign_purpose_intent: campaignPurposeIntent,
      });
    }
    return res.status(200).json({
      nextQuestion: parsed.nextQuestion || 'Anything else you’d like to add about your commercial strategy?',
    });
  } catch (err: any) {
    console.error('Define target customer failed:', err);
    return res.status(500).json({
      error: 'Failed to run define target customer',
      details: err?.message || null,
    });
  }
}
