/**
 * CPG-011/012 — the composition root: the ONE place built-in providers are listed.
 *
 * Nothing else in the core names a provider. Adding a jurisdiction is a new
 * provider module plus one `register` line here — or, at runtime,
 * `defaultProviderRegistry().register(provider)`; the resolver, establishment,
 * persistence and API are unchanged.
 */

import { createProviderRegistry, type ProviderRegistry } from './providerRegistry';
import { EIN_SCHEME, secEdgarProvider } from './providers/secEdgarProvider';
import { mcaProvider } from './providers/mcaProvider';
import { frSireneProvider } from './providers/frSireneProvider';
import { createGleifProvider } from './providers/gleifProvider';
import { gbCompaniesHouseProvider } from './providers/gbCompaniesHouseProvider';
import { deHandelsregisterProvider } from './providers/deHandelsregisterProvider';
import { jpCorporateNumberProvider } from './providers/jpCorporateNumberProvider';
import { sgAcraProvider } from './providers/sgAcraProvider';
import { brCnpjProvider } from './providers/brCnpjProvider';
import { zaCipcProvider } from './providers/zaCipcProvider';
import { usDelawareProvider } from './providers/usDelawareProvider';

/** A fresh registry with the built-in providers (tests register extra providers on their own instance). */
export function createDefaultProviderRegistry(): ProviderRegistry {
  // Schemes with an issuer but no provider here — normalisable, never resolvable:
  // EIN (U.S. IRS).
  const reg = createProviderRegistry([], [EIN_SCHEME]);
  reg.register(secEdgarProvider);
  reg.register(mcaProvider);
  reg.register(frSireneProvider);
  // CPG-012
  reg.register(gbCompaniesHouseProvider);
  reg.register(deHandelsregisterProvider);
  reg.register(jpCorporateNumberProvider);
  reg.register(sgAcraProvider);
  reg.register(brCnpjProvider);
  reg.register(zaCipcProvider);
  reg.register(usDelawareProvider);
  // GLEIF reads every scheme's declared registration-authority codes from this registry.
  reg.register(createGleifProvider(() => reg));
  return reg;
}

let shared: ProviderRegistry | null = null;
/** The process-wide registry (lazy, so provider modules are fully loaded before use). */
export function defaultProviderRegistry(): ProviderRegistry {
  shared ??= createDefaultProviderRegistry();
  return shared;
}
