
/**
 * Campaign Health API
 * POST: Evaluates campaign_design and execution_plan with context awareness.
 * Input: { campaign_design, execution_plan, company_context_mode?, focus_modules?, companyId? }
 * Output: CampaignHealthReport (narrative_score, content_mix_score, cadence_score, audience_alignment_score, suggestions)
 * When company_context_mode=full_company_context and companyId provided, fetches company profile for alignment checks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  evaluateCampaignHealth,
  type CampaignDesignInput,
  type ExecutionPlanInput,
  type CompanyContextModeInput,
} from '../../../backend/services/campaignIntelligenceService';
import { getProfile } from '../../../backend/services/companyProfileService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const campaign_design = body.campaign_design as (CampaignDesignInput & { company_context_mode?: string; focus_modules?: string[] }) | null | undefined;
    const execution_plan = body.execution_plan as ExecutionPlanInput | null | undefined;
    const company_context_mode = (body.company_context_mode ?? campaign_design?.company_context_mode) as string | null | undefined;
    const focus_modules = (body.focus_modules ?? campaign_design?.focus_modules) as string[] | null | undefined;
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : null;

    let company_profile: Record<string, unknown> | null = null;
    if (
      company_context_mode === 'full_company_context' &&
      companyId
    ) {
      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
      if (profile) company_profile = profile as unknown as Record<string, unknown>;
    }

    const validMode: CompanyContextModeInput | undefined =
      company_context_mode === 'full_company_context' ||
      company_context_mode === 'focused_context' ||
      company_context_mode === 'no_company_context'
        ? company_context_mode
        : undefined;

    const report = evaluateCampaignHealth({
      campaign_design: campaign_design ?? null,
      execution_plan: execution_plan ?? null,
      strategy_context: (body.strategy_context ?? execution_plan?.strategy_context) ?? undefined,
      company_context_mode: validMode,
      focus_modules: focus_modules ?? undefined,
      company_profile,
    });
    return res.status(200).json(report);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to evaluate campaign health';
    return res.status(500).json({ error: msg });
  }
}
