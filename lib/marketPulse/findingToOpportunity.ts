/**
 * Market Pulse — Finding → Opportunity adapter.
 *
 * Phase 2: bridges a `market_pulse_findings` row to the existing
 * opportunity → campaign-builder pipeline. Two adapters:
 *
 *   1. findingToCampaignBuilderInput(finding, run) — produces the shape
 *      consumed by `backend/services/opportunityCampaignBuilder.buildCampaignFromOpportunity`,
 *      so a finding can be promoted via the same pipeline as a TREND/LEAD opportunity.
 *
 *   2. findingToOpportunityItem(finding, run, executorContext) — produces the
 *      shape consumed by `backend/services/opportunityService.upsertOpportunities`,
 *      so a finding can be persisted as a first-class `opportunity_items` row
 *      (type='market_pulse'). This is what the action rail's "Promote to
 *      campaign" calls so the opportunity has a permanent home + audit trail.
 *
 * NEITHER adapter mutates the finding. Both inherit confidence/alignment/
 * priority/evidence from the finding so opportunities surface in the existing
 * opportunity ranking with the right tier.
 */

export type FindingForAdapter = {
  id: string;
  company_id: string;
  run_id: string;
  canonical_event_key: string | null;
  category: string;
  title: string;
  summary: string | null;
  regions: string[] | null;
  impact_type: 'opportunity' | 'risk' | 'watch';
  priority_tier: 'P0' | 'P1' | 'P2' | null;
  confidence_score: number | null;
  relevance_score: number | null;
  evidence_strength: number | null;
  company_alignment_score: number | null;
  freshness_score: number | null;
  recommended_action: string | null;
  why_it_matters: string | null;
  interpretation_text: string | null;
  strategic_implication: string | null;
  urgency_reason: string | null;
  operational_impact: string | null;
  opportunity_window: string | null;
  affected_business_areas: string[] | null;
  alert_class: string | null;
  cluster_role: string | null;
  correlated_findings: unknown;
};

export type RunForAdapter = {
  id: string;
  objective: string | null;
  market_direction: string | null;
};

/**
 * Composite "opportunity_score" derived from finding scores, on the same
 * 0..100 scale opportunities use elsewhere. Inherits priority via tier.
 *
 *   P0 → floor 80, scaled by composite
 *   P1 → 60..79
 *   P2 → 30..59
 */
export function deriveOpportunityScore(finding: FindingForAdapter): number {
  const conf = Math.max(0, Math.min(100, finding.confidence_score ?? 60));
  const rel = Math.max(0, Math.min(100, finding.relevance_score ?? 65));
  const align = Math.max(0, Math.min(1, finding.company_alignment_score ?? 0.5));
  const evidence = Math.max(0, Math.min(1, finding.evidence_strength ?? 0.5));
  const composite = conf * 0.30 + rel * 0.30 + align * 100 * 0.20 + evidence * 100 * 0.20;
  if (finding.priority_tier === 'P0') return Math.max(80, Math.min(100, composite));
  if (finding.priority_tier === 'P1') return Math.max(60, Math.min(79, composite));
  return Math.max(30, Math.min(59, composite));
}

/**
 * Map Market Pulse impact_type / alert_class / category onto a
 * campaign-builder `opportunity_type` so `deriveCampaignDirection` produces
 * a sensible default angle.
 */
export function deriveOpportunityType(finding: FindingForAdapter): string {
  if (finding.impact_type === 'opportunity') {
    if (finding.alert_class === 'market_acceleration' || finding.alert_class === 'opportunity_breakout') {
      return 'market_opportunity';
    }
    if (finding.category === 'partnerships_alliances') return 'audience_opportunity';
    if (finding.category === 'demand_category_momentum') return 'campaign_opportunity';
    return 'content_opportunity';
  }
  if (finding.impact_type === 'risk') return 'engagement_opportunity';
  return 'content_opportunity';
}

/**
 * Build the campaign-builder description by stacking interpretation + strategic
 * implication + recommended action. Falls back to summary when the Phase 1B
 * interpretation columns are NULL (legacy rows).
 */
export function buildOpportunityDescription(finding: FindingForAdapter): string {
  const lines: string[] = [];
  if (finding.interpretation_text) lines.push(finding.interpretation_text);
  else if (finding.summary) lines.push(finding.summary);
  if (finding.strategic_implication) lines.push(`Strategic implication: ${finding.strategic_implication}`);
  if (finding.urgency_reason) lines.push(`Urgency: ${finding.urgency_reason}`);
  if (finding.opportunity_window) lines.push(`Window: ${finding.opportunity_window}`);
  if (finding.operational_impact) lines.push(`Owner: ${finding.operational_impact}`);
  if (finding.recommended_action) lines.push(`Recommended action: ${finding.recommended_action}`);
  return lines.filter(Boolean).join('\n\n');
}

