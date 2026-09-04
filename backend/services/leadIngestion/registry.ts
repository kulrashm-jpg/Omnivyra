/**
 * LI-4D — the lead source adapter registry.
 *
 * The orchestrator must be able to ingest from any source without knowing which
 * one it is. That requires a lookup from a source key to an adapter, and this is
 * it: a registry, a capability check, and nothing else.
 *
 * ─── IT SHIPS EMPTY, DELIBERATELY ─────────────────────────────────────────
 * No provider is registered here, because no provider adapter is implemented.
 * `PROVIDER_CATALOG` already records `integrated: false` for providers whose
 * ingestion is unbuilt, and repeating that claim optimistically in a second
 * place is how a platform ends up advertising a source it cannot actually read.
 * A registry with extension points and no registrations is the honest state.
 *
 * ─── IT IS NOT THE PROVIDER COST CATALOG ──────────────────────────────────
 * `backend/services/providers/providerCatalog.ts` governs SPEND: quota, auth,
 * timeout, retry, whether a call must pass the cost governor. That is a
 * different question from "how is this provider's record translated", and the
 * two are kept apart. An adapter that eventually makes network calls must still
 * go through the governor and `safeFetch`; this registry does not replace, wrap
 * or duplicate either.
 */

import {
  SOURCE_CAPABILITIES,
  type LeadSourceAdapter,
  type SourceCapability,
} from './contracts';

/** Registered adapters, keyed by their normalised source key. */
const adapters = new Map<string, LeadSourceAdapter>();

const normalizeKey = (source: string): string => String(source ?? '').trim().toLowerCase();

export class UnsupportedSourceError extends Error {
  constructor(readonly source: string) {
    super(`unsupported ingestion source '${source}' — no adapter is registered`);
    this.name = 'UnsupportedSourceError';
  }
}

export class AdapterRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterRegistrationError';
  }
}

/**
 * Register an adapter.
 *
 * Validates the adapter's own claims: a capability outside the known set, or a
 * duplicate registration, is refused loudly. A silently-overwritten adapter
 * would mean records are translated by code nobody chose.
 */
export function registerLeadSourceAdapter(adapter: LeadSourceAdapter): void {
  if (!adapter || typeof adapter.translate !== 'function') {
    throw new AdapterRegistrationError('an adapter must implement translate()');
  }
  const key = normalizeKey(adapter.source);
  if (!key) throw new AdapterRegistrationError('an adapter must declare a non-empty source key');
  if (adapters.has(key)) {
    throw new AdapterRegistrationError(`source '${key}' is already registered — refusing to replace it silently`);
  }
  if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
    throw new AdapterRegistrationError(`adapter '${key}' declares no capabilities`);
  }
  for (const c of adapter.capabilities) {
    if (!SOURCE_CAPABILITIES.includes(c)) {
      throw new AdapterRegistrationError(`adapter '${key}' declares unknown capability '${c}'`);
    }
  }
  adapters.set(key, adapter);
}

/** Look up an adapter, or throw a typed error the orchestrator turns into a rejection. */
export function getLeadSourceAdapter(source: string): LeadSourceAdapter {
  const found = adapters.get(normalizeKey(source));
  if (!found) throw new UnsupportedSourceError(String(source));
  return found;
}

export function hasLeadSourceAdapter(source: string): boolean {
  return adapters.has(normalizeKey(source));
}

/**
 * What a future source-selection UI would list. Reports only what is registered,
 * so an unimplemented provider can never appear as available.
 */
export function listLeadSources(): Array<{ source: string; label: string; capabilities: SourceCapability[] }> {
  return [...adapters.values()].map((a) => ({
    source: a.source,
    label: a.label,
    capabilities: [...a.capabilities],
  }));
}

export function sourceSupports(source: string, capability: SourceCapability): boolean {
  const found = adapters.get(normalizeKey(source));
  return !!found && found.capabilities.includes(capability);
}

/** Test-only reset. Never called by runtime code. */
export function __resetLeadSourceRegistry(): void {
  adapters.clear();
}
