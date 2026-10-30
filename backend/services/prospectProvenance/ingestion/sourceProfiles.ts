/**
 * Explicit source → provenance classification for every ingestion path Agent 2 owns.
 *
 * The contract rule (docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md) is that
 * `source_category` is set EXPLICITLY by each ingestion path and is never
 * inferred from the display source. This module is that explicit table: one row
 * per path or per PI adapter key, written out by hand. There is no fallback
 * category — an unknown PI adapter key returns `null`, and the caller records
 * nothing rather than guessing.
 *
 * Keys here are ADAPTER/PATH keys (`apollo`, `crm`, `csv`, `manual`, and the
 * inbound lead modes), never `CanonicalLeadSource` display values and never the
 * free-text `leads.source` / CRM `lead_source` strings.
 *
 * Pure: no I/O.
 */
import {
  namespacedExternalRef,
  type SourceCategory,
} from '../../../../lib/prospectProvenance/contract';

export interface IngestionSourceProfile {
  readonly sourceCategory: SourceCategory;
  /** Originating platform/provider (lowercase), or null when the path cannot know it. */
  readonly platform: string | null;
  /** Provider prefix used for namespaced external references (`<prefix>:<id>`). */
  readonly refProvider: string;
}

/**
 * PI adapters reached through `ingestLeadBatch` (backend/services/leadIngestion).
 *
 * `apollo` is DISCOVERY: the only route into the orchestrator for Apollo records
 * is `discoveryExecutor` (people search). Apollo enrichment of an existing
 * prospect writes `source_records` through `enrichment/providers/persistence.ts`
 * and never reaches the orchestrator, so it is not listed here (see
 * `PI_ENRICHMENT_PROFILE`).
 */
export const PI_ADAPTER_PROFILES: Readonly<Record<string, IngestionSourceProfile>> = Object.freeze({
  apollo: { sourceCategory: 'pi_discovery', platform: 'apollo', refProvider: 'apollo' },
  crm: { sourceCategory: 'crm', platform: null, refProvider: 'crm' },
  csv: { sourceCategory: 'csv', platform: null, refProvider: 'csv' },
  manual: { sourceCategory: 'manual', platform: null, refProvider: 'manual' },
});

/**
 * Provider enrichment of an EXISTING prospect (`enrichment/providers/persistence.ts`).
 *
 * Enrichment never originates a prospect: it is always recorded as a
 * `contributing` source. The platform is the provider that answered, and the
 * reference namespace is `enrichment_<provider>` — deliberately NOT the
 * provider's discovery namespace (`apollo:`), so an enrichment observation can
 * never collide with, or be mistaken for, the discovery event that originated
 * the prospect. Returns null for a provider id that cannot form a valid
 * namespace (never sanitised into a guessed one).
 */
export function piEnrichmentProfile(providerId: string | null | undefined): IngestionSourceProfile | null {
  const provider = String(providerId ?? '').trim().toLowerCase();
  const refProvider = `enrichment_${provider}`;
  if (!provider || !/^[a-z][a-z0-9_]{0,39}$/.test(provider) || !/^[a-z][a-z0-9_]{0,39}$/.test(refProvider)) return null;
  return Object.freeze({ sourceCategory: 'pi_enrichment', platform: provider, refProvider });
}

/** Apollo enrichment profile (the only enrichment provider live today). */
export const PI_ENRICHMENT_PROFILE: IngestionSourceProfile = piEnrichmentProfile('apollo')!;

/**
 * The legacy CRM importer (`crmIngestionService`). It does not know which CRM
 * product sent the rows (the row's `source` is the CRM's LEAD SOURCE, e.g.
 * `webinar`, not the vendor), so platform is null and the provider prefix is the
 * generic `crm`.
 */
export const LEGACY_CRM_PROFILE: IngestionSourceProfile = Object.freeze({
  sourceCategory: 'crm', platform: null, refProvider: 'crm',
});

/** MarketPulse market-event signals. */
export const MARKETPULSE_PROFILE: IngestionSourceProfile = Object.freeze({
  sourceCategory: 'marketpulse', platform: 'marketpulse', refProvider: 'marketpulse',
});

/** The four structural modes of `leadService.createLead`. */
export type InboundLeadMode = 'inbound_form' | 'inbound_webhook' | 'website' | 'manual';

/**
 * Inbound `leads` rows. The provenance reference is the `leads` row itself, so
 * every inbound mode namespaces under `leads:` (a `leads.id` is unique across
 * modes, and this can never collide with the PI manual adapter's `manual:<hash>`).
 */
export const INBOUND_LEAD_PROFILES: Readonly<Record<InboundLeadMode, IngestionSourceProfile>> = Object.freeze({
  inbound_form: { sourceCategory: 'inbound_form', platform: 'form', refProvider: 'leads' },
  inbound_webhook: { sourceCategory: 'inbound_webhook', platform: 'webhook', refProvider: 'leads' },
  website: { sourceCategory: 'website', platform: 'website', refProvider: 'leads' },
  manual: { sourceCategory: 'manual', platform: null, refProvider: 'leads' },
});

/** The PI adapter profile for an adapter key, or null (never a guessed default). */
export function piAdapterProfile(adapterSource: string | null | undefined): IngestionSourceProfile | null {
  const key = String(adapterSource ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PI_ADAPTER_PROFILES, key) ? PI_ADAPTER_PROFILES[key] : null;
}

/**
 * `<provider>:<id>`, without double-prefixing ids that a source already emits in
 * its own namespace (the PI csv/manual adapters mint `csv:<hash>` / `manual:<hash>`).
 * Any other id — including one that happens to contain a colon — is prefixed.
 */
export function toNamespacedRef(provider: string, id: string | number): string {
  const raw = String(id ?? '').trim();
  if (raw.startsWith(`${provider}:`) && raw.length > provider.length + 1) return raw;
  return namespacedExternalRef(provider, raw);
}

/**
 * The lookup keys for a canonical prospect: the namespaced key first, then the
 * legacy raw key. Existing `canonical_leads.external_lead_key` values are raw, so
 * a resync must still find them; new rows are written with the namespaced key.
 * `legacy` is null when the raw key already IS the namespaced key.
 */
export function prospectKeyCandidates(
  provider: string,
  rawKey: string | null | undefined,
): { namespaced: string; legacy: string | null } | null {
  const raw = String(rawKey ?? '').trim();
  if (!raw) return null;
  const namespaced = toNamespacedRef(provider, raw);
  return { namespaced, legacy: namespaced === raw ? null : raw };
}