/**
 * Adapter for `buildCampaignFromOpportunity` (opportunityCampaignBuilder).
 * Returns the exact OpportunityInput shape that endpoint expects.
 */
export type CampaignBuilderInput = {
  title: string;
  description: string;
  opportunity_type: string;
  confidence: number;
  opportunity_score: number;
  supporting_signals: string[];
  recommended_action: string;
};

export function findingToCampaignBuilderInput(
  finding: FindingForAdapter,
  _run: RunForAdapter,
): CampaignBuilderInput {
  const opportunity_score = deriveOpportunityScore(finding);
  const opportunity_type = deriveOpportunityType(finding);

  // supporting_signals are the human-readable context the campaign builder
  // surfaces in the Idea Spine. We pull from the strongest enrichment fields.
  const supportingSignals: string[] = [];
  if (finding.cluster_role) supportingSignals.push(`Cluster role: ${finding.cluster_role}`);
  if (finding.alert_class) supportingSignals.push(`Alert class: ${finding.alert_class}`);
  if (Array.isArray(finding.affected_business_areas) && finding.affected_business_areas.length > 0) {
    supportingSignals.push(`Affects: ${finding.affected_business_areas.join(', ')}`);
  }
  if (Array.isArray(finding.regions) && finding.regions.length > 0) {
    supportingSignals.push(`Regions: ${finding.regions.join(', ')}`);
  }
  if (finding.priority_tier) supportingSignals.push(`Priority: ${finding.priority_tier}`);

  return {
    title: finding.title,
    description: buildOpportunityDescription(finding),
    opportunity_type,
    confidence: Math.max(0, Math.min(100, finding.confidence_score ?? 60)),
    opportunity_score,
    supporting_signals: supportingSignals,
    recommended_action: finding.recommended_action ?? finding.strategic_implication ?? '',
  };
}

/**
 * Adapter for `opportunityService.upsertOpportunities`.
 * Produces an OpportunityInput row that persists in `opportunity_items`
 * with `type='market_pulse'`. The `source_refs` block carries the
 * originating finding/run reference for full audit lineage.
 */
export type OpportunityItemInput = {
  title: string;
  summary: string | null;
  problem_domain: string | null;
  region_tags: string[] | null;
  source_refs: Record<string, unknown>;
  conversion_score: number;
  payload: Record<string, unknown>;
};

export function findingToOpportunityItem(
  finding: FindingForAdapter,
  run: RunForAdapter,
): OpportunityItemInput {
  const opportunity_score = deriveOpportunityScore(finding);

  return {
    title: finding.title,
    summary: finding.interpretation_text ?? finding.summary ?? null,
    problem_domain: finding.category,
    region_tags: Array.isArray(finding.regions) && finding.regions.length > 0 ? finding.regions : null,
    source_refs: {
      // Source linkage — required by audit + reverse-lookup
      // ("which opportunities came from this Market Pulse run?").
      origin: 'market_pulse',
      finding_id: finding.id,
      run_id: finding.run_id,
      canonical_event_key: finding.canonical_event_key,
      category: finding.category,
      impact_type: finding.impact_type,
      priority_tier: finding.priority_tier,
      alert_class: finding.alert_class,
      cluster_role: finding.cluster_role,
      objective: run.objective,
      market_direction: run.market_direction,
    },
    conversion_score: opportunity_score,
    payload: {
      // Inherit the trust + alignment signals so downstream consumers
      // (recommendation ranker, campaign builder) don't have to re-derive.
      confidence_score: finding.confidence_score,
      relevance_score: finding.relevance_score,
      evidence_strength: finding.evidence_strength,
      company_alignment_score: finding.company_alignment_score,
      freshness_score: finding.freshness_score,
      // Pre-rendered campaign-builder payload for fast handoff.
      campaign_builder_input: findingToCampaignBuilderInput(finding, run),
      interpretation: {
        text: finding.interpretation_text,
        strategic_implication: finding.strategic_implication,
        urgency_reason: finding.urgency_reason,
        operational_impact: finding.operational_impact,
        opportunity_window: finding.opportunity_window,
        affected_business_areas: finding.affected_business_areas,
      },
    },
  };
}
