/**
 * Campaign Validation Engine — deterministic, no AI, no async.
 * Runs after plan generation, before execution, to give CMOs an
 * instant health signal: confidence score, risk level, expected
 * outcomes, issues, and actionable suggestions.
 */

import type { AccountContext, MaturityStage } from '../../types/accountContext';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CampaignValidationInput {
  plan: {
    weeks: Array<{
      week: number;
      theme?: string | null;
      funnel_stage?: string | null;
      primary_objective?: string | null;
      daily?: Array<{
        day?: string | null;
        platforms?: Record<string, string> | null;
        content?: string | null;
        objective?: string | null;
        content_type?: string | null;
      }> | null;
    }>;
  };
  strategy_context: {
    duration_weeks: number;
    platforms: string[];
    posting_frequency: Record<string, number>;
    content_mix?: Record<string, number> | null;
    campaign_goal?: string | null;
    target_audience?: string | string[] | null;
  };
  account_context?: AccountContext | null;
  /** Flat array form already normalized by deterministicWeeklySkeleton */
  execution_items?: Array<{
    content_type: string;
    count_per_week: number;
    selected_platforms: string[];
  }> | null;
}

export interface CampaignValidation {
  confidenceScore: number; // 0–100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedOutcome: {
    reachEstimate: string;
    engagementEstimate: string;
    leadsEstimate: string;
  };
  issues: string[];
  suggestions: string[];
  scoreBreakdown: {
    frequency: number;
    platformMix: number;
    contentDiversity: number;
    funnelCoverage: number;
    consistency: number;
  };
}

// ---------------------------------------------------------------------------
// Safe default returned when the plan or strategy_context is too malformed
// to evaluate. Scores 50 (MEDIUM) so the user sees a signal but is not blocked.
// ---------------------------------------------------------------------------

