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

const OUTPUT_SCHEMA = `{
  core_problem_statement: string | null,
  pain_symptoms: string[],
  awareness_gap: string | null,
  problem_impact: string | null,
  life_with_problem: string | null,
  life_after_solution: string | null,
  desired_transformation: string | null,
  transformation_mechanism: string | null,
  authority_domains: string[]
}`;

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
  if (!(await isSuperAdmin(user.id))) {
    const { role, error: roleError } = await getUserRole(user.id, companyId);
    if (roleError || !role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }

  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(200).json({
        structuredFields: {
          core_problem_statement: null,
          pain_symptoms: [],
          awareness_gap: null,
          problem_impact: null,
          life_with_problem: null,
          life_after_solution: null,
          desired_transformation: null,
          transformation_mechanism: null,
          authority_domains: [],
        },
      });
    }

    const sections = [
      ['Identity', `Name: ${profile.name ?? ''}. Industry: ${profile.industry ?? ''}. Category: ${profile.category ?? ''}. Geography: ${profile.geography ?? ''}.`],
      ['Products/Services', String(profile.products_services ?? '').trim() || String((profile.products_services_list ?? []).join(', ')).trim() || '(empty)'],
      ['Target Audience', String(profile.target_audience ?? '').trim() || String((profile.target_audience_list ?? []).join(', ')).trim() || '(empty)'],
      ['Content themes', String(profile.content_themes ?? '').trim() || String((profile.content_themes_list ?? []).join(', ')).trim() || '(empty)'],
      ['Goals', String(profile.goals ?? '').trim() || String((profile.goals_list ?? []).join(', ')).trim() || '(empty)'],
      ['Brand voice', String(profile.brand_voice ?? '').trim() || '(empty)'],
      ['Unique value', String(profile.unique_value ?? '').trim() || '(empty)'],
      ['ICP / Target customer', String(profile.ideal_customer_profile ?? '').trim() || String(profile.target_customer_segment ?? '').trim() || '(empty)'],
      ['Marketing Intelligence', [
        profile.marketing_channels,
        profile.content_strategy,
        profile.campaign_focus,
        profile.key_messages,
        profile.brand_positioning,
        profile.competitive_advantages,
        profile.growth_priorities,
      ].filter(Boolean).join('. ') || '(empty)'],
      ['Campaign Purpose', profile.campaign_purpose_intent
        ? `Objective: ${profile.campaign_purpose_intent.primary_objective ?? ''}. Intent: ${profile.campaign_purpose_intent.campaign_intent ?? ''}. Problem domains: ${(profile.campaign_purpose_intent.dominant_problem_domains ?? []).join(', ') || 'none'}.`
        : '(empty)'],
    ];

    const profileContext = sections
      .map(([label, text]) => `[${label}]\n${text}`)
      .join('\n\n');

    const systemPrompt =
      'You are a company profile analyst. Infer and COMPLETE Problem & Transformation fields from the available profile sections.\n\n' +
      'Your job is to make the output MORE COMPLETE:\n' +
      '- Infer from profile; then EXPAND snippets into fuller, actionable statements (1–2 sentences).\n' +
      '- When you infer a concept (e.g. prioritization from campaign_focus), add 1–3 related pain_symptoms or authority_domains typical for that industry.\n' +
      '- Fill adjacent fields: if you infer core_problem, suggest life_with_problem and life_after_solution from it.\n' +
      '- Use ONLY concepts grounded in the profile; expand and complete using your expertise.\n\n' +
      'Rules:\n' +
      '- pain_symptoms and authority_domains: return string arrays. Add 2–4 items when profile supports it.\n' +
      '- Prefer completeness over leaving null; suggest plausible completions when unsure.\n' +
      '- Return valid JSON only. No markdown.\n\n' +
      `Output schema: ${OUTPUT_SCHEMA}`;

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Profile sections:\n\n${profileContext}\n\nInfer and COMPLETE problem-transformation fields. Expand snippets into fuller statements; add related pain_symptoms/authority_domains where profile supports it. Output JSON only.` },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    const str = (v: unknown): string | null =>
      v != null && String(v).trim() ? String(v).trim() : null;

    const structuredFields = {
      core_problem_statement: str(parsed.core_problem_statement),
      pain_symptoms: arr(parsed.pain_symptoms),
      awareness_gap: str(parsed.awareness_gap),
      problem_impact: str(parsed.problem_impact),
      life_with_problem: str(parsed.life_with_problem),
      life_after_solution: str(parsed.life_after_solution),
      desired_transformation: str(parsed.desired_transformation),
      transformation_mechanism: str(parsed.transformation_mechanism),
      authority_domains: arr(parsed.authority_domains),
    };

    return res.status(200).json({ structuredFields });
  } catch (err: unknown) {
    console.error('Infer problem transformation failed:', err);
    return res.status(500).json({
      error: 'Failed to infer problem transformation',
      details: err instanceof Error ? err.message : null,
    });
  }
}
