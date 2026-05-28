/**
 * Phase 5 — Adaptive portfolio intelligence engine.
 *
 * Looks at the feedback registry through a portfolio lens. Adjusts:
 *   sequencingPriorityAdjustments  — relative weight on the 5 sequencing targets
 *   gapSeverityAdjustments         — promote / demote labelled authority gaps
 *   saturationSensitivityDelta     — −10..+10 (positive = more sensitive)
 *   noveltyWeightingDelta          − −10..+10
 *
 * Heuristics:
 *   - adopted sequencing recommendations of type X → boost X weight
 *   - ignored sequencing of type X                → demote X weight
 *   - resolved authority gaps → demote those gap labels
 *   - cannibalization recurrence rising → +saturationSensitivity, +novelty weighting
 *   - editorial freshness improving → −novelty weighting (we have headroom)
 */

import type {
  AdaptivePortfolioAdjustments,
  PerformanceSignalAggregation,
  SequencingTarget,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

const SEQUENCING_TARGETS: SequencingTarget[] = [
  'authority_gap', 'funnel_balance', 'icp_expansion', 'narrative_evolution', 'capability_depth',
];

function extractTagsByPrefix(tags: string[] | undefined, prefix: string): string[] {
  if (!tags) return [];
  return tags
    .filter((t) => t.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((t) => t.slice(prefix.length).trim().toLowerCase())
    .filter(Boolean);
}

function clampDelta(v: number): number {
  return Math.max(-10, Math.min(10, Math.round(v)));
}

export interface AdaptPortfolioStrategyInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  signals: PerformanceSignalAggregation;
  /** Optional: gap labels that have been resolved (caller-supplied). */
  resolvedGapLabels?: string[];
  /** Optional: portfolio freshness trend ('improving' lets us loosen novelty pressure). */
  freshnessTrend?: 'improving' | 'stable' | 'degrading' | 'unknown';
}

export function adaptPortfolioStrategy(input: AdaptPortfolioStrategyInput): AdaptivePortfolioAdjustments {
  const events = input.registry.list(input.companyId);

  // 1. Sequencing target adoption tracking via tag conventions:
  //   "sequencing_target:authority_gap" etc.
  const adoptionByTarget = new Map<SequencingTarget, number>();
  const ignoreByTarget = new Map<SequencingTarget, number>();
  for (const t of SEQUENCING_TARGETS) { adoptionByTarget.set(t, 0); ignoreByTarget.set(t, 0); }
  for (const e of events) {
    const targets = extractTagsByPrefix(e.tags, 'sequencing_target:') as SequencingTarget[];
    if (e.eventType === 'strategic_sequencing_adopted') {
      for (const t of targets) adoptionByTarget.set(t, (adoptionByTarget.get(t) ?? 0) + 1);
    } else if (e.eventType === 'strategic_sequencing_ignored') {
      for (const t of targets) ignoreByTarget.set(t, (ignoreByTarget.get(t) ?? 0) + 1);
    }
  }

  const sequencingPriorityAdjustments: AdaptivePortfolioAdjustments['sequencingPriorityAdjustments'] = [];
  for (const t of SEQUENCING_TARGETS) {
    const adopted = adoptionByTarget.get(t) ?? 0;
    const ignored = ignoreByTarget.get(t) ?? 0;
    const total = adopted + ignored;
    if (total < 2) continue; // not enough signal
    const adoptionRate = adopted / total;
    const weightDelta = clampDelta(Math.round((adoptionRate - 0.5) * 8)); // -4..+4 range
    if (weightDelta === 0) continue;
    sequencingPriorityAdjustments.push({
      target: t,
      weightDelta,
      rationale: weightDelta > 0
        ? `Target "${t}" adoption rate ${Math.round(adoptionRate * 100)}% (${adopted}/${total}) — boost weighting.`
        : `Target "${t}" adoption rate ${Math.round(adoptionRate * 100)}% (${adopted}/${total}) — demote weighting.`,
    });
  }

  // 2. Gap severity adjustments — when a gap was the focus of multiple
  //    portfolio_recovery events and is now `resolvedGapLabels`, demote it.
  const gapMentions = new Map<string, number>();
  for (const e of events) {
    if (e.eventType !== 'portfolio_recovery') continue;
    for (const gap of extractTagsByPrefix(e.tags, 'authority_gap:')) {
      gapMentions.set(gap, (gapMentions.get(gap) ?? 0) + 1);
    }
  }
  const gapSeverityAdjustments: AdaptivePortfolioAdjustments['gapSeverityAdjustments'] = [];
  for (const [label, count] of gapMentions) {
    if ((input.resolvedGapLabels ?? []).includes(label)) {
      gapSeverityAdjustments.push({
        nodeLabel: label,
        newSeverity: 'low',
        rationale: `Gap "${label}" mentioned in ${count} portfolio recoveries and marked resolved — downgrade severity.`,
      });
    } else if (count >= 3) {
      gapSeverityAdjustments.push({
        nodeLabel: label,
        newSeverity: 'high',
        rationale: `Gap "${label}" has been the focus of ${count} portfolio recoveries — promote severity.`,
      });
    }
  }

  // 3. Saturation sensitivity.
  let saturationSensitivityDelta = 0;
  if (input.signals.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent >= 15) {
    saturationSensitivityDelta += 5;
  }
  if (input.signals.ecosystemEvolutionIndicators.portfolioSaturationTrend === 'degrading') {
    saturationSensitivityDelta += 4;
  } else if (input.signals.ecosystemEvolutionIndicators.portfolioSaturationTrend === 'improving') {
    saturationSensitivityDelta -= 3;
  }
  saturationSensitivityDelta = clampDelta(saturationSensitivityDelta);

  // 4. Novelty weighting.
  let noveltyWeightingDelta = 0;
  if (input.signals.strategicHealthIndicators.noveltyDecayTrend === 'degrading') noveltyWeightingDelta += 5;
  if (input.signals.strategicHealthIndicators.noveltyDecayTrend === 'improving') noveltyWeightingDelta -= 2;
  if (input.freshnessTrend === 'improving' && noveltyWeightingDelta > 0) noveltyWeightingDelta -= 2;
  noveltyWeightingDelta = clampDelta(noveltyWeightingDelta);

  const rationale = [
    sequencingPriorityAdjustments.length > 0 ? `${sequencingPriorityAdjustments.length} sequencing target(s) re-weighted.` : '',
    gapSeverityAdjustments.length > 0 ? `${gapSeverityAdjustments.length} gap severity adjustments.` : '',
    saturationSensitivityDelta !== 0 ? `Saturation sensitivity Δ${saturationSensitivityDelta >= 0 ? '+' : ''}${saturationSensitivityDelta}.` : '',
    noveltyWeightingDelta !== 0 ? `Novelty weighting Δ${noveltyWeightingDelta >= 0 ? '+' : ''}${noveltyWeightingDelta}.` : '',
  ].filter(Boolean).join(' ');

  return {
    sequencingPriorityAdjustments,
    gapSeverityAdjustments,
    saturationSensitivityDelta,
    noveltyWeightingDelta,
    rationale: rationale || 'No adjustments — insufficient signal.',
  };
}
