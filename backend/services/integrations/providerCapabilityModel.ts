/**
 * PHASE 2 — the canonical provider capability model.
 *
 * ─── THE QUESTION THIS REPLACES ───────────────────────────────────────────
 * Every surface used to ask "is this provider AVAILABLE?", and that question has
 * no single answer. Apollo is usable for enrichment and cannot do discovery at
 * all; ZoomInfo can hold a credential and can do nothing with it; CSV is fully
 * released and holds no credential. One boolean collapsed four independent facts
 * into whichever one its author was thinking about, and `DATA_SOURCE_CATALOGUE`
 * then asserted that boolean as truth beside registries that disagreed with it.
 *
 * The hub now asks "what capabilities does this provider have, and in what
 * state?" — which is answerable.
 *
 * ─── FOUR LAYERS, AND NONE IS DERIVED FROM ANOTHER ────────────────────────
 *   A. PROVIDER       identity, and which capabilities it CLAIMS.
 *                     `registered`, and per capability `blocked` / `planned`.
 *   B. CAPABILITY     per provider × capability: `implemented`, `executable`.
 *                     Declared from code evidence, never computed.
 *   C. TENANT CONFIG  can the PLATFORM accept a tenant credential for it
 *                     (`credentialMode`, `tenantConfigurable`) — the static half;
 *                     whether a given tenant HAS one (`credentialed`) is tenant
 *                     state and is never stored here.
 *   D. RUNTIME        `operationallyVerified` — a real execution was observed
 *                     and recorded. Declared ONLY from evidence, in its own
 *                     registry, and empty for every external provider.
 *
 * The prohibition is the whole point and is enforced by tests:
 *   credentialed  ≠ executable
 *   implemented   ≠ operationally verified
 *   registered    ≠ operational
 *   enrichment-capable ≠ discovery-capable
 *
 * Nothing in this file computes one layer from another. `implemented` and
 * `executable` are both written down, because "we built it" and "there is a
 * working call path" came apart in this codebase before: adapters existed for
 * months while the cost gate refused every call.
 *
 * ─── IT IS NOT A SECOND REGISTRY ──────────────────────────────────────────
 * It introduces no provider that `ACQUISITION_SOURCES` does not already define,
 * and it owns none of what the specialized registries own:
 *   `ACQUISITION_SOURCES`     tenant provider identity, auth mode, funding
 *   `leadIngestion/registry`  runtime source translation
 *   `platform_registry`       social-platform capabilities
 *   `PROVIDER_CATALOG`        platform-owned spend/quota/governance
 *   `transportRegistry`       dispatchable engagement channels
 *   `integrationCatalog`      onboarding/presentation metadata
 * This file owns ONE question — what state is a provider's capability in — and
 * it is the only thing allowed to answer it. It performs no I/O and holds no
 * credential.
 */

/** The capability kinds a provider can claim. */
export const CAPABILITY_KINDS = ['acquisition', 'discovery', 'enrichment', 'engagement'] as const;
export type CapabilityKind = typeof CAPABILITY_KINDS[number];

/**
 * Why a capability cannot proceed for a reason outside engineering.
 *
 * `blocked` is NOT "not built yet" — it means building it would not help, which
 * is a different thing for an operator to read.
 */
export const BLOCKED_REASONS = ['provider_terms_review', 'oauth_grant_unavailable'] as const;
export type BlockedReason = typeof BLOCKED_REASONS[number];

/** Layer A (per capability) + Layer B. */
export interface CapabilityState {
  /** Layer B — we have built it. */
  readonly implemented: boolean;
  /**
   * Layer B — a call path exists end to end: adapter registered, executor
   * reachable, and no gate that refuses unconditionally. Declared separately
   * from `implemented` because the two have genuinely diverged here.
   */
  readonly executable: boolean;
  /** Layer A — blocked for a non-engineering reason, with that reason. */
  readonly blocked?: BlockedReason;
  /** Layer A — declared for the roadmap, with one line an operator can act on. */
  readonly planned?: string;
}

/** How the PLATFORM would accept a credential for this provider. Layer C, static half. */
export const CREDENTIAL_MODES = ['api_key', 'gateway_api_key', 'oauth', 'not_applicable'] as const;
export type CredentialMode = typeof CREDENTIAL_MODES[number];

