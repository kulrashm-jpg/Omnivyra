/**
 * A3C — the acquisition source model.
 *
 * PI acquires evidence from mechanisms that are not alike: a direct vendor API,
 * a gateway fronting many vendor APIs, and a browser extension operating inside
 * the user's own authenticated session. This file describes them uniformly
 * WITHOUT pretending they are the same thing, so that everything downstream —
 * normalisation, provenance, identity, ICP — stays source-independent.
 *
 * ─── NO PROVIDER IS THE CENTRE ────────────────────────────────────────────
 * Apollo is one entry here, not the shape of the model. A new source is a new
 * descriptor plus an adapter; nothing in the canonical enrichment contract
 * changes. That is the whole point of the file.
 *
 * ─── "NOT CONNECTED" IS NOT "NO DATA FOUND" ───────────────────────────────
 * A user who selects Apollo and is told "no enrichment data found" has been
 * misled: nothing was searched. `ConnectionState` exists so that the reason a
 * source produced nothing survives all the way to them.
 *
 * PURE: descriptors and predicates. No I/O, no credential values, no clock.
 */

import type { EnrichmentSubject } from './contract';
// A3V removed the `hasCredential` import with the env default it fed: this
// module must not be able to read a global credential even by accident.

/**
 * How a source physically acquires data. Not cosmetic — each type has
 * different authorization, cost and trust characteristics.
 */
export const SOURCE_TYPES = [
  'external_api',      // a vendor API we call directly, with our credential
  'gateway_api',       // a marketplace fronting other vendors; see GatewaySource
  'browser_extension', // acquires inside the USER's authenticated session
  'manual',            // an operator typed or uploaded it
] as const;
export type SourceType = typeof SOURCE_TYPES[number];

/**
 * Why a source can or cannot be used right now.
 *
 * `not_connected` and `credential_missing` are separated deliberately: the
 * first is "nobody has linked this", the second is "it is linked but the key is
 * absent", and they call for different actions from different people.
 */
export const CONNECTION_STATES = [
  'connected',                // usable now
  'available',                // implemented and connectable, not yet connected
  'not_connected',            // the tenant has not linked it
  'credential_missing',       // configured but the credential is absent
  'disabled',                 // deliberately turned off
  'unsupported',              // declared only; no adapter exists
  'temporarily_unavailable',  // connected but failing right now
] as const;
export type ConnectionState = typeof CONNECTION_STATES[number];

/** States from which an acquisition attempt may proceed. Exactly one. */
export const USABLE_STATES: readonly ConnectionState[] = ['connected'];

export interface SourceCapabilities {
  readonly entities: readonly EnrichmentSubject[];
  /**
   * Canonical attributes this source can actually supply. Declared ONLY from
   * an observed or documented provider contract — never from a guess, because a
   * false capability makes `auto` select a source that returns nothing.
   */
  readonly attributes: readonly string[];
}

export interface AcquisitionSourceDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly sourceType: SourceType;
  readonly capabilities: SourceCapabilities;
  /** Env var holding the credential; null when the source needs none. */
  readonly credentialEnvVar: string | null;
  /** What must be true before this source can be used. */
  readonly authorizationRequirements: readonly string[];
  /**
   * The OMNIVYRA credit action this source's calls are charged to.
   *
   * A3X: `null` for every external provider, and that is the settled model
   * rather than a gap. Provider subscription, credits, licensing and usage
   * charges are TENANT-OWNED AND TENANT-FUNDED — the tenant holds the Clearbit
   * subscription and the Apollo credits and is billed by that vendor directly,
   * so Omnivyra charges nothing for the vendor's work and must not invent a
   * credit price to represent someone else's invoice. Non-null belongs only to
   * an operation Omnivyra itself performs and pays for.
   */
  readonly creditAction: string | null;
  /** For `gateway_api`: the concrete vendor APIs behind it. */
  readonly gatewayProviders?: readonly GatewaySubProvider[];
  /** Lower runs first in `auto`. Deterministic, never a quality judgement. */
  readonly priority: number;
  readonly note: string;
}

/**
 * A concrete API behind a gateway.
 *
 * RapidAPI is a marketplace, not a dataset: two RapidAPI products share no
 * schema, no pricing and no coverage. Modelling "RapidAPI" as one adapter would
 * bake that error in permanently, so the gateway holds sub-providers and each
 * gets its own adapter when one is actually chosen.
 */
export interface GatewaySubProvider {
  readonly id: string;
  readonly displayName: string;
  readonly selected: boolean;
  readonly note: string;
}

