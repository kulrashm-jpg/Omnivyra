/**
 * B1b — STORAGE for attribute authority declarations.
 *
 * ─── WHY THIS IS A SEPARATE MODULE FROM `attributeAuthority.ts` ────────────
 * Not taste. `prospectIdentityIngestionBoundary.test.ts` asserts that
 * `attributeAuthority.ts` cannot reach a database at all — it is one of the
 * files exempted from the LI-1 name scan, and the price of that exemption is
 * that it must be provably incapable of writing. b1b.1's own comment
 * anticipated this gate and said so explicitly: a future gate attaching storage
 * to the resolver seam "must therefore put that storage in its own module".
 * This is that module.
 *
 * ─── WHAT A DECLARATION IS ────────────────────────────────────────────────
 * Governance configuration, keyed exactly as D-3 ratified:
 * (organization_id, entity_type, attribute) -> the source keys that tenant has
 * declared authoritative. It holds no value, no decision and no evidence.
 *
 * It is NOT a provider registry. `source_assertions.provider` is free text by
 * LI-2's design so that a new provider never needs a migration, and a
 * declaration is a tenant's opinion about those free-text keys. Nothing here
 * names a provider, and nothing here validates one against a catalogue — doing
 * so would re-introduce exactly the coupling LI-2 removed.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * Reading during arbitration is an internal act and takes no actor. MUTATING a
 * declaration is a governance act and takes a tenant administrator, resolved
 * through the existing RBAC service. No new role is invented.
 *
 * Cross-tenant safety here is structural rather than a comparison someone has
 * to remember to write: the actor's role is resolved FOR THE TENANT BEING
 * MUTATED, so an administrator of another tenant simply has no role to find.
 * Drishiq Labs goes through this same path; there is no owner-company branch.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { getUserRole, isSuperAdmin, Role } from '../rbacService';
import { normalizePermissionRole } from '../rbacPrimitives';
import { logger } from '../logger';

/**
 * The three scopes B1b can arbitrate, mirroring the `aad_entity_type_valid`
 * CHECK exactly.
 *
 * This vocabulary lives in the store rather than in the contract module so the
 * dependency runs one way only (contract -> store). A cycle between them would
 * be a runtime hazard for a module that ingestion loads on every batch.
 */
export const AUTHORITY_ENTITY_TYPES = ['person', 'account', 'relationship'] as const;
export type AuthorityEntityType = typeof AUTHORITY_ENTITY_TYPES[number];

export const isAuthorityEntityType = (v: unknown): v is AuthorityEntityType =>
  typeof v === 'string' && (AUTHORITY_ENTITY_TYPES as readonly string[]).includes(v);

/** One stored declaration, as the resolver needs it. */
export interface AuthorityDeclarationRow {
  readonly organizationId: string;
  readonly entityType: AuthorityEntityType;
  readonly attribute: string;
  readonly providers: readonly string[];
  readonly declaredByUserId: string | null;
  readonly updatedAt: string | null;
}

const TABLE = 'attribute_authority_declarations';

type Row = Record<string, unknown>;

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

const toDeclaration = (r: Row): AuthorityDeclarationRow => ({
  organizationId: String(r.organization_id),
  entityType: String(r.entity_type) as AuthorityEntityType,
  attribute: String(r.attribute),
  providers: Array.isArray(r.authoritative_providers)
    ? (r.authoritative_providers as unknown[]).map((p) => String(p))
    : [],
  declaredByUserId: text(r.declared_by_user_id),
  updatedAt: text(r.updated_at),
});

const SELECT_COLS =
  'organization_id, entity_type, attribute, authoritative_providers, declared_by_user_id, updated_at';

/**
 * Normalise one declared source key. Kept identical in meaning to
 * `normalizeProviderKey` in the contract module, and re-stated here rather than
 * imported so the dependency stays one-way; the database enforces the same rule
 * through `pi_authority_providers_ok`, so a drift between the two is a
 * constraint violation rather than a silent mismatch.
 */
const normalizeKey = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase() : '';

