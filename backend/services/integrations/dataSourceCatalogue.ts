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
 * Every provider below is `available: false` — declared, not implemented. The
 * two exceptions are `manual` and `crm`, which are genuinely released
 * (LI-4E / LI-5E.4) and reachable through their own governed routes.
 */

/** Where a data source sits in the Company Admin integration hub. */
export const DATA_SOURCE_GROUPS = ['prospect_discovery', 'enrichment', 'crm_import'] as const;
export type DataSourceGroup = typeof DATA_SOURCE_GROUPS[number];

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

export interface DataSourceDefinition {
  /** Stable key. Matches the LI-4D adapter source key where one exists. */
  readonly key: string;
  readonly label: string;
  readonly group: DataSourceGroup;
  /**
   * Whether the platform can actually use this source TODAY. False means
   * declared-only: the hub shows it so the shape of the roadmap is visible,
   * and refuses to pretend it can be connected.
   */
  readonly available: boolean;
  /** What connecting it would require. Empty when nothing is needed. */
  readonly requires: readonly string[];
  /** One line an operator can act on. Never marketing copy. */
  readonly note: string;
}

/**
 * The declared catalogue.
 *
 * Ordered by group so the hub can render sections without sorting logic. Keys
 * are frozen: they become part of the URL and of any future integration row, so
 * renaming one later is a migration, not an edit.
 */
export const DATA_SOURCE_CATALOGUE: readonly DataSourceDefinition[] = Object.freeze([
  {
    key: 'manual',
    label: 'Manual entry',
    group: 'prospect_discovery',
    available: true,
    requires: [],
    note: 'Operator-entered records. Released and reachable; no credential needed.',
  },
  {
    key: 'crm',
    label: 'CRM record (operator-supplied)',
    group: 'crm_import',
    available: true,
    requires: [],
    note: 'Operator-supplied CRM records. A namespace, not a CRM connection — no provider is contacted.',
  },
  {
    key: 'csv',
    label: 'CSV / Excel import',
    group: 'prospect_discovery',
    available: false,
    requires: ['file_upload'],
    note: 'Declared only. No ingestion adapter exists yet.',
  },
  {
    key: 'linkedin_sales_navigator',
    label: 'LinkedIn / Sales Navigator',
    group: 'prospect_discovery',
    available: false,
    requires: ['oauth', 'provider_terms_review'],
    note: 'Declared only. Existing LinkedIn support covers publishing and engagement, not prospect discovery.',
  },
  {
    key: 'apollo',
    label: 'Apollo',
    group: 'prospect_discovery',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. No adapter and no credential configuration exist.',
  },
  {
    key: 'zoominfo',
    label: 'ZoomInfo',
    group: 'prospect_discovery',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. No adapter and no credential configuration exist.',
  },
  {
    key: 'crunchbase',
    label: 'Crunchbase',
    group: 'prospect_discovery',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. No adapter and no credential configuration exist.',
  },
  {
    key: 'rapidapi',
    label: 'RapidAPI',
    group: 'enrichment',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. No adapter and no credential configuration exist.',
  },
  {
    key: 'apollo_enrichment',
    label: 'Apollo enrichment',
    group: 'enrichment',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. Enrichment is a later phase.',
  },
  {
    key: 'zoominfo_enrichment',
    label: 'ZoomInfo enrichment',
    group: 'enrichment',
    available: false,
    requires: ['api_key'],
    note: 'Declared only. Enrichment is a later phase.',
  },
]);

export function getDataSourceDefinition(key: string): DataSourceDefinition | null {
  return DATA_SOURCE_CATALOGUE.find((d) => d.key === key) ?? null;
}

export function listDataSourcesByGroup(group: DataSourceGroup): DataSourceDefinition[] {
  return DATA_SOURCE_CATALOGUE.filter((d) => d.group === group);
}

/** One tenant's view of one definition. */
export interface DataSourceView extends DataSourceDefinition {
  readonly status: DataSourceStatus;
  /** The integration row backing `connected`, when there is one. Never a secret. */
  readonly integrationId: string | null;
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
    return { ...definition, status, integrationId };
  });
}