/**
 * The sources PI knows about.
 *
 * Every external one is `unsupported` — declared, no adapter, no credential.
 * The extension is `available` rather than `connected`: it exists and works,
 * but its observations do not yet reach the PI evidence spine (see its note).
 */
export const ACQUISITION_SOURCES: readonly AcquisitionSourceDescriptor[] = [
  {
    id: 'omnivyra_extension',
    displayName: 'Omnivyra Extension',
    sourceType: 'browser_extension',
    capabilities: {
      entities: ['person'],
      // Nothing is claimed. What the extension captures today lands in the
      // ENGAGEMENT spine, not the prospect evidence spine — see the note.
      attributes: [],
    },
    credentialEnvVar: null,
    authorizationRequirements: ['extension_installed', 'hmac_signed_session', 'user_platform_session'],
    creditAction: null,
    priority: 10,
    note:
      'Installed and operational as an ENGAGEMENT runtime: it posts LinkedIn comment/DM '
      + 'observations to /api/extension/events/* and those land in engagement_threads / '
      + 'engagement_messages via engagement_sources(source_type=extension). It does NOT yet write '
      + 'source_records / source_assertions, so its observations are not PI enrichment evidence. '
      + 'That bridge is the integration gap, not a missing capability.',
  },
  {
    id: 'apollo',
    displayName: 'Apollo',
    sourceType: 'external_api',
    capabilities: { entities: [], attributes: [] },
    credentialEnvVar: 'APOLLO_API_KEY',
    authorizationRequirements: ['api_key', 'adapter', 'tenant_provider_subscription'],
    creditAction: null,
    priority: 20,
    note: 'Declared only. No adapter, no credential. Capabilities are empty because no observed API contract exists.',
  },
  {
    id: 'rapidapi',
    displayName: 'RapidAPI',
    sourceType: 'gateway_api',
    capabilities: { entities: [], attributes: [] },
    credentialEnvVar: 'RAPIDAPI_KEY',
    authorizationRequirements: ['api_key', 'sub_provider_selected', 'adapter', 'tenant_provider_subscription'],
    creditAction: null,
    gatewayProviders: [{
      id: 'unselected',
      displayName: 'No RapidAPI provider selected',
      selected: false,
      note: 'RapidAPI is a marketplace. The specific enrichment API has not been chosen, so no adapter can exist.',
    }],
    priority: 30,
    note: 'Gateway declared only. Capabilities are empty until a concrete sub-provider is selected.',
  },
  {
    id: 'zoominfo',
    displayName: 'ZoomInfo',
    sourceType: 'external_api',
    capabilities: { entities: [], attributes: [] },
    credentialEnvVar: 'ZOOMINFO_API_KEY',
    authorizationRequirements: ['api_key', 'adapter', 'tenant_provider_subscription'],
    creditAction: null,
    priority: 40,
    note: 'Declared only. No adapter, no credential.',
  },
  {
    // A3T declared it; A3U built its adapter; A3X settled its economics.
    //
    // The PI adapter (`./adapters/clearbit.ts`) is a TRANSLATION of the WS-4
    // company-intelligence spec, not a reuse of its provider: WS-4 resolves its
    // credential from `process.env`, which is right for Omnivyra's own key and
    // forbidden here, where the key is the tenant's.
    //
    // What remains outstanding is the TENANT's: their own Clearbit
    // subscription, and their own key stored through the Lead Sources API.
    // Omnivyra charges nothing for the call and reserves no credits against
    // it, because the tenant is the one Clearbit invoices.
    id: 'clearbit',
    displayName: 'Clearbit',
    sourceType: 'external_api',
    // A3U built the adapter, so these are no longer a guess: they are the five
    // canonical attributes it can actually emit, and it emits nothing else.
    capabilities: {
      entities: ['account'],
      attributes: ['employee_count', 'employee_band', 'founded_year', 'country_code', 'technologies'],
    },
    credentialEnvVar: 'CLEARBIT_API_KEY',
    // `adapter` is satisfied as of A3U and has been removed rather than left to
    // say something untrue. What remains is the tenant's own provider
    // subscription, which Omnivyra never buys on their behalf.
    authorizationRequirements: ['api_key', 'tenant_provider_subscription'],
    creditAction: null,
    // Ordering only, with no effect while the source is unusable. It reflects
    // A3I's finding that Clearbit has the most complete existing contract, so
    // `auto` would reach it first once one is actually built.
    priority: 25,
    note:
      'Company firmographics keyed on domain. Requires the tenant\'s own Clearbit '
      + 'subscription and API key: the tenant is billed by Clearbit directly, and '
      + 'Omnivyra neither buys nor resells that usage.',
  },
  {
    id: 'crunchbase',
    displayName: 'Crunchbase',
    sourceType: 'external_api',
    capabilities: { entities: [], attributes: [] },
    credentialEnvVar: 'CRUNCHBASE_API_KEY',
    authorizationRequirements: ['api_key', 'adapter', 'tenant_provider_subscription'],
    creditAction: null,
    priority: 50,
    note: 'Declared only. Account firmographics. No adapter, no credential.',
  },
  {
    id: 'manual',
    displayName: 'Manual / CSV entry',
    sourceType: 'manual',
    capabilities: {
      entities: ['person', 'account'],
      // The operator-supplied vocabulary that already reaches the spine.
      attributes: ['job_title', 'department', 'country_code', 'region', 'city'],
    },
    credentialEnvVar: null,
    authorizationRequirements: [],
    creditAction: null,
    priority: 90,
    note: 'Operator-entered records through the released ingestion routes. No provider is contacted, so nothing is charged.',
  },
];

