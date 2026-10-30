/**
 * ENGAGEMENT → NEW PROSPECT qualification rule (owner decision 3, 2026-10-30).
 *
 * Engagement evidence may always ENRICH a prospect that already exists (a
 * `contributing` contribution). Creating a NEW canonical prospect — or a new
 * Lead Intelligence lead — from an engagement signal additionally requires this
 * explicit predicate. Nothing else in the bridge or the adoption path may create
 * a prospect from engagement.
 *
 * ─── THE RULE ─────────────────────────────────────────────────────────────
 *   qualified  ⇔  lead_signals.intent_score is a number in the unit range [0, 1]
 *                 AND intent_score ≥ 0.7
 *                 AND metadata.risk_flag is not true
 *
 * ─── WHERE THE NUMBERS COME FROM (existing code, not invented) ───────────
 * - 0.7 is the product's existing HIGH-intent band boundary, used by the Lead
 *   Intelligence read model to label a lead "Reach out now — high buying
 *   intent" and to count it as high intent:
 *     lib/leadIntelligence/recommendations.ts:18   (intent >= 0.7 ⇒ reach out now)
 *     lib/leadIntelligence/recommendations.ts:30   (intentBand high ≥ 0.7, medium ≥ 0.4)
 *     lib/leadIntelligence/stats.ts:53             (intentBands.high ≥ 0.7)
 *     lib/leadIntelligence/buyingIntent.ts:215     (high_intent_score ≥ 0.7)
 *   The literal is restated here because none of those files exports it (they
 *   are owned by another workstream); `engagementQualification.test` pins the
 *   value against those sources so the two cannot drift silently.
 * - The risk exclusion is the existing Active Leads qualifier's
 *   (`leadJobProcessor.ts`: `qualified = total_score >= QUALIFIED_THRESHOLD && !risk_flag`).
 *   Its 0.6 threshold was NOT adopted: every engagement pattern in
 *   `leadDetectionService.LEAD_PATTERNS` scores ≥ 60, so 0.6 would admit every
 *   detected engagement and would not be a qualification at all.
 * - `intent_score` is the column both engagement writers set
 *   (`leadDetectionService` and `communitySignalService`: `lead_score / 100`),
 *   declared `unit` in `lib/leadIntelligence/adapters.ts` SOURCE_SCORE_SCALES.
 *   A value outside [0, 1] is NOT rescaled (scales are never guessed — provenance
 *   contract "Scores"); it simply does not qualify.
 *
 * With today's `LEAD_PATTERNS` this admits demo (90), pricing (85), tool search
 * (80), trial (80), usage (75), solution exploration (70) and implementation
 * (70) intents, before sentiment / intent adjustments; it refuses interest (65),
 * comparison (65), connection (60) and competitor mentions (60).
 *
 * PURE. No I/O.
 */

export const ENGAGEMENT_QUALIFICATION_RULE = 'engagement.high_intent.v1';
/** HIGH-intent band boundary (unit scale). See header for the sources. */
export const ENGAGEMENT_NEW_PROSPECT_MIN_INTENT = 0.7;

export interface EngagementQualification {
  qualified: boolean;
  rule: typeof ENGAGEMENT_QUALIFICATION_RULE;
  /** Stable, loggable. */
  reason: 'high_intent' | 'below_high_intent' | 'no_intent_score' | 'intent_score_out_of_unit_range' | 'risk_flagged';
  intentScore: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Decide whether an engagement `lead_signals` row may CREATE a new prospect. */
export function qualifyEngagementForNewProspect(signal: Record<string, unknown>): EngagementQualification {
  const intent = num(signal?.intent_score);
  const out = (qualified: boolean, reason: EngagementQualification['reason']): EngagementQualification =>
    ({ qualified, rule: ENGAGEMENT_QUALIFICATION_RULE, reason, intentScore: intent });
  const meta = signal?.metadata && typeof signal.metadata === 'object' && !Array.isArray(signal.metadata)
    ? (signal.metadata as Record<string, unknown>) : {};
  if (meta.risk_flag === true) return out(false, 'risk_flagged');
  if (intent === null) return out(false, 'no_intent_score');
  if (intent < 0 || intent > 1) return out(false, 'intent_score_out_of_unit_range');
  return intent >= ENGAGEMENT_NEW_PROSPECT_MIN_INTENT ? out(true, 'high_intent') : out(false, 'below_high_intent');
}
