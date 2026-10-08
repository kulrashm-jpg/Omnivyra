/**
 * B1b — ATTRIBUTE AUTHORITY, declared as DATA.
 *
 * Ratified by D22-B1a decision D-3:
 *
 *   "Authority is tenant-scoped data keyed by (entity_type, attribute). Do not
 *    hard-code provider names into the arbitration boundary."
 *
 * ─── WHY THIS IS A SEPARATE MODULE ─────────────────────────────────────────
 * `source_records.provider` is free TEXT on purpose — LI-2's own words: "a new
 * provider must never need a migration". A precedence rule written as a constant
 * in the arbitration code would undo that, and a repository test
 * (`prospectIdentityIngestionBoundary.test.ts`) fails the build if the boundary
 * ever names a provider. So authority arrives as an argument, and the shape of
 * that argument is the whole of this file.
 *
 * NO PROVIDER IS NAMED ANYWHERE IN THIS MODULE EITHER. A declaration is data a
 * tenant holds; it is never a fact about the codebase.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 * No storage. The owner ratified O-1 and O-7 as DEFERRED:
 *
 *   O-1  "Do not seed an operative Sales Navigator authority declaration."
 *   O-7  "Do NOT declare manual/operator assertions universally authoritative.
 *         Manual assertions participate in normal arbitration until a separate
 *         owner decision establishes manual authority."
 *
 * So there is no authoritative source today, for any attribute, in any tenant.
 * Creating a table to hold zero rows would reproduce exactly the defect O-3
 * names: `unified_persons.source_priority` is a JSONB column with zero readers
 * and zero writers that reads as though precedence were configured. One of
 * those is enough.
 *
 * `resolveAttributeAuthority` is therefore the SEAM, not the storage. It returns
 * an empty declaration today, and it is the single place a future gate attaches
 * a table, a settings row or a policy service — without touching arbitration.
 *
 * ─── WHAT AN EMPTY DECLARATION MEANS ───────────────────────────────────────
 * Source-neutral. Arbitration falls straight through to recency (D-1) and the
 * confidence tie-break (D-2). That is today's intended behaviour, not a
 * degraded mode, and it is why deferring every declaration blocks nothing.
 */

import type { SourceEntityType } from './ingestionBoundary';

/** Bumped when the declaration contract changes, so a caller can trace it. */
export const ATTRIBUTE_AUTHORITY_VERSION = 'b1b.1';

/**
 * One tenant's authority declaration for ONE entity type.
 *
 * The full key is (organization_id, entity_type, attribute) — the tenant and
 * the entity type are fixed by the call that resolved this object, and
 * `byAttribute` carries the last leg. Field-level by construction: there is no
 * way to express "provider X wins for the whole prospect", which D22-B1a §11
 * forbids.
 *
 * A provider key is compared case-insensitively against
 * `source_assertions.provider` after trimming, because `provider` is free text
 * and a declaration must not fail on 'Apollo' vs 'apollo'.
 */
export interface AttributeAuthority {
  readonly entityType: SourceEntityType;
  /**
   * attribute -> the provider keys declared authoritative for it.
   *
   * An absent attribute, or an empty array, means SOURCE-NEUTRAL: arbitration
   * uses recency then confidence. An entry with several providers means "any of
   * these outranks every other source", and if they then disagree with each
   * other, recency decides AMONG THEM (authority narrows the field, it never
   * widens it).
   */
  readonly byAttribute: Readonly<Record<string, readonly string[]>>;
}

/** The source-neutral declaration. Returned whenever nothing is declared. */
export function noAttributeAuthority(entityType: SourceEntityType): AttributeAuthority {
  return { entityType, byAttribute: {} };
}

/**
 * Normalise a provider key for comparison. Exported so arbitration and any
 * future declaration writer agree on what "the same provider" means.
 */
export function normalizeProviderKey(provider: string | null | undefined): string {
  return typeof provider === 'string' ? provider.trim().toLowerCase() : '';
}

/**
 * The provider keys declared authoritative for one attribute, normalised and
 * de-duplicated. Empty means source-neutral.
 *
 * Pure, and total: an unknown attribute is source-neutral rather than an error,
 * because a declaration naming an attribute the surface does not have must not
 * be able to break ingestion.
 */
export function authoritativeProvidersFor(
  authority: AttributeAuthority | null | undefined,
  attribute: string,
): readonly string[] {
  const declared = authority?.byAttribute?.[attribute];
  if (!declared || declared.length === 0) return [];
  const out: string[] = [];
  for (const p of declared) {
    const key = normalizeProviderKey(p);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Build a declaration from a plain attribute->providers map, dropping anything
 * unusable. The validating constructor a future storage layer should go through
 * rather than casting a JSON blob into the type.
 *
 * `allowedColumns` is required: a declaration may only name an attribute that
 * is actually on the canonical surface for this entity type. Without that check
 * a typo silently declares authority over nothing and reads as though it had
 * taken effect.
 */
export function buildAttributeAuthority(
  entityType: SourceEntityType,
  declared: Readonly<Record<string, readonly string[]>>,
  allowedColumns: readonly string[],
): { authority: AttributeAuthority; rejected: string[] } {
  const byAttribute: Record<string, readonly string[]> = {};
  const rejected: string[] = [];

  for (const [attribute, providers] of Object.entries(declared ?? {})) {
    if (!allowedColumns.includes(attribute)) { rejected.push(attribute); continue; }
    const keys: string[] = [];
    for (const p of providers ?? []) {
      const key = normalizeProviderKey(p);
      if (key && !keys.includes(key)) keys.push(key);
    }
    if (keys.length === 0) { rejected.push(attribute); continue; }
    byAttribute[attribute] = keys;
  }

  return { authority: { entityType, byAttribute }, rejected };
}

/**
 * Resolve the declaration for a tenant and entity type.
 *
 * TODAY: always source-neutral. O-1 and O-7 are ratified as deferred, so no
 * authoritative source exists for any attribute in any tenant, and this
 * function performs NO I/O — it cannot fail, cannot be slow and cannot leak
 * across tenants.
 *
 * The tenant argument is REQUIRED even though it is currently unused, and it is
 * validated. A resolver that accepts an absent tenant is a resolver that will
 * one day return another tenant's policy; refusing now is free, and the seam is
 * the only place that guarantee can be made before storage exists.
 */
export async function resolveAttributeAuthority(
  organizationId: string,
  entityType: SourceEntityType,
): Promise<AttributeAuthority> {
  if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new Error('resolveAttributeAuthority: organizationId is required — authority is never global');
  }
  return noAttributeAuthority(entityType);
}
