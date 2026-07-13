/**
 * POST /api/recommendations/long-form/handoff
 *
 * Phase 1 — Recommendation handoff orchestration.
 *
 * Flow:
 *   Recommendation
 *     → applyRecommendationToPlanningInput
 *     → validateGenerationContinuity
 *     → analyzeSemanticContinuity
 *     → evaluatePlannerInheritanceContract
 *     → lifecycle.transition(handed_off → planner_validated|planner_drifted)
 *     → return planner-ready payload + diagnostics
 *
 * Does NOT trigger generation. The planner kick-off is a separate concern.
 *
 * Request:
 *   {
 *     companyId: string,
 *     recommendationId?: string,            // looked up in lifecycle registry
 *     recommendation?: LongFormRecommendation, // inline alternative
 *     foundation?: CompanyContextFoundation,    // optional re-attach
 *     overrides?: { topic, intent, formatType, tone, seoContext, targetWordCount },
 *     strictness?: 'warn' | 'strict' | 'regenerate',
 *     inheritanceThreshold?: number,        // default 70
 *   }
 *
 * Response:
 *   {
 *     plannerReadyPayload: PlanningInputPartial,
 *     continuityValidation,
 *     semanticContinuity,
 *     inheritance,
 *     lineageMetadata,
 *     inheritanceSummary,
 *     recommendedAction: 'accept' | 'regenerate' | 'reject',
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { buildCompanyContextFoundation } from '../../../../backend/services/longForm/companyContextFoundation';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  applyRecommendationToPlanningInput,
} from '../../../../backend/services/longForm/longFormPlanningAdapter';
import { validateGenerationContinuity } from '../../../../backend/services/longForm/generationContinuityValidator';
import { analyzeSemanticContinuity } from '../../../../backend/services/longForm/semanticContinuityAnalyzer';
import { evaluatePlannerInheritanceContract } from '../../../../backend/services/longForm/plannerInheritanceContract';
import {
  getDefaultRecommendationLifecycleRegistry,
  InvalidLifecycleTransitionError,
} from '../../../../backend/services/longForm/recommendationLifecycle';
import { rescoreWithContinuity } from '../../../../backend/services/longForm/recommendationConfidenceModel';
import type {
  ContinuityValidatorStrictness,
  LongFormRecommendation,
} from '../../../../backend/services/longForm/longFormRecommendationTypes';

interface HandoffBody {
  companyId?: string;
  recommendationId?: string;
  recommendation?: LongFormRecommendation;
  overrides?: {
    topic?: string;
    intent?: string;
    formatType?: string;
    tone?: string;
    seoContext?: string;
    targetWordCount?: number;
  };
  strictness?: ContinuityValidatorStrictness;
  inheritanceThreshold?: number;
}

function asStrictness(value: unknown): ContinuityValidatorStrictness {
  return value === 'strict' || value === 'regenerate' ? value : 'warn';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as HandoffBody;

  if (typeof body.companyId !== 'string' || body.companyId.trim().length === 0) {
    return res.status(400).json({ error: 'companyId is required' });
  }
  if (!body.recommendationId && !body.recommendation) {
    return res.status(400).json({ error: 'recommendationId or recommendation is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: body.companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    const registry = getDefaultRecommendationLifecycleRegistry();

    // 1. Resolve the recommendation. Registry lookup wins; inline body falls back.
    let recommendation: LongFormRecommendation | null = null;
    let foundationSignature: string | null = null;
    if (body.recommendationId) {
      const entry = registry.get(body.recommendationId);
      if (entry) {
        recommendation = entry.recommendation;
        foundationSignature = entry.metadata.foundationSignature;
      }
    }
    if (!recommendation && body.recommendation) {
      recommendation = body.recommendation;
    }
    if (!recommendation) {
      return res.status(404).json({
        error: 'RECOMMENDATION_NOT_FOUND',
        detail: 'recommendationId not in lifecycle registry (expired or never registered) and no inline recommendation provided.',
      });
    }
    if (recommendation.recommendationId !== body.recommendationId && body.recommendationId) {
      // Inline body wins but tag mismatch.
      console.warn('LONG_FORM_HANDOFF_ID_MISMATCH', {
        body: body.recommendationId,
        inline: recommendation.recommendationId,
      });
    }

    // 2. Build foundation — re-derive from profile so the planning adapter has
    // the same view the engine used. Re-derivation is cheap.
    const profile = await getProfile(body.companyId, { autoRefine: false });
    const foundation = buildCompanyContextFoundation(profile);

    if (foundationSignature && foundationSignature !== foundation.signature) {
      // Foundation drifted since recommendation was generated. Surface it but proceed.
      console.warn('LONG_FORM_HANDOFF_FOUNDATION_DRIFT', {
        companyId: body.companyId,
        recommendationId: recommendation.recommendationId,
        previous: foundationSignature,
        current: foundation.signature,
      });
    }

    // 3. Apply the planning adapter with the live foundation.
    const plannerReadyPayload = applyRecommendationToPlanningInput(recommendation, {
      foundation,
      topic: body.overrides?.topic,
      intent: body.overrides?.intent,
      formatType: body.overrides?.formatType,
      tone: body.overrides?.tone,
      seoContext: body.overrides?.seoContext,
      targetWordCount: body.overrides?.targetWordCount,
    });

    // 4. Run the three validation layers.
    const strictness = asStrictness(body.strictness);
    const continuityValidation = validateGenerationContinuity({
      recommendation,
      planningInput: plannerReadyPayload,
      editorialContext: plannerReadyPayload.editorialContext,
      strictness,
    });
    const semanticContinuity = analyzeSemanticContinuity({
      recommendation,
      planningInput: plannerReadyPayload,
      editorialContext: plannerReadyPayload.editorialContext,
    });
    const inheritance = evaluatePlannerInheritanceContract({
      recommendation,
      planningInput: plannerReadyPayload,
      editorialContext: plannerReadyPayload.editorialContext,
      passingThreshold: body.inheritanceThreshold ?? 70,
    });

    // 5. Update lifecycle if the recommendation is in the registry.
    let lineageMetadata = null;
    if (body.recommendationId && registry.get(body.recommendationId)) {
      try {
        lineageMetadata = registry.transition(body.recommendationId, 'handed_off');
        const passed = continuityValidation.passed && semanticContinuity.semanticContinuityScore >= 55 && inheritance.passed;
        lineageMetadata = registry.transition(
          body.recommendationId,
          passed ? 'planner_validated' : 'planner_drifted',
          `continuity=${continuityValidation.continuityScore} semantic=${semanticContinuity.semanticContinuityScore} inheritance=${inheritance.inheritanceCompletenessScore}`,
        );
        lineageMetadata = registry.recordHandoffOutcome(body.recommendationId, {
          continuity: continuityValidation,
          semantic: semanticContinuity,
          inheritance,
        });
      } catch (err) {
        if (err instanceof InvalidLifecycleTransitionError) {
          console.warn('LONG_FORM_HANDOFF_INVALID_TRANSITION', {
            recommendationId: body.recommendationId,
            from: err.from,
            to: err.to,
          });
        } else {
          throw err;
        }
      }
    }

    // 6. Re-score confidence with the actual continuity stability we just measured.
    const continuityStability = Math.round(
      (continuityValidation.continuityScore + semanticContinuity.semanticContinuityScore + inheritance.inheritanceCompletenessScore) / 3,
    );
    const updatedConfidence = recommendation.confidence
      ? rescoreWithContinuity(recommendation.confidence, continuityStability)
      : null;

    // 7. Compose the inheritance summary for the client.
    const inheritanceSummary = {
      inheritanceCompletenessScore: inheritance.inheritanceCompletenessScore,
      passed: inheritance.passed,
      breaches: inheritance.breaches,
      elementScores: Object.fromEntries(
        Object.entries(inheritance.elementStatus).map(([k, v]) => [k, v.score]),
      ),
    };

    // 8. Decide the recommended downstream action.
    const recommendedAction: 'accept' | 'regenerate' | 'reject' = (() => {
      if (!inheritance.passed) {
        return strictness === 'strict' ? 'reject' : strictness === 'regenerate' ? 'regenerate' : 'accept';
      }
      if (!continuityValidation.passed) return continuityValidation.recommendedAction;
      if (semanticContinuity.driftDetections.some((d) => d.severity === 'high')) {
        return strictness === 'strict' ? 'reject' : 'regenerate';
      }
      return 'accept';
    })();

    return res.status(200).json({
      plannerReadyPayload,
      continuityValidation,
      semanticContinuity,
      inheritance,
      inheritanceSummary,
      lineageMetadata,
      updatedConfidence,
      continuityStability,
      recommendedAction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('LONG_FORM_HANDOFF_FAILED', { companyId: body.companyId, error: message });
    return res.status(500).json({ error: 'LONG_FORM_HANDOFF_FAILED', detail: message });
  }
}
