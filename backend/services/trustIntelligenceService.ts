import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
// BETA-ENGINE-003: evidence-derived confidence from the canonical Confidence Engine.
import { deriveDecisionConfidence, decisionConfidenceExplainability } from './evidencePlatform';
// BETA-ENGINE-005: trust/credibility genuinely consumes authenticated external evidence — measured
// reputation (reviews) replaces the INFERRED community-sentiment basis, and AI-retrieval presence
// (llm_visibility) corroborates credibility. Reused, availability-gated, no scoring redesign.
import { isReputationProviderAvailable, reputationProviderReliability } from './reputationProviderBridge';
import { isAIVisibilityProviderAvailable, aiVisibilityProviderReliability } from './aiVisibilityProviderBridge';
import { combinedProviderReliability } from './ga4ProviderBridge';
// BETA-ENGINE-006: evidence-aware confidence — consume the reputation/AI providers' ACTUAL measured
// Evidence (review count, source coverage, citation rate) when supplied, not just provider availability.
import { hasMeasuredEvidence, evidenceValue, summarizeEvidence, type Evidence } from './evidencePlatform';
// BETA-ENGINE-009: cross-evidence correlations (reviews+brand, entity+AI) fold a bounded, measured coverage
// adjustment into trust confidence — deterministic, no scoring redesign.
import { summarizeCorrelations, correlationCoverageDelta, type CorrelatedEvidence } from './evidencePlatform';
// BETA-ENGINE-010: root-cause diagnoses (AI Optimization Gap, Thin Trust Base, …) make trust
// recommendations diagnosis-driven. Attached for traceability; confidence flows through the correlations.
import { summarizeRootCauses, type RootCause } from './evidencePlatform';
// BETA-ENGINE-011: root causes become deterministic, prioritized, executable plans attached to the decision.
import { summarizeRecommendations, type ExecutionPlan } from './evidencePlatform';
// BETA-ENGINE-012: business-prioritized initiatives (impact + opportunity + honest ROI) attached to the decision.
import { summarizeBusinessImpact, type BusinessImpact } from './evidencePlatform';
// BETA-ENGINE-013: compose the full reasoning chain into one auditable Explanation (evidence → … → decision).
import { buildExplanation, summarizeExplanation } from './evidencePlatform';

