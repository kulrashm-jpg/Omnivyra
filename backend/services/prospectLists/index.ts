/**
 * PI LISTS-001 — prospect lists and memberships.
 *
 * WS-2 of the PI x Workflow x Outreach programme: the audience layer a future
 * Workflow Engine will read from. It implements no workflow definition, no
 * execution state, no AI decision and no dispatch, and must not grow any.
 *
 * ─── WHAT THIS MODULE IS NOT ALLOWED TO DO ────────────────────────────────
 * A membership POINTS AT a `canonical_leads` row. It owns nothing about that
 * prospect, and this module writes no canonical attribute, no source
 * assertion, no identity claim and no lifecycle transition. It never calls
 * ingestion, because ingestion writes canonical attributes as a side effect and
 * adding someone to a list is not evidence about them.
 *
 * That boundary is the point of the batch, not a precaution: the canonical
 * write path's arbitration warrant is still unratified (PI-ARB-RERAT-001) and
 * two of its migrations are UNVERIFIED, so a new feature that wrote through it
 * would inherit an unresolved governance problem. Lists sit beside it instead.
 *
 * ─── WHY PORTS RATHER THAN A DATABASE CLIENT ──────────────────────────────
 * Every operation takes a `ListStore`. The production store (`./store`) is the
 * only thing that knows PostgREST exists; this module holds the rules.
 *
 * It is not for tidiness. A test that fakes a query builder passes or fails on
 * the fidelity of the fake — this repository has watched a `.contains()` stub
 * make an idempotency test pass for the wrong reason — whereas a port has a
 * surface small enough to double honestly. The price is that a double proves
 * NOTHING about the database: uniqueness, foreign keys, CHECKs and RLS are the
 * migration's guarantees and are asserted against the migration SQL and, when a
 * stack is available, against the real schema. A unit test here may never be
 * cited as evidence that a constraint holds.
 *
 * ─── TENANT SCOPE IS AN ARGUMENT, NEVER A LOOKUP ──────────────────────────
 * `organizationId` is always the VERIFIED tenant the route's guard returned,
 * and every store call is scoped by it. A list or prospect belonging to another
 * tenant is therefore NOT FOUND rather than forbidden — the refusal does not
 * distinguish "exists elsewhere" from "does not exist", so an attacker cannot
 * probe for the existence of another tenant's records. There is no
 * owner-company branch anywhere in this module.
 *
 * ─── REMOVAL IS SOFT, ERASURE IS NOT ──────────────────────────────────────
 * Removing a member sets `status='removed'` and records who and when, so the
 * fact of the removal survives. Erasing or deleting the canonical prospect
 * CASCADEs the membership away at the database — see the migration header. The
 * two are different questions and this module only performs the first.
 */

export const LIST_STATUSES = ['active', 'archived'] as const;
export type ListStatus = typeof LIST_STATUSES[number];

export const MEMBERSHIP_STATUSES = ['active', 'removed'] as const;
export type MembershipStatus = typeof MEMBERSHIP_STATUSES[number];

export interface ProspectList {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ListStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ProspectListMember {
  readonly id: string;
  readonly organizationId: string;
  readonly listId: string;
  readonly prospectId: string;
  readonly status: MembershipStatus;
  /** How this prospect came to be in the list. Free text; never blank. */
  readonly addedVia: string;
  readonly addedAt: string;
  readonly addedByUserId: string | null;
  readonly removedAt: string | null;
  readonly removedByUserId: string | null;
  readonly removalReason: string | null;
}

/**
 * Why an operation was refused.
 *
 * `list_not_found` and `prospect_not_found` are returned for a foreign-tenant
 * id as well as a nonexistent one, deliberately — see the header.
 */
export type ListRefusal =
  | 'tenant_required'
  | 'actor_required'
  | 'invalid_list_id'
  | 'invalid_prospect_id'
  | 'invalid_name'
  | 'invalid_provenance'
  | 'invalid_page_size'
  | 'invalid_cursor'
  | 'nothing_to_update'
  | 'list_not_found'
  | 'list_archived'
  | 'prospect_not_found'
  | 'store_failed';

export type ListResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ListRefusal; readonly detail?: string };