export const getSource = (id: string): AcquisitionSourceDescriptor | null =>
  ACQUISITION_SOURCES.find((s) => s.id === id) ?? null;

export interface SourceStatus extends AcquisitionSourceDescriptor {
  readonly connectionState: ConnectionState;
  readonly usable: boolean;
  readonly stateReason: string;
}

/**
 * Resolve a source's live connection state.
 *
 * `hasAdapter` is supplied by the caller from the adapter registry rather than
 * read here, so this module stays pure and testable without registration.
 *
 * ─── A3V: `credentialPresent` IS REQUIRED, AND USED TO DEFAULT TO env ─────
 * It defaulted to `hasCredential(source.credentialEnvVar)` — a read of
 * `process.env`. That was harmless only for as long as no adapter existed,
 * because the `!hasAdapter` branch above returned first. A3U registered one,
 * and the branch became reachable: with `CLEARBIT_API_KEY` set, a source no
 * tenant had configured would have reported `connected` — "adapter registered
 * and credential configured" — describing OMNIVYRA's environment while a
 * caller read it as a statement about a tenant.
 *
 * PI credentials are tenant-owned (A3M), and this function has no tenant. So
 * it no longer guesses: the caller must supply the answer from the tenant's
 * own credential store, and a caller that cannot must pass `false` and get
 * `credential_missing` rather than an inferred readiness.
 */
export function resolveConnectionState(
  source: AcquisitionSourceDescriptor,
  hasAdapter: boolean,
  credentialPresent: boolean,
): { state: ConnectionState; reason: string } {
  if (source.sourceType === 'browser_extension') {
    // The extension needs no server credential. It is `available` because its
    // observations do not yet reach the PI evidence spine — a wiring gap, which
    // is a different thing from being disconnected.
    return {
      state: 'available',
      reason: 'installed and operational for engagement, but not yet wired to PI evidence (source_records)',
    };
  }
  if (source.sourceType === 'manual') {
    return { state: 'connected', reason: 'operator entry needs no connection' };
  }
  if (source.sourceType === 'gateway_api' && !source.gatewayProviders?.some((p) => p.selected)) {
    return { state: 'unsupported', reason: 'no concrete sub-provider has been selected behind this gateway' };
  }
  if (!hasAdapter) {
    return { state: 'unsupported', reason: 'declared only — no adapter is registered' };
  }
  if (!credentialPresent) {
    return {
      state: 'credential_missing',
      reason: 'this tenant has not configured a credential for this source',
    };
  }
  return { state: 'connected', reason: 'adapter registered and this tenant has configured a credential' };
}

/**
 * Every source with its live state. The authoritative "what can we use?".
 *
 * `credentialPresent` is required for the reason given on
 * `resolveConnectionState`: it is a question about a TENANT, and this module
 * has none. A caller with a tenant answers it from the tenant credential
 * store; a caller without one passes `() => false`.
 */
export function listSourceStatus(
  hasAdapter: (id: string) => boolean,
  credentialPresent: (envVar: string | null) => boolean,
): readonly SourceStatus[] {
  return ACQUISITION_SOURCES
    .map((source) => {
      const { state, reason } = resolveConnectionState(
        source, hasAdapter(source.id), credentialPresent(source.credentialEnvVar));
      return {
        ...source,
        connectionState: state,
        usable: USABLE_STATES.includes(state),
        stateReason: reason,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

/** Whether a source claims an entity and at least one requested attribute. */
export function supportsRequest(
  source: AcquisitionSourceDescriptor,
  subject: EnrichmentSubject,
  attributes: readonly string[],
): boolean {
  if (!source.capabilities.entities.includes(subject)) return false;
  return attributes.some((a) => source.capabilities.attributes.includes(a));
}
