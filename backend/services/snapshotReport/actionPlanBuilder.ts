import type { PersistedDecisionObject } from '../decisionObjectService';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import { impactScore } from '../reportDecisionUtils';
import {
  buildExpectedUpside,
  classifyPriorityType,
} from '../actionPriorityService';
import type {
  CompanyNarrativeContext,
  SnapshotAction,
  StrategicContext,
} from './types';
import {
  inferEffortLevel,
} from './actionHelpers';
import {
  buildStructuredTactics,
  guessFocusPage,
  scrubActionCompanyReferences,
  structuredReasoning,
} from './actionTacticHelpers';
import {
  splitCandidates,
  firstNonEmpty,
  recommendationTimeline,
  confidencePercent,
} from './narrativeHelpers';

function impactBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function executivePriorityBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 72) return 'high';
  if (score >= 48) return 'medium';
  return 'low';
}

export function buildActionPlan(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
  strategicContext?: StrategicContext,
  context?: {
    publicAudit?: PublicAuditResult | null;
    competitorIntelligence?: CompetitorIntelligenceResult | null;
    authorityScore?: number | null;
    contentQualityScore?: number | null;
    aiVisibilityScore?: number | null;
  },
): {
  title: string;
  reasoning: string;
  recommendation: string;
  steps: string[];
  tactics: string[];
  focusPage: string;
  timeline: {
    short: string;
    mid: string;
    long: string;
  };
  priority: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  confidence: number;
  expectedOutcome: string;
  effortLevel: 'low' | 'medium' | 'high';
} {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const focus = scrubActionCompanyReferences(
    (typeof payload.keyword === 'string' && payload.keyword) ||
    (typeof payload.keyword_theme === 'string' && payload.keyword_theme) ||
    decision.title,
    companyContext,
  );
  const effortLevel = inferEffortLevel(decision);
  const alignmentStep = strategicContext?.positioningStrength === 'weak'
    ? 'Ensure each buyer-stage page reinforces your differentiation with proof before scaling broader distribution.'
    : strategicContext
      ? `Tune this execution for a ${strategicContext.marketType} market by prioritizing ${strategicContext.keySuccessFactor}.`
      : null;
  const reasoning = scrubActionCompanyReferences(
    structuredReasoning({ decision, companyContext, strategicContext }),
    companyContext,
  );
  const tactics = buildStructuredTactics({
    decision,
    companyContext,
    strategicContext,
    publicAudit: context?.publicAudit ?? null,
    competitorIntelligence: context?.competitorIntelligence ?? null,
    authorityScore: context?.authorityScore ?? null,
    contentQualityScore: context?.contentQualityScore ?? null,
    aiVisibilityScore: context?.aiVisibilityScore ?? null,
  });
  const focusPage = guessFocusPage(decision, context?.publicAudit ?? null);
  const confidence = confidencePercent(decision);
  const timeline = recommendationTimeline(effortLevel, confidence);
  const impact = impactBand(impactScore(decision));
  const priority = executivePriorityBand(Number(decision.priority_score ?? impactScore(decision)));

  if (decision.action_type === 'fix_cta') {
    return {
      title: `Rebuild the CTA flow on ${focus} for high-intent conversion`,
      reasoning,
      recommendation: decision.recommendation,
      steps: [
        'Audit the current CTA on the highest-intent page and identify the single next action you want visitors to take.',
        'Rewrite the CTA copy so the value promise and next step are explicit and low-friction.',
        alignmentStep || 'Align supporting proof near the CTA so visitors have a reason to trust the click.',
      ],
      tactics,
      focusPage,
      timeline,
      priority,
      impact,
      confidence,
      expectedOutcome: companyContext?.companyName
        ? `More of ${companyContext.companyName}'s existing traffic should progress into meaningful action instead of stalling.`
        : 'More of the traffic you already have should progress into meaningful action instead of stalling.',
      effortLevel,
    };
  }

  if (decision.action_type === 'fix_distribution') {
    return {
      title: companyContext?.marketContext
        ? `Reallocate distribution to the highest-fit segment in ${companyContext.marketContext}`
        : 'Reallocate distribution to the highest-fit market segment',
      reasoning,
      recommendation: decision.recommendation,
      steps: [
        'Define the primary geography or channel segment that should be prioritized first.',
        'Adjust messaging examples, proof, and landing experience so they match that audience more closely.',
        alignmentStep || 'Shift distribution effort toward the channels where that audience is already showing intent.',
      ],
      tactics,
      focusPage,
      timeline,
      priority,
      impact,
      confidence,
      expectedOutcome: companyContext?.companyName
        ? `Traffic quality for ${companyContext.companyName} should improve because the right message is reaching the right audience.`
        : 'Traffic quality should improve because the right message is reaching the right audience.',
      effortLevel,
    };
  }

  if (decision.action_type === 'adjust_strategy') {
    return {
      title: companyContext?.positioning
        ? `Strengthen proof for ${companyContext.positioning} around the core focus area to recover trust`
        : `Strengthen positioning proof around ${focus} to recover trust`,
      reasoning,
      recommendation: decision.recommendation,
      steps: [
        'Define the main promise the brand should own and the proof required to support it.',
        'Update the homepage or key landing page so the value proposition and credibility are obvious within seconds.',
        alignmentStep || 'Publish at least one supporting proof asset, such as a case study, testimonial block, or expert perspective.',
      ],
      tactics,
      focusPage,
      timeline,
      priority,
      impact,
      confidence,
      expectedOutcome: companyContext?.companyName
        ? `Buyers should understand faster why ${companyContext.companyName} is credible and different, improving trust and conversion readiness.`
        : 'Buyers should understand faster why this business is credible and different, improving trust and conversion readiness.',
      effortLevel,
    };
  }

  return {
    title: companyContext?.companyName && companyContext.marketContext
      ? `Build comparison and decision pages aligned with the current positioning in ${companyContext.marketContext}`
      : `Build comparison and decision pages targeting ${focus} intent gaps`,
    reasoning,
    recommendation: decision.recommendation,
    steps: [
      'Identify the primary page or topic cluster that should carry this intent.',
      'Rewrite or expand the page so it answers the real buyer question with more specificity and proof.',
      alignmentStep || 'Add one supporting asset or internal link that strengthens topical depth and next-step clarity.',
    ],
    tactics,
    focusPage,
    timeline,
    priority,
    impact,
    confidence,
    expectedOutcome: companyContext?.companyName
      ? `${companyContext.companyName} should become easier to discover and easier to trust for this demand area${strategicContext ? ` in a ${strategicContext.marketType} market.` : '.'}`
      : 'The business should become easier to discover and easier to trust for this demand area.',
    effortLevel,
  };
}

