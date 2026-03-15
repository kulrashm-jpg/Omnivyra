/**
 * Feature flags for gradual rollout.
 * Set via env: ENABLE_UNIFIED_CAMPAIGN_WIZARD=true
 */

export const ENABLE_UNIFIED_CAMPAIGN_WIZARD =
  process.env.NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true' ||
  process.env.ENABLE_UNIFIED_CAMPAIGN_WIZARD === 'true';
