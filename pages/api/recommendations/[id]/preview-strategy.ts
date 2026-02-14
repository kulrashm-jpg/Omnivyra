import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';
import { getProfile } from '../../../../backend/services/companyProfileService';
import { previewStrategy } from '../../../../backend/services/aiGateway';

const allowedRoles = new Set([Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const previewContext = req.body?.preview_context ?? null;
  const previewCompanyId = req.body?.company_id ?? null;
  const { data: recommendation, error: recError } = await supabase
    .from('recommendation_snapshots')
    .select('*')
    .eq('id', id)
    .single();

  if ((recError || !recommendation) && !previewContext) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const companyId = recommendation?.company_id
    ? String(recommendation.company_id)
    : previewCompanyId
    ? String(previewCompanyId)
    : null;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id is required for preview context' });
  }
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || !(allowedRoles as Set<string>).has(role)) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const profile = await getProfile(companyId, { autoRefine: false });
  const previewOverrides = req.body?.preview_overrides ?? null;
  const context = {
    trend_topic: recommendation?.trend_topic ?? previewContext?.topic ?? null,
    narrative: previewContext?.narrative ?? null,
    objective: previewContext?.objective ?? null,
    platform_preferences: previewContext?.platform_preferences ?? null,
    audience: recommendation?.audience ?? null,
    platforms: recommendation?.platforms ?? previewContext?.platform_preferences ?? null,
    confidence: recommendation?.confidence ?? null,
    final_score: recommendation?.final_score ?? null,
    snapshot_hash: recommendation?.snapshot_hash ?? null,
    company_profile: profile ?? null,
    preview_overrides: previewOverrides ?? null,
  };

  const message =
    'Generate a PREVIEW ONLY strategy. Do NOT generate a full weekly calendar.\n' +
    'Return JSON only. Do not wrap in Markdown.\n' +
    'JSON fields required:\n' +
    '- platform_mix: array of platforms\n' +
    '- content_mix: array of content types\n' +
    '- frequency_plan: object keyed by platform or content type with weekly frequency\n' +
    '- reuse_plan: array of reuse/repurpose ideas\n' +
    '- narrative_direction: short narrative direction text\n' +
    '- directional_themes: array of 12-week theme ideas\n' +
    '- confidence: number between 0 and 1\n' +
    '- content_frequency: object keyed by platform or content type\n' +
    'If preview_overrides are provided, use them as primary guidance.\n' +
    `Input Context:\n${JSON.stringify(context, null, 2)}`;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  let parsed: any = {};
  try {
    const completion = await previewStrategy({
      companyId,
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You generate preview-only strategy JSON for campaign planning.',
        },
        { role: 'user', content: message },
      ],
    });
    parsed = completion.output || {};
  } catch {
    return res.status(500).json({ error: 'Failed to parse preview response' });
  }

  const preview = {
    platform_mix: Array.isArray(parsed.platform_mix)
      ? parsed.platform_mix
      : recommendation?.platforms ?? previewContext?.platform_preferences ?? [],
    content_mix: Array.isArray(parsed.content_mix) ? parsed.content_mix : [],
    frequency_plan:
      parsed.frequency_plan && typeof parsed.frequency_plan === 'object'
        ? parsed.frequency_plan
        : {},
    reuse_plan: Array.isArray(parsed.reuse_plan) ? parsed.reuse_plan : [],
    narrative_direction: typeof parsed.narrative_direction === 'string' ? parsed.narrative_direction : '',
    directional_themes: Array.isArray(parsed.directional_themes) ? parsed.directional_themes : [],
    content_frequency:
      parsed.content_frequency && typeof parsed.content_frequency === 'object'
        ? parsed.content_frequency
        : parsed.frequency_plan && typeof parsed.frequency_plan === 'object'
        ? parsed.frequency_plan
        : {},
  };
  const confidence =
    typeof parsed.confidence === 'number'
      ? parsed.confidence
      : typeof recommendation?.confidence === 'number'
      ? recommendation.confidence
      : null;
  const contentFrequency =
    parsed.content_frequency && typeof parsed.content_frequency === 'object'
      ? parsed.content_frequency
      : preview.frequency_plan;

  if (recommendation?.id) {
    try {
      await supabase.from('audit_logs').insert({
        action: 'RECOMMENDATION_PREVIEW_GENERATED',
        actor_user_id: user.id,
        company_id: companyId,
        metadata: {
          recommendation_id: recommendation.id,
          snapshot_hash: recommendation.snapshot_hash ?? null,
        },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }
  }

  return res.status(200).json({
    preview,
    confidence,
    platform_mix: preview.platform_mix,
    content_frequency: contentFrequency,
    recommendation_id: recommendation?.id ?? null,
    snapshot_hash: recommendation?.snapshot_hash ?? null,
  });
}
