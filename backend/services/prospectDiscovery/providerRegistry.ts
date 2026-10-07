/**
 * B4-A1 — the discovery provider registry.
 *
 * ─── IT SHIPS EMPTY, AND THAT IS THE POINT ────────────────────────────────
 * No provider is registered here. B4-A1 is the architecture gate: it builds the
 * governed seam between an authorized tenant search and the existing canonical
 * ingestion spine, and it is explicitly forbidden from implementing Apollo or
 * calling it. An empty registry is what makes that structural rather than
 * aspirational — the executor cannot reach a provider that is not registered, so
 * there is no configuration, credential or environment variable that can turn
 * this gate into one that contacts a vendor.
 *
 * This is the same honest-empty stance `leadIngestion/registry.ts` takes, and
 * for the same stated reason: a registry with extension points and no
 * registrations does not advertise a capability the platform lacks.
 *
 * ─── WHY IT IS A SECOND REGISTRY AND NOT THE INGESTION ONE ────────────────
 * The two hold different kinds of thing. `leadIngestion/registry.ts` holds PURE
 * translators — `translate(raw, organizationId)`, no I/O, run for every source
 * including file uploads. This holds FETCHERS, which perform governed network
 * egress against a tenant credential. Putting a fetcher in the translation
 * registry would mean every call site that translates a CSV row is one typo away
 * from reaching a provider.
 *
 * A discovery provider must ALSO have a registered `LeadSourceAdapter` under the
 * same key, because what it fetches has to be translatable. `registerDiscoveryProvider`
 * does not check that — the check belongs where both registries are populated,
 * and the executor refuses at run time if the translation half is missing.
 */

import type { DiscoveryProviderAdapter } from './contract';

const providers = new Map<string, DiscoveryProviderAdapter>();

const normalizeKey = (provider: string): string => String(provider ?? '').trim().toLowerCase();

export class UnregisteredDiscoveryProviderError extends Error {
  constructor(readonly provider: string) {
    super(`no discovery provider is registered for '${provider}'`);
    this.name = 'UnregisteredDiscoveryProviderError';
  }
}

export class DiscoveryProviderRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryProviderRegistrationError';
  }
}

/**
 * Register a discovery provider.
 *
 * A duplicate registration is refused loudly rather than silently replaced: a
 * provider quietly swapped for another means a tenant's credential is handed to
 * code nobody chose.
 */
export function registerDiscoveryProvider(adapter: DiscoveryProviderAdapter): void {
  if (!adapter || typeof adapter.discover !== 'function') {
    throw new DiscoveryProviderRegistrationError('a discovery provider must implement discover()');
  }
  const key = normalizeKey(adapter.provider);
  if (!key) {
    throw new DiscoveryProviderRegistrationError('a discovery provider must declare a non-empty key');
  }
  if (providers.has(key)) {
    throw new DiscoveryProviderRegistrationError(
      `discovery provider '${key}' is already registered — refusing to replace it silently`,
    );
  }
  providers.set(key, adapter);
}

/** Look up a provider, or throw a typed error the executor turns into a refusal. */
export function getDiscoveryProvider(provider: string): DiscoveryProviderAdapter {
  const found = providers.get(normalizeKey(provider));
  if (!found) throw new UnregisteredDiscoveryProviderError(String(provider));
  return found;
}

export function hasDiscoveryProvider(provider: string): boolean {
  return providers.has(normalizeKey(provider));
}

/**
 * What a source-selection surface may offer.
 *
 * Reports only what is registered, so an unimplemented provider can never be
 * presented to an operator as available for discovery.
 */
export function listDiscoveryProviders(): Array<{ provider: string; label: string }> {
  return [...providers.values()].map((p) => ({ provider: p.provider, label: p.label }));
}

/** Test-only reset. Never called by runtime code. */
export function __resetDiscoveryProviderRegistry(): void {
  providers.clear();
}
