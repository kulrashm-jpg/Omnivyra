import type { PersistedDecisionObject } from '../decisionObjectService';
import type { ResolvedReportInput } from '../reportInputResolver';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import { impactScore, rankByImpactConfidence } from '../reportDecisionUtils';
import {
  buildExpectedUpside,
  classifyPriorityType,
} from '../actionPriorityService';
import { nowIso, clamp } from '../snapshotReportNarrativeHelpers';
import type {
  CompanyNarrativeContext,
  SnapshotAction,
  SnapshotSignalKey,
  SignalAvailabilityLevel,
  SnapshotSectionDefinition,
  StrategicContext,
} from './types';
import { SNAPSHOT_MIN_INSIGHTS } from './types';
import {
  isSeoDecision,
  isGeoDecision,
  isCompetitorDecision,
  inferEffortLevel,
  describeBusinessContext,
  uniqueById,
} from './actionHelpers';
import {
  buildStructuredTactics,
  guessFocusPage,
  isAuthorityDecision,
  isContentDecision,
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

export function signalAvailabilityFromDecisions(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): Record<SnapshotSignalKey, SignalAvailabilityLevel> {
  const { decisions, resolvedInput } = params;
  const seoCount = decisions.filter(isSeoDecision).length;
  const contentCount = decisions.filter(isContentDecision).length;
  const authorityCount = decisions.filter(isAuthorityDecision).length;
  const geoCount = decisions.filter(isGeoDecision).length;
  const competitorCount = decisions.filter(isCompetitorDecision).length;

  const domainPresent = Boolean(resolvedInput?.resolved.websiteDomain);
  const socialPresent = (resolvedInput?.resolved.socialLinks.length ?? 0) > 0;
  const geographyPresent = Boolean(resolvedInput?.resolved.geography);
  const competitorPresent = (resolvedInput?.resolved.competitors.length ?? 0) > 0;

  return {
    seo_structure: seoCount >= 2 ? 'NORMAL' : seoCount === 1 || domainPresent ? 'LOW_DATA' : 'NO_DATA',
    content_coverage:
      contentCount >= 2
        ? 'NORMAL'
        : contentCount === 1 || domainPresent || socialPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    authority:
      authorityCount >= 1
        ? 'NORMAL'
        : socialPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    competitor:
      competitorCount >= 1 || competitorPresent
        ? 'NORMAL'
        : domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    geo_relevance:
      geoCount >= 1
        ? 'NORMAL'
        : geographyPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
  };
}

function syntheticDecision(params: {
  companyId: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  actionType: PersistedDecisionObject['action_type'];
  actionPayload: Record<string, unknown>;
  impactTraffic: number;
  impactConversion: number;
  impactRevenue: number;
  priorityScore: number;
  confidenceScore: number;
}): PersistedDecisionObject {
  const now = nowIso();
  return {
    id: `synthetic_${params.issueType}_${Math.random().toString(36).slice(2, 10)}`,
    company_id: params.companyId,
    report_tier: 'snapshot',
    source_service: 'snapshotFallbackService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: {
      synthetic: true,
      generated_at: now,
    },
    impact_traffic: params.impactTraffic,
    impact_conversion: params.impactConversion,
    impact_revenue: params.impactRevenue,
    priority_score: params.priorityScore,
    effort_score: 24,
    execution_score: clamp(
      params.priorityScore * 0.62 + Math.max(params.impactTraffic, params.impactConversion, params.impactRevenue) * 0.38,
      0,
      100,
    ),
    confidence_score: params.confidenceScore,
    recommendation: params.recommendation,
    action_type: params.actionType,
    action_payload: params.actionPayload,
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

export function buildSnapshotBaselineDecisions(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): PersistedDecisionObject[] {
  const signalAvailability = signalAvailabilityFromDecisions(params);
  const fallbacks: PersistedDecisionObject[] = [];
  const domain = params.resolvedInput?.resolved.websiteDomain ?? 'your site';
  const contextLabel = describeBusinessContext(params.resolvedInput);
  const geography = params.resolvedInput?.resolved.geography ?? 'your highest-value market';

  if (!params.decisions.some(isSeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'seo_gap',
        title: `${domain} is not yet visible enough to generate dependable discovery`,
        description: `We do not yet have enough durable SEO signal around ${domain} for ${contextLabel}, which usually means discoverability is being left to chance rather than engineered through search coverage.`,
        recommendation: `Build a simple search foundation for ${domain}: one sharpened homepage promise, one core service page, and one high-intent educational page tied to ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_seo_baseline', domain },
        impactTraffic: 62,
        impactConversion: 34,
        impactRevenue: 28,
        priorityScore: signalAvailability.seo_structure === 'NO_DATA' ? 68 : 58,
        confidenceScore: signalAvailability.seo_structure === 'NO_DATA' ? 0.74 : 0.68,
      }),
    );
  }

  if (!params.decisions.some(isContentDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'content_gap',
        title: `${domain} does not yet cover enough of the questions buyers ask before choosing`,
        description: `The current signal set suggests there is not enough topic coverage, depth, or supporting content for ${contextLabel} to turn interest into repeat discovery and trust.`,
        recommendation: `Prioritize a small content spine for ${domain}: one authority page, one comparison/problem page, and one proof-driven article tied to buyer intent in ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_content_coverage' },
        impactTraffic: 54,
        impactConversion: 42,
        impactRevenue: 32,
        priorityScore: 63,
        confidenceScore: 0.76,
      }),
    );
  }

  if (!params.decisions.some(isAuthorityDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'authority_deficit',
        title: `${domain} lacks enough proof to reinforce buyer confidence`,
        description: `Even if people discover ${domain}, there are not enough visible proof signals, trust markers, or authority assets to consistently convert interest into action for ${contextLabel}.`,
        recommendation: `Add proof assets that compress trust quickly for ${domain}: case studies, testimonials, founder/expert credibility, and visible outcome claims.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_authority_baseline' },
        impactTraffic: 34,
        impactConversion: 56,
        impactRevenue: 46,
        priorityScore: 61,
        confidenceScore: 0.73,
      }),
    );
  }

  if (
    signalAvailability.competitor !== 'NORMAL' &&
    !params.decisions.some(isCompetitorDecision)
  ) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'competitor_gap',
        title: `Competitive positioning for ${domain} is unclear because no baseline is being tracked`,
        description: `Without a visible competitor set for ${contextLabel}, it is difficult to tell whether weak performance is a market problem, a messaging problem, or simply a positioning gap.`,
        recommendation: `Track 3 direct competitors serving ${geography} and compare offers, messaging promises, and search topics so the next report can show concrete positioning gaps.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_competitor_tracking' },
        impactTraffic: 28,
        impactConversion: 38,
        impactRevenue: 34,
        priorityScore: signalAvailability.competitor === 'NO_DATA' ? 57 : 49,
        confidenceScore: 0.66,
      }),
    );
  }

  if (signalAvailability.geo_relevance === 'NO_DATA' && !params.decisions.some(isGeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'geo_gap',
        title: `Regional relevance for ${domain} is unclear, which can hide demand-quality problems`,
        description: `We do not yet have enough geographic signal to tell whether the current positioning for ${contextLabel} matches the market you most want to win.`,
        recommendation: `Define ${geography} as the first market to win and align messaging, examples, and proof so ${domain} reads as locally relevant there.`,
        actionType: 'fix_distribution',
        actionPayload: { optimization_focus: 'snapshot_geo_clarity' },
        impactTraffic: 31,
        impactConversion: 33,
        impactRevenue: 29,
        priorityScore: 46,
        confidenceScore: 0.61,
      }),
    );
  }

  return fallbacks;
}

export function ensureSnapshotDecisionFloor(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): { decisions: PersistedDecisionObject[]; fallbackAdded: number } {
  const uniqueDecisions = uniqueById(params.decisions);
  const baseline = buildSnapshotBaselineDecisions({
    companyId: params.companyId,
    decisions: uniqueDecisions,
    resolvedInput: params.resolvedInput,
  });

  const needed = Math.max(0, SNAPSHOT_MIN_INSIGHTS - uniqueDecisions.length);
  const selectedBaseline = baseline.slice(0, Math.max(needed, Math.min(3, baseline.length)));
  const finalDecisions = uniqueById([...uniqueDecisions, ...selectedBaseline]).sort(rankByImpactConfidence);

  return {
    decisions: finalDecisions,
    fallbackAdded: selectedBaseline.length,
  };
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
