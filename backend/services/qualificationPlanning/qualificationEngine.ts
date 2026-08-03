/**
 * INT-001 Phase 3 — Qualification Engine. Combines the five independent
 * dimensions (intent, persona, company fit, behavioural fit, urgency) into a
 * deterministic, fully explained qualification result. No randomness, no LLM.
 */

import type {
  QualificationPlanningInput,
  QualificationResult,
  DimensionAssessment,
  UrgencyAssessment,
  CompanyFitAssessment,
  BehavioralFitAssessment,
  QualificationBand,
} from './types';
import { DIMENSION_WEIGHTS, BAND_THRESHOLDS, PERSONA_VALUE_SCORES } from './planningConfig';
import { clampScore, clampConfidence } from './signals';

export interface DimensionInputs {
  urgency: UrgencyAssessment;
  companyFit: CompanyFitAssessment;
  behavioralFit: BehavioralFitAssessment;
}

function bandFor(totalScore: number): QualificationBand {
  for (const { band, min } of BAND_THRESHOLDS) {
    if (totalScore >= min) return band;
  }
  return 'cold';
}

export function assessQualification(
  input: QualificationPlanningInput,
  dims: DimensionInputs,
): QualificationResult {
  const { intent, persona } = input;

  // Intent dimension — score from the Phase 2 engine; confidence from how
  // much evidence backed it (contribution count, saturating at 5).
  const intentDim: DimensionAssessment = {
    key: 'intent',
    score: clampScore(intent.score),
    weight: DIMENSION_WEIGHTS.intent,
    confidence: clampConfidence(intent.contributions.length === 0 ? 0.2 : 0.4 + Math.min(intent.contributions.length, 5) * 0.12),
    explanation: intent.contributions.length === 0
      ? `Intent band ${intent.band} with no recorded signals.`
      : `Intent band ${intent.band} from ${intent.contributions.length} signal(s).`,
  };

  const personaScore = PERSONA_VALUE_SCORES[persona.persona] ?? PERSONA_VALUE_SCORES.Unknown;
  const personaDim: DimensionAssessment = {
    key: 'persona',
    score: clampScore(personaScore),
    weight: DIMENSION_WEIGHTS.persona,
    confidence: clampConfidence(persona.confidence),
    explanation: persona.persona === 'Unknown'
      ? 'Persona unresolved — neutral commercial value assumed.'
      : `Persona ${persona.persona} (${persona.reasons.slice(0, 2).join('; ') || 'no stated reasons'}).`,
  };

  const companyFitDim: DimensionAssessment = {
    key: 'companyFit',
    score: dims.companyFit.score,
    weight: DIMENSION_WEIGHTS.companyFit,
    confidence: dims.companyFit.confidence,
    explanation: dims.companyFit.explanation,
  };

  const behavioralDim: DimensionAssessment = {
    key: 'behavioralFit',
    score: dims.behavioralFit.score,
    weight: DIMENSION_WEIGHTS.behavioralFit,
    confidence: dims.behavioralFit.confidence,
    explanation: dims.behavioralFit.explanation,
  };

  const urgencyDim: DimensionAssessment = {
    key: 'urgency',
    score: dims.urgency.score,
    weight: DIMENSION_WEIGHTS.urgency,
    confidence: dims.urgency.confidence,
    explanation: dims.urgency.explanation,
  };

  // Deterministic dimension order: fixed, not data-dependent.
  const dimensions = [intentDim, personaDim, companyFitDim, behavioralDim, urgencyDim];

  const totalScore = clampScore(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  const normalizedScore = Math.round((totalScore / 100) * 1000) / 1000;
  const confidence = clampConfidence(dimensions.reduce((sum, d) => sum + d.confidence * d.weight, 0));

  const ranked = [...dimensions].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const reasoning = [
    `Total ${totalScore}/100 (${bandFor(totalScore)}) from ${dimensions.length} weighted dimensions.`,
    `Strongest dimension: ${ranked[0].key} (${ranked[0].score}/100 at weight ${ranked[0].weight}).`,
    `Weakest dimension: ${ranked[ranked.length - 1].key} (${ranked[ranked.length - 1].score}/100).`,
  ];

  return {
    dimensions,
    totalScore,
    normalizedScore,
    band: bandFor(totalScore),
    confidence,
    reasoning,
  };
}
