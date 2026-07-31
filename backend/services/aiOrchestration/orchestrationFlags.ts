/**
 * orchestrationFlags.ts — AI Orchestration rollout flags (Phase 2B.1).
 *
 * REGISTRATION ONLY. This module DEFINES the five AI Orchestration rollout flags
 * so they appear on the operator surface (`listRolloutFlags()` /
 * super-admin operations center) and can be flipped per environment. It does NOT
 * consume any of them — nothing in Phase 2B.1 reads these decisions, and every
 * flag defaults to OFF. When they are OFF (the default), runtime behavior is
 * byte-identical to today.
 *
 * Each flag maps to a phase of the approved migration
 * (docs/ai-architecture/AI-ORCHESTRATION-PHASE-2A-DESIGN.md §17):
 *   ai-config-resolver-shadow   → 2A-2  run the resolver in shadow (compare only)
 *   ai-config-resolver-enabled  → 2A-3  resolver authoritative behind the chokepoints
 *   ai-admin-console            → 2A-4/5 admin console (read → write)
 *   ai-profile-params-enabled   → 2A-6  profiles drive temperature/max_tokens/modality
 *   ai-multiprovider-live       → 2A-7  widen the live path beyond openai/anthropic
 *
 * Registration is a side effect of importing this module (defineRolloutFlag runs
 * at load). Future phases import the exported constants; the accompanying unit
 * test imports this module to assert all five are registered and resolve to OFF —
 * the same pattern proven for other platform-wave flags.
 *
 * CONVENTION: kebab-case keys → env prefix ROLLOUT_<SCREAMING_SNAKE> (see
 * lib/platform/rollout.defineRolloutFlag). e.g. the shadow flag is controlled by
 * ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE (off|shadow|enforce) and killed by
 * ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_KILL.
 */
import { defineRolloutFlag, type RolloutFlag } from '../../../lib/platform/rollout';

/** 2A-2: run the Configuration Resolver in SHADOW alongside legacy resolution. */
export const AI_CONFIG_RESOLVER_SHADOW: RolloutFlag = defineRolloutFlag({
  key: 'ai-config-resolver-shadow',
  description:
    'AI-ORCH 2A-2: run the Configuration Resolver in shadow (compare plan vs legacy; never surfaced). Default off.',
});

/** 2A-3: make the Configuration Resolver authoritative behind the chokepoints. */
export const AI_CONFIG_RESOLVER_ENABLED: RolloutFlag = defineRolloutFlag({
  key: 'ai-config-resolver-enabled',
  description:
    'AI-ORCH 2A-3: Configuration Resolver authoritative behind resolveLlmConfig/resolveEffectiveModel; legacy default on miss. Default off.',
});

/** 2A-4/5: the AI Orchestration admin console (read, then RBAC writes). */
export const AI_ADMIN_CONSOLE: RolloutFlag = defineRolloutFlag({
  key: 'ai-admin-console',
  description:
    'AI-ORCH 2A-4/5: expose the AI Orchestration admin console (providers/models/profiles/bindings). Default off.',
});

/** 2A-6: profiles drive execution parameters (temperature/max_tokens/modality). */
export const AI_PROFILE_PARAMS_ENABLED: RolloutFlag = defineRolloutFlag({
  key: 'ai-profile-params-enabled',
  description:
    'AI-ORCH 2A-6: Execution Profiles drive temperature/max_tokens/modality; call-site literals become fallback. Default off.',
});

/** 2A-7: widen the live generation path beyond openai/anthropic via the dispatcher. */
export const AI_MULTIPROVIDER_LIVE: RolloutFlag = defineRolloutFlag({
  key: 'ai-multiprovider-live',
  description:
    'AI-ORCH 2A-7: activate multi-provider routing on the live path (resolveTransport + routing policies + circuit breaker). Default off.',
});

/**
 * All AI Orchestration flags, in phase order. Exported for the operator surface,
 * diagnostics, and tests. Importing this array (or the module) is what registers
 * the flags at runtime.
 */
export const AI_ORCHESTRATION_FLAGS: readonly RolloutFlag[] = Object.freeze([
  AI_CONFIG_RESOLVER_SHADOW,
  AI_CONFIG_RESOLVER_ENABLED,
  AI_ADMIN_CONSOLE,
  AI_PROFILE_PARAMS_ENABLED,
  AI_MULTIPROVIDER_LIVE,
]);