const fail = <T>(refusal: ListRefusal, detail?: string): ListResult<T> =>
  (detail === undefined ? { ok: false, refusal } : { ok: false, refusal, detail });

const succeed = <T>(value: T): ListResult<T> => ({ ok: true, value });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v.trim());

const cleanText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
};

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

// ═══════════════════════════════════════════════════════════════════════════
// PORTS — the only I/O surface. `./store` is the production implementation.
// ═══════════════════════════════════════════════════════════════════════════

export interface MemberPage {
  readonly members: readonly ProspectListMember[];
  /** Opaque. Null when this is the last page. */
  readonly nextCursor: string | null;
}

export interface ListStore {
  insertList(input: {
    organizationId: string;
    name: string;
    description: string | null;
    createdByUserId: string;
  }): Promise<ProspectList>;

  getList(organizationId: string, listId: string): Promise<ProspectList | null>;

  listLists(organizationId: string, status: ListStatus | null): Promise<readonly ProspectList[]>;

  updateList(input: {
    organizationId: string;
    listId: string;
    patch: { name?: string; description?: string | null; status?: ListStatus };
  }): Promise<ProspectList | null>;

  /** Does this canonical prospect exist IN THIS TENANT? A reference check only. */
  prospectExists(organizationId: string, prospectId: string): Promise<boolean>;

  findActiveMembership(
    organizationId: string, listId: string, prospectId: string,
  ): Promise<ProspectListMember | null>;

  /**
   * One membership by id, WHATEVER its status, within the tenant.
   *
   * Exists for the removal race: when a conditional update affects no row, the
   * only honest way to tell "someone else removed it first" from "something is
   * wrong" is to look at the row's current status. `findActiveMembership`
   * cannot answer that, because the row it would need to return is precisely
   * the one that is no longer active.
   */
  findMembershipById(
    organizationId: string, membershipId: string,
  ): Promise<ProspectListMember | null>;

  /** `addedByUserId` is null ONLY for the ICP evaluator (provenance `evaluator:*`). */
  insertMember(input: {
    organizationId: string;
    listId: string;
    prospectId: string;
    addedVia: string;
    addedByUserId: string | null;
  }): Promise<{ member: ProspectListMember | null; duplicate: boolean }>;

  /** `removedByUserId` is null ONLY for the ICP evaluator. */
  markMemberRemoved(input: {
    organizationId: string;
    membershipId: string;
    removedByUserId: string | null;
    removalReason: string | null;
  }): Promise<ProspectListMember | null>;

  /**
   * Orchestration (20261231000000) — the list's ICP, when it is an ICP list.
   * `undefined` when the list does not exist in this tenant; null for a manual
   * or intake list. Throws `targeting_schema_missing` when the column is absent.
   */
  getListIcp(organizationId: string, listId: string): Promise<string | null | undefined>;
  /** Set or clear the list's ICP. Returns false when the list is not in this tenant. */
  setListIcp(organizationId: string, listId: string, icpId: string | null): Promise<boolean>;

  pageMembers(input: {
    organizationId: string;
    listId: string;
    status: MembershipStatus | null;
    pageSize: number;
    cursor: { addedAt: string; id: string } | null;
  }): Promise<MemberPage>;

