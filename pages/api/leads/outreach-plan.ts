import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getProfile } from '../../../backend/services/companyProfileService';
import { runDiagnosticPrompt } from '../../../backend/services/llm/openaiAdapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const leadId = (req.body?.leadId ?? req.body?.lead_signal_id) as string;
  if (!leadId) {
    return res.status(400).json({ error: 'leadId is required' });
  }

  const { data: signal, error: signalError } = await supabase
    .from('lead_signals_v1')
    .select('id, company_id, platform, snippet, raw_text, source_url, author_handle')
    .eq('id', leadId)
    .single();

  if (signalError || !signal) {
    return res.status(404).json({ error: 'Lead signal not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: signal.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const profile = await getProfile(signal.company_id);
  const profileSummary = profile
    ? [profile.ideal_customer_profile, profile.target_audience, profile.brand_voice].filter(Boolean).join(' | ').slice(0, 400)
    : '';

  const systemPrompt = `You are an outreach strategy assistant. Given a qualified lead (social post snippet) and company context, output valid JSON only in this exact shape:
{
  "opening_line": string,
  "engagement_strategy": string,
  "call_to_action": string,
  "follow_up_sequence": string (short steps),
  "risk_notes": string (optional cautions)
}`;

  const userPrompt = JSON.stringify(
    {
      lead_snippet: signal.snippet,
      platform: signal.platform,
      company_context: profileSummary,
    },
    null,
    2
  );

  let plan: {
    opening_line?: string;
    engagement_strategy?: string;
    call_to_action?: string;
    follow_up_sequence?: string;
    risk_notes?: string;
  };

  try {
    const { data } = await runDiagnosticPrompt<typeof plan>(systemPrompt, userPrompt);
    plan = data ?? {};
  } catch {
    plan = {
      opening_line: 'Reach out referencing their post.',
      engagement_strategy: 'Provide value first, then soft CTA.',
      call_to_action: 'Suggest a brief call or demo.',
      follow_up_sequence: 'Day 1: message; Day 3: follow-up; Day 7: final touch.',
      risk_notes: '',
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('lead_outreach_plans')
    .insert({
      lead_signal_id: leadId,
      opening_line: plan.opening_line ?? null,
      engagement_strategy: plan.engagement_strategy ?? null,
      call_to_action: plan.call_to_action ?? null,
      follow_up_sequence: plan.follow_up_sequence ?? null,
      risk_notes: plan.risk_notes ?? null,
    })
    .select('id, opening_line, engagement_strategy, call_to_action, follow_up_sequence, risk_notes, created_at')
    .single();

  if (insertError) {
    return res.status(500).json({ error: 'Failed to save outreach plan' });
  }

  return res.status(201).json(inserted);
}
