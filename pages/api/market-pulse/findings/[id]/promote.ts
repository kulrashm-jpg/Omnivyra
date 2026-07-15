import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/market-pulse/findings/[id]/promote
 *
 * Phase 2: Convert a Market Pulse finding into a real opportunity row +
 * pre-built campaign-builder payload, ready for the planner. Three steps:
 *
 *   1. Load + verify ownership of the finding.
 *   2. Persist as `opportunity_items` row (type='market_pulse') via the
 *      existing `opportunityService.upsertOpportunities` so it appears in
 *      the standard opportunity ranking.
 *   3. Build the campaign payload via `opportunityCampaignBuilder` and
 *      return it. The client navigates to the planner with the payload
 *      stashed in sessionStorage (handoff pattern matches V1's
 *      pulse_topic_bridge but uses sessionStorage, scoped to the tab).
 *
 * Side effects:
 *   - market_pulse_findings.user_action_state → 'promoted'
 *   - market_pulse_findings.generated_opportunity_id ← upserted opportunity id
 *   - market_pulse_findings.generated_campaign_payload ← prebuilt payload
 *   - market_pulse_finding_actions audit row (action_type='promote')
 *   - learningFeedbackService.recordActionAsFeedback (intelligence_recommendations
 *     outcome='accepted' + recommendation_feedback row if user_id known)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { ownedDbTable } from '../../../../../backend/db/writeOwner';
import { upsertOpportunities } from '../../../../../backend/services/opportunityService';
import { buildCampaignFromOpportunity } from '../../../../../backend/services/opportunityCampaignBuilder';
import {
  findingToCampaignBuilderInput,
  findingToOpportunityItem,
  type FindingForAdapter,
  type RunForAdapter,
} from '../../../../../lib/marketPulse/findingToOpportunity';
import { recordActionAsFeedback } from '../../../../../backend/services/marketPulse/learningFeedbackService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const findingId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!findingId) return res.status(400).json({ error: 'finding id is required' });

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  // ── 1. Load + verify ownership ──────────────────────────────────────────────
  const { data: findingRow, error: lookupError } = await ownedDbTable('market_pulse_findings')
    .select(
      'id, company_id, run_id, canonical_event_key, category, title, summary, regions, ' +
      'impact_type, priority_tier, confidence_score, relevance_score, evidence_strength, ' +
      'company_alignment_score, freshness_score, recommended_action, why_it_matters, ' +
      'interpretation_text, strategic_implication, urgency_reason, operational_impact, ' +
      'opportunity_window, affected_business_areas, alert_class, cluster_role, correlated_findings'
    )
    .eq('id', findingId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (lookupError || !findingRow) return res.status(404).json({ error: 'finding not found' });

  const finding = findingRow as unknown as FindingForAdapter;

  const { data: runRow } = await ownedDbTable('market_pulse_runs')
    .select('id, objective, market_direction')
    .eq('id', finding.run_id)
    .maybeSingle();
  const run: RunForAdapter = (runRow as unknown as RunForAdapter) ?? {
    id: finding.run_id,
    objective: null,
    market_direction: null,
  };

  // ── 2. Persist opportunity row (so it surfaces in opportunity rankings) ─────
  const opportunityInput = findingToOpportunityItem(finding, run);
  let opportunityId: string | null = null;
  try {
    await upsertOpportunities(companyId, 'market_pulse', [opportunityInput]);
    // Read back the upserted row's id so we can stamp it on the finding.
    const { data: opp } = await ownedDbTable('opportunity_items')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', 'market_pulse')
      .eq('title', opportunityInput.title)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    opportunityId = (opp as { id?: string } | null)?.id ?? null;
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to upsert opportunity',
    });
  }

  // ── 3. Build campaign payload (same shape /api/opportunity/build-campaign returns) ─
  const campaignBuilderInput = findingToCampaignBuilderInput(finding, run);
  const campaignPayload = buildCampaignFromOpportunity(campaignBuilderInput);

  // ── 4. Stamp finding state + linkage + audit row ───────────────────────────
  await ownedDbTable('market_pulse_findings')
    .update({
      user_action_state: 'promoted',
      generated_opportunity_id: opportunityId,
      generated_campaign_payload: campaignPayload,
    })
    .eq('id', findingId)
    .eq('company_id', companyId);

  try {
    await ownedDbTable('market_pulse_finding_actions').insert({
      finding_id: findingId,
      company_id: companyId,
      run_id: finding.run_id,
      action_type: 'promote',
      payload: { opportunity_id: opportunityId, opportunity_type: opportunityInput.source_refs },
      performed_by: typeof body.performed_by === 'string' ? body.performed_by : null,
    });
  } catch {
    /* non-blocking */
  }

  // ── 5. Learning loop: action → recommendation outcome + feedback ────────────
  recordActionAsFeedback({
    finding_id: findingId,
    company_id: companyId,
    action: 'promote',
    user_id: typeof body.user_id === 'string' ? body.user_id : null,
  }).catch(() => {/* non-blocking */});

  return res.status(200).json({
    ok: true,
    opportunity_id: opportunityId,
    campaign_payload: campaignPayload,
    finding_id: findingId,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/findings/:id/promote' });
