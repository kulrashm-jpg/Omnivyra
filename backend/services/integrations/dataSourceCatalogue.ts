/**
 * PHASE-1A — the Data Sources catalogue.
 *
 * A DEFINITION registry, not an integration. Nothing here connects to a
 * provider, holds a credential, or performs I/O; it declares which data sources
 * the platform intends to support and what each one would need, so the Company
 * Admin integration hub has something truthful to render before any provider
 * exists.
 *
 * ─── WHY A CATALOGUE RATHER THAN ROWS ─────────────────────────────────────
 * The obvious shortcut is to seed a row per provider per tenant and let the UI
 * list them. That would make every tenant appear to "have" seven integrations
 * that do not exist, and `status` would be a value we wrote rather than a fact
 * we observed. Definitions live in code; only a REAL connection creates a row.
 * A provider with no row is `not_connected` because nothing was found — never
 * because something was seeded to say so.
 *
 * ─── STATUS IS DERIVED, NEVER ASSERTED ────────────────────────────────────
 * `resolveDataSourceStatus` reads the tenant's existing integration rows and
 * reports what it finds. It cannot return `connected` unless a row exists whose
 * status says so. There is deliberately no way to set a status here.
 *
 * ─── IT ACTIVATES NOTHING ─────────────────────────────────────────────────
 * Nothing here can make a provider usable. `manual`, `crm` and `csv` are
 * genuinely released (LI-4E / LI-5E.4 / PI-P1-W02) and reachable through their
 * own governed routes; every other row describes something that cannot be
 * connected today, and says why.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PHASE 2 — THIS MODULE IS NOW PRESENTATION ONLY
 * ══════════════════════════════════════════════════════════════════════════
 * It used to carry a hand-written `available` boolean, which made it an
 * independent authority on implementation state — and it drifted, because a
 * boolean maintained in one file cannot track code in another. `csv` shipped and
 * this file was not updated; Apollo gained an adapter and a credential path while
 * its note still read "No adapter and no credential configuration exist".
 *
 * `available` is now DERIVED from `providerCapabilityModel`, which is the single
 * authority on capability state. This file owns what it should: which rows the
 * hub shows, their grouping, what connecting one requires, and the note an
 * operator reads. It owns no truth about whether anything works.
 *
 * ─── ONE VENDOR IS ONE PROVIDER ───────────────────────────────────────────
 * `apollo` and `apollo_enrichment` are two catalogue KEYS — frozen, because a key
 * reaches URLs and integration rows — but one `providerId` with two different
 * capabilities. Same for ZoomInfo. The duplicate provider identity is gone
 * without breaking a single key.
 */

/** Where a data source sits in the Company Admin integration hub. */
export const DATA_SOURCE_GROUPS = ['prospect_discovery', 'enrichment', 'crm_import'] as const;
export type DataSourceGroup = typeof DATA_SOURCE_GROUPS[number];

// PHASE 2 — the ONE authority on capability state. This module derives from it
// and never restates it.
import {
  derivePresentationStatus,
  mayOfferCredentialForm,
  type CapabilityKind,
  type PresentationStatus,
} from './providerCapabilityModel';

/**
 * What a tenant sees for one provider.
 *
 * `configuration_required` is distinct from `not_connected`: it means a row
 * exists but is unusable, which is a different problem for the operator to fix.
 */
export const DATA_SOURCE_STATUSES = [
  'not_connected',
  'connected',
  'configuration_required',
  'error',
  'not_available',
] as const;
export type DataSourceStatus = typeof DATA_SOURCE_STATUSES[number];

/**
 * One row of the catalogue — a PRESENTATION entry, not an authority.
 *
 * ─── PHASE 2: WHAT THIS STOPPED OWNING ────────────────────────────────────
 * `available` used to be written here by hand, and was therefore an independent
 * claim about implementation state that could — and did — contradict the
 * registries. It is now DERIVED from `providerCapabilityModel`, which is the one
 * place allowed to answer "what state is this capability in".
 *
 * What this module still owns, and should: which rows the hub shows, which group
 * each sits in, what connecting one would require, and the operator-facing note.
 * Grouping and prose are presentation; capability state is not.
 */
export interface DataSourceDefinition {
  /** Stable key. Matches the LI-4D adapter source key where one exists. */
  readonly key: string;
  readonly label: string;
  readonly group: DataSourceGroup;
  /**
   * COMPATIBILITY FIELD — derived, never authored.
   *
   * Its meaning is deliberately unchanged from before Phase 2: "the platform can
   * actually use this source TODAY", which is `derivePresentationStatus(...) ===
   * 'operational'`. Existing consumers keep working and keep getting the same
   * semantics; the difference is that nobody maintains it by hand any more, so it
   * can no longer disagree with the capability model.
   *
   * New code should ask `derivePresentationStatus` for the distinction it
   * actually needs — `planned`, `blocked` and `not_operational` are three
   * different answers that this boolean flattens into `false`.
   */
  readonly available: boolean;
  /** What connecting it would require. Empty when nothing is needed. */
  readonly requires: readonly string[];
  /** One line an operator can act on. Never marketing copy. */
  readonly note: string;
  /**
   * The canonical PROVIDER this row presents, and WHICH of its capabilities.
   *
   * Phase 2 added these so one vendor stops being two providers. `apollo` and
   * `apollo_enrichment` are two catalogue KEYS — frozen, because a key reaches
   * URLs and integration rows — but they are ONE `providerId` with two different
   * capabilities. The duplicate provider identity is gone; the stable keys remain.
   */
  readonly providerId: string;
  readonly capability: CapabilityKind;
}