export function toAction(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
  strategicContext?: StrategicContext,
  recommendationContext?: {
    publicAudit?: PublicAuditResult | null;
    competitorIntelligence?: CompetitorIntelligenceResult | null;
    authorityScore?: number | null;
    contentQualityScore?: number | null;
    aiVisibilityScore?: number | null;
  },
): SnapshotAction {
  const plan = buildActionPlan(decision, companyContext, strategicContext, recommendationContext);
  const impact = impactScore(decision);
  const priorityType = classifyPriorityType({
    impactScore: impact,
    effortLevel: plan.effortLevel,
  });
  return {
    decision_id: decision.id,
    title: plan.title,
    reasoning: plan.reasoning,
    recommendation: plan.recommendation,
    steps: plan.steps,
    tactics: plan.tactics,
    focus_page: plan.focusPage,
    timeline: plan.timeline,
    priority: plan.priority,
    impact: plan.impact,
    effort: plan.effortLevel,
    confidence: plan.confidence,
    expected_outcome: plan.expectedOutcome,
    expected_upside: buildExpectedUpside({
      priorityType,
      impactScore: impact,
      actionType: decision.action_type,
      expectedOutcome: plan.expectedOutcome,
    }),
    effort_level: plan.effortLevel,
    priority_type: priorityType,
    impact_score: impact,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}
