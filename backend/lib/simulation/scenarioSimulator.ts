/**
 * Scenario Simulation Engine — deterministic, synchronous, <50ms.
 * Answers "What if I change X?" by transforming strategy inputs and
 * re-running the validation + paid amplification engines.
 *
 * Does NOT mutate the original plan structure — funnel stages and
 * weekly themes are left untouched. Only strategy-level levers change.
 */

import { validateCampaignPlan, type CampaignValidation, type CampaignValidationInput } from '../validation/campaignValidator';
import { generatePaidRecommendation, type PaidRecommendation, type PaidAmplificationInput } from '../ads/paidAmplificationEngine';
import type { AccountContext } from '../../types/accountContext';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  /** Multiply all posting frequencies — e.g. 0.5 halves, 1.5 adds 50% more. */
  frequencyMultiplier?: number;
  /** Platform names to add to the campaign. */
  addPlatform?: string[];
  /** Platform names to remove from the campaign. */
  removePlatform?: string[];
  /** Override content types per platform (replaces existing). */
  contentMixOverride?: Array<{
    platform: string;
    contentTypes: string[];
  }>;
  /**
   * Explicit ads override.
   * true  → recompute paid recommendation normally (ignores NOT_NEEDED from low confidence)
   * false → force NOT_NEEDED regardless of other signals
   */
  enableAds?: boolean;
}

export interface ScenarioDelta {
  /** Positive = improvement, negative = regression. */
  confidenceChange: number;
  /** Human-readable risk transition, e.g. "MEDIUM → LOW" or "unchanged". */
  riskChange: string;
  /** Bullet-point explanations of what drove the delta. */
  impactChange: string[];
}

export interface ScenarioOutput {
  updatedValidation: CampaignValidation;
  updatedPaidRecommendation: PaidRecommendation;
  delta: ScenarioDelta;
}

/** Minimal plan shape required by this engine. */
export interface SimulatorBasePlan {
  weeks: Array<{
    week: number;
    theme?: string | null;
    funnel_stage?: string | null;
    daily?: Array<{
      day?: string | null;
      platforms?: Record<string, string> | null;
      content?: string | null;
    }> | null;
  }>;
}

export interface SimulatorStrategyContext {
  duration_weeks: number;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix?: Record<string, number> | null;
  campaign_goal?: string | null;
}

export interface SimulateScenarioInput {
  base_plan: SimulatorBasePlan;
  base_validation: CampaignValidation;
  base_paid_recommendation: PaidRecommendation;
  account_context?: AccountContext | null;
  strategy_context: SimulatorStrategyContext;
  scenario: ScenarioInput;
}

// ---------------------------------------------------------------------------
// Transformation helpers
// ---------------------------------------------------------------------------

const DEFAULT_FREQ_PER_NEW_PLATFORM = 3;

/** Deep-clone a plain object (strategy-level data only — no circular refs). */
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Apply scenario levers to produce a transformed strategy_context and
 * execution_items for the validator.
 */