  /** Every list a prospect is an ACTIVE member of. The multi-list question. */
  listsForProspect(organizationId: string, prospectId: string): Promise<readonly string[]>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CURSOR — keyset on (added_at, id), which the index orders by.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Keyset rather than offset. An offset shifts when a member is added, so page 2
 * would skip or repeat rows; the tuple (added_at, id) is stable and `id` breaks
 * the tie when two members were added in the same instant.
 */
export const encodeCursor = (addedAt: string, id: string): string =>
  Buffer.from(`${addedAt}|${id}`, 'utf8').toString('base64url');

export const decodeCursor = (cursor: string): { addedAt: string; id: string } | null => {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    const addedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!addedAt || !isUuid(id) || Number.isNaN(Date.parse(addedAt))) return null;
    return { addedAt, id };
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LIST MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export async function createProspectList(
  store: ListStore,
  input: { organizationId: string; name: unknown; description?: unknown; actorUserId: string },
): Promise<ListResult<ProspectList>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!input.actorUserId?.trim()) return fail('actor_required');

  const name = cleanText(input.name);
  if (!name) return fail('invalid_name');

  try {
    return succeed(await store.insertList({
      organizationId: input.organizationId,
      name,
      description: cleanText(input.description),
      createdByUserId: input.actorUserId,
    }));
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

export async function getProspectList(
  store: ListStore,
  input: { organizationId: string; listId: unknown },
): Promise<ListResult<ProspectList>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!isUuid(input.listId)) return fail('invalid_list_id');

  try {
    const list = await store.getList(input.organizationId, String(input.listId).trim());
    // A foreign-tenant list is NOT FOUND, not forbidden.
    return list ? succeed(list) : fail('list_not_found');
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

export async function listProspectLists(
  store: ListStore,
  input: { organizationId: string; status?: unknown },
): Promise<ListResult<readonly ProspectList[]>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');

  let status: ListStatus | null = null;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!(LIST_STATUSES as readonly unknown[]).includes(input.status)) return fail('nothing_to_update');
    status = input.status as ListStatus;
  }

  try {
    return succeed(await store.listLists(input.organizationId, status));
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

/**
 * Update permitted metadata, or archive.
 *
 * `status` is the only lifecycle field, and it may only move between the two
 * declared values. There is no delete: archiving keeps the memberships and the
 * history, and a Workflow Engine reading an archived list must refuse to enrol
 * from it rather than find it missing.
 */
export async function updateProspectList(
  store: ListStore,
  input: {
    organizationId: string;
    listId: unknown;
    name?: unknown;
    description?: unknown;
    status?: unknown;
    actorUserId: string;
  },
): Promise<ListResult<ProspectList>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!input.actorUserId?.trim()) return fail('actor_required');
  if (!isUuid(input.listId)) return fail('invalid_list_id');

  const patch: { name?: string; description?: string | null; status?: ListStatus } = {};

  if (input.name !== undefined) {
    const name = cleanText(input.name);
    if (!name) return fail('invalid_name');
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = cleanText(input.description);
  }
  if (input.status !== undefined) {
    if (!(LIST_STATUSES as readonly unknown[]).includes(input.status)) return fail('nothing_to_update');
    patch.status = input.status as ListStatus;
  }
  if (Object.keys(patch).length === 0) return fail('nothing_to_update');

  try {
    const updated = await store.updateList({
      organizationId: input.organizationId,
      listId: String(input.listId).trim(),
      patch,
    });
    return updated ? succeed(updated) : fail('list_not_found');
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMBERSHIP
// ═══════════════════════════════════════════════════════════════════════════

export interface AddMemberOutcome {
  readonly member: ProspectListMember;
  /** True when an active membership already existed and nothing was written. */
  readonly alreadyMember: boolean;
}

/**
 * Add an existing canonical prospect to a list.
 *
 * IDEMPOTENT. An already-active membership returns the existing row with
 * `alreadyMember: true` and writes nothing, so a retried request cannot create
 * a second membership or move `added_at`.
 *
 * The pre-check is the fast path, NOT the guarantee. Two concurrent requests
 * can both pass it, and the partial unique index refuses the loser; that
 * rejection is reported as `alreadyMember` rather than an error, because the
 * caller's intended end state holds either way.
 */
export async function addProspectToList(
  store: ListStore,
  input: {
    organizationId: string;
    listId: unknown;
    prospectId: unknown;
    addedVia: unknown;
    actorUserId: string;
  },
): Promise<ListResult<AddMemberOutcome>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!input.actorUserId?.trim()) return fail('actor_required');
  return addMember(store, input, input.actorUserId);
}

