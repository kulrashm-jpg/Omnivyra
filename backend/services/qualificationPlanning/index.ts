/**
 * INT-001 Phase 3 — Qualification & Autonomous Planning (public surface).
 *
 * LIVE since INT-002 Wave 2. The header previously read "Inert by design:
 * nothing in the runtime imports this module yet", which stopped being true
 * when the orchestrator began calling `buildQualificationPlanningSummary` as
 * part of every generation. A reviewer reading the old note would reasonably
 * have concluded this was dead code and treated changes here as risk-free;
 * they are not — the output is persisted in the intelligence envelope and
 * served to the UI. Corrected in WS-3 M0 (documentation only).
 *
 * Consumes Phase 2 outputs (types only); never touches capture, tracking,
 * attribution, or any Phase 1/2 code path.
 *
 * WS-3 OWNERSHIP BOUNDARY: this module PLANS. It does not execute. The plan it
 * produces is disposable and regenerated; WS-3 materialises it into durable
 * OutreachTasks at a single translation boundary outside this module. Nothing
 * here may dispatch, persist a task, or contact anyone.
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
