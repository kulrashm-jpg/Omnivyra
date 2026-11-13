import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Shared API: Generate 7 AI daily plans via execution engine.
 * Single endpoint for Source B (AI expansion). Used by:
 * - campaign-daily-plan (Generate from AI button)
 * - campaign-details (fallback when generate-weekly-structure fails)
 * - ComprehensivePlanningInterface (Generate All Days)
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { generateFromAI, WEEK_EXECUTION_LOCKED } from '../../../backend/services/executionPlannerService';
import { runEntryConsumptionForHttp, entryConsumptionHttpError } from '../../../backend/services/billing/entryConsumptionHttp';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber } = req.body as { campaignId?: string; weekNumber?: number };

    if (!campaignId || !Number.isFinite(weekNumber) || weekNumber < 1) {
      return res.status(400).json({
        error: 'campaignId and weekNumber (>= 1) are required',
      });
    }

    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    // C75 (BLOCKING money; owner ruling via e9): ONE billed entry, action content_basic (featureRegistry maps
    // generateDailyPlan there), token-actual via executeWithEntryConsumption: hold the prescribed price, settle the
    // SUM of every provider call inside (daily-plan generation + the slot scheduler, which is NOT charged on its own),
    // release the remainder / on failure. Billed + attributed to the AUTHORITATIVE owner (access.companyId).
    // Doubly dark: off unless PHASE2_ENTRY_CONSUMPTION + this org's gate for the surface -> the legacy path below.
    const generate = () => generateFromAI(campaignId, weekNumber as number, { companyId: access.companyId });
    const billing = await runEntryConsumptionForHttp({
      surface:       'route.campaigns-generate-ai-daily-plans',
      actorUserId:   String(access.userId),
      orgId:         access.companyId,
      action:        'content_basic',
      referenceType: 'campaign_ai_daily_plans',
      referenceId:   `ai-daily-plans:${campaignId}:${weekNumber}`,
      requestBody:   { campaignId, weekNumber },
      requestHeaderIdempotency: typeof req.headers['idempotency-key'] === 'string' ? (req.headers['idempotency-key'] as string) : undefined,
      llmPricing:    { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 12000, maxOutputTokens: 6000 },
      note:          `ai daily plans ${campaignId} w${weekNumber}`,
      executor:      generate,
    });
    let rowsInserted: number;
    if (billing.kind === 'legacy') {
      ({ rowsInserted } = await generate());
    } else {
      const refusal = entryConsumptionHttpError(billing.result);
      if (refusal) return res.status(refusal.status).json(refusal.body);
      ({ rowsInserted } = (billing.result as { status: 'executed'; result: { rowsInserted: number } }).result);
    }

    return res.status(200).json({
      success: true,
      message: `Generated and saved ${rowsInserted} daily plan(s) for week ${weekNumber}`,
      rowsInserted,
    });
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err?.code === WEEK_EXECUTION_LOCKED) {
      return res.status(423).json({ error: WEEK_EXECUTION_LOCKED, message: err?.message ?? 'Week is executing; regeneration blocked.' });
    }
    console.error('Error in generate-ai-daily-plans API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/generate-ai-daily-plans' });
