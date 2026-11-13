import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { resolveCompanyGroundingGuard } from '../../../../backend/services/context/canonicalContentContextResolver';

/**
 * POST /api/campaigns/planner/suggest-update
 * Accepts campaignId and insight_id, returns AI-generated planning suggestion.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { campaignId, insight_id } = req.body as { campaignId?: string; insight_id?: string };
  // BLOCKING fast-track (two-id sweep, 2026-11-13): companyId is REQUIRED. It used to fall back to campaignId (a
  // campaign id used as a company id), which only failed closed by accident. No client calls this route today.
  const companyId = typeof req.body?.companyId === 'string' ? (req.body.companyId as string) : '';
  if (!campaignId || !insight_id || !companyId) {
    return res.status(400).json({ error: 'campaignId, insight_id and companyId are required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    // BLOCKING (tenancy + money): the insight was read by id ALONE, so a caller authorized for company A could feed
    // company B's engagement_opportunities text into the LLM prompt (A charged). It is now bound to the company
    // enforceCompanyAccess just authorized (engagement_opportunities is tenant-scoped by organization_id); another
    // company's insight reads exactly like an unknown one (uniform 404) and never reaches the prompt.
    // (On the S2 branch the same read goes through tenantTable; this is the main-native equivalent.)
    const { data: insight, error: oppError } = await supabase
      .from('engagement_opportunities')
      .select('id, opportunity_type, opportunity_text, platform, confidence_score, detected_at')
      .eq('id', insight_id)
      .eq('organization_id', companyId)
      .maybeSingle();

    if (oppError || !insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    // Company grounding is read only AFTER the caller is authorized for that company (it used to run first).
    const grounding = await resolveCompanyGroundingGuard(companyId);

    const insightText = (insight as { opportunity_text?: string }).opportunity_text || 'Engagement insight';
    const insightType = (insight as { opportunity_type?: string }).opportunity_type || 'general';
    const platform = (insight as { platform?: string }).platform || '';

    const systemPrompt =
      'You are a campaign planning advisor. Given an engagement insight from community/conversation signals, suggest a concrete campaign planning update. Output a single, actionable suggestion in plain text (e.g. "Week 4 campaign should address pricing questions."). Be specific and brief.';
    const userPrompt = `Campaign ID: ${campaignId}. Engagement insight (${insightType}${platform ? `, ${platform}` : ''}): "${insightText}". Provide one planning suggestion.`;

    const { output } = await wirePhase2Route({
      surface:        'campaigns.planner.suggest-update',
      organizationId: companyId,
      action:         'campaign_suggest_update',
      referenceType:  'campaign_suggest_update',
      referenceId:    createHash('sha256')
        .update([companyId, String(campaignId), String(insight_id)].join('|'))
        .digest('hex').slice(0, 40),
      run: () => runCompletionWithOperation({
      companyId,
      campaignId,
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + grounding.directive },
        { role: 'user', content: userPrompt },
      ],
      operation: 'plannerSuggestUpdate',
      }),
    });

    const suggestion = (typeof output === 'string' ? output : '').trim() || 'No suggestion generated.';

    return res.status(200).json({ suggestion, insight_id, campaignId });
  } catch (err: unknown) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    console.error('[planner/suggest-update]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to generate planning suggestion',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/planner/suggest-update' });
