/**
 * RenderProviderRegistry — Step-R3 (single provider, image-only).
 * ──────────────────────────────────────────────────────────────────────────
 * One provider this step (OpenAI image). Capability-filtered, health
 * unaware (no failover/queue yet — later step). Pure resolution.
 */

import type {
  RenderProvider,
  RenderProviderRegistry,
  RenderProviderKey,
  RenderSpec,
} from '../contracts';
import { createOpenAIRenderProvider } from './openAIRenderProvider';

/** Step-R4: optional provider health gating for FAILOVER FOUNDATION.
 *  Single-active execution still — the chain is an ORDERED preference
 *  (primary → secondary); the executor picks one healthy head. R3 sync
 *  behavior is unchanged (no health map ⇒ identical to before). */
export type RenderProviderHealthMap = Record<string, 'healthy' | 'degraded' | 'circuit_open' | 'maintenance'>;

export function createRenderProviderRegistry(
  providers?: ReadonlyArray<RenderProvider>,
  health?: RenderProviderHealthMap,
): RenderProviderRegistry {
  const list = providers && providers.length > 0
    ? providers
    : [createOpenAIRenderProvider()];
  const byKey = new Map<string, RenderProvider>();
  for (const p of list) byKey.set(p.key, p);
  const usable = (k: string) => {
    const h = health?.[k];
    return h !== 'circuit_open' && h !== 'maintenance';
  };

  return {
    get(key: RenderProviderKey) { return byKey.get(key); },
    list() { return Array.from(byKey.values()); },
    resolveProviderChain(spec: RenderSpec) {
      // Capability-filtered + health-gated ORDERED preference. Empty ⇒
      // caller fails closed (no_capable_provider). First entry is the
      // active provider; later entries are failover candidates.
      return list
        .filter((p) => p.supports(spec) && usable(p.key))
        .map((p) => p.key);
    },
  };
}