type CommunityRow = {
  sentiment: string | null;
  tone: string | null;
  content: string | null;
  suggested_text: string | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeSentiment(row: CommunityRow): 'positive' | 'negative' | 'neutral' {
  const sentiment = `${row.sentiment ?? ''} ${row.tone ?? ''}`.toLowerCase();
  if (/(negative|angry|frustrated|complaint|critical)/.test(sentiment)) return 'negative';
  if (/(positive|happy|support|love|excellent)/.test(sentiment)) return 'positive';
  return 'neutral';
}

function hasCredibilitySignal(text: string): boolean {
  return /(proof|case study|testimonial|verified|trusted|credible|authority|review)/.test(text);
}

/** BETA-ENGINE-006: an orchestrator may supply the reputation / AI-visibility providers' already-fetched
 *  canonical Evidence (no duplicate fetch) so trust confidence is driven by ACTUAL measurements. Optional. */
export interface TrustEvidenceContext {
  reputationEvidence?: Evidence[] | null;
  aiVisibilityEvidence?: Evidence[] | null;
  /** BETA-ENGINE-009: correlations the trust engine consumes (reviews+brand, entity+AI). */
  correlations?: CorrelatedEvidence[] | null;
  /** BETA-ENGINE-010: root-cause diagnoses (AI Optimization Gap, Thin Trust Base, …) the recommendation targets. */
  rootCauses?: RootCause[] | null;
  /** BETA-ENGINE-011: executable, prioritized plans generated from the root causes. */
  recommendations?: ExecutionPlan[] | null;
  /** BETA-ENGINE-012: business-prioritized initiatives (impact + opportunity + honest ROI). */
  businessImpact?: BusinessImpact[] | null;
}

export async function generateTrustIntelligenceDecisions(
  companyId: string,
  context: TrustEvidenceContext = {},
): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('trustIntelligenceService');

  const { data, error } = await supabase
    .from('community_ai_actions')
    .select('sentiment, tone, content, suggested_text')
    .eq('company_id', companyId)
    .gte('created_at', sinceDays(30))
    .limit(1000);

  if (error) throw new Error(`Failed to load community actions for trust engine: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'trustIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as CommunityRow[];
  if (rows.length === 0) return [];

  let negative = 0;
  let positive = 0;
  let credibilitySignals = 0;

  for (const row of rows) {
    const sentiment = normalizeSentiment(row);
    if (sentiment === 'negative') negative += 1;
    else if (sentiment === 'positive') positive += 1;

    const text = `${row.content ?? ''} ${row.suggested_text ?? ''}`.toLowerCase();
    if (hasCredibilitySignal(text)) credibilitySignals += 1;
  }

  const total = rows.length;
  const negativeRate = negative / Math.max(1, total);
  const positiveRate = positive / Math.max(1, total);
  const credibilityRate = credibilitySignals / Math.max(1, total);

  // BETA-ENGINE-003: evidence-derived confidence (was 0.84/0.79/0.76). Community sentiment is INFERRED.
  // BETA-ENGINE-005: when a real reputation provider is connected, trust becomes MEASURED (reputation
  // genuinely measures trust); AI-visibility (can AI systems discover/trust/recommend the brand) adds a
  // corroborating credibility reliability factor. Confidence improves solely because measured evidence
  // improves — no manual boost, no scoring redesign. With no provider this is INFERRED, exactly as before.
  const reputationLive = isReputationProviderAvailable();
  const aiVisibilityLive = isAIVisibilityProviderAvailable();

  // BETA-ENGINE-006: when the reputation provider's ACTUAL measured Evidence is supplied, trust confidence
  // is driven by the real review corpus — a high review count / broad platform coverage raises confidence,
  // a thin one lowers it — not merely by "the provider is connected". AI-visibility citation evidence
  // corroborates credibility reliability. Deterministic; falls back to BETA-ENGINE-005 availability
  // behaviour when no measured Evidence is present (backward compatible).
  // BETA-ENGINE-009: fold correlated cross-evidence (bounded, measured) into the coverage factor.
  const correlationSummary = context.correlations ? summarizeCorrelations(context.correlations) : null;
  const correlationDelta = correlationSummary ? correlationCoverageDelta(correlationSummary) : 0;
  const correlationReasonCodes = correlationSummary?.reasonCodes ?? [];

  const reputationMeasured = hasMeasuredEvidence(context.reputationEvidence);
  const aiMeasured = hasMeasuredEvidence(context.aiVisibilityEvidence);
  let trustConfidence;
  let measuredEvidenceKeys: string[] = [];
  if (reputationMeasured) {
    const repSummary = summarizeEvidence(context.reputationEvidence);
    const aiSummary = summarizeEvidence(context.aiVisibilityEvidence);
    measuredEvidenceKeys = [...repSummary.measuredKeys, ...(aiMeasured ? aiSummary.measuredKeys : [])];
    const reviewCount = evidenceValue(context.reputationEvidence, 'review_count') ?? 0;
    const sourceCount = evidenceValue(context.reputationEvidence, 'review_source_count') ?? 0;
    const baseCoverage = Math.max(0, Math.min(1, sourceCount / 4)); // platform coverage across review sources
    trustConfidence = deriveDecisionConfidence({
      maturity: 'MEASURED',
      sampleSize: reviewCount, // real review corpus size drives confidence (low reviews → lower confidence)
      coverage: Math.max(0, Math.min(1, baseCoverage + correlationDelta)), // adjusted by measured correlations
      providerReliability: combinedProviderReliability(
        repSummary.meanReliability ?? reputationProviderReliability(),
        aiMeasured ? (aiSummary.meanReliability ?? aiVisibilityProviderReliability()) : null,
      ),
      dataPresent: reviewCount > 0,
    });
  } else {
    // BETA-ENGINE-005 fallback: provider-availability behaviour (unchanged, backward compatible).
    trustConfidence = deriveDecisionConfidence({
      maturity: reputationLive ? 'MEASURED' : 'INFERRED',
      providerReliability: combinedProviderReliability(
        reputationLive ? reputationProviderReliability() : null,
        aiVisibilityLive ? aiVisibilityProviderReliability() : null,
      ),
      sampleSize: total,
      dataPresent: total > 0,
    });
  }
  // BETA-ENGINE-010: attach the diagnosed root causes so the recommendation is diagnosis-driven + traceable.
  const rootCauseSummary = context.rootCauses ? summarizeRootCauses(context.rootCauses) : null;
  const recommendationSummary = context.recommendations ? summarizeRecommendations(context.recommendations) : null;
  const businessSummary = context.businessImpact ? summarizeBusinessImpact(context.businessImpact) : null;
  // BETA-ENGINE-013: one auditable Explanation composing the whole chain for this engine's conclusions.
  const trustExplanation = summarizeExplanation(buildExplanation({
    decisionId: `trust:${companyId}`,
    evidence: [...(context.reputationEvidence ?? []), ...(context.aiVisibilityEvidence ?? [])],
    correlations: context.correlations,
    rootCauses: context.rootCauses,
    recommendations: context.recommendations,
    businessImpact: context.businessImpact,
    confidence: trustConfidence,
  }));
  const trustConfExplain = {
    ...decisionConfidenceExplainability(trustConfidence),
    measured_evidence: measuredEvidenceKeys,
    correlations: correlationReasonCodes,
    root_causes: rootCauseSummary?.diagnoses ?? [],
    execution_plans: recommendationSummary?.plans ?? [],
    business_initiatives: businessSummary?.initiatives ?? [],
    decision_explanation: trustExplanation,
  };

  const decisions = [];

  if (negativeRate >= 0.25) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'sentiment_risk',
      title: 'Negative sentiment trend is above safe operating threshold',
      description: 'Community feedback sentiment has shifted toward a risky negative ratio.',
      evidence: {
        sample_size: total,
        negative_rate: negativeRate,
        positive_rate: positiveRate,
        confidence: trustConfExplain,
      },
      impact_traffic: 28,
      impact_conversion: 56,
      impact_revenue: 54,
      priority_score: 67,
      effort_score: 20,
      confidence_score: trustConfidence.confidenceScore,
      recommendation: 'Launch trust-repair communication and high-priority response workflows for negative threads.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'sentiment_recovery' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (positiveRate < 0.2) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'brand_trust_gap',
      title: 'Brand trust reinforcement is insufficient',
      description: 'Positive advocacy is too weak to offset negative or neutral trust narratives.',
      evidence: {
        sample_size: total,
        positive_rate: positiveRate,
        confidence: trustConfExplain,
      },
      impact_traffic: 24,
      impact_conversion: 52,
      impact_revenue: 50,
      priority_score: 63,
      effort_score: 26,
      confidence_score: trustConfidence.confidenceScore,
      recommendation: 'Increase proof-based trust content and customer success amplification.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'brand_trust' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (credibilityRate < 0.15) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'trustIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'credibility_gap',
      title: 'Credibility cues are underrepresented in active conversations',
      description: 'Low proof/credibility signal density suggests weak trust conversion support.',
      evidence: {
        sample_size: total,
        credibility_signal_rate: credibilityRate,
        confidence: trustConfExplain,
      },
      impact_traffic: 18,
      impact_conversion: 48,
      impact_revenue: 52,
      priority_score: 61,
      effort_score: 18,
      confidence_score: trustConfidence.confidenceScore,
      recommendation: 'Publish verifiable trust artifacts and incorporate credibility cues in frontline content.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'credibility_proof' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
