/**
 * INT-001 Phase 3 — consolidated Qualification & Planning summary.
 * Orchestrates the independent engines in a fixed order:
 * urgency / company fit / behavioural fit → qualification → channels →
 * outreach plan → recommended actions. Pure and deterministic;
 * `generatedAt` is always the injected snapshot.now.
 */

import type { QualificationPlanningInput, QualificationPlanningSummary } from './types';
import { evaluateUrgency } from './urgencyEngine';
import { evaluateCompanyFit } from './companyFitEngine';
import { evaluateBehavioralFit } from './behavioralFitEngine';
import { assessQualification } from './qualificationEngine';
import { recommendChannels } from './channelIntelligence';
import { buildOutreachPlan } from './outreachPlanner';
import { buildRecommendedActions } from './recommendedActions';

export function buildQualificationPlanningSummary(
  input: QualificationPlanningInput,
): QualificationPlanningSummary {
  const urgency = evaluateUrgency(input.snapshot);
  const companyFit = evaluateCompanyFit(input.snapshot, input.context ?? {});
  const behavioralFit = evaluateBehavioralFit(input.snapshot);
  const qualification = assessQualification(input, { urgency, companyFit, behavioralFit });
  const recommendedChannels = recommendChannels(input);
  const recommendedPlan = buildOutreachPlan(input, qualification, recommendedChannels);
  const recommendedActions = buildRecommendedActions(input, qualification, urgency);

  return {
    leadId: input.snapshot.lead.id,
    qualification,
    urgency,
    companyFit,
    behavioralFit,
    intent: input.intent,
    persona: input.persona,
    overallScore: qualification.totalScore,
    recommendedChannels,
    recommendedPlan,
    recommendedActions,
    confidence: qualification.confidence,
    generatedAt: input.snapshot.now,
  };
}