/** The add, shared by the human path (an actor) and the evaluator (`actor` null). */
async function addMember(
  store: ListStore,
  input: { organizationId: string; listId: unknown; prospectId: unknown; addedVia: unknown },
  actor: string | null,
): Promise<ListResult<AddMemberOutcome>> {
  if (!isUuid(input.listId)) return fail('invalid_list_id');
  if (!isUuid(input.prospectId)) return fail('invalid_prospect_id');

  const addedVia = cleanText(input.addedVia);
  if (!addedVia) return fail('invalid_provenance');

  const listId = String(input.listId).trim();
  const prospectId = String(input.prospectId).trim();

  try {
    const list = await store.getList(input.organizationId, listId);
    if (!list) return fail('list_not_found');
    if (list.status === 'archived') return fail('list_archived');

    // A REFERENCE check, scoped to this tenant. Never a write, never ingestion.
    if (!(await store.prospectExists(input.organizationId, prospectId))) {
      return fail('prospect_not_found');
    }

    const existing = await store.findActiveMembership(input.organizationId, listId, prospectId);
    if (existing) return succeed({ member: existing, alreadyMember: true });

    const { member, duplicate } = await store.insertMember({
      organizationId: input.organizationId,
      listId,
      prospectId,
      addedVia,
      addedByUserId: actor,
    });

    if (duplicate) {
      // Lost the race. The index held; re-read the winner rather than guessing.
      const winner = await store.findActiveMembership(input.organizationId, listId, prospectId);
      return winner
        ? succeed({ member: winner, alreadyMember: true })
        : fail('store_failed', 'duplicate reported but no active membership found');
    }
    if (!member) return fail('store_failed', 'insert returned no row');
    return succeed({ member, alreadyMember: false });
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

export interface RemoveMemberOutcome {
  readonly listId: string;
  readonly prospectId: string;
  /** True when there was no active membership and nothing was written. */
  readonly alreadyRemoved: boolean;
}

/**
 * Remove a prospect from a list.
 *
 * SOFT, and it does not touch the canonical prospect. The prospect keeps its
 * identity, its attributes, its evidence and its membership of every other
 * list; only this membership's status changes.
 *
 * Idempotent: removing a prospect that is not an active member succeeds with
 * `alreadyRemoved: true`, because the requested end state already holds.
 */
export async function removeProspectFromList(
  store: ListStore,
  input: {
    organizationId: string;
    listId: unknown;
    prospectId: unknown;
    removalReason?: unknown;
    actorUserId: string;
  },
): Promise<ListResult<RemoveMemberOutcome>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!input.actorUserId?.trim()) return fail('actor_required');
  return removeMember(store, input, input.actorUserId);
}

/** The removal, shared by the human path (an actor) and the evaluator (`actor` null). */
async function removeMember(
  store: ListStore,
  input: { organizationId: string; listId: unknown; prospectId: unknown; removalReason?: unknown },
  actor: string | null,
): Promise<ListResult<RemoveMemberOutcome>> {
  if (!isUuid(input.listId)) return fail('invalid_list_id');
  if (!isUuid(input.prospectId)) return fail('invalid_prospect_id');

  const listId = String(input.listId).trim();
  const prospectId = String(input.prospectId).trim();

  try {
    const list = await store.getList(input.organizationId, listId);
    if (!list) return fail('list_not_found');

    const existing = await store.findActiveMembership(input.organizationId, listId, prospectId);
    if (!existing) return succeed({ listId, prospectId, alreadyRemoved: true });

    const removed = await store.markMemberRemoved({
      organizationId: input.organizationId,
      membershipId: existing.id,
      removedByUserId: actor,
      removalReason: cleanText(input.removalReason),
    });
    if (removed) return succeed({ listId, prospectId, alreadyRemoved: false });

    // ZERO ROWS AFFECTED. The update is scoped `status = 'active'`, so a
    // concurrent removal that committed between our read and our write leaves
    // nothing for us to update. That is the same shape as the ADD race, and it
    // deserves the same answer: the end state the caller asked for holds.
    //
    // It is NOT assumed. The row is re-read, in the same verified tenant scope,
    // and only an OBSERVED 'removed' status is reported as success — an
    // arbitrary database error is never converted into one, because a read
    // failure throws and leaves through `store_failed` below.
    const current = await store.findMembershipById(input.organizationId, existing.id);

    if (current === null) {
      // The membership was readable a moment ago and is now gone. A CASCADE
      // (its list or its canonical prospect deleted) is the benign explanation,
      // but we did not observe the removal we were asked to perform, so this is
      // reported rather than claimed as done.
      return fail('store_failed', 'the membership disappeared between the read and the removal');
    }
    if (current.status === 'removed') {
      return succeed({ listId, prospectId, alreadyRemoved: true });
    }
    // Still active, yet the scoped update matched nothing. Something is wrong
    // that this layer cannot explain, and saying "removed" would be a lie.
    return fail('store_failed', 'the removal affected no row while the membership is still active');
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION — the ICP evaluator's SYSTEM path (20261231000000).
//
// The evaluator is not a person, so its writes carry no actor; they are told
// apart by provenance, which must be `evaluator:*`. It reuses the exact add and
// removal above — idempotency, race handling and soft removal included — so the
// evaluator cannot become a second membership writer with different rules.
// ═══════════════════════════════════════════════════════════════════════════

export const EVALUATOR_PROVENANCE_PREFIX = 'evaluator:';

export async function addProspectToListBySystem(
  store: ListStore,
  input: { organizationId: string; listId: unknown; prospectId: unknown; addedVia: string },
): Promise<ListResult<AddMemberOutcome>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!String(input.addedVia ?? '').startsWith(EVALUATOR_PROVENANCE_PREFIX)) return fail('invalid_provenance');
  return addMember(store, input, null);
}

