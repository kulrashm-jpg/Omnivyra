import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getProfile, MARKETING_INTELLIGENCE_FIELD_NAMES } from '../../../backend/services/companyProfileService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';

const OUTPUT_FIELDS = [
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;

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
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const client = getOpenAiClient();
    const systemPrompt =
      'You are a marketing intelligence analyst. Given a company profile (including commercial strategy), produce structured marketing intelligence.\n\n' +
      'Return JSON only with exactly these keys (string values, 1–3 sentences each; empty string if unclear):\n' +
      '- marketing_channels: primary channels (e.g. social, email, events, paid)\n' +
      '- content_strategy: high-level content approach and formats\n' +
      '- campaign_focus: what campaigns typically focus on\n' +
      '- key_messages: core messages to convey\n' +
      '- brand_positioning: how the brand wants to be perceived\n' +
      '- competitive_advantages: differentiators vs competitors\n' +
      '- growth_priorities: marketing/growth priorities';

    const userPrompt =
      'Company profile and commercial context:\n' + JSON.stringify(profile, null, 2);

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    const structuredFields: Record<string, string> = {};
    for (const key of OUTPUT_FIELDS) {
      const v = parsed[key];
      structuredFields[key] =
        v !== undefined && v !== null ? String(v).trim() : '';
    }

    try {
      await supabase.from('audit_logs').insert({
        action: 'MARKETING_INTELLIGENCE_GENERATED',
        actor_user_id: user.id,
        company_id: null,
        metadata: {
          company_id: companyId,
          fields_generated: MARKETING_INTELLIGENCE_FIELD_NAMES.slice(),
        },
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('MARKETING_INTELLIGENCE_GENERATED audit failed', e);
    }

    return res.status(200).json({ structuredFields });
  } catch (err: any) {
    console.error('Generate marketing intelligence failed:', err);
    return res.status(500).json({
      error: 'Failed to generate marketing intelligence',
      details: err?.message || null,
    });
  }
}