const requireTenant = (organizationId: string, where: string): void => {
  if (!organizationId || !organizationId.trim()) {
    throw new Error(`${where}: organizationId is required — authority is never global`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// READ — the arbitration path.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every declaration a tenant holds for one scope.
 *
 * THROWS on a read failure rather than returning []. Returning an empty list
 * would be indistinguishable from "this tenant declared nothing", and
 * arbitration would then quietly apply source-neutral rules — which is the
 * precise failure this gate exists to remove. A tenant that declared human
 * authority must not lose it to a transient outage.
 */
export async function loadAuthorityDeclarations(
  organizationId: string,
  entityType: AuthorityEntityType,
): Promise<AuthorityDeclarationRow[]> {
  requireTenant(organizationId, 'loadAuthorityDeclarations');
  const { data, error } = await ownedDbTable(TABLE)
    .select(SELECT_COLS)
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType);

  if (error) {
    throw new Error(`authority declaration read failed: ${error.message}`);
  }
  return ((data ?? []) as unknown as Row[]).map(toDeclaration);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTHORIZATION — governance configuration needs an administrator.
// ═══════════════════════════════════════════════════════════════════════════

export type AuthorityMutationRefusal =
  | 'tenant_required'
  | 'actor_required'
  | 'not_authorized'
  | 'invalid_entity_type'
  | 'invalid_attribute'
  | 'write_failed';

export interface AuthorityActorCheck {
  readonly allowed: boolean;
  readonly role: string | null;
}

/**
 * May this actor change THIS tenant's authority configuration?
 *
 * A platform super-admin may, as everywhere else in the product. Otherwise the
 * actor must hold an administrator role in the tenant being changed — which is
 * also what makes cross-tenant mutation impossible, since the role lookup is
 * scoped to that tenant.
 */
export async function canDeclareAuthority(
  actorUserId: string,
  organizationId: string,
): Promise<AuthorityActorCheck> {
  if (!actorUserId?.trim() || !organizationId?.trim()) return { allowed: false, role: null };

  if (await isSuperAdmin(actorUserId)) {
    return { allowed: true, role: Role.SUPER_ADMIN };
  }
  const { role } = await getUserRole(actorUserId, organizationId);
  if (!role) return { allowed: false, role: null };

  // ADMIN is a legacy alias the auth layers normalise to COMPANY_ADMIN.
  const normalized = normalizePermissionRole(role);
  const allowed = normalized === Role.COMPANY_ADMIN || normalized === Role.SUPER_ADMIN;
  return { allowed, role: normalized };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — declare, replace, clear.
// ═══════════════════════════════════════════════════════════════════════════

export type AuthorityMutationResult =
  | { readonly ok: true; readonly declaration: AuthorityDeclarationRow }
  | { readonly ok: true; readonly cleared: true }
  | { readonly ok: false; readonly reason: AuthorityMutationRefusal; readonly detail?: string };

export interface DeclareAuthorityInput {
  organizationId: string;
  entityType: AuthorityEntityType;
  attribute: string;
  /** The declared source keys. An EMPTY array is legal and means source-neutral. */
  providers: readonly string[];
  actorUserId: string;
}

/**
 * Declare — or replace — the authority for one (tenant, scope, attribute).
 *
 * Replacement rather than accumulation is deliberate: "who is authoritative for
 * this attribute" has one answer at a time, and an append model would make the
 * current answer depend on row order. The unique key makes the replacement
 * deterministic, and because that index is TOTAL (unlike the relationship
 * table's partial ones) it can be named as a conflict target directly.
 *
 * An empty `providers` list is stored, not rejected. It records an explicit
 * decision — "we looked, and nothing is authoritative here" — which resolves
 * exactly like an absent row but is visible to an auditor. It never means
 * "suppress every candidate".
 */
export async function declareAttributeAuthority(
  input: DeclareAuthorityInput,
): Promise<AuthorityMutationResult> {
  if (!input.organizationId?.trim()) return { ok: false, reason: 'tenant_required' };
  if (!input.actorUserId?.trim()) return { ok: false, reason: 'actor_required' };
  if (!isAuthorityEntityType(input.entityType)) return { ok: false, reason: 'invalid_entity_type' };

  const attribute = typeof input.attribute === 'string' ? input.attribute.trim() : '';
  if (!attribute) return { ok: false, reason: 'invalid_attribute' };

  const { allowed } = await canDeclareAuthority(input.actorUserId, input.organizationId);
  if (!allowed) {
    logger.warn('authority_declaration_refused', {
      reason: 'not_authorized', entityType: input.entityType, attribute,
    });
    return { ok: false, reason: 'not_authorized' };
  }

  // Normalise here so the stored key is the key arbitration compares against.
  // The database re-checks this, so a future writer cannot store a key that
  // would silently match nothing.
  const providers: string[] = [];
  for (const p of input.providers ?? []) {
    const key = normalizeKey(p);
    if (key && !providers.includes(key)) providers.push(key);
  }

  const { data, error } = await ownedDbTable(TABLE)
    .upsert({
      organization_id: input.organizationId,
      entity_type: input.entityType,
      attribute,
      authoritative_providers: providers,
      declared_by_user_id: input.actorUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,entity_type,attribute' })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    const detail = (error as { message?: string } | null)?.message ?? 'unknown error';
    logger.warn('authority_declaration_refused', { reason: 'write_failed', detail });
    return { ok: false, reason: 'write_failed', detail };
  }
  return { ok: true, declaration: toDeclaration(data as unknown as Row) };
}

export interface ClearAuthorityInput {
  organizationId: string;
  entityType: AuthorityEntityType;
  attribute: string;
  actorUserId: string;
}

/**
 * Remove a declaration entirely, returning the tenant to source-neutral for
 * that attribute.
 *
 * Clearing DELETES rather than storing an empty array, so "no declaration" and
 * "declared nothing authoritative" stay distinguishable to an auditor. Both
 * arbitrate identically; only the audit trail differs.
 */
export async function clearAttributeAuthority(
  input: ClearAuthorityInput,
): Promise<AuthorityMutationResult> {
  if (!input.organizationId?.trim()) return { ok: false, reason: 'tenant_required' };
  if (!input.actorUserId?.trim()) return { ok: false, reason: 'actor_required' };
  if (!isAuthorityEntityType(input.entityType)) return { ok: false, reason: 'invalid_entity_type' };

  const attribute = typeof input.attribute === 'string' ? input.attribute.trim() : '';
  if (!attribute) return { ok: false, reason: 'invalid_attribute' };

  const { allowed } = await canDeclareAuthority(input.actorUserId, input.organizationId);
  if (!allowed) {
    logger.warn('authority_declaration_refused', {
      reason: 'not_authorized', entityType: input.entityType, attribute,
    });
    return { ok: false, reason: 'not_authorized' };
  }

  const { error } = await ownedDbTable(TABLE)
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('entity_type', input.entityType)
    .eq('attribute', attribute);

  if (error) {
    const detail = error.message ?? 'unknown error';
    logger.warn('authority_declaration_refused', { reason: 'write_failed', detail });
    return { ok: false, reason: 'write_failed', detail };
  }
  // Deleting a declaration that was never there is a success, not an error:
  // the requested end state — source-neutral — holds either way.
  return { ok: true, cleared: true };
}

/**
 * Read a tenant's declarations as an administrator, for an operator surface.
 *
 * Separate from `loadAuthorityDeclarations` because this one is a USER action
 * and carries an actor; arbitration's read is internal and does not.
 */
export async function listAttributeAuthority(input: {
  organizationId: string;
  entityType: AuthorityEntityType;
  actorUserId: string;
}): Promise<
  | { ok: true; declarations: AuthorityDeclarationRow[] }
  | { ok: false; reason: AuthorityMutationRefusal }
> {
  if (!input.organizationId?.trim()) return { ok: false, reason: 'tenant_required' };
  if (!input.actorUserId?.trim()) return { ok: false, reason: 'actor_required' };
  if (!isAuthorityEntityType(input.entityType)) return { ok: false, reason: 'invalid_entity_type' };

  const { allowed } = await canDeclareAuthority(input.actorUserId, input.organizationId);
  if (!allowed) return { ok: false, reason: 'not_authorized' };

  return { ok: true, declarations: await loadAuthorityDeclarations(input.organizationId, input.entityType) };
}
