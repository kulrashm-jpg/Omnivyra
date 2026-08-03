/**
 * INT-001 Phase 3 — Qualification & Autonomous Planning (public surface).
 *
 * Inert by design: nothing in the runtime imports this module yet — wiring is
 * a later, separately reviewed step. Consumes Phase 2 outputs (types only);
 * never touches capture, tracking, attribution, or any Phase 1/2 code path.
 */

export * from './types';
export { DIMENSION_WEIGHTS, BAND_THRESHOLDS, PERSONA_PLAYBOOKS } from './planningConfig';
export { classifyEmail, pageSignalsFor, extractSnapshotSignals } from './signals';
export { evaluateUrgency } from './urgencyEngine';
export { evaluateCompanyFit } from './companyFitEngine';
export { evaluateBehavioralFit } from './behavioralFitEngine';
export { assessQualification } from './qualificationEngine';
export { recommendChannels } from './channelIntelligence';
export { buildOutreachPlan } from './outreachPlanner';
export { buildRecommendedActions } from './recommendedActions';
export { buildQualificationPlanningSummary } from './planningSummary';