export interface ProviderCapabilityDefinition {
  /** Layer A — the ONE identity for this vendor. `apollo`, never `apollo_enrichment`. */
  readonly providerId: string;
  readonly label: string;
  /** Layer A — it exists in this model, which is what `registered` means. */
  readonly registered: true;
  readonly capabilities: Readonly<Partial<Record<CapabilityKind, CapabilityState>>>;
  readonly credentialMode: CredentialMode;
  /**
   * Layer C — may a tenant store a credential for this provider through the
   * existing A3P control plane? TRUE for a provider whose credential the
   * platform accepts, INDEPENDENTLY of whether anything can use it. ZoomInfo is
   * the case that makes the independence matter.
   */
  readonly tenantConfigurable: boolean;
}

/**
 * The canonical providers.
 *
 * Every entry's state is written from code evidence, and the evidence is named.
 * No provider appears here that `ACQUISITION_SOURCES` or the released ingestion
 * routes do not already define, and no provider mentioned only in past
 * discussions appears at all — PeopleDataLabs, Hunter and BuiltWith are absent
 * from the repository and are therefore absent here.
 */
export const PROVIDER_CAPABILITIES: readonly ProviderCapabilityDefinition[] = Object.freeze([
  // ── Operator-supplied acquisition. Released routes, no vendor, no credential ──
  {
    providerId: 'manual',
    label: 'Manual entry',
    registered: true,
    // Evidence: `manualAdapter` registered in `leadIngestion/index.ts`, reachable
    // at `pages/api/lead-ingestion/manual.ts`.
    capabilities: { acquisition: { implemented: true, executable: true } },
    credentialMode: 'not_applicable',
    tenantConfigurable: false,
  },
  {
    providerId: 'csv',
    label: 'CSV / Excel import',
    registered: true,
    // Evidence: `csvAdapter` registered, reachable at
    // `pages/api/lead-ingestion/csv.ts`. Released as PI-P1-W02.
    capabilities: { acquisition: { implemented: true, executable: true } },
    credentialMode: 'not_applicable',
    tenantConfigurable: false,
  },
  {
    providerId: 'crm',
    label: 'CRM record (operator-supplied)',
    registered: true,
    // Evidence: `crmAdapter` registered, reachable at
    // `pages/api/lead-ingestion/crm.ts`. A namespace, not a CRM connection.
    capabilities: { acquisition: { implemented: true, executable: true } },
    credentialMode: 'not_applicable',
    tenantConfigurable: false,
  },

  // ── Tenant-subscription vendors ───────────────────────────────────────────
  {
    providerId: 'apollo',
    label: 'Apollo',
    registered: true,
    capabilities: {
      // Evidence for BOTH flags: `apolloEnrichmentAdapter` is registered at load
      // by `registerPiEnrichmentAdapters`, and the production composition uses
      // `tenantFundedExecutionPort`, whose own header states that "a tenant who
      // has stored a key for Clearbit or Apollo therefore reaches the provider".
      // So the call path exists — which is `executable`, and is NOT the same
      // claim as `operationallyVerified`.
      enrichment: { implemented: true, executable: true },
      // PHASE 4 — discovery is now implemented and callable.
      //
      // Evidence for BOTH flags: `apolloDiscoveryAdapter` implements the frozen
      // `DiscoveryProviderAdapter` against `POST /api/v1/mixed_people/search`,
      // `apolloLeadSourceAdapter` provides the pure translation half, and
      // `registerDiscoveryAdapters()` registers the pair — so the executor no
      // longer answers `provider_not_registered` and the chain runs end to end
      // through the attempt ledger into canonical ingestion.
      //
      // What this is NOT: operationally verified. No Apollo call has ever been
      // made from this repository, and a passing mock is not Layer D evidence.
      // `OPERATIONAL_VERIFICATIONS` below therefore still has no Apollo entry,
      // which is what keeps this capability reading `not_operational`.
      discovery: { implemented: true, executable: true },
    },
    credentialMode: 'api_key',
    tenantConfigurable: true,
  },
  {
    providerId: 'clearbit',
    label: 'Clearbit',
    registered: true,
    // Evidence: `clearbitEnrichmentAdapter` registered alongside Apollo.
    capabilities: { enrichment: { implemented: true, executable: true } },
    credentialMode: 'api_key',
    tenantConfigurable: true,
  },
  {
    providerId: 'zoominfo',
    label: 'ZoomInfo',
    registered: true,
    // Credential-storable and useless: no adapter exists for either capability.
    // `tenantConfigurable: true` below is deliberately NOT contradicted here —
    // that is layer C, this is layer B, and they are different facts.
    capabilities: {
      enrichment: { implemented: false, executable: false, planned: 'Declared only. No adapter exists.' },
      discovery: { implemented: false, executable: false, planned: 'Declared only. No adapter exists.' },
    },
    credentialMode: 'api_key',
    tenantConfigurable: true,
  },
  {
    providerId: 'crunchbase',
    label: 'Crunchbase',
    registered: true,
    capabilities: {
      discovery: { implemented: false, executable: false, planned: 'Declared only. No adapter exists.' },
    },
    credentialMode: 'api_key',
    tenantConfigurable: true,
  },
  {
    providerId: 'rapidapi',
    label: 'RapidAPI',
    registered: true,
    // A marketplace with no sub-provider selected, so there is nothing to build
    // an adapter against yet.
    capabilities: {
      enrichment: {
        implemented: false,
        executable: false,
        planned: 'Declared only. RapidAPI is a marketplace and no sub-provider has been selected.',
      },
    },
    credentialMode: 'gateway_api_key',
    tenantConfigurable: true,
  },

  // ── Blocked, not merely unbuilt ───────────────────────────────────────────
  {
    providerId: 'linkedin_sales_navigator',
    label: 'LinkedIn / Sales Navigator',
    registered: true,
    capabilities: {
      discovery: {
        implemented: false,
        executable: false,
        blocked: 'provider_terms_review',
        planned: 'Requires an OAuth grant and a provider terms review Omnivyra does not hold.',
      },
    },
    // Not storable through the A3P control plane: that path accepts an API key,
    // and this provider authenticates by OAuth. Refusing is honest.
    credentialMode: 'oauth',
    tenantConfigurable: false,
  },
]);

