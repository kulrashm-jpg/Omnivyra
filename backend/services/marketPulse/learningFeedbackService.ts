/**
 * Market Pulse — Learning Feedback Service.
 *
 * Phase 2: bridges Market Pulse user actions into the existing
 * intelligence-recommendation lifecycle so the
 * `signalWeightOptimizationEngine` (which reads `intelligence_outcomes` +
 * `recommendation_feedback`) starts seeing real Market Pulse engagement
 * and adjusts weights accordingly.
 *
 * Two surfaces:
 *
 *   1. recordFindingShown(finding) — called when a finding card mounts in
 *      the feed. Inserts (or no-ops on duplicate) into
 *      `intelligence_recommendations` via the existing
 *      `intelligenceRecommendationService.recordRecommendationShown`.
 *      The shown row's id is then persisted on the finding via the
 *      `recommendation_shown_id` column added by migration 20260635.
 *
 *   2. recordActionAsFeedback(finding, action, userId?) — translates
 *      Market Pulse actions to the existing recommendation outcome
 *      vocabulary and writes both:
 *        - intelligence_recommendations.{accepted_at|rejected_at}
 *          via `recordRecommendationOutcome`
 *        - recommendation_feedback (feedback_type) via
 *          `recordFeedback` (which `signalWeightOptimizationEngine` reads)
 *
 *      Action mapping:
 *        promote   → accepted   (committed to act)
 *        escalate  → accepted   (engagement signal)
 *        resolve   → executed   (work completed)
 *        share     → accepted   (social signal)
 *        reopen    → ignored    (user changed mind)
 *        snooze    → no outcome (deferred — neither accepted nor rejected)
 *        feedback  → no outcome (audit-only)
 *
 *   Both surfaces are non-blocking — feedback failures cannot prevent the
 *   finding-action endpoint from succeeding.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { recordRecommendationOutcome, recordRecommendationShown } from '../intelligence/intelligenceRecommendationService';
import { recordFeedback, type FeedbackType } from '../recommendationFeedbackEngine';

const RECOMMENDATION_PATTERN_TYPE = 'market_pulse_finding';

export interface FindingShownInput {
  finding_id: string;
  company_id: string;
  category: string;
  priority_tier: 'P0' | 'P1' | 'P2' | null;
  confidence_score: number | null;
  alert_class?: string | null;
}

export interface FindingShownResult {
  shown_id: string;
  recorded: boolean;
}

/**
 * Record a "shown" event for a Market Pulse finding. Idempotent per UTC day
 * via `intelligenceRecommendationService.recordRecommendationShown` —
 * showing the same finding twice on the same day collapses to one row.
 *
 * Persists the deterministic shown_id back onto the finding so subsequent
 * outcome calls can find the right row without recomputing the hash.
 */
export async function recordFindingShown(input: FindingShownInput): Promise<FindingShownResult> {
  const result = await recordRecommendationShown({
    organization_id: input.company_id,
    platform: null,
    action_type: 'market_pulse_review',
    pattern_type: RECOMMENDATION_PATTERN_TYPE,
    label: input.alert_class ?? input.category,
    confidence_score: typeof input.confidence_score === 'number' ? Math.round(input.confidence_score) : null,
    target_id: input.finding_id,
    metadata: {
      category: input.category,
      priority_tier: input.priority_tier,
      origin: 'market_pulse',
    },
  });

  // Best-effort: persist the shown_id on the finding. If the finding row was
  // deleted between insert and now, the no-op is harmless.
  if (result.recorded) {
    try {
      await ownedDbTable('market_pulse_findings')
        .update({ recommendation_shown_id: result.shown_id })
        .eq('id', input.finding_id)
        .eq('company_id', input.company_id);
    } catch {
      /* non-blocking */
    }
  }

  return result;
}

export type MarketPulseFindingAction =
  | 'resolve'
  | 'reopen'
  | 'snooze'
  | 'unsnooze'
  | 'escalate'
  | 'promote'
  | 'share'
  | 'feedback';

