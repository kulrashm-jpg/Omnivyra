/**
 * orchestrationMode.ts — the AI-orchestration rollout mode + execution authority
 * (AI-ORCH 2A-3).
 *
 * Five modes control WHERE execution authority sits. Pure resolution; no side effects.
 *
 *   off    → legacy executes; resolver never runs.
 *   shadow → legacy executes; resolver observed only (2A-2.1/2/3 equivalence + adapter).
 *   dual   → legacy executes; resolver builds config; ConfigurationParityGuard validates.
 *   canary → resolver config executes; legacy still computed; guard validates. (INFRA ONLY
 *            this phase — the live execution swap is deferred; see the 2A-3 doc.)
 *   full   → resolver authoritative (OUT OF SCOPE this phase).
 *
 * DEFAULT is `off` → byte-identical to today. Controlled by `AI_CONFIG_RESOLVER_MODE`
 * (off|shadow|dual|canary|full). When unset, it falls back to the existing
 * AI_CONFIG_RESOLVER_SHADOW rollout flag (off→off, else→shadow) so no flag default
 * changes and prior behavior is preserved.
 */
import { resolveRolloutSync } from '../../../lib/platform/rollout';
import { AI_CONFIG_RESOLVER_SHADOW, AI_CONFIG_RESOLVER_ENABLED } from './orchestrationFlags';

export type OrchestrationMode = 'off' | 'shadow' | 'dual' | 'canary' | 'full';

const MODES: readonly OrchestrationMode[] = ['off', 'shadow', 'dual', 'canary', 'full'];

/** Ordinal used only to detect rollback (mode decreasing toward legacy). */
export const MODE_ORDINAL: Readonly<Record<OrchestrationMode, number>> = Object.freeze({
  off: 0, shadow: 1, dual: 2, canary: 3, full: 4,
});

/**
 * Resolve the current orchestration mode. Pure (reads env + the cached rollout flag).
 * Fails safe to `off` on any error. FULL is recognized but treated as CANARY-level
 * authority here (this phase does not implement FULL execution).
 */
export function resolveOrchestrationMode(): OrchestrationMode {
  try {
    const raw = String(process.env.AI_CONFIG_RESOLVER_MODE ?? '').trim().toLowerCase();
    if ((MODES as readonly string[]).includes(raw)) return raw as OrchestrationMode;
    // Fallback: derive from the existing shadow rollout flag (no default change).
    return resolveRolloutSync(AI_CONFIG_RESOLVER_SHADOW).mode === 'off' ? 'off' : 'shadow';
  } catch {
    return 'off';
  }
}

/**
 * The MASTER SAFETY SWITCH for resolver authority (AI-ORCH 2B). Resolver execution is
 * only possible when this rollout flag is `enforce`. Default (off) → resolver NEVER
 * executes, regardless of mode. Pure; fail-safe to false.
 */
export function isResolverAuthorityEnabled(): boolean {
  try {
    return resolveRolloutSync(AI_CONFIG_RESOLVER_ENABLED).mode === 'enforce';
  } catch {
    return false;
  }
}

export interface ExecutionAuthority {
  mode: OrchestrationMode;
  /** Which configuration the gateway executes. */
  executes: 'legacy' | 'resolver';
  /** The master enable flag state (AI_CONFIG_RESOLVER_ENABLED). */
  resolverEnabled: boolean;
  /** Build the resolver configuration (for observation/validation). */
  buildResolver: boolean;
  /** Run the ConfigurationParityGuard on executed-vs-resolver. */
  validateParity: boolean;
  /** Canary: resolver config is the one that WOULD execute. */
  canary: boolean;
}

/**
 * Pure mapping from (mode, enable flag) → execution authority — THE single source of
 * truth for "who executes". `executes: 'resolver'` requires BOTH a resolver mode
 * (canary/full) AND the master enable flag. When the flag is off (default), it always
 * degrades to `executes: 'legacy'` — so the mode alone can never promote the resolver.
 *
 * NOTE: computing the authority does NOT itself perform any execution swap. The actual
 * gateway synchronous-resolve swap is the operational go-live, gated on the promotion
 * checklist (see the 2B doc) — deferred, not wired this phase.
 */
export function resolveExecutionAuthority(
  mode: OrchestrationMode = resolveOrchestrationMode(),
  resolverEnabled: boolean = isResolverAuthorityEnabled(),
): ExecutionAuthority {
  const base = {
    mode, resolverEnabled,
    buildResolver: mode !== 'off',
    validateParity: mode === 'dual' || mode === 'canary' || mode === 'full',
    canary: mode === 'canary',
  };
  // Resolver executes ONLY when the mode is canary/full AND the master switch is on.
  const wantsResolver = mode === 'canary' || mode === 'full';
  const executes: 'legacy' | 'resolver' = wantsResolver && resolverEnabled ? 'resolver' : 'legacy';
  return { ...base, executes };
}