const BY_ID = new Map(PROVIDER_CAPABILITIES.map((p) => [p.providerId, p]));

export function getProviderCapabilities(providerId: string): ProviderCapabilityDefinition | null {
  return BY_ID.get(String(providerId ?? '').trim().toLowerCase()) ?? null;
}

export function getCapability(
  providerId: string,
  kind: CapabilityKind,
): CapabilityState | null {
  return getProviderCapabilities(providerId)?.capabilities?.[kind] ?? null;
}

/** Every provider claiming a capability of this kind, in declaration order. */
export function providersWithCapability(kind: CapabilityKind): ProviderCapabilityDefinition[] {
  return PROVIDER_CAPABILITIES.filter((p) => p.capabilities[kind] !== undefined);
}

/** One (provider, capability) pair. */
export interface CapabilityRef {
  readonly providerId: string;
  readonly capability: CapabilityKind;
}

/**
 * LAYER D — observed operational verification, and NOTHING ELSE may write here.
 *
 * ─── WHY THIS LIST IS ALMOST EMPTY ────────────────────────────────────────
 * "Operational" means a real execution was observed and recorded. No external
 * provider has one: no Apollo or Clearbit call has ever been made from this
 * repository, so neither is verified however complete its adapter is. Adding an
 * entry here on the strength of an adapter existing would reintroduce exactly
 * the confusion Phase 2 exists to remove.
 *
 * The three acquisition sources ARE listed, and the basis is stated: their
 * "provider" is Omnivyra's own released route, exercised by its own tests. That
 * is a genuinely different kind of evidence from a vendor call, which is why the
 * basis is recorded rather than implied.
 *
 * Phase 6 owns real provider certification. Until then this list does not grow.
 */
export const OPERATIONAL_VERIFICATIONS: readonly (CapabilityRef & { readonly basis: string })[] =
  Object.freeze([
    { providerId: 'manual', capability: 'acquisition', basis: 'released_route' },
    { providerId: 'csv', capability: 'acquisition', basis: 'released_route' },
    { providerId: 'crm', capability: 'acquisition', basis: 'released_route' },
  ]);

