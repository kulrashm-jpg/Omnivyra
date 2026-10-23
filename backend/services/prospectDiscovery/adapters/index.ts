/**
 * PHASE 4 — discovery adapter registration.
 *
 * ─── WHY BOTH HALVES REGISTER TOGETHER ────────────────────────────────────
 * The frozen contract requires it: *"A discovery provider must ALSO have a
 * registered `LeadSourceAdapter` under the same key, because what it fetches has
 * to be translatable."* Registering them from one function makes that pairing
 * structural rather than something a caller must remember — a provider that could
 * fetch but not translate would spend a tenant's Apollo quota on records with
 * nowhere to go, and the executor's readiness check refuses exactly that.
 *
 * ─── REGISTRATION IS NOT ACTIVATION ───────────────────────────────────────
 * This changes one thing: the executor stops refusing `provider_not_registered`
 * and starts asking the next question instead — does this TENANT have a
 * credential? Every other gate is untouched. A tenant with no Apollo key still
 * gets `credential_missing` and no provider is contacted; the attempt ledger
 * still bounds pages, results and calls; cost authorization still runs before
 * egress; and nothing here makes Apollo discovery *operationally verified*, which
 * only observed runtime evidence can do.
 *
 * It is also caller-driven rather than an import side effect, which is the
 * position `transportRegistry` takes for the same reason: a module import must
 * never be what makes a provider reachable.
 *
 * ─── IDEMPOTENT ───────────────────────────────────────────────────────────
 * Both registries refuse a duplicate registration loudly, so this checks first
 * and a second call is a no-op. A process cannot crash because two entry points
 * both registered.
 */

import { hasDiscoveryProvider, registerDiscoveryProvider } from '../providerRegistry';
import { hasLeadSourceAdapter, registerLeadSourceAdapter } from '../../leadIngestion/registry';
import { apolloLeadSourceAdapter } from '../../leadIngestion/adapters/apolloAdapter';
import { apolloDiscoveryAdapter } from './apolloDiscovery';

export { apolloDiscoveryAdapter } from './apolloDiscovery';

/** Every discovery provider that exists. Registered together, so none is forgotten. */
export const DISCOVERY_ADAPTERS = [apolloDiscoveryAdapter] as const;

/**
 * Register the discovery providers this runtime may use, with their translators.
 *
 * Both halves, keyed identically, or neither.
 */
export function registerDiscoveryAdapters(): void {
  for (const adapter of DISCOVERY_ADAPTERS) {
    // The translation half FIRST: a fetcher without a translator is the
    // combination the executor must never be offered.
    if (!hasLeadSourceAdapter(adapter.provider)) {
      if (adapter.provider === apolloDiscoveryAdapter.provider) {
        registerLeadSourceAdapter(apolloLeadSourceAdapter);
      }
    }
    if (!hasDiscoveryProvider(adapter.provider)) {
      registerDiscoveryProvider(adapter);
    }
  }
}
