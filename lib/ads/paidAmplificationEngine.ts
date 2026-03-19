/**
 * Paid Amplification Engine — deterministic, rule-based, no AI, no external deps.
 * Answers: Should we run ads? When? How much? Why?
 *
 * Decision hierarchy:
 *   1. Risk level from validation (hard gate — HIGH risk blocks ads)
 *   2. Maturity stage baseline recommendation
 *   3. Confidence score modifier (boosts or throttles)
 *   4. Funnel coverage → ad objective mapping
 *   5. Trigger generation from plan structure
 */

import type { AccountContext, MaturityStage } from '../../backend/types/accountContext';
import type { CampaignValidation } from '../validation/campaignValidator';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PaidOverallRecommendation = 'NOT_NEEDED' | 'TEST' | 'SCALE';
export type AdObjective = 'AWARENESS' | 'ENGAGEMENT' | 'LEAD_GEN' | 'CONVERSION';
export type AudienceType = 'COLD' | 'WARM' | 'LOOKALIKE';

export interface PaidTrigger {
  condition: string;
  action: string;
}

export interface AdPlan {
  objective: AdObjective;
  platforms: string[];
  audienceType: AudienceType;
  budgetRange: string;
  duration: string;
}

export interface PaidRecommendation {
  overallRecommendation: PaidOverallRecommendation;
  reasoning: string[];
  triggers: PaidTrigger[];
  adPlan: AdPlan | null;
  expectedImpact: {
    reachLift: string;
    engagementLift: string;
    leadLift: string;
  };
}

