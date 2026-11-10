/**
 * R1: which information Apollo fills, chosen by the TENANT per data group.
 *
 * Owner decisions (2026-11-10):
 *  - both credential modes (the tenant's own key, or the platform key) honour
 *    the tenant's choice;
 *  - contact data is a choosable group, DEFAULT OFF, and it REFUSES until the
 *    owner records a lawful basis for holding vendor-sourced contact data (L1);
 *  - phone is deferred to v2;
 *  - platform-funded calls are charged per chosen group (mode B, separate module).
 *
 * A group can only NARROW what is fetched. An attribute is fetched only when
 * it is in a chosen group AND claimed by the adapter
 * (`APOLLO_SUPPORTED_ATTRIBUTES`, extended only after live verification).
 *
 * Storage: the tenant's existing `feature_flags` row `apollo_field_groups`
 * (`metadata.groups`), through `upsertFeatureFlag`, the same tenant-policy
 * pattern the enrichment spend ceiling uses. No schema change.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { upsertFeatureFlag } from '../featureFlagService';
import { APOLLO_SUPPORTED_ATTRIBUTES } from './providers/adapters/apollo';

export const APOLLO_FIELD_GROUPS_FLAG_KEY = 'apollo_field_groups';

export type ApolloFieldGroupId = 'job_role' | 'company_firmographics' | 'technologies' | 'contact_email' | 'contact_phone';

export interface ApolloFieldGroup {
  readonly id: ApolloFieldGroupId;
  readonly label: string;
  readonly subject: 'person' | 'account';
  /** Canonical attributes this group may fill (still gated by the adapter's claims). */
  readonly attributes: readonly string[];
  /** Whether it may be chosen at all right now, and if not, why (tenant-facing). */
  readonly availability: { readonly available: true } | { readonly available: false; readonly reason: string };
  /** Contact data: priced at the higher rate and default off (owner R1). */
  readonly contact: boolean;
}

/**
 * L1: no lawful basis has been recorded by the owner for holding
 * vendor-sourced contact data. A code constant, like the capture switch: it is
 * flipped only by a reviewed change after the owner records the basis.
 */
export const CONTACT_DATA_LAWFUL_BASIS_RECORDED: boolean = false;

export const APOLLO_FIELD_GROUPS: readonly ApolloFieldGroup[] = Object.freeze([
  {
    id: 'job_role', label: 'Job and role (title, seniority, location)', subject: 'person',
    attributes: ['job_title', 'seniority', 'city', 'region'], availability: { available: true }, contact: false,
  },
  {
    id: 'company_firmographics', label: 'Company firmographics (size, industry, founded)', subject: 'account',
    attributes: ['employee_count', 'industry', 'founded_year'], availability: { available: true }, contact: false,
  },
  {
    id: 'technologies', label: 'Technologies the company uses', subject: 'account',
    attributes: ['technologies'], availability: { available: true }, contact: false,
  },
  {
    id: 'contact_email', label: 'Work email', subject: 'person', attributes: ['email'], contact: true,
    availability: CONTACT_DATA_LAWFUL_BASIS_RECORDED
      ? { available: true }
      : { available: false, reason: 'Not yet available: the lawful basis for holding provider-sourced contact data has not been recorded.' },
  },
  {
    id: 'contact_phone', label: 'Phone', subject: 'person', attributes: ['phone'], contact: true,
    availability: { available: false, reason: 'Planned for a later release.' },
  },
] as ApolloFieldGroup[]);

/** The owner's default when a tenant has chosen nothing: no contact data. */
export const DEFAULT_APOLLO_FIELD_GROUPS: readonly ApolloFieldGroupId[] = Object.freeze(['job_role', 'company_firmographics']);

const byId = (id: string) => APOLLO_FIELD_GROUPS.find((g) => g.id === id);