function applyScenario(
  base: SimulatorStrategyContext,
  scenario: ScenarioInput
): {
  strategy: SimulatorStrategyContext;
  execution_items: CampaignValidationInput['execution_items'];
} {
  const strategy = clone(base);

  // Guard: clamp multiplier to a safe range and reject NaN/Infinity
  const rawMultiplier = scenario.frequencyMultiplier ?? 1;
  const multiplier = Number.isFinite(rawMultiplier)
    ? Math.min(Math.max(rawMultiplier, 0.1), 5)  // floor 0.1× to prevent zeroing out; cap 5× to prevent explosion
    : 1;

  // A. Frequency: scale posting_frequency for every existing platform
  for (const platform of Object.keys(strategy.posting_frequency)) {
    const base_freq = Number(strategy.posting_frequency[platform]) || 3;
    strategy.posting_frequency[platform] = Math.max(1, Math.round(base_freq * multiplier));
  }

  // B. Remove platforms — filter empty/whitespace strings before building set
  const removedSet = new Set(
    (scenario.removePlatform ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean)
  );
  strategy.platforms = strategy.platforms.filter((p) => !removedSet.has(p.toLowerCase()));
  for (const p of Object.keys(strategy.posting_frequency)) {
    if (removedSet.has(p.toLowerCase())) delete strategy.posting_frequency[p];
  }

  // Guard: always keep at least one platform to prevent empty-platform validation crash
  if (strategy.platforms.length === 0 && base.platforms.length > 0) {
    console.warn('[PLANNER][SIMULATOR][WARN] removePlatform would have emptied all platforms — keeping original set');
    strategy.platforms = [...base.platforms];
    strategy.posting_frequency = clone(base.posting_frequency);
  }

  // C. Add platforms (skip duplicates, skip empty strings)
  const existingLower = new Set(strategy.platforms.map((p) => p.toLowerCase()));
  for (const p of (scenario.addPlatform ?? []).filter(Boolean)) {
    if (!existingLower.has(p.toLowerCase())) {
      strategy.platforms.push(p);
      // Apply multiplier to the default frequency for newly added platform
      strategy.posting_frequency[p] = Math.max(1, Math.round(DEFAULT_FREQ_PER_NEW_PLATFORM * multiplier));
      existingLower.add(p.toLowerCase());
    }
  }

  // D. Content mix override → build execution_items
  let execution_items: CampaignValidationInput['execution_items'] = null;
  if (scenario.contentMixOverride && scenario.contentMixOverride.length > 0) {
    execution_items = [];
    for (const override of scenario.contentMixOverride) {
      const freqForPlatform = strategy.posting_frequency[override.platform] ?? DEFAULT_FREQ_PER_NEW_PLATFORM;
      const perType = Math.max(1, Math.round(freqForPlatform / Math.max(1, override.contentTypes.length)));
      for (const ct of override.contentTypes) {
        execution_items!.push({
          content_type: ct,
          count_per_week: perType,
          selected_platforms: [override.platform],
        });
      }
    }
  }

  return { strategy, execution_items };
}

// ---------------------------------------------------------------------------
// Delta engine
// ---------------------------------------------------------------------------

function buildDelta(
  base: CampaignValidation,
  simulated: CampaignValidation,
  scenario: ScenarioInput,
  basePaid: PaidRecommendation,
  simPaid: PaidRecommendation
): ScenarioDelta {
  const confidenceChange = simulated.confidenceScore - base.confidenceScore;
  const riskChange =
    base.riskLevel === simulated.riskLevel
      ? 'unchanged'
      : `${base.riskLevel} → ${simulated.riskLevel}`;

  const impactChange: string[] = [];

  // Confidence delta bullet
  if (confidenceChange > 0) {
    impactChange.push(`+${confidenceChange} confidence points — plan quality improved.`);
  } else if (confidenceChange < 0) {
    impactChange.push(`${confidenceChange} confidence points — plan quality declined.`);
  }

  // Risk bullet
  if (base.riskLevel !== simulated.riskLevel) {
    const direction = simulated.riskLevel === 'LOW' ? 'Risk reduced' : 'Risk increased';
    impactChange.push(`${direction}: ${base.riskLevel} → ${simulated.riskLevel}.`);
  }

  // Frequency bullet
  if ((scenario.frequencyMultiplier ?? 1) !== 1) {
    const pct = Math.round(((scenario.frequencyMultiplier ?? 1) - 1) * 100);
    const direction = pct > 0 ? `+${pct}%` : `${pct}%`;
    impactChange.push(`Posting frequency changed by ${direction} across all platforms.`);
  }

  // Platform bullets
  for (const p of scenario.addPlatform ?? []) {
    impactChange.push(`Added platform: ${p} — increases distribution but adds execution load.`);
  }
  for (const p of scenario.removePlatform ?? []) {
    impactChange.push(`Removed platform: ${p} — reduces reach, simplifies execution.`);
  }

  // Content mix bullet
  if (scenario.contentMixOverride && scenario.contentMixOverride.length > 0) {
    impactChange.push('Content type mix updated — diversity score recalculated.');
  }

  // Ads toggle bullet
  if (scenario.enableAds === true && basePaid.overallRecommendation === 'NOT_NEEDED') {
    impactChange.push('Ads toggled ON — paid amplification re-evaluated.');
  }
  if (scenario.enableAds === false && basePaid.overallRecommendation !== 'NOT_NEEDED') {
    impactChange.push('Ads toggled OFF — paid reach removed from expected outcomes.');
  }

  // Paid recommendation change
  if (basePaid.overallRecommendation !== simPaid.overallRecommendation) {
    impactChange.push(
      `Paid recommendation: ${basePaid.overallRecommendation} → ${simPaid.overallRecommendation}.`
    );
  }

  // Reach estimate change
  if (base.expectedOutcome.reachEstimate !== simulated.expectedOutcome.reachEstimate) {
    impactChange.push(
      `Expected reach: "${base.expectedOutcome.reachEstimate}" → "${simulated.expectedOutcome.reachEstimate}".`
    );
  }

  if (impactChange.length === 0) {
    impactChange.push('No meaningful change detected — scenario is equivalent to the current plan.');
  }

  return { confidenceChange, riskChange, impactChange };
}

