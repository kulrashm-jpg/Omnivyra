/**
 * Platform Consumption rollout flag — DEFAULT OFF (shadow-only). The consumption API is computed on
 * demand; the flag gates any wired downstream path so Programs 1–4 operate byte-identically when OFF
 * (O(1) rollback).
 */
export function isIntelligencePlatformEnabled(): boolean {
  return process.env.INTELLIGENCE_PLATFORM_ENABLED === 'true';
}
