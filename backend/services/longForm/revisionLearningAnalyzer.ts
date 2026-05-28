/**
 * Phase 6 — Revision learning analyzer.
 *
 * Walks revision-related feedback events and surfaces:
 *   highRiskEditPatterns                — patterns appearing across many revisions
 *   reviewerSpecificGovernancePressure  — per-reviewer concern profile
 *   recurringIntegrityWeaknesses        — dimensions that degrade repeatedly
 *
 * Reads the registry. No LLM.
 */

import type {
  EditPattern,
  FeedbackEvent,
  RevisionLearningOutputs,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

function tagsWithPrefix(tags: string[] | undefined, prefix: string): string[] {
  if (!tags) return [];
  return tags
    .filter((t) => t.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((t) => t.slice(prefix.length).trim().toLowerCase())
    .filter(Boolean);
}

export interface LearnFromRevisionsInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  windowSinceISO?: string;
}

export function learnFromRevisions(input: LearnFromRevisionsInput): RevisionLearningOutputs {
  const events = input.registry.list(input.companyId, { sinceISO: input.windowSinceISO });

  // 1. High-risk edit patterns. We honor tag conventions:
  //   "edit_risk:terminology_removal"
  //   "edit_risk:factual_degradation"
  //   "edit_risk:tone_mutation"
  const editPatternCounts = new Map<EditPattern, number>();
  let humanEditTotal = 0;
  let factualCorrectionTotal = 0;
  let reviewerSpecificFriction = 0;

  for (const e of events) {
    if (e.eventType === 'human_edit_pattern') humanEditTotal += 1;
    if (e.eventType === 'factual_correction') factualCorrectionTotal += 1;

    const risks = tagsWithPrefix(e.tags, 'edit_risk:');
    if (risks.includes('terminology_removal')) {
      editPatternCounts.set('frequent_term_removal', (editPatternCounts.get('frequent_term_removal') ?? 0) + 1);
    }
    if (risks.includes('tone_mutation') || risks.includes('certainty_softening')) {
      editPatternCounts.set('frequent_certainty_softening', (editPatternCounts.get('frequent_certainty_softening') ?? 0) + 1);
    }
    if (risks.includes('factual_degradation') || risks.includes('unsupported_addition')) {
      editPatternCounts.set('recurring_factual_corrections', (editPatternCounts.get('recurring_factual_corrections') ?? 0) + 1);
    }
  }

  // Reviewer-specific friction: ≥ 3 events sharing the same reviewerId across revisions counts.
  const reviewerEvents = new Map<string, FeedbackEvent[]>();
  for (const e of events) {
    if (!e.reviewerId) continue;
    const arr = reviewerEvents.get(e.reviewerId) ?? [];
    arr.push(e);
    reviewerEvents.set(e.reviewerId, arr);
  }
  for (const [, arr] of reviewerEvents) {
    if (arr.length >= 3) reviewerSpecificFriction += 1;
  }
  if (reviewerSpecificFriction >= 2) {
    editPatternCounts.set('reviewer_specific_friction', reviewerSpecificFriction);
  }

  const totalForPct = Math.max(1, humanEditTotal + factualCorrectionTotal);
  const highRiskEditPatterns: RevisionLearningOutputs['highRiskEditPatterns'] = [];
  for (const [pattern, count] of editPatternCounts) {
    if (count < 2) continue;
    highRiskEditPatterns.push({
      pattern,
      frequencyPercent: Math.round((count / totalForPct) * 100),
      detail: `${pattern} observed ${count} time(s) across ${totalForPct} revision events.`,
    });
  }
  highRiskEditPatterns.sort((a, b) => b.frequencyPercent - a.frequencyPercent);

  // 2. Reviewer-specific governance pressure.
  const reviewerSpecificGovernancePressure: RevisionLearningOutputs['reviewerSpecificGovernancePressure'] = [];
  for (const [reviewerId, arr] of reviewerEvents) {
    if (arr.length < 3) continue;
    const concerns = new Map<string, number>();
    for (const e of arr) {
      for (const tag of tagsWithPrefix(e.tags, 'edit_risk:')) {
        concerns.set(tag, (concerns.get(tag) ?? 0) + 1);
      }
    }
    const topConcerns = Array.from(concerns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    // pressure score = event count × concentration of top concerns.
    const pressureScore = Math.min(100, Math.round(
      Math.min(50, arr.length * 4)
      + Math.min(50, (topConcerns.length > 0 ? (concerns.get(topConcerns[0]) ?? 0) * 6 : 0)),
    ));
    reviewerSpecificGovernancePressure.push({
      reviewerId,
      pressureScore,
      topConcerns: topConcerns.length > 0 ? topConcerns : ['(no concern tags)'],
    });
  }
  reviewerSpecificGovernancePressure.sort((a, b) => b.pressureScore - a.pressureScore);

  // 3. Recurring integrity weaknesses — from scoreContext dimensions on factual_correction events.
  const dimensionCounts = new Map<string, number>();
  for (const e of events) {
    if (e.eventType !== 'factual_correction') continue;
    const ctx = e.scoreContext ?? {};
    for (const [k, v] of Object.entries(ctx)) {
      if (typeof v === 'number' && v < 50) {
        dimensionCounts.set(k, (dimensionCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const recurringIntegrityWeaknesses: RevisionLearningOutputs['recurringIntegrityWeaknesses'] = [];
  for (const [dimension, count] of dimensionCounts) {
    if (count < 2) continue;
    recurringIntegrityWeaknesses.push({
      dimension,
      degradationCount: count,
      recommendedFocus: `Strengthen ${dimension} during recommendation generation — it has degraded ${count} times.`,
    });
  }
  recurringIntegrityWeaknesses.sort((a, b) => b.degradationCount - a.degradationCount);

  return {
    highRiskEditPatterns,
    reviewerSpecificGovernancePressure,
    recurringIntegrityWeaknesses,
  };
}