// ---------------------------------------------------------------------------
// Force NOT_NEEDED paid recommendation
// ---------------------------------------------------------------------------

function forceNotNeeded(base: PaidRecommendation): PaidRecommendation {
  return {
    ...base,
    overallRecommendation: 'NOT_NEEDED',
    reasoning: ['Ads have been manually disabled for this scenario.'],
    adPlan: null,
    expectedImpact: {
      reachLift: 'No paid lift — organic only',
      engagementLift: 'Baseline organic performance',
      leadLift: 'Not applicable',
    },
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function simulateScenario(input: SimulateScenarioInput): ScenarioOutput {
  // Guard: malformed input — return unchanged base values so the UI stays usable
  if (!input || !input.base_plan || !Array.isArray(input.base_plan.weeks) || !input.base_validation || !input.base_paid_recommendation) {
    console.warn('[PLANNER][SIMULATOR][WARN] simulateScenario received null or malformed input — returning base values unchanged');
    const fallbackValidation = input?.base_validation ?? { confidenceScore: 50, riskLevel: 'MEDIUM' as const, expectedOutcome: { reachEstimate: 'Unknown', engagementEstimate: 'Unknown', leadsEstimate: 'Unknown' }, issues: [], suggestions: [], scoreBreakdown: { frequency: 10, platformMix: 10, contentDiversity: 10, funnelCoverage: 10, consistency: 10 } };
    const fallbackPaid = input?.base_paid_recommendation ?? { overallRecommendation: 'NOT_NEEDED' as const, reasoning: [], triggers: [], adPlan: null, expectedImpact: { reachLift: 'Unknown', engagementLift: 'Unknown', leadLift: 'Unknown' } };
    return { updatedValidation: fallbackValidation, updatedPaidRecommendation: fallbackPaid, delta: { confidenceChange: 0, riskChange: 'unchanged', impactChange: ['Simulation could not run — input data incomplete.'] } };
  }

  const { base_plan, base_validation, base_paid_recommendation, account_context, strategy_context, scenario } = input;

  // 1. Transform strategy context
  const { strategy: simStrategy, execution_items: simItems } = applyScenario(strategy_context, scenario);

  // 2. Re-run validation
  const updatedValidation = validateCampaignPlan({
    plan: base_plan,
    strategy_context: simStrategy,
    account_context: account_context ?? null,
    execution_items: simItems,
  });

  // 3. Re-run paid recommendation
  let updatedPaidRecommendation: PaidRecommendation;
  if (scenario.enableAds === false) {
    updatedPaidRecommendation = forceNotNeeded(base_paid_recommendation);
  } else {
    const paidInput: PaidAmplificationInput = {
      plan: base_plan,
      campaign_validation: updatedValidation,
      account_context: account_context ?? null,
      strategy_context: {
        duration_weeks: simStrategy.duration_weeks,
        platforms: simStrategy.platforms,
        posting_frequency: simStrategy.posting_frequency,
        campaign_goal: simStrategy.campaign_goal ?? null,
      },
    };
    updatedPaidRecommendation = generatePaidRecommendation(paidInput);
  }

  // 4. Compute delta
  const delta = buildDelta(base_validation, updatedValidation, scenario, base_paid_recommendation, updatedPaidRecommendation);

  return { updatedValidation, updatedPaidRecommendation, delta };
}
