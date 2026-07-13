/**
 * refreshPolicyConfig.ts — configurable refresh policy (CKRE-002 §8).
 *
 * All refresh business rules are DATA, not hardcoded logic: cooldowns, per-tier
 * frequency, feature flags, and the master enable switch are resolved here from
 * env with safe defaults. The pure refreshPolicyEngine consumes this config —
 * it never reads env itself, so it stays deterministic and testable.
 *
 * Master switch: CKRE_AI_GATING_ENABLED (default TRUE). When enabled, AI
 * enrichment runs only when the policy engine permits it. The kill-switch
 * (=false) reverts to the pre-CKRE-002 behaviour (AI always runs on a stale
 * read) for emergency rollback without a deploy.
 */

export type CompanyTier = 'free' | 'pro' | 'enterprise';
export type PlatformState = 'normal' | 'degraded';

export interface RefreshPolicyConfig {
  /** Master switch — false reverts to "AI always runs" (pre-CKRE-002). */
  aiGatingEnabled: boolean;
  /** Enrichment AI-response caching enabled (CKRE-002 §4). */
  enrichmentCacheEnabled: boolean;
  /** Minimum time between AI refreshes, per tier (ms). */
  cooldownMsByTier: Record<CompanyTier, number>;
  /** Bounded refresh-history length kept in report_settings. */
  historyLimit: number;
}

const DAY = 24 * 60 * 60 * 1000;

function envBool(name: string, dflt: boolean): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (v === '') return dflt;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}
function envNum(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Resolve the effective policy config. Never throws. */
export function getRefreshPolicyConfig(): RefreshPolicyConfig {
  return {
    aiGatingEnabled: envBool('CKRE_AI_GATING_ENABLED', true),
    // Enrichment response caching is OPT-IN (default off). The policy gate is
    // the primary, provably-safe AI-work reducer (it skips AI on unchanged
    // sites); caching extraction responses risks near-match staleness on a
    // genuine change, so it is enabled only by explicit config.
    enrichmentCacheEnabled: envBool('CKRE_ENRICHMENT_CACHE_ENABLED', false),
    cooldownMsByTier: {
      enterprise: envNum('CKRE_COOLDOWN_MS_ENTERPRISE', DAY),        // daily
      pro:        envNum('CKRE_COOLDOWN_MS_PRO', 3 * DAY),           // every 3 days
      free:       envNum('CKRE_COOLDOWN_MS_FREE', 7 * DAY),          // weekly
    },
    historyLimit: envNum('CKRE_REFRESH_HISTORY_LIMIT', 20),
  };
}

export function cooldownForTier(config: RefreshPolicyConfig, tier: CompanyTier): number {
  return config.cooldownMsByTier[tier] ?? config.cooldownMsByTier.free;
}