export function isOperationallyVerified(providerId: string, capability: CapabilityKind): boolean {
  const id = String(providerId ?? '').trim().toLowerCase();
  return OPERATIONAL_VERIFICATIONS.some((v) => v.providerId === id && v.capability === capability);
}

/**
 * What a surface renders for one capability.
 *
 * A VIEW over the four layers, deliberately named so it cannot be mistaken for a
 * fifth layer. It reads the layers; it never writes them, and no layer is
 * defined in terms of this function's output.
 */
export const PRESENTATION_STATUSES = [
  'operational',
  'not_operational',
  'planned',
  'blocked',
  'not_implemented',
] as const;
export type PresentationStatus = typeof PRESENTATION_STATUSES[number];

/**
 * Derive the presentation status for one capability.
 *
 * The order matters and each branch is a different message to an operator:
 *   blocked          waiting on something engineering cannot deliver
 *   planned          declared, deliberately not built
 *   not_implemented  claimed but with neither an implementation nor a plan note
 *   not_operational  built and callable, but never proven against the vendor
 *   operational      proven
 */
export function derivePresentationStatus(
  providerId: string,
  capability: CapabilityKind,
): PresentationStatus {
  const state = getCapability(providerId, capability);
  if (!state) return 'not_implemented';
  if (state.blocked) return 'blocked';
  if (!state.implemented || !state.executable) {
    return state.planned ? 'planned' : 'not_implemented';
  }
  // Implemented AND callable. Whether it WORKS is layer D, and only layer D.
  return isOperationallyVerified(providerId, capability) ? 'operational' : 'not_operational';
}

/**
 * May a connect form be offered for this provider? — owner decision O-2.
 *
 * Both halves are required and they are different layers: the platform must
 * accept a credential (C), AND something must be able to use it (B). ZoomInfo,
 * Crunchbase and RapidAPI satisfy the first and fail the second, which is
 * exactly the case that previously produced a key form for a provider the cost
 * gate would refuse.
 *
 * It deliberately does NOT consult layer D. Requiring verification before
 * allowing configuration would make the first verification impossible — you
 * cannot prove a provider works without first storing its key.
 */
export function mayOfferCredentialForm(providerId: string): boolean {
  const provider = getProviderCapabilities(providerId);
  if (!provider || !provider.tenantConfigurable) return false;
  return Object.values(provider.capabilities).some((c) => c.implemented && c.executable);
}

/** Provider ids whose connect form the hub may show. The O-2 allowlist, derived. */
export function credentialFormProviderIds(): string[] {
  return PROVIDER_CAPABILITIES.filter((p) => mayOfferCredentialForm(p.providerId))
    .map((p) => p.providerId);
}

/**
 * PHASE 3 — may THIS CAPABILITY offer a configuration action?
 *
 * ─── WHY THIS IS NOT `mayOfferCredentialForm` ─────────────────────────────
 * The two answer different questions and Apollo is why. A credential is held per
 * PROVIDER — one Apollo key, one row in `integration_credentials` — so
 * `mayOfferCredentialForm('apollo')` is correctly true: there is a key worth
 * storing. But Apollo's DISCOVERY capability must not offer its own connect
 * action, because storing that key does nothing for discovery and a button
 * beside "Planned" would say otherwise.
 *
 * So: the provider-level function gates the credential PANEL (one form per
 * provider), and this capability-level function gates an individual capability
 * CARD. Both are required and they are not the same rule.
 */
export function isCapabilityConnectable(providerId: string, capability: CapabilityKind): boolean {
  const provider = getProviderCapabilities(providerId);
  const state = getCapability(providerId, capability);
  if (!provider || !state) return false;
  return state.implemented && state.executable && provider.tenantConfigurable;
}

/** One line explaining a blocked reason, in the model's own vocabulary. */
export function describeBlockedReason(reason: BlockedReason): string {
  switch (reason) {
    case 'provider_terms_review':
      return 'Waiting on a provider terms review Omnivyra does not hold. This is not an engineering task.';
    case 'oauth_grant_unavailable':
      return 'Requires an OAuth grant that is not available to Omnivyra.';
    default:
      return 'Blocked for a reason outside engineering.';
  }
}