export async function removeProspectFromListBySystem(
  store: ListStore,
  input: { organizationId: string; listId: unknown; prospectId: unknown; removalReason: string },
): Promise<ListResult<RemoveMemberOutcome>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!String(input.removalReason ?? '').startsWith(EVALUATOR_PROVENANCE_PREFIX)) return fail('invalid_provenance');
  return removeMember(store, input, null);
}

export async function listMembers(
  store: ListStore,
  input: {
    organizationId: string;
    listId: unknown;
    status?: unknown;
    pageSize?: unknown;
    cursor?: unknown;
  },
): Promise<ListResult<MemberPage>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!isUuid(input.listId)) return fail('invalid_list_id');

  let pageSize = DEFAULT_PAGE_SIZE;
  if (input.pageSize !== undefined && input.pageSize !== null && input.pageSize !== '') {
    const n = Number(input.pageSize);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) return fail('invalid_page_size');
    pageSize = n;
  }

  // Default to ACTIVE members: a caller asking "who is in this list" means the
  // live audience, and returning removed rows by default would silently widen
  // every future enrolment.
  let status: MembershipStatus | null = 'active';
  if (input.status === 'all') {
    status = null;
  } else if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!(MEMBERSHIP_STATUSES as readonly unknown[]).includes(input.status)) {
      return fail('invalid_page_size');
    }
    status = input.status as MembershipStatus;
  }

  let cursor: { addedAt: string; id: string } | null = null;
  if (typeof input.cursor === 'string' && input.cursor.trim() !== '') {
    cursor = decodeCursor(input.cursor.trim());
    if (!cursor) return fail('invalid_cursor');
  }

  try {
    const list = await store.getList(input.organizationId, String(input.listId).trim());
    if (!list) return fail('list_not_found');

    return succeed(await store.pageMembers({
      organizationId: input.organizationId,
      listId: String(input.listId).trim(),
      status,
      pageSize,
      cursor,
    }));
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}

/** Which lists is this prospect an active member of? */
export async function listsContainingProspect(
  store: ListStore,
  input: { organizationId: string; prospectId: unknown },
): Promise<ListResult<readonly string[]>> {
  if (!isUuid(input.organizationId)) return fail('tenant_required');
  if (!isUuid(input.prospectId)) return fail('invalid_prospect_id');

  try {
    return succeed(await store.listsForProspect(input.organizationId, String(input.prospectId).trim()));
  } catch (e) {
    return fail('store_failed', (e as Error)?.message);
  }
}
