/**
 * INT-001 Phase 5 — Automation & Execution Framework (public surface).
 *
 * Inert by design: nothing in the runtime imports this module yet. It
 * generates deterministic, non-running automation plans from Phase 3
 * planning intelligence (types-only dependency). No queues, no schedulers,
 * no workflow engine, no network, no DB, no LLM, no randomness.
 */

export * from './types';
export {
  STEP_DELAY_LADDER_HOURS,
  READINESS_THRESHOLDS,
  RESTRICTED_REGIONS,
} from './automationConfig';
export { sequenceChannels } from './channelSequencer';
export { generateTasks } from './taskGenerator';
export { buildExecutionTimeline } from './timelineBuilder';
export { assessHumanReview } from './humanReviewEngine';
export { assessReadiness } from './readinessEngine';
export { buildAutomationPlan, buildAutomationSummary } from './automationSummary';