/**
 * Whether a TENANT has stored a credential — supplied by the caller, never here.
 *
 * `unknown` is the honest default: this module has no tenant, so it cannot know.
 * `not_applicable` belongs to a provider that takes no credential at all, which
 * is a different statement from "has none".
 */
export const CREDENTIAL_STATES = ['not_applicable', 'unknown', 'configured', 'not_configured'] as const;
export type CredentialState = typeof CREDENTIAL_STATES[number];

/** What an operator can do about this capability right now. */
export const CAPABILITY_ACTIONS = ['configure', 'none'] as const;
export type CapabilityAction = typeof CAPABILITY_ACTIONS[number];

/**
 * PHASE 3 — the canonical provider card. ONE representation, consumed by every
 * surface.
 *
 * It exists so no UI component assembles provider state from registry fragments
 * of its own choosing. It is a derived VIEW: nothing here is stored, no row is
 * written, and tenant state enters only as the caller's `credentialed` argument —
 * the static model never learns it.
 */
export interface ProviderCapabilityCard {
  readonly providerId: string;
  readonly label: string;
  readonly capability: CapabilityKind;
  readonly status: PresentationStatus;
  readonly implemented: boolean;
  readonly executable: boolean;
  readonly tenantConfigurable: boolean;
  /** §6: capability + implemented + executable + tenant-configurable. */
  readonly connectable: boolean;
  readonly credentialState: CredentialState;
  readonly action: CapabilityAction;
  /** Why it is blocked, planned, or unverified. Null when there is nothing to explain. */
  readonly reason: string | null;
}

/**
 * Build the card for one (provider, capability).
 *
 * `credentialed` is the tenant fact, and the caller owns it: `true`/`false` when
 * a tenant-scoped read has answered, `null`/omitted when there is no tenant or no
 * answer yet. A missing tenant therefore produces `unknown` rather than
 * `not_configured`, because those read very differently to an operator and only
 * one of them is true before a company is chosen.
 *
 * The action is `configure` ONLY when the capability is connectable. A stored
 * credential never promotes it, and an absent one never demotes it — that is the
 * credential ⇒ capability inference this model exists to prevent.
 */
export function buildCapabilityCard(
  providerId: string,
  capability: CapabilityKind,
  opts: { readonly credentialed?: boolean | null } = {},
): ProviderCapabilityCard | null {
  const provider = getProviderCapabilities(providerId);
  const state = getCapability(providerId, capability);
  if (!provider || !state) return null;

  const status = derivePresentationStatus(providerId, capability);
  const connectable = isCapabilityConnectable(providerId, capability);

  let credentialState: CredentialState = 'unknown';
  if (provider.credentialMode === 'not_applicable') credentialState = 'not_applicable';
  else if (opts.credentialed === true) credentialState = 'configured';
  else if (opts.credentialed === false) credentialState = 'not_configured';

  let reason: string | null = null;
  if (state.blocked) reason = describeBlockedReason(state.blocked);
  else if (state.planned) reason = state.planned;
  else if (status === 'not_operational') {
    reason = 'Implemented and callable with your own key, but no execution has been verified against the provider yet.';
  }

  return {
    providerId: provider.providerId,
    label: provider.label,
    capability,
    status,
    implemented: state.implemented,
    executable: state.executable,
    tenantConfigurable: provider.tenantConfigurable,
    connectable,
    credentialState,
    action: connectable ? 'configure' : 'none',
    reason,
  };
}

/** Every card for one capability kind, in declaration order. */
export function buildCapabilityCards(
  capability: CapabilityKind,
  opts: { readonly credentialed?: Readonly<Record<string, boolean>> } = {},
): ProviderCapabilityCard[] {
  return providersWithCapability(capability)
    .map((p) => buildCapabilityCard(p.providerId, capability, {
      credentialed: opts.credentialed ? (opts.credentialed[p.providerId] ?? false) : null,
    }))
    .filter((c): c is ProviderCapabilityCard => c !== null);
}