export class FieldGroupSelectionRefused extends Error {
  constructor(readonly code: 'unknown_group' | 'group_unavailable' | 'empty_selection', readonly group?: string) {
    super(`field group selection refused: ${code}${group ? ` (${group})` : ''}`);
    this.name = 'FieldGroupSelectionRefused';
  }
}

/** Validate a requested selection. Unknown or unavailable groups are REFUSED, never silently dropped. */
export function validateFieldGroups(groups: unknown): ApolloFieldGroupId[] {
  if (!Array.isArray(groups) || groups.length === 0) throw new FieldGroupSelectionRefused('empty_selection');
  const out: ApolloFieldGroupId[] = [];
  for (const g of groups) {
    const def = typeof g === 'string' ? byId(g) : undefined;
    if (!def) throw new FieldGroupSelectionRefused('unknown_group', String(g).slice(0, 40));
    if (!def.availability.available) throw new FieldGroupSelectionRefused('group_unavailable', def.id);
    if (!out.includes(def.id)) out.push(def.id);
  }
  return out;
}

/**
 * The tenant's chosen groups. No row means the owner's default. An UNREADABLE
 * setting throws: running enrichment on a guessed selection could fetch, and
 * charge for, data the tenant turned off.
 */
export async function readTenantFieldGroups(organizationId: string): Promise<ApolloFieldGroupId[]> {
  const res = await ownedDbTable('feature_flags').select('enabled, metadata')
    .eq('organization_id', organizationId).eq('flag_key', APOLLO_FIELD_GROUPS_FLAG_KEY).limit(1);
  if (res.error || (res.status !== 200 && res.status !== 206) || !Array.isArray(res.data)) {
    throw new Error('apollo field group setting could not be read');
  }
  const row = res.data[0] as { enabled?: boolean; metadata?: { groups?: unknown } } | undefined;
  if (!row || row.enabled !== true) return [...DEFAULT_APOLLO_FIELD_GROUPS];
  // A stored group that is no longer available (e.g. contact before L1) is
  // dropped at READ, never fetched; the rest of the selection stands.
  const stored = Array.isArray(row.metadata?.groups) ? row.metadata!.groups as unknown[] : [];
  const usable = stored.filter((g): g is ApolloFieldGroupId => typeof g === 'string' && !!byId(g) && byId(g)!.availability.available);
  return usable.length ? usable : [...DEFAULT_APOLLO_FIELD_GROUPS];
}

export async function writeTenantFieldGroups(organizationId: string, groups: unknown, userId: string): Promise<ApolloFieldGroupId[]> {
  const valid = validateFieldGroups(groups);
  await upsertFeatureFlag({
    organizationId,
    flagKey: APOLLO_FIELD_GROUPS_FLAG_KEY,
    enabled: true,
    rationale: 'Tenant choice of which data Apollo fills (R1).',
    metadata: { groups: valid },
    createdBy: userId,
  });
  return valid;
}

/**
 * The attributes the chosen groups allow, per subject, intersected with what
 * the adapter CLAIMS. An unclaimed attribute is never fetched, whatever the
 * tenant chose.
 */
export function allowedAttributesFor(
  groups: readonly ApolloFieldGroupId[],
  claimed: readonly string[] = APOLLO_SUPPORTED_ATTRIBUTES,
): { person: string[]; account: string[] } {
  const out = { person: [] as string[], account: [] as string[] };
  for (const id of groups) {
    const def = byId(id);
    if (!def || !def.availability.available) continue;
    for (const a of def.attributes) {
      if (claimed.includes(a) && !out[def.subject].includes(a)) out[def.subject].push(a);
    }
  }
  return out;
}

/** The group an attribute belongs to (for pricing and display). */
export function groupOfAttribute(subject: 'person' | 'account', attribute: string): ApolloFieldGroupId | null {
  return APOLLO_FIELD_GROUPS.find((g) => g.subject === subject && g.attributes.includes(attribute))?.id ?? null;
}
