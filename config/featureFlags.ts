/**
 * Feature flags for gradual rollout.
 * Set via env: ENABLE_UNIFIED_CAMPAIGN_WIZARD=true
 */

export const ENABLE_UNIFIED_CAMPAIGN_WIZARD =
  process.env.NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true' ||
  process.env.ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true';

/**
 * Planner → Execution adapter path.
 * When enabled, finalize requests with source='planner' run through
 * plannerToExecutionAdapter before saving slots.
 * Set ENABLE_PLANNER_ADAPTER=false to disable and fall back to existing inline mapping.
 * Defaults to ON (opt-out flag).
 */
export const ENABLE_PLANNER_ADAPTER =
  process.env.ENABLE_PLANNER_ADAPTER !== 'false';