const SAFE_DEFAULT_VALIDATION: CampaignValidation = {
  confidenceScore: 50,
  riskLevel: 'MEDIUM',
  expectedOutcome: {
    reachEstimate: 'Unknown — plan data incomplete',
    engagementEstimate: 'Unknown — plan data incomplete',
    leadsEstimate: 'Unknown — plan data incomplete',
  },
  issues: ['Plan data is incomplete or missing — validation could not run fully.'],
  suggestions: ['Ensure all required fields are set before generating the plan.'],
  scoreBreakdown: { frequency: 10, platformMix: 10, contentDiversity: 10, funnelCoverage: 10, consistency: 10 },
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

type Deduction = { points: number; severity: 'minor' | 'medium' | 'critical'; issue: string; suggestion: string };

const POINTS: Record<'minor' | 'medium' | 'critical', number> = {
  minor: 5,
  medium: 10,
  critical: 20,
};

// ---------------------------------------------------------------------------
// Rule A: Frequency check
// ---------------------------------------------------------------------------

function checkFrequency(
  posting_frequency: Record<string, number>,
  maturity: MaturityStage,
  platforms: string[]
): Deduction[] {
  const deductions: Deduction[] = [];
  const totalPerWeek = Object.values(posting_frequency).reduce((s, n) => s + (Number(n) || 0), 0);
  // Guard: never divide by zero — treat 0 platforms same as 1 for avg computation
  const platformCount = Math.max(1, platforms.filter(Boolean).length);
  const avgPerPlatform = totalPerWeek / platformCount;

  if (maturity === 'NEW') {
    if (avgPerPlatform > 7) {
      deductions.push({
        points: POINTS.critical,
        severity: 'critical',
        issue: 'Posting frequency is too high for a new account — risks burnout and low quality.',
        suggestion: 'Reduce to 3–5 posts/week per platform until you establish a consistent rhythm.',
      });
    } else if (avgPerPlatform > 5) {
      deductions.push({
        points: POINTS.medium,
        severity: 'medium',
        issue: 'Frequency is high for a new account — content quality may suffer.',
        suggestion: 'Consider starting at 3–4 posts/week and scaling up gradually.',
      });
    }
  }

  if (maturity === 'ESTABLISHED') {
    if (avgPerPlatform < 2) {
      deductions.push({
        points: POINTS.minor,
        severity: 'minor',
        issue: 'Posting frequency is low for an established account — may lose audience momentum.',
        suggestion: 'Increase to at least 3–5 posts/week to maintain visibility.',
      });
    }
  }

  if (totalPerWeek === 0) {
    deductions.push({
      points: POINTS.critical,
      severity: 'critical',
      issue: 'No posting frequency defined — plan has no execution cadence.',
      suggestion: 'Set posting frequency for each platform before generating the plan.',
    });
  }

  return deductions;
}

// ---------------------------------------------------------------------------
// Rule B: Platform mix
// ---------------------------------------------------------------------------

function checkPlatformMix(platforms: string[]): Deduction[] {
  const deductions: Deduction[] = [];
  const count = platforms.filter(Boolean).length;

  if (count === 0) {
    deductions.push({
      points: POINTS.critical,
      severity: 'critical',
      issue: 'No platforms selected — campaign has no distribution channel.',
      suggestion: 'Add at least one platform (e.g. LinkedIn, Instagram) to your strategy.',
    });
  } else if (count === 1) {
    deductions.push({
      points: POINTS.medium,
      severity: 'medium',
      issue: `Over-dependence on a single platform (${platforms[0]}) — reach is limited.`,
      suggestion: 'Add a second platform to diversify reach and reduce single-channel risk.',
    });
  }

  return deductions;
}

// ---------------------------------------------------------------------------
// Rule C: Content diversity
// ---------------------------------------------------------------------------

function checkContentDiversity(
  execution_items: CampaignValidationInput['execution_items'],
  content_mix: Record<string, number> | null | undefined
): Deduction[] {
  const deductions: Deduction[] = [];

  const types = new Set<string>();
  if (Array.isArray(execution_items)) {
    execution_items.forEach((item) => {
      if (item.content_type) types.add(item.content_type.toLowerCase());
    });
  } else if (content_mix && typeof content_mix === 'object') {
    Object.keys(content_mix).forEach((k) => {
      if (k) types.add(k.toLowerCase());
    });
  }

  if (types.size === 0) return deductions;

  if (types.size === 1) {
    deductions.push({
      points: POINTS.medium,
      severity: 'medium',
      issue: `Only one content type used (${[...types][0]}) — plan lacks variety.`,
      suggestion: 'Mix at least 2 content types (e.g. posts + videos) to boost engagement across formats.',
    });
  }

  return deductions;
}

// ---------------------------------------------------------------------------
// Rule D: Funnel coverage
// ---------------------------------------------------------------------------

function checkFunnelCoverage(
  weeks: CampaignValidationInput['plan']['weeks']
): Deduction[] {
  const deductions: Deduction[] = [];
  const stages = new Set(
    weeks.map((w) => String(w.funnel_stage ?? '').toLowerCase()).filter(Boolean)
  );

  if (stages.size === 0) return deductions;

  if (!stages.has('awareness')) {
    deductions.push({
      points: POINTS.critical,
      severity: 'critical',
      issue: 'No awareness phase in the plan — cold audiences have no entry point.',
      suggestion: 'Add at least one awareness week at the start of the campaign.',
    });
  }

  if (!stages.has('conversion')) {
    deductions.push({
      points: POINTS.medium,
      severity: 'medium',
      issue: 'No conversion phase in the plan — the campaign lacks a clear call to action.',
      suggestion: 'Reserve the final week(s) for conversion-focused content.',
    });
  }

  if (weeks.length > 3 && !stages.has('trust') && !stages.has('education')) {
    deductions.push({
      points: POINTS.minor,
      severity: 'minor',
      issue: 'No education or trust phase — longer campaigns benefit from middle-funnel content.',
      suggestion: 'Add education or trust-building weeks between awareness and conversion.',
    });
  }

  return deductions;
}

// ---------------------------------------------------------------------------
// Rule E: Consistency (gaps + overloaded days)
// ---------------------------------------------------------------------------

function checkConsistency(
  weeks: CampaignValidationInput['plan']['weeks']
): Deduction[] {
  const deductions: Deduction[] = [];

  let emptyWeeks = 0;
  let overloadedDays = 0;

  for (const week of weeks) {
    const daily = week.daily ?? [];
    if (daily.length === 0) emptyWeeks += 1;

    const dayPostingCounts: Record<string, number> = {};
    for (const d of daily) {
      const dayKey = d.day ?? 'unknown';
      const platformCount = d.platforms ? Object.keys(d.platforms).length : 0;
      dayPostingCounts[dayKey] = (dayPostingCounts[dayKey] ?? 0) + platformCount;
    }
    for (const count of Object.values(dayPostingCounts)) {
      if (count > 5) overloadedDays += 1;
    }
  }

  if (emptyWeeks > 0) {
    const capped = Math.min(emptyWeeks, 3);
    for (let i = 0; i < capped; i++) {
      deductions.push({
        points: POINTS.minor,
        severity: 'minor',
        issue: `Week ${i + 1} has no scheduled content — creates a posting gap.`,
        suggestion: 'Fill all weeks with at least one post to maintain audience continuity.',
      });
    }
  }

  if (overloadedDays > 0) {
    deductions.push({
      points: POINTS.minor,
      severity: 'minor',
      issue: `${overloadedDays} day(s) have more than 5 platform posts — execution overload risk.`,
      suggestion: 'Spread high-volume days across the week to reduce production pressure.',
    });
  }

  return deductions;
}

// ---------------------------------------------------------------------------
// Expectation engine (heuristic ranges)
// ---------------------------------------------------------------------------

function buildExpectedOutcome(
  maturity: MaturityStage,
  platforms: string[],
  posting_frequency: Record<string, number>
): CampaignValidation['expectedOutcome'] {
  const totalWeekly = Object.values(posting_frequency).reduce((s, n) => s + (Number(n) || 0), 0);
  const isMultiPlatform = platforms.length > 1;

  const reach: Record<MaturityStage, string> = {
    NEW: isMultiPlatform ? 'Low to Moderate' : 'Low',
    GROWING: isMultiPlatform ? 'Moderate to High' : 'Moderate',
    ESTABLISHED: isMultiPlatform ? 'High' : 'Moderate to High',
  };

  const engagement: Record<MaturityStage, string> = {
    NEW: 'Building Phase — expect low engagement initially',
    GROWING: totalWeekly >= 5 ? 'Growing — consistent posting drives steady engagement' : 'Moderate — increase frequency for better results',
    ESTABLISHED: 'Strong — leveraging an active audience',
  };

  const leads: Record<MaturityStage, string> = {
    NEW: 'Minimal — focus on awareness first',
    GROWING: 'Emerging — direct traffic and signups will grow',
    ESTABLISHED: 'Moderate to High — strong audience converts at higher rates',
  };

  return {
    reachEstimate: reach[maturity],
    engagementEstimate: engagement[maturity],
    leadsEstimate: leads[maturity],
  };
}

// ---------------------------------------------------------------------------
// Score dimension breakdown
// ---------------------------------------------------------------------------

function dimensionScore(basePoints: number, deductions: Deduction[]): number {
  const loss = deductions.reduce((s, d) => s + d.points, 0);
  return Math.max(0, basePoints - loss);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function validateCampaignPlan(input: CampaignValidationInput): CampaignValidation {
  // Guard: malformed input — return safe default rather than crashing
  if (!input || !input.plan || !Array.isArray(input.plan.weeks) || !input.strategy_context) {
    console.warn('[PLANNER][VALIDATION][WARN] validateCampaignPlan received null or malformed input — returning safe default');
    return { ...SAFE_DEFAULT_VALIDATION };
  }

  const { plan, strategy_context, account_context, execution_items } = input;
  const maturity: MaturityStage = account_context?.maturityStage ?? 'GROWING';
  // Guard: ensure platforms and posting_frequency are always arrays/objects
  const platforms = Array.isArray(strategy_context.platforms) ? strategy_context.platforms : [];
  const posting_frequency = (strategy_context.posting_frequency && typeof strategy_context.posting_frequency === 'object')
    ? strategy_context.posting_frequency
    : {};

  const freqDeductions = checkFrequency(posting_frequency, maturity, platforms);
  const platformDeductions = checkPlatformMix(platforms);
  const contentDeductions = checkContentDiversity(execution_items, strategy_context.content_mix);
  const funnelDeductions = checkFunnelCoverage(plan.weeks);
  const consistencyDeductions = checkConsistency(plan.weeks);

  const allDeductions = [
    ...freqDeductions,
    ...platformDeductions,
    ...contentDeductions,
    ...funnelDeductions,
    ...consistencyDeductions,
  ];

  const totalLoss = allDeductions.reduce((s, d) => s + d.points, 0);
  const confidenceScore = Math.max(0, Math.min(100, 100 - totalLoss));

  const riskLevel: CampaignValidation['riskLevel'] =
    confidenceScore >= 80 ? 'LOW' : confidenceScore >= 50 ? 'MEDIUM' : 'HIGH';

  const scoreBreakdown: CampaignValidation['scoreBreakdown'] = {
    frequency: dimensionScore(20, freqDeductions),
    platformMix: dimensionScore(20, platformDeductions),
    contentDiversity: dimensionScore(20, contentDeductions),
    funnelCoverage: dimensionScore(20, funnelDeductions),
    consistency: dimensionScore(20, consistencyDeductions),
  };

  return {
    confidenceScore,
    riskLevel,
    expectedOutcome: buildExpectedOutcome(maturity, platforms, posting_frequency),
    issues: allDeductions.map((d) => d.issue),
    suggestions: allDeductions.map((d) => d.suggestion),
    scoreBreakdown,
  };
}
