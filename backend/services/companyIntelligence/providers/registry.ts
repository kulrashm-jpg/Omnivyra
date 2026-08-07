/**
 * WS-4 Phase-2 — provider registry and capability routing.
 *
 * Registration is CALLER-DRIVEN, following the precedent WS-3's
 * `transportRegistry` set: a module import must never make an external provider
 * reachable. Importing this file registers nothing. That is the difference
 * between a dependency and a capability.
 *
 * Routing is DETERMINISTIC. `providersFor` returns a stable order — precedence
 * ascending, then id — so two runs against the same registry consult providers
 * in the same sequence and produce the same aggregate. An unordered Map
 * iteration would have made the whole pipeline quietly non-reproducible.
 */

import type { CompanyEnrichmentProvider, EnrichmentCapability } from './contract';

const registry = new Map<string, CompanyEnrichmentProvider>();

/** Register a provider. Keyed on id, so re-registration replaces rather than duplicates. */
export function registerProvider(provider: CompanyEnrichmentProvider): void {
  registry.set(provider.id, provider);
}

/** Every registered provider, in deterministic order. */
export function registeredProviders(): CompanyEnrichmentProvider[] {
  return [...registry.values()].sort(byPrecedenceThenId);
}

/**
 * Providers that serve a capability, in the order the orchestrator will consult
 * them. Includes UNCONFIGURED providers deliberately: the orchestrator reports
 * them as `no_credential`, which is how an operator discovers that a capability
 * is one key away from working rather than unsupported.
 */
export function providersFor(capability: EnrichmentCapability): CompanyEnrichmentProvider[] {
  return [...registry.values()]
    .filter((p) => p.capabilities.includes(capability))
    .sort(byPrecedenceThenId);
}

/** Capabilities with at least one registered provider, sorted. */
export function supportedCapabilities(): EnrichmentCapability[] {
  const out = new Set<EnrichmentCapability>();
  for (const p of registry.values()) for (const c of p.capabilities) out.add(c);
  return [...out].sort();
}

/**
 * What an operator needs to see: which capabilities can actually produce data
 * right now, and which are registered but starved of a credential.
 */
export function capabilityReadiness(): Array<{
  capability: EnrichmentCapability;
  registered: string[];
  configured: string[];
  ready: boolean;
}> {
  return supportedCapabilities().map((capability) => {
    const providers = providersFor(capability);
    const configured = providers.filter((p) => p.isConfigured()).map((p) => p.id);
    return {
      capability,
      registered: providers.map((p) => p.id),
      configured,
      ready: configured.length > 0,
    };
  });
}

/** Test seam. Mirrors `__clearTransportsForTests` in WS-3. */
export function __clearProvidersForTests(): void {
  registry.clear();
}

function byPrecedenceThenId(a: CompanyEnrichmentProvider, b: CompanyEnrichmentProvider): number {
  return a.precedence !== b.precedence ? a.precedence - b.precedence : a.id.localeCompare(b.id);
}
