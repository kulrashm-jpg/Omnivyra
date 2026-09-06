/**
 * A3 — the enrichment provider registry.
 *
 * Declares which providers PI knows about and resolves what each one can
 * actually do RIGHT NOW. It performs no I/O and contacts no provider.
 *
 * ─── IT DECLARES; IT DOES NOT PRETEND ─────────────────────────────────────
 * `dataSourceCatalogue.ts` already takes this position for ingestion sources
 * and its header is worth restating: a status we write is a value, not a fact.
 * So a provider here is `operational` only when an adapter exists AND its
 * credential is configured. Every provider PI has named — Apollo, ZoomInfo,
 * Crunchbase, RapidAPI — is `declared`: no adapter is registered for any of
 * them, and no credential for any of them exists in this environment.
 *
 * That is deliberate. Writing an adapter against a response shape nobody here
 * has ever received would produce normalization code that compiles, passes its
 * own fixtures, and is wrong — and the first evidence of that would be
 * fabricated attributes on real people. An adapter lands when someone can run
 * it against the real provider.
 *
 * ─── HOW A PROVIDER BECOMES OPERATIONAL ───────────────────────────────────
 * 1. implement `EnrichmentProviderAdapter`, routing egress through `safeFetch`;
 * 2. register it below with its credential env var;
 * 3. configure that env var;
 * 4. register a credit action so cost can be authorised (see `execute.ts`).
 * Until all four hold, the executor refuses before any external call.
 */

import type { EnrichmentProviderAdapter, ProviderState } from './contract';

/** A provider PI has named but for which no adapter is registered. */
export interface DeclaredProvider {
  readonly id: string;
  readonly label: string;
  readonly credentialEnvVar: string | null;
  /** What still has to be true. Stated so nobody has to guess. */
  readonly requires: readonly string[];
  readonly note: string;
}

/**
 * Providers named by the PI architecture. Kept in step with
 * `dataSourceCatalogue.ts`, which says the same thing to the admin UI.
 */
export const DECLARED_PROVIDERS: readonly DeclaredProvider[] = [
  {
    id: 'apollo',
    label: 'Apollo enrichment',
    credentialEnvVar: 'APOLLO_API_KEY',
    requires: ['adapter', 'api_key', 'credit_action'],
    note: 'Declared only. No adapter is registered and no credential is configured.',
  },
  {
    id: 'zoominfo',
    label: 'ZoomInfo enrichment',
    credentialEnvVar: 'ZOOMINFO_API_KEY',
    requires: ['adapter', 'api_key', 'credit_action'],
    note: 'Declared only. No adapter is registered and no credential is configured.',
  },
  {
    id: 'crunchbase',
    label: 'Crunchbase',
    credentialEnvVar: 'CRUNCHBASE_API_KEY',
    requires: ['adapter', 'api_key', 'credit_action'],
    note: 'Declared only. Account firmographics; no adapter, no credential.',
  },
  {
    id: 'rapidapi',
    label: 'RapidAPI enrichment',
    credentialEnvVar: 'RAPIDAPI_KEY',
    requires: ['adapter', 'api_key', 'credit_action'],
    note: 'Declared only. No adapter is registered and no credential is configured.',
  },
];

/**
 * Registered adapters.
 *
 * A3U registered the first one — Clearbit — through `./adapters`, so this map
 * is no longer empty. That does NOT make any provider operational: an adapter
 * only moves the refusal one step later, from `not_implemented` to whichever
 * of "this tenant has no credential" or "this operation is unpriced" applies.
 * Both still refuse, so no external call can occur.
 *
 * Tests continue to inject their own adapters rather than relying on this list.
 */
const adapters = new Map<string, EnrichmentProviderAdapter>();

/** Register an adapter. Used by production wiring and by tests. */
export function registerProvider(adapter: EnrichmentProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

/** Remove an adapter. Test hygiene; never used in production wiring. */
export function unregisterProvider(id: string): void {
  adapters.delete(id);
}

export function getProvider(id: string): EnrichmentProviderAdapter | null {
  return adapters.get(id) ?? null;
}

export interface ProviderStatus {
  readonly id: string;
  readonly label: string;
  readonly state: ProviderState;
  readonly credentialEnvVar: string | null;
  /** True only when an adapter exists AND its credential is configured. */
  readonly callable: boolean;
  readonly supports: readonly string[];
  readonly note: string;
}

/**
 * Every provider PI knows about, with its real state.
 *
 * A registered adapter whose credential is absent is `implemented`, not
 * `operational` — the distinction is the whole point of this function, and it
 * is what stops a caller reading "the adapter exists" as "this works".
 */
export function listProviderStatus(): readonly ProviderStatus[] {
  const out: ProviderStatus[] = [];

  for (const adapter of adapters.values()) {
    const callable = adapter.isAvailable();
    out.push({
      id: adapter.id,
      label: adapter.label,
      state: callable ? 'operational' : 'implemented',
      credentialEnvVar: adapter.credentialEnvVar,
      callable,
      supports: adapter.supports,
      note: callable
        ? 'Adapter registered and credential configured.'
        : `Adapter registered; ${adapter.credentialEnvVar ?? 'its credential'} is not configured.`,
    });
  }

  for (const declared of DECLARED_PROVIDERS) {
    if (adapters.has(declared.id)) continue;   // an adapter supersedes the declaration
    out.push({
      id: declared.id,
      label: declared.label,
      state: 'declared',
      credentialEnvVar: declared.credentialEnvVar,
      callable: false,
      supports: [],
      note: declared.note,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Providers that could answer at least one of these attributes right now.
 * Returns nothing when none is operational, which is the current reality.
 */
export function providersFor(attributes: readonly string[]): readonly EnrichmentProviderAdapter[] {
  const wanted = new Set(attributes);
  return [...adapters.values()]
    .filter((a) => a.isAvailable() && a.supports.some((s) => wanted.has(s)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether a credential is configured. Reads presence ONLY — never the value. */
export function hasCredential(envVar: string | null): boolean {
  if (!envVar) return true;                    // a provider needing none
  const raw = process.env[envVar];
  return typeof raw === 'string' && raw.trim().length > 0;
}
