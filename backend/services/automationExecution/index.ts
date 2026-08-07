/**
 * INT-001 Phase 5 — Automation PLANNING (public surface).
 *
 * LIVE since INT-002 Wave 2. The header previously read "Inert by design:
 * nothing in the runtime imports this module yet" — untrue since the
 * orchestrator began calling `buildAutomationSummary` on every generation, and
 * misleading in a way that mattered: the plans produced here are persisted in
 * the intelligence envelope and rendered in the UI. Corrected in WS-3 M0
 * (documentation only).
 *
 * The name says "Execution", the module PLANS. That gap is the single most
 * confusable thing in this area of the codebase, so it is stated plainly:
 *
 *   • What this module DOES: derive a deterministic, non-running plan —
 *     channel sequence, tasks with dependencies and delays, an execution
 *     timeline, readiness status and human-review requirements — from Phase 3
 *     planning intelligence (types-only dependency).
 *
 *   • What this module DOES NOT DO: run any of it. No queues, no schedulers,
 *     no workflow engine, no network, no DB, no LLM, no randomness. Nothing
 *     here contacts anyone, and nothing here is durable.
 *
 * WS-3 OWNERSHIP BOUNDARY (frozen architecture): the `AutomationTask` values
 * produced here are WS-2-owned and IMMUTABLE. WS-3 reads them and materialises
 * durable OutreachTasks at a single translation boundary that lives in the WS-3
 * Lead Outreach Execution Runtime — never in this module, never in an engine,
 * never in a transport. Execution, approval, governance and dispatch are WS-3
 * concerns and must not be added here.
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