const ACTION_TO_OUTCOME: Partial<Record<MarketPulseFindingAction, 'accepted' | 'rejected'>> = {
  promote: 'accepted',
  escalate: 'accepted',
  resolve: 'accepted',
  share: 'accepted',
  reopen: 'rejected',
  // snooze, unsnooze, feedback intentionally omitted — no outcome flip.
};

const ACTION_TO_FEEDBACK_TYPE: Partial<Record<MarketPulseFindingAction, FeedbackType>> = {
  promote: 'accepted',
  escalate: 'accepted',
  resolve: 'executed',
  share: 'accepted',
  reopen: 'ignored',
  // snooze and unsnooze deliberately produce no feedback row — the user
  // is deferring, not signalling quality.
};

export interface FindingActionFeedbackInput {
  finding_id: string;
  company_id: string;
  action: MarketPulseFindingAction;
  user_id?: string | null;
  /** Pre-fetched recommendation_shown_id, if known (skips a DB roundtrip). */
  recommendation_shown_id?: string | null;
  /** Used as the recommendation_id when writing recommendation_feedback. */
  recommendation_row_id?: string | null;
}

export interface FindingActionFeedbackResult {
  outcome_recorded: boolean;
  feedback_recorded: boolean;
  outcome_error?: string;
  feedback_error?: string;
}

/**
 * Record a finding-action as both an intelligence_recommendations outcome AND
 * a recommendation_feedback row so the existing weight optimizer picks it up.
 *
 * Always returns a result object — failures bubble up via the *_error fields,
 * but never throw. The action endpoint's primary success (state mutation +
 * audit row insert) does not depend on this call.
 */
export async function recordActionAsFeedback(
  input: FindingActionFeedbackInput,
): Promise<FindingActionFeedbackResult> {
  const result: FindingActionFeedbackResult = {
    outcome_recorded: false,
    feedback_recorded: false,
  };

  const outcome = ACTION_TO_OUTCOME[input.action];
  const feedbackType = ACTION_TO_FEEDBACK_TYPE[input.action];

  if (!outcome && !feedbackType) {
    return result; // snooze / unsnooze / feedback — intentional no-op.
  }

  // ── 1. Flip the intelligence_recommendations row to accepted/rejected ──────
  if (outcome) {
    try {
      const out = await recordRecommendationOutcome({
        organization_id: input.company_id,
        pattern_type: RECOMMENDATION_PATTERN_TYPE,
        target_id: input.finding_id,
        outcome,
      });
      result.outcome_recorded = !!out.updated;
      if (!out.updated && out.error) result.outcome_error = out.error;
    } catch (err) {
      result.outcome_error = err instanceof Error ? err.message : String(err);
    }
  }

  // ── 2. Write recommendation_feedback so signalWeightOptimizationEngine sees it ─
  // recordFeedback requires recommendation_id (FK to intelligence_recommendations)
  // and user_id. If we don't have either, we skip — the weight optimizer
  // already has alternative inputs (intelligence_outcomes), and we don't
  // want to write malformed rows.
  if (feedbackType && input.user_id) {
    let recommendationId = input.recommendation_row_id ?? null;
    if (!recommendationId) {
      try {
        const { data } = await ownedDbTable('intelligence_recommendations')
          .select('id')
          .eq('organization_id', input.company_id)
          .eq('pattern_type', RECOMMENDATION_PATTERN_TYPE)
          .eq('target_id', input.finding_id)
          .order('shown_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        recommendationId = (data as { id?: string } | null)?.id ?? null;
      } catch {
        /* fall through with null */
      }
    }
    if (recommendationId) {
      try {
        const fb = await recordFeedback({
          company_id: input.company_id,
          recommendation_id: recommendationId,
          user_id: input.user_id,
          feedback_type: feedbackType,
        });
        result.feedback_recorded = !!fb.inserted;
        if (!fb.inserted && fb.throttle_hit) result.feedback_error = 'throttled';
      } catch (err) {
        result.feedback_error = err instanceof Error ? err.message : String(err);
      }
    } else {
      result.feedback_error = 'no recommendation row to attach feedback to';
    }
  }

  return result;
}

export const MARKET_PULSE_RECOMMENDATION_PATTERN_TYPE = RECOMMENDATION_PATTERN_TYPE;