/**
 * The presentation rows.
 *
 * Everything here is presentation: which rows exist, their group, their note and
 * what connecting one would require. `available` is ABSENT by design — it is
 * derived below from the capability model, so this list cannot contradict it.
 *
 * Ordered by group so the hub renders sections without sorting logic. Keys are
 * frozen: they reach URLs and integration rows, so renaming one is a migration,
 * not an edit. That is why `apollo_enrichment` survives as a KEY while no longer
 * being a second provider identity.
 */
type PresentationRow = Omit<DataSourceDefinition, 'available'>;

const PRESENTATION_ROWS: readonly PresentationRow[] = Object.freeze([
  {
    key: 'manual',
    label: 'Manual entry',
    group: 'prospect_discovery',
    requires: [],
    note: 'Operator-entered records. Released and reachable; no credential needed.',
    providerId: 'manual',
    capability: 'acquisition',
  },
  {
    key: 'crm',
    label: 'CRM record (operator-supplied)',
    group: 'crm_import',
    requires: [],
    note: 'Operator-supplied CRM records. A namespace, not a CRM connection — no provider is contacted.',
    providerId: 'crm',
    capability: 'acquisition',
  },
  {
    key: 'csv',
    label: 'CSV / Excel import',
    group: 'prospect_discovery',
    requires: [],
    note: 'Client-parsed spreadsheet rows. Released and reachable; no credential, no upload — the file never reaches the server.',
    providerId: 'csv',
    capability: 'acquisition',
  },
  {
    key: 'linkedin_sales_navigator',
    label: 'LinkedIn / Sales Navigator',
    group: 'prospect_discovery',
    requires: ['oauth', 'provider_terms_review'],
    note: 'Blocked, not merely unbuilt: needs an OAuth grant and a provider terms review Omnivyra does not hold. Existing LinkedIn support covers publishing and engagement, not prospect discovery.',
    providerId: 'linkedin_sales_navigator',
    capability: 'discovery',
  },
  {
    key: 'apollo',
    label: 'Apollo (prospect discovery)',
    group: 'prospect_discovery',
    requires: ['api_key'],
    // PHASE 2 — the stale note corrected. The old text said "No adapter and no
    // credential configuration exist", which was false on both counts: a tenant
    // credential IS configurable through the A3P control plane, and an Apollo
    // adapter exists — for ENRICHMENT. Neither fact makes discovery possible,
    // and the note now says exactly that instead of overstating the gap.
    // PHASE 4 — discovery is implemented and callable, and has never been run
    // against the provider. The note says both, because they are both true and
    // an operator needs the second one.
    note: 'Implemented and callable with your own Apollo key. Not yet verified against the provider, so it is not operational. Uses the same tenant credential as Apollo enrichment.',
    providerId: 'apollo',
    capability: 'discovery',
  },
  {
    key: 'zoominfo',
    label: 'ZoomInfo (prospect discovery)',
    group: 'prospect_discovery',
    requires: ['api_key'],
    note: 'Declared only. A credential can be stored, but no adapter exists to use it.',
    providerId: 'zoominfo',
    capability: 'discovery',
  },
  {
    key: 'crunchbase',
    label: 'Crunchbase',
    group: 'prospect_discovery',
    requires: ['api_key'],
    note: 'Declared only. A credential can be stored, but no adapter exists to use it.',
    providerId: 'crunchbase',
    capability: 'discovery',
  },
  {
    key: 'rapidapi',
    label: 'RapidAPI',
    group: 'enrichment',
    requires: ['api_key'],
    note: 'Declared only. RapidAPI is a marketplace and no sub-provider has been selected, so there is nothing to build an adapter against.',
    providerId: 'rapidapi',
    capability: 'enrichment',
  },
  {
    key: 'apollo_enrichment',
    label: 'Apollo enrichment',
    group: 'enrichment',
    requires: ['api_key'],
    // Same provider as `apollo` above — one vendor, one identity, two capabilities.
    note: 'Implemented and callable with your own Apollo key. Not yet verified against the provider, so it is not operational.',
    providerId: 'apollo',
    capability: 'enrichment',
  },
  {
    key: 'zoominfo_enrichment',
    label: 'ZoomInfo enrichment',
    group: 'enrichment',
    requires: ['api_key'],
    note: 'Declared only. A credential can be stored, but no adapter exists to use it.',
    providerId: 'zoominfo',
    capability: 'enrichment',
  },
  {
    key: 'clearbit_enrichment',
    label: 'Clearbit enrichment',
    group: 'enrichment',
    requires: ['api_key'],
    // PHASE 2 — Clearbit was ABSENT from this catalogue while having a fully
    // registered adapter, so the hub's Data Sources view silently omitted one of
    // only two implemented enrichment providers. Added as presentation; its state
    // is derived like every other row.
    note: 'Implemented and callable with your own Clearbit key. Not yet verified against the provider, so it is not operational.',
    providerId: 'clearbit',
    capability: 'enrichment',
  },
]);

