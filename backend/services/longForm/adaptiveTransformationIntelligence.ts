/**
 * Phase 12.4 — Adaptive transformation intelligence.
 *
 * Walks the feedback registry for transformation-relevant events and
 * produces an `AdaptiveTransformationProfile` that callers fold into:
 *   - transformationIntelligenceEngine.assessTransformation
 *     (via `compatibilityWeightMultiplier` and `retentionThresholdShift`)
 *   - crossModalContinuityGovernor (via `oversimplificationSensitivityDelta`)
 *   - narrativeTransformationAnalyzer (via `decompositionAggressivenessDelta`)
 *
 * Pure / deterministic. Confidence-scaled by sample size like the existing
 * adaptive learning layer.
 */

import type {
  AdaptiveTransformationProfile,
  FeedbackEvent,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tagsByPrefix(event: FeedbackEvent, prefix: string): string[] {
  return (event.tags ?? [])
    .filter((t) => t.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((t) => t.slice(prefix.length).trim().toLowerCase())
    .filter(Boolean);
}

export interface AdaptTransformationIntelligenceInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  windowSinceISO?: string;
}

export function adaptTransformationIntelligence(input: AdaptTransformationIntelligenceInput): AdaptiveTransformationProfile {
  const events = input.registry.list(input.companyId, { sinceISO: input.windowSinceISO });
  const total = events.length;
  const rationale: string[] = [];

  // Confidence scaling — same brackets as the adaptive learning layer.
  const confidenceFactor = total < 10 ? 0.25
    : total < 30 ? 0.5
    : total < 60 ? 0.75
    : 1.0;

  // ── Per-axis counters ─────────────────────────────────────────────────
  let transformAccept = 0;
  let transformReject = 0;
  let cannibRecurrence = 0;
  let oversimplificationFlag = 0;       // tag "edit_risk:oversimplification"
  let authorityLossFlag = 0;             // tag "edit_risk:authority_loss"
  let fatigueFlag = 0;                   // tag "edit_risk:transformation_fatigue"
  let decompositionAccept = 0;           // tag "transformation_type:decomposition" on accepts
  let decompositionReject = 0;
  let retentionLowFlag = 0;              // scoreContext.narrativeRetention < 50

  for (const e of events) {
    const editRisks = tagsByPrefix(e, 'edit_risk:');
    const tType = tagsByPrefix(e, 'transformation_type:')[0];

    switch (e.eventType) {
      case 'recommendation_accepted':
      case 'planner_approved':
        transformAccept += 1;
        if (tType === 'decomposition' || tType === 'extraction') decompositionAccept += 1;
        break;
      case 'recommendation_rejected':
      case 'planner_rejected':
        transformReject += 1;
        if (tType === 'decomposition' || tType === 'extraction') decompositionReject += 1;
        break;
      case 'cannibalization_recurrence':
        cannibRecurrence += 1;
        break;
      case 'human_edit_pattern':
      case 'factual_correction':
        if (editRisks.includes('oversimplification')) oversimplificationFlag += 1;
        if (editRisks.includes('authority_loss')) authorityLossFlag += 1;
        if (editRisks.includes('transformation_fatigue')) fatigueFlag += 1;
        break;
      default:
        break;
    }

    const ctx = e.scoreContext ?? {};
    if (typeof ctx.narrativeRetention === 'number' && ctx.narrativeRetention < 50) retentionLowFlag += 1;
  }

  // ── 1. compatibilityWeightMultiplier (0.6..1.4) ───────────────────────
  // Many accepts vs rejects → trust base compat more (mult > 1).
  // Many rejects → trust base compat less (mult < 1).
  let cwm = 1.0;
  const acceptDenom = transformAccept + transformReject;
  if (acceptDenom > 0) {
    const acceptRate = transformAccept / acceptDenom;
    if (acceptRate >= 0.7) { cwm += 0.2 * confidenceFactor; rationale.push(`Accept rate ${Math.round(acceptRate * 100)}% — trusting base compatibility more.`); }
    else if (acceptRate <= 0.3) { cwm -= 0.2 * confidenceFactor; rationale.push(`Accept rate ${Math.round(acceptRate * 100)}% — distrust base compatibility, weighting it lower.`); }
  }
  if (fatigueFlag >= 3) { cwm -= 0.1 * confidenceFactor; rationale.push(`Fatigue flagged ${fatigueFlag} times — softening base compatibility weighting.`); }
  cwm = clamp(cwm, 0.6, 1.4);

  // ── 2. retentionThresholdShift (-15..+15) ─────────────────────────────
  // Many low-retention events → shift threshold UP (tighter — flag earlier).
  let rts = 0;
  if (retentionLowFlag >= 3) { rts += Math.round(8 * confidenceFactor); rationale.push(`${retentionLowFlag} low-retention events — tightening retention thresholds (+${rts}).`); }
  if (authorityLossFlag >= 3) { rts += Math.round(6 * confidenceFactor); rationale.push(`${authorityLossFlag} authority-loss events — tightening retention threshold further.`); }
  if (transformAccept >= 20 && retentionLowFlag === 0) { rts -= Math.round(4 * confidenceFactor); rationale.push('Healthy acceptance with no retention issues — relaxing retention threshold.'); }
  rts = clamp(rts, -15, 15);

  // ── 3. oversimplificationSensitivityDelta (-20..+20) ──────────────────
  let osd = 0;
  if (oversimplificationFlag >= 3) { osd += Math.round(12 * confidenceFactor); rationale.push(`${oversimplificationFlag} oversimplification events — increasing sensitivity.`); }
  if (authorityLossFlag >= 3) { osd += Math.round(6 * confidenceFactor); rationale.push('Authority loss events also increase oversimplification sensitivity.'); }
  if (osd === 0 && transformAccept >= 20 && oversimplificationFlag === 0) { osd -= Math.round(4 * confidenceFactor); rationale.push('No oversimplification issues observed — slightly lowering sensitivity.'); }
  osd = clamp(osd, -20, 20);

  // ── 4. decompositionAggressivenessDelta (-20..+20) ────────────────────
  let dad = 0;
  if (cannibRecurrence >= 3) { dad -= Math.round(10 * confidenceFactor); rationale.push(`${cannibRecurrence} cannibalization recurrences — backing off decomposition.`); }
  if (fatigueFlag >= 3) { dad -= Math.round(6 * confidenceFactor); rationale.push(`${fatigueFlag} fatigue flags — backing off decomposition further.`); }
  if (decompositionAccept >= 5 && decompositionReject <= 1) { dad += Math.round(8 * confidenceFactor); rationale.push(`Decomposition transformations consistently accepted (${decompositionAccept}) — leaning in.`); }
  dad = clamp(dad, -20, 20);

  // ── confidence score ──────────────────────────────────────────────────
  // High when sample is large AND signals are consistent.
  const signalCount = [transformAccept, transformReject, oversimplificationFlag, authorityLossFlag, fatigueFlag, cannibRecurrence]
    .filter((c) => c > 0).length;
  const adaptiveTransformationConfidence = Math.round(
    Math.min(100, confidenceFactor * 60 + signalCount * 5 + Math.min(15, rationale.length * 3)),
  );

  return {
    compatibilityWeightMultiplier: cwm,
    retentionThresholdShift: rts,
    oversimplificationSensitivityDelta: osd,
    decompositionAggressivenessDelta: dad,
    adaptiveTransformationConfidence,
    rationaleNotes: rationale,
  };
}
