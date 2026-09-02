/**
 * Feature flags for gradual rollout.
 *
 * This file is imported by both server and browser code — it must NOT import
 * the server-side config module (@/config) which validates server-only env vars
 * (the Supabase server key, REDIS_URL, etc.) and crashes in the browser.
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

/**
 * Strategic Mix R2-P2 — per-item blueprint lock doctrine (SPEC-001 §2).
 * When enabled, assertBlueprintMutable evaluates individual scheduled items
 * (publishing/published, or inside their OWN 24h freeze window) instead of
 * the legacy campaign-wide freeze. Defaults OFF — legacy behavior stays
 * byte-identical until validation completes; switching is configuration-
 * only. Read lazily (a function, not a const) so runtime config changes
 * and tests take effect without module reloads. Server-only.
 */
export function blueprintPerItemLocksEnabled(): boolean {
  return typeof window === 'undefined' && process.env.BLUEPRINT_PER_ITEM_LOCKS === 'true';
}
