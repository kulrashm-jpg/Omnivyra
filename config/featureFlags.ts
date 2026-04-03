/**
 * Feature flags for gradual rollout.
 *
 * This file is imported by both server and browser code — it must NOT import
 * the server-side config module (@/config) which validates server-only env vars
 * (SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, etc.) and crashes in the browser.
 *
 * Rules:
 *   - NEXT_PUBLIC_* vars: read process.env directly (Next.js exposes these to the browser)
 *   - Server-only vars: guard with `typeof window === 'undefined'` and provide a safe default
 */

/**
 * Unified campaign wizard UI.
 * Set via env: NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD=true
 * (or server-only ENABLE_UNIFIED_CAMPAIGN_WIZARD=true)
 */
export const ENABLE_UNIFIED_CAMPAIGN_WIZARD =
  process.env.NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true' ||
  (typeof window === 'undefined' && process.env.ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true');

/**
 * Planner → Execution adapter path.
 * When enabled, finalize requests with source='planner' run through
 * plannerToExecutionAdapter before saving slots.
 * Set ENABLE_PLANNER_ADAPTER=false to disable. Defaults to ON.
 * Server-only flag — always true on the client side.
 */
export const ENABLE_PLANNER_ADAPTER =
  typeof window === 'undefined'
    ? process.env.ENABLE_PLANNER_ADAPTER !== 'false'
    : true;