/**
 * The catalogue, with `available` DERIVED.
 *
 * Computed once at load from `derivePresentationStatus`, so the compatibility
 * boolean and the capability model cannot drift: there is no second place to
 * edit. `'operational'` is the only status that maps to `true`, which preserves
 * the field's original meaning exactly — "the platform can use this TODAY".
 */
export const DATA_SOURCE_CATALOGUE: readonly DataSourceDefinition[] = Object.freeze(
  PRESENTATION_ROWS.map((row) => Object.freeze({
    ...row,
    available: derivePresentationStatus(row.providerId, row.capability) === 'operational',
  })),
);

export function getDataSourceDefinition(key: string): DataSourceDefinition | null {
  return DATA_SOURCE_CATALOGUE.find((d) => d.key === key) ?? null;
}

export function listDataSourcesByGroup(group: DataSourceGroup): DataSourceDefinition[] {
  return DATA_SOURCE_CATALOGUE.filter((d) => d.group === group);
}

/**
 * One tenant's view of one definition — the canonical view model.
 *
 * It carries BOTH axes, because they answer different questions and flattening
 * them is what Phase 2 exists to undo:
 *   `status`           the tenant's CONNECTION state for this row
 *   `capabilityStatus` the capability's state, from the canonical model
 *
 * A UI reading this never has to infer provider state from registry fragments,
 * and never has to treat "not connected" and "cannot be connected" as one thing.
 */
export interface DataSourceView extends DataSourceDefinition {
  readonly status: DataSourceStatus;
  /** The integration row backing `connected`, when there is one. Never a secret. */
  readonly integrationId: string | null;
  /** Layer A–D, resolved. `planned` / `blocked` / `not_operational` are distinct. */
  readonly capabilityStatus: PresentationStatus;
  /**
   * May a connect form be offered for this provider? Owner decision O-2, derived
   * from the capability model — never from the presence of a credential.
   */
  readonly credentialFormAllowed: boolean;
}

/** The integration facts this module is willing to read. Never a credential. */
export interface TenantIntegrationRow {
  id: string;
  type: string;
  status: string | null;
}

/**
 * Derive one provider's status for a tenant from rows that already exist.
 *
 * Pure: the caller does the tenant-scoped read and passes the rows in, which
 * keeps this module free of database access and makes the derivation directly
 * testable. `rows` MUST already be scoped to one company — this function has no
 * way to verify that and does not pretend to.
 */
export function resolveDataSourceStatus(
  definition: DataSourceDefinition,
  rows: readonly TenantIntegrationRow[],
): { status: DataSourceStatus; integrationId: string | null } {
  // An unimplemented provider is never "not connected" — that would imply
  // connecting it is possible today. It is not available at all.
  //
  // PHASE 2: `available` is now DERIVED from the capability model, so this branch
  // can no longer be flipped by editing a hand-written boolean in this file. The
  // behaviour is unchanged; what changed is that it is no longer independently
  // assertable here.
  if (!definition.available) return { status: 'not_available', integrationId: null };

  const match = rows.find((r) => r.type === definition.key);
  if (!match) return { status: 'not_connected', integrationId: null };

  switch ((match.status ?? '').toLowerCase()) {
    case 'connected':
      return { status: 'connected', integrationId: match.id };
    case 'failed':
      return { status: 'error', integrationId: match.id };
    case 'pending':
      return { status: 'configuration_required', integrationId: match.id };
    default:
      // An unrecognised status is reported as needing attention rather than
      // being optimistically rounded up to connected.
      return { status: 'configuration_required', integrationId: match.id };
  }
}

/** The whole catalogue as one tenant sees it. */
export function buildDataSourceView(rows: readonly TenantIntegrationRow[]): DataSourceView[] {
  return DATA_SOURCE_CATALOGUE.map((definition) => {
    const { status, integrationId } = resolveDataSourceStatus(definition, rows);
    return {
      ...definition,
      status,
      integrationId,
      capabilityStatus: derivePresentationStatus(definition.providerId, definition.capability),
      credentialFormAllowed: mayOfferCredentialForm(definition.providerId),
    };
  });
}