export interface PaidAmplificationInput {
  plan: {
    weeks: Array<{
      week: number;
      theme?: string | null;
      funnel_stage?: string | null;
      daily?: Array<{ day?: string | null; platforms?: Record<string, string> | null }> | null;
    }>;
  };
  campaign_validation: CampaignValidation;
  account_context?: AccountContext | null;
  strategy_context: {
    duration_weeks: number;
    platforms: string[];
    posting_frequency: Record<string, number>;
    campaign_goal?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Collect all unique funnel stages present in the plan weeks. */
function collectFunnelStages(weeks: PaidAmplificationInput['plan']['weeks']): Set<string> {
  const stages = new Set<string>();
  for (const w of weeks) {
    const stage = String(w.funnel_stage ?? '').toLowerCase().trim();
    if (stage) stages.add(stage);
  }
  return stages;
}

/** Pick ad objective from dominant funnel stage. */
function resolveAdObjective(stages: Set<string>, weeks: PaidAmplificationInput['plan']['weeks']): AdObjective {
  if (stages.size === 0) return 'AWARENESS';
  // Count weeks per stage to find dominant
  const counts: Record<string, number> = {};
  for (const w of weeks) {
    const s = String(w.funnel_stage ?? '').toLowerCase().trim();
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'awareness';
  if (dominant === 'conversion') return 'CONVERSION';
  if (dominant === 'trust' || dominant === 'education') return 'LEAD_GEN';
  if (dominant === 'engagement') return 'ENGAGEMENT';
  return 'AWARENESS';
}

/** Audience type by maturity and objective. */
function resolveAudienceType(maturity: MaturityStage, objective: AdObjective): AudienceType {
  if (maturity === 'NEW') return 'COLD';
  if (maturity === 'ESTABLISHED') return objective === 'CONVERSION' ? 'WARM' : 'LOOKALIKE';
  return 'COLD'; // GROWING starts cold then warms
}

/** Budget range by maturity stage. */
const BUDGET_BY_MATURITY: Record<MaturityStage, string> = {
  NEW: '₹10K–₹30K test budget',
  GROWING: '₹30K–₹75K growth budget',
  ESTABLISHED: '₹75K+ scaling budget',
};

/** Ad duration heuristic based on campaign duration. */
function resolveDuration(durationWeeks: number, recommendation: PaidOverallRecommendation): string {
  if (recommendation === 'TEST') return `${Math.min(2, durationWeeks)} weeks`;
  const adWeeks = Math.max(2, Math.round(durationWeeks * 0.6));
  return `${adWeeks} of ${durationWeeks} weeks`;
}

// ---------------------------------------------------------------------------
// Rule A: Base recommendation from maturity + confidence
// ---------------------------------------------------------------------------

function baseRecommendation(
  maturity: MaturityStage,
  confidenceScore: number,
  riskLevel: CampaignValidation['riskLevel']
): { recommendation: PaidOverallRecommendation; reasons: string[] } {
  const reasons: string[] = [];

  // Hard gate: HIGH risk → not yet
  if (riskLevel === 'HIGH') {
    reasons.push('Plan has HIGH risk issues that must be fixed before investing in paid distribution.');
    return { recommendation: 'NOT_NEEDED', reasons };
  }

  if (maturity === 'NEW') {
    if (confidenceScore < 60) {
      reasons.push('New account with a low-confidence plan — organic consistency should come first.');
      reasons.push('Ads on an unproven content strategy waste budget with no learnings.');
      return { recommendation: 'NOT_NEEDED', reasons };
    }
    reasons.push('New account: test-budget ads will validate content-market fit cheaply.');
    if (riskLevel === 'MEDIUM') {
      reasons.push('Medium risk plan is acceptable for a limited awareness test.');
    }
    return { recommendation: 'TEST', reasons };
  }

  if (maturity === 'GROWING') {
    if (riskLevel === 'LOW' && confidenceScore >= 75) {
      reasons.push('Strong plan with a growing audience — scaling ads now accelerates momentum.');
      reasons.push('Organic engagement signals indicate paid reach will convert efficiently.');
      return { recommendation: 'SCALE', reasons };
    }
    reasons.push('Growing account: a measured test validates paid ROI before full commitment.');
    return { recommendation: 'TEST', reasons };
  }

  // ESTABLISHED
  if (riskLevel === 'LOW' || confidenceScore >= 80) {
    reasons.push('Established account with a high-confidence plan — the conditions for scaling are in place.');
    return { recommendation: 'SCALE', reasons };
  }
  reasons.push('Established account but plan needs minor improvements — test first, then scale.');
  return { recommendation: 'TEST', reasons };
}

// ---------------------------------------------------------------------------
// Rule B: Funnel-based reasoning modifiers
// ---------------------------------------------------------------------------

function funnelReasons(stages: Set<string>, recommendation: PaidOverallRecommendation): string[] {
  const reasons: string[] = [];
  if (stages.size === 0) return reasons;

  if (stages.has('conversion') && recommendation === 'SCALE') {
    reasons.push('Funnel includes a conversion phase — direct-response ads will amplify this stage.');
  }
  if (stages.has('awareness') && !stages.has('conversion')) {
    reasons.push('Awareness-focused plan benefits from paid reach to fill the top of funnel faster.');
  }
  if (stages.has('trust') || stages.has('education')) {
    reasons.push('Mid-funnel content is present — retargeting warm audiences with these pieces improves conversion rates.');
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Rule C: Trigger generation (2–4 smart triggers)
// ---------------------------------------------------------------------------

function buildTriggers(
  weeks: PaidAmplificationInput['plan']['weeks'],
  maturity: MaturityStage,
  recommendation: PaidOverallRecommendation,
  stages: Set<string>
): PaidTrigger[] {
  const triggers: PaidTrigger[] = [];

  // Always: underperformance trigger
  triggers.push({
    condition: 'Week 1 organic reach is below the platform benchmark for your maturity stage',
    action: 'Activate awareness ads immediately to supplement organic distribution.',
  });

  // Engagement spike trigger
  triggers.push({
    condition: 'A post achieves 2× your average engagement rate',
    action: 'Boost that post via paid promotion — high organic signals predict strong paid performance.',
  });

  // Conversion-stage specific trigger
  if (stages.has('conversion')) {
    triggers.push({
      condition: 'Conversion week begins and lead gen is below target',
      action: 'Switch to lead-gen or conversion objective ads targeting warm website visitors.',
    });
  }

  // Established / scale-specific trigger
  if (maturity === 'ESTABLISHED' && recommendation === 'SCALE') {
    triggers.push({
      condition: 'Organic reach plateau is detected (flat for 2 consecutive weeks)',
      action: 'Expand to lookalike audiences with ₹50K+ weekly budget to break the ceiling.',
    });
  }

  // NEW maturity — budget-preservation trigger
  if (maturity === 'NEW') {
    triggers.push({
      condition: 'Cost-per-click exceeds ₹25 in the first test week',
      action: 'Pause campaign and review ad creative before continuing spend.',
    });
  }

  // Growing — retarget trigger
  if (maturity === 'GROWING') {
    triggers.push({
      condition: 'Content engagement rate stays consistent for 2+ weeks',
      action: 'Launch retargeting ads to profile visitors who engaged but did not convert.',
    });
  }

  // Cap at 4
  return triggers.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Expected impact by recommendation + maturity
// ---------------------------------------------------------------------------

function buildExpectedImpact(
  recommendation: PaidOverallRecommendation,
  maturity: MaturityStage
): PaidRecommendation['expectedImpact'] {
  if (recommendation === 'NOT_NEEDED') {
    return {
      reachLift: 'No paid lift — organic only',
      engagementLift: 'Baseline organic performance',
      leadLift: 'Not applicable',
    };
  }

  const table: Record<MaturityStage, Record<PaidOverallRecommendation, PaidRecommendation['expectedImpact']>> = {
    NEW: {
      NOT_NEEDED: { reachLift: 'No paid lift', engagementLift: 'Organic only', leadLift: 'Not applicable' },
      TEST: { reachLift: '2×–4× vs organic', engagementLift: 'Moderate — learning phase', leadLift: 'Minimal — awareness focus' },
      SCALE: { reachLift: '5×–10× vs organic', engagementLift: 'Growing as audience warms', leadLift: 'Emerging — early funnel' },
    },
    GROWING: {
      NOT_NEEDED: { reachLift: 'No paid lift', engagementLift: 'Organic only', leadLift: 'Not applicable' },
      TEST: { reachLift: '3×–6× vs organic', engagementLift: 'Strong — engaged base amplified', leadLift: 'Low to moderate' },
      SCALE: { reachLift: '8×–15× vs organic', engagementLift: 'High — proven content scaled', leadLift: 'Moderate to high' },
    },
    ESTABLISHED: {
      NOT_NEEDED: { reachLift: 'No paid lift', engagementLift: 'Organic only', leadLift: 'Not applicable' },
      TEST: { reachLift: '5×–10× vs organic', engagementLift: 'High — established brand effect', leadLift: 'Moderate' },
      SCALE: { reachLift: '15×–30× vs organic', engagementLift: 'Very High — audience trust converts', leadLift: 'High' },
    },
  };

  return table[maturity][recommendation];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generatePaidRecommendation(input: PaidAmplificationInput): PaidRecommendation {
  const { plan, campaign_validation, account_context, strategy_context } = input;
  const maturity: MaturityStage = account_context?.maturityStage ?? 'GROWING';
  const { confidenceScore, riskLevel } = campaign_validation;
  const platforms = strategy_context.platforms.filter(Boolean);
  const stages = collectFunnelStages(plan.weeks);

  // Step 1: base recommendation
  const { recommendation, reasons } = baseRecommendation(maturity, confidenceScore, riskLevel);

  // Step 2: funnel reasoning modifiers
  const extraReasons = funnelReasons(stages, recommendation);
  const allReasons = [...reasons, ...extraReasons];

  // Step 3: ad plan (null if NOT_NEEDED)
  let adPlan: AdPlan | null = null;
  if (recommendation !== 'NOT_NEEDED') {
    const objective = resolveAdObjective(stages, plan.weeks);
    const audienceType = resolveAudienceType(maturity, objective);
    adPlan = {
      objective,
      platforms: platforms.length > 0 ? platforms : ['Instagram', 'LinkedIn'],
      audienceType,
      budgetRange: BUDGET_BY_MATURITY[maturity],
      duration: resolveDuration(strategy_context.duration_weeks, recommendation),
    };
  }

  // Step 4: triggers
  const triggers = buildTriggers(plan.weeks, maturity, recommendation, stages);

  // Step 5: expected impact
  const expectedImpact = buildExpectedImpact(recommendation, maturity);

  return {
    overallRecommendation: recommendation,
    reasoning: allReasons,
    triggers,
    adPlan,
    expectedImpact,
  };
}
