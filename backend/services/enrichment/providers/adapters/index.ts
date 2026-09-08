/**
 * A3U — PI enrichment adapters, and their registration.
 *
 * Mirrors the WS-4 pattern (`companyIntelligence/providers/index.ts` registers
 * its vendor list at module load) so PI has ONE place where "which adapters
 * exist" is answered, rather than a second registry.
 *
 * REGISTERING AN ADAPTER IS NOT ACTIVATING A PROVIDER. It changes exactly one
 * thing: `executeEnrichment` stops answering `not_implemented` and starts
 * asking the next question instead — does this TENANT have a credential, and is
 * the operation priced. Both still refuse today, so no call can occur.
 */

import { registerProvider } from '../registry';
import { clearbitEnrichmentAdapter } from './clearbit';
import { apolloEnrichmentAdapter } from './apollo';

export { clearbitEnrichmentAdapter, mapClearbitPayload, CLEARBIT_SUPPORTED_ATTRIBUTES } from './clearbit';
export { apolloEnrichmentAdapter, mapApolloPayload, APOLLO_SUPPORTED_ATTRIBUTES } from './apollo';

/** Every PI adapter that exists. Registered together, so none is forgotten. */
export const PI_ENRICHMENT_ADAPTERS = [clearbitEnrichmentAdapter, apolloEnrichmentAdapter] as const;

/** Idempotent: `registerProvider` keys by adapter id, so a repeat is a no-op. */
export function registerPiEnrichmentAdapters(): void {
  for (const adapter of PI_ENRICHMENT_ADAPTERS) registerProvider(adapter);
}
