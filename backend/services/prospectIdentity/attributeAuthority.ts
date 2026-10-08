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
 * ─── STORAGE (b1b.2) ──────────────────────────────────────────────────────
 * b1b.1 left `resolveAttributeAuthority` as a SEAM with no storage behind it,
 * on two ratified grounds:
 *
 *   O-1  "Do not seed an operative Sales Navigator authority declaration."
 *   O-7  "Do NOT declare manual/operator assertions universally authoritative.
 *         Manual assertions participate in normal arbitration until a separate
 *         owner decision establishes manual authority."
 *
 * That separate owner decision has now been taken, so the seam is wired to
 * `attribute_authority_declarations` (migration 20261123000000). The storage
 * itself lives in `attributeAuthorityStore` — not here — because this module is
 * exempted from the LI-1 name scan on the strict condition that it cannot reach
 * a database, and b1b.1 said in as many words that a gate attaching storage
 * "must therefore put that storage in its own module".
 *
 * What did NOT change: O-1 still holds, nothing is seeded, and nothing is
 * universally authoritative. Human precedence became POSSIBLE, not automatic.
 * A tenant that declares nothing behaves exactly as it did under b1b.1.
 *
 * ─── WHAT AN EMPTY DECLARATION MEANS ───────────────────────────────────────
 * Source-neutral. Arbitration falls straight through to recency (D-1) and the
 * confidence tie-break (D-2). That is the intended behaviour, not a degraded
 * mode. It is NOT "no candidate may win": authority narrows the field, so an
 * empty declaration narrows nothing.
 *
 * An absent row and a stored-but-empty declaration both resolve this way. They
 * differ only in the audit trail: one tenant never answered the question, the
 * other answered "nothing here is authoritative".
 */

import { PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS } from './attributes';
import { loadAuthorityDeclarations } from './attributeAuthorityStore';
import type { AuthorityEntityType } from './attributeAuthorityStore';

export type { AuthorityEntityType };

/** Bumped when the declaration contract changes, so a caller can trace it. */
export const ATTRIBUTE_AUTHORITY_VERSION = 'b1b.2';

/**
 * The attributes a RELATIONSHIP declaration may address.
 *
 * These are facts about an employment rather than about a person, which is why
 * they are addressable at relationship scope at all: a tenant must be able to
 * declare who is authoritative for a title at one employer without that
 * decision reaching the same person's title at another.
 *
 * They are also members of the person surface, because the person spine still
 * carries them for its existing readers. Scope is what distinguishes the two
 * declarations, not the attribute name.
 */
export const RELATIONSHIP_AUTHORITY_COLUMNS = [
  'job_title', 'department', 'seniority', 'buying_role',
] as const;

/**
 * The canonical surface a declaration may name, per scope. A declaration over
 * an attribute the scope does not have is REJECTED rather than stored, because
 * a typo that silently declares authority over nothing reads exactly like a
 * declaration that took effect.
 */
export function authoritySurfaceFor(entityType: AuthorityEntityType): readonly string[] {
  if (entityType === 'account') return ACCOUNT_ATTRIBUTE_COLUMNS;
  if (entityType === 'relationship') return RELATIONSHIP_AUTHORITY_COLUMNS;
  return PERSON_ATTRIBUTE_COLUMNS;
}

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
  readonly entityType: AuthorityEntityType;
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
export function noAttributeAuthority(entityType: AuthorityEntityType): AttributeAuthority {
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
  entityType: AuthorityEntityType,
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
 * Resolve the declaration for a tenant and entity type. THE single production
 * authority-resolution path — there is deliberately no second one.
 *
 * The tenant argument is REQUIRED and validated. A resolver that accepts an
 * absent tenant is a resolver that will one day return another tenant's policy,
 * and now that storage exists behind this call that is no longer hypothetical:
 * the tenant is the first leg of the key it reads.
 *
 * It does NOT fall back to source-neutral when the read fails. A tenant that
 * declared human authority losing it to a transient outage would be the exact
 * defect this contract exists to prevent, and silently applying recency instead
 * would be invisible. The store throws; so does this.
 */
export async function resolveAttributeAuthority(
  organizationId: string,
  entityType: AuthorityEntityType,
): Promise<AttributeAuthority> {
  if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new Error('resolveAttributeAuthority: organizationId is required — authority is never global');
  }

  const rows = await loadAuthorityDeclarations(organizationId, entityType);
  if (rows.length === 0) return noAttributeAuthority(entityType);

  const declared: Record<string, readonly string[]> = {};
  for (const row of rows) declared[row.attribute] = row.providers;

  // Through the validating constructor rather than cast straight in: it drops
  // an attribute the scope does not have, and an entry naming no usable
  // provider. A stored-but-empty declaration therefore arrives here and leaves
  // as source-neutral, which is the ratified meaning of empty.
  const { authority } = buildAttributeAuthority(
    entityType, declared, authoritySurfaceFor(entityType),
  );
  return authority;
}
