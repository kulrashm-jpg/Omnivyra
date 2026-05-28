/**
 * POST /api/recommendations/long-form/prepare-generation
 *
 * Orchestration layer — does NOT trigger generation. Takes a planner output
 * and decides whether it is safe to hand to the generation engine.
 *
 * Flow:
 *   1. Resolve recommendation (registry by id, or inline body).
 *   2. Build GenerationOrchestrationContract from recommendation + planner output.
 *   3. Run PlannerGenerationContinuityAnalyzer.
 *   4. Run GenerationReadinessValidator (10 dimensions).
 *   5. Run GenerationExecutionGate (strict / balanced / exploratory).
 *   6. If blocked: run GenerationRecoveryCoordinator.
 *   7. Compose explanation (single canonical source).
 *   8. Transition lifecycle (planner_ready → generation_validated | generation_blocked).
 *   9. Record diagnostics sample.
 *  10. Return full orchestration package.
 *
 * Request body:
 *   {
 *     companyId,
 *     recommendationId? | recommendation?,
 *     contentPlan,                       // required — planner output
 *     planningInput,                     // required — from handoff
 *     upstreamScores?: { continuityScore, semanticContinuityScore, icpEntityPreservation, inheritanceCompletenessScore },
 *     thresholdMode? = 'balanced',       // 'strict' | 'balanced' | 'exploratory'
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { buildGenerationOrchestrationContract } from '../../../../backend/services/longForm/generationOrchestrationContract';
import { analyzePlannerGenerationContinuity } from '../../../../backend/services/longForm/plannerGenerationContinuityAnalyzer';
import { assessGenerationReadiness } from '../../../../backend/services/longForm/generationReadinessValidator';
import { evaluateGenerationExecutionGate } from '../../../../backend/services/longForm/generationExecutionGate';
import { buildRecoveryPlan } from '../../../../backend/services/longForm/generationRecoveryCoordinator';
import { composeGenerationPreparationExplanation } from '../../../../backend/services/longForm/generationPreparationExplanationComposer';
import {
  getDefaultRecommendationLifecycleRegistry,
  InvalidLifecycleTransitionError,
} from '../../../../backend/services/longForm/recommendationLifecycle';
import { getDefaultGenerationPreparationDiagnosticsRegistry } from '../../../../backend/services/longForm/generationPreparationDiagnostics';
import type {
  ExecutionGateThreshold,
  LongFormRecommendation,
  RecommendationLifecycleState,
} from '../../../../backend/services/longForm/longFormRecommendationTypes';
import type { ContentPlan } from '../../../../lib/content/longFormPlanningEngine';
import type { PlanningInputPartial } from '../../../../backend/services/longForm/longFormPlanningAdapter';

interface PrepareGenerationBody {
  companyId?: string;
  recommendationId?: string;
  recommendation?: LongFormRecommendation;
  contentPlan?: ContentPlan;
  planningInput?: PlanningInputPartial;
  upstreamScores?: {
    continuityScore?: number;
    semanticContinuityScore?: number;
    icpEntityPreservation?: number;
    inheritanceCompletenessScore?: number;
  };
  thresholdMode?: ExecutionGateThreshold;
}

function asThreshold(value: unknown): ExecutionGateThreshold {
  return value === 'strict' || value === 'exploratory' ? value : 'balanced';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as PrepareGenerationBody;

  if (typeof body.companyId !== 'string' || body.companyId.trim().length === 0) {
    return res.status(400).json({ error: 'companyId is required' });
  }
  if (!body.recommendationId && !body.recommendation) {
    return res.status(400).json({ error: 'recommendationId or recommendation is required' });
  }
  if (!body.contentPlan || typeof body.contentPlan !== 'object') {
    return res.status(400).json({ error: 'contentPlan is required (planner output)' });
  }
  if (!body.planningInput || typeof body.planningInput !== 'object') {
    return res.status(400).json({ error: 'planningInput is required' });
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
    const diagnostics = getDefaultGenerationPreparationDiagnosticsRegistry();

    // 1. Resolve recommendation (registry preferred).
    let recommendation: LongFormRecommendation | null = null;
    if (body.recommendationId) {
      const entry = registry.get(body.recommendationId);
      if (entry) recommendation = entry.recommendation;
    }
    if (!recommendation && body.recommendation) recommendation = body.recommendation;
    if (!recommendation) {
      return res.status(404).json({
        error: 'RECOMMENDATION_NOT_FOUND',
        detail: 'recommendationId not in lifecycle registry (expired or never registered) and no inline recommendation provided.',
      });
    }

    // 2. Orchestration contract.
    const upstream = {
      continuityScore: body.upstreamScores?.continuityScore ?? 80,
      semanticContinuityScore: body.upstreamScores?.semanticContinuityScore ?? 75,
      icpEntityPreservation: body.upstreamScores?.icpEntityPreservation ?? 70,
      inheritanceCompletenessScore: body.upstreamScores?.inheritanceCompletenessScore ?? 80,
    };
    const contract = buildGenerationOrchestrationContract({
      recommendation,
      planningInput: body.planningInput,
      contentPlan: body.contentPlan,
      upstream: {
        continuityScore: upstream.continuityScore,
        semanticContinuityScore: upstream.semanticContinuityScore,
        inheritanceCompletenessScore: upstream.inheritanceCompletenessScore,
      },
    });

    // 3. Planner → generation continuity.
    const domainVocabulary = body.planningInput.editorialContext?.terminologyEmphasis?.domainVocabulary ?? [];
    const strategicTerminology = body.planningInput.editorialContext?.terminologyEmphasis?.strategicTerminology ?? [];
    const plannerContinuity = analyzePlannerGenerationContinuity({
      recommendation,
      contentPlan: body.contentPlan,
      domainVocabulary,
      strategicTerminology,
    });

    // 4. Readiness assessment.
    const readiness = assessGenerationReadiness({
      recommendation,
      contentPlan: body.contentPlan,
      upstream,
      plannerContinuity,
    });

    // 5. Execution gate.
    const thresholdMode = asThreshold(body.thresholdMode);
    const gate = evaluateGenerationExecutionGate({
      readiness,
      plannerContinuity,
      thresholdMode,
    });

    // 6. Recovery plan (always computed; trivial if nothing failed).
    const recovery = buildRecoveryPlan({ readiness, plannerContinuity, gateDecision: gate });

    // 7. Explanation.
    const explanation = composeGenerationPreparationExplanation({
      contract,
      readiness,
      gate,
      plannerContinuity,
      recoveryRecommendations: recovery.recoveryRecommendations,
      recoveryAttemptPlan: recovery.recoveryAttemptPlan,
    });

    // 8. Lifecycle transitions (best-effort — skip silently if not registered).
    let finalState: RecommendationLifecycleState | null = null;
    if (body.recommendationId && registry.get(body.recommendationId)) {
      try {
        // First land on planner_ready (allowed from planner_validated or generation_ready).
        try {
          registry.transition(body.recommendationId, 'planner_ready', `contract=${contract.generationContractId}`);
        } catch (err) {
          if (!(err instanceof InvalidLifecycleTransitionError)) throw err;
          // already past planner_ready — proceed
        }
        const targetState: RecommendationLifecycleState = gate.decision === 'block' ? 'generation_blocked' : 'generation_validated';
        const lineage = registry.transition(body.recommendationId, targetState, `band=${readiness.readinessBand} score=${readiness.generationReadinessScore}`);
        finalState = lineage.lifecycleStateHistory[lineage.lifecycleStateHistory.length - 1].state;
      } catch (err) {
        if (err instanceof InvalidLifecycleTransitionError) {
          console.warn('LONG_FORM_PREPARE_GENERATION_INVALID_TRANSITION', {
            recommendationId: body.recommendationId,
            from: err.from,
            to: err.to,
          });
        } else {
          throw err;
        }
      }
    }

    // 9. Record diagnostics sample.
    diagnostics.record({
      timestamp: new Date().toISOString(),
      companyId: body.companyId,
      readiness,
      gate,
      plannerContinuity,
      recoveryRecommendations: recovery.recoveryRecommendations,
      recoveryAttemptPlan: recovery.recoveryAttemptPlan,
    });

    return res.status(200).json({
      contract,
      readiness,
      gate,
      plannerContinuity,
      recovery,
      explanation,
      finalState,
      diagnostics: diagnostics.build(body.companyId, 50),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('LONG_FORM_PREPARE_GENERATION_FAILED', { companyId: body.companyId, error: message });
    return res.status(500).json({ error: 'LONG_FORM_PREPARE_GENERATION_FAILED', detail: message });
  }
}
