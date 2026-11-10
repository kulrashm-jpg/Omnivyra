/**
 * PI LISTS-001 — the production `ListStore`.
 *
 * The ONLY module in this feature that knows PostgREST exists. Everything above
 * it speaks the port in `./index`, which is what lets the rules be tested
 * without a query-builder double of uncertain fidelity.
 *
 * ─── WHAT THIS FILE IS RESPONSIBLE FOR ────────────────────────────────────
 * Column names, row shapes, the tenant predicate on every single query, and
 * translating one PostgreSQL error code into a domain fact. No business rule
 * lives here: it does not decide whether a list may be added to, whether a
 * removal is idempotent, or what a cursor means.
 *
 * ─── EVERY QUERY CARRIES THE TENANT ───────────────────────────────────────
 * `organization_id` is in the predicate of every read and every write, without
 * exception. The composite foreign keys in migration 20261127000000 make a
 * cross-tenant row impossible to WRITE; these predicates make one impossible to
 * READ. Both are needed — the first is the database's guarantee and the second
 * is this layer's, and neither is allowed to stand in for the other.
 *
 * ─── A UNIQUE VIOLATION IS NOT AN ERROR HERE ──────────────────────────────
 * `uq_prospect_list_members_active` is PARTIAL, so it cannot be an `ON CONFLICT`
 * target and an upsert is unavailable. The insert therefore runs and `23505`
 * (unique_violation) is reported back as `duplicate: true` rather than thrown.
 * That is the race the index exists to lose safely, and the caller turns it into
 * `alreadyMember`.
 *
 * Every OTHER database error is thrown. A swallowed failure would read as "this
 * list is empty" or "this prospect is not a member", and both are answers the
 * caller would act on.
 */

import { ownedDbTable } from '../../db/writeOwner';
// `encodeCursor` is pure and lives with the contract it belongs to. The
// dependency runs one way only — `./index` never imports this module — so
// there is no cycle.
import { encodeCursor } from './index';
import type {
  ListStatus,
  ListStore,
  MemberPage,
  MembershipStatus,
  ProspectList,
  ProspectListMember,
} from './index';

const LISTS = 'prospect_lists';
const MEMBERS = 'prospect_list_members';

const LIST_COLS =
  'id, organization_id, name, description, status, created_by_user_id, created_at, updated_at';
const MEMBER_COLS =
  'id, organization_id, list_id, prospect_id, status, added_via, added_at, added_by_user_id, '
  + 'removed_at, removed_by_user_id, removal_reason';

/** PostgreSQL unique_violation. The one code this layer interprets. */
const UNIQUE_VIOLATION = '23505';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const nullableStr = (v: unknown): string | null =>
  (typeof v === 'string' && v !== '' ? v : null);

const toList = (r: Row): ProspectList => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  name: str(r.name),
  description: nullableStr(r.description),
  status: str(r.status) as ListStatus,
  createdByUserId: nullableStr(r.created_by_user_id),
  createdAt: nullableStr(r.created_at),
  updatedAt: nullableStr(r.updated_at),
});

const toMember = (r: Row): ProspectListMember => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  listId: str(r.list_id),
  prospectId: str(r.prospect_id),
  status: str(r.status) as MembershipStatus,
  addedVia: str(r.added_via),
  addedAt: str(r.added_at),
  addedByUserId: nullableStr(r.added_by_user_id),
  removedAt: nullableStr(r.removed_at),
  removedByUserId: nullableStr(r.removed_by_user_id),
  removalReason: nullableStr(r.removal_reason),
});

const errorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
};

const throwOn = (error: unknown, where: string): void => {
  if (!error) return;
  const message = (error as { message?: string } | null)?.message ?? 'unknown error';
  throw new Error(`prospectLists.${where}: ${message}`);
};

export const productionListStore: ListStore = {
  async insertList(input) {
    const { data, error } = await ownedDbTable(LISTS)
      .insert({
        organization_id: input.organizationId,
        name: input.name,
        description: input.description,
        created_by_user_id: input.createdByUserId,
      })
      .select(LIST_COLS)
      .single();
    throwOn(error, 'insertList');
    if (!data) throw new Error('prospectLists.insertList: insert returned no row');
    return toList(data as unknown as Row);
  },

  async getList(organizationId, listId) {
    const { data, error } = await ownedDbTable(LISTS)
      .select(LIST_COLS)
      .eq('organization_id', organizationId)
      .eq('id', listId)
      .maybeSingle();
    throwOn(error, 'getList');
    return data ? toList(data as unknown as Row) : null;
  },

  async listLists(organizationId, status) {
    let query = ownedDbTable(LISTS)
      .select(LIST_COLS)
      .eq('organization_id', organizationId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    throwOn(error, 'listLists');
    return ((data ?? []) as unknown as Row[]).map(toList);
  },

  async updateList(input) {
    const patch: Row = {};
    if (input.patch.name !== undefined) patch.name = input.patch.name;
    if (input.patch.description !== undefined) patch.description = input.patch.description;
    if (input.patch.status !== undefined) patch.status = input.patch.status;

    const { data, error } = await ownedDbTable(LISTS)
      .update(patch)
      .eq('organization_id', input.organizationId)
      .eq('id', input.listId)
      .select(LIST_COLS)
      .maybeSingle();
    throwOn(error, 'updateList');
    return data ? toList(data as unknown as Row) : null;
  },

  /**
   * A REFERENCE check against the canonical prospect, scoped to the tenant.
   *
   * `canonical_leads` keys its tenant `company_id`, not `organization_id` — the
   * name asymmetry the migration header records. Selecting only `id` keeps this
   * an existence question: no canonical attribute is read, and none is written.
   */
  async prospectExists(organizationId, prospectId) {
    const { data, error } = await ownedDbTable('canonical_leads')
      .select('id')
      .eq('company_id', organizationId)
      .eq('id', prospectId)
      .maybeSingle();
    throwOn(error, 'prospectExists');
    return Boolean(data);
  },

  async findActiveMembership(organizationId, listId, prospectId) {
    const { data, error } = await ownedDbTable(MEMBERS)
      .select(MEMBER_COLS)
      .eq('organization_id', organizationId)
      .eq('list_id', listId)
      .eq('prospect_id', prospectId)
      .eq('status', 'active')
      .maybeSingle();
    throwOn(error, 'findActiveMembership');
    return data ? toMember(data as unknown as Row) : null;
  },

  /**
   * One membership by id, any status, tenant-scoped.
   *
   * No `status` predicate on purpose: the caller needs the row precisely when
   * it is no longer active. The tenant predicate stays, so this cannot read
   * another tenant's membership even with a correct id.
   */
  async findMembershipById(organizationId, membershipId) {
    const { data, error } = await ownedDbTable(MEMBERS)
      .select(MEMBER_COLS)
      .eq('organization_id', organizationId)
      .eq('id', membershipId)
      .maybeSingle();
    throwOn(error, 'findMembershipById');
    return data ? toMember(data as unknown as Row) : null;
  },

  async insertMember(input) {
    const { data, error } = await ownedDbTable(MEMBERS)
      .insert({
        organization_id: input.organizationId,
        list_id: input.listId,
        prospect_id: input.prospectId,
        // EXPLICIT, not left to the column default. The partial unique index
        // and the removal-coherence CHECK both key on `status`, so the value
        // this row is created with is part of the write's meaning rather than a
        // detail of the schema. The default remains as a backstop.
        status: 'active',
        added_via: input.addedVia,
        added_by_user_id: input.addedByUserId,
      })
      .select(MEMBER_COLS)
      .single();

    // The partial unique index did its job. Not an error — a fact.
    if (error && errorCode(error) === UNIQUE_VIOLATION) {
      return { member: null, duplicate: true };
    }
    throwOn(error, 'insertMember');
    if (!data) throw new Error('prospectLists.insertMember: insert returned no row');
    return { member: toMember(data as unknown as Row), duplicate: false };
  },

  /**
   * Soft removal. `status`, `removed_at`, `removed_by_user_id` and
   * `removal_reason` are written in ONE statement, so the row can never be
   * observed as 'removed' without its timestamp — which the
   * `prospect_list_members_removal_coherent` CHECK also refuses.
   *
   * Scoped to `status = 'active'` so a repeated removal updates nothing rather
   * than overwriting the original removal's actor and time.
   */
  async markMemberRemoved(input) {
    const { data, error } = await ownedDbTable(MEMBERS)
      .update({
        status: 'removed',
        removed_at: new Date().toISOString(),
        removed_by_user_id: input.removedByUserId,
        removal_reason: input.removalReason,
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.membershipId)
      .eq('status', 'active')
      .select(MEMBER_COLS)
      .maybeSingle();
    throwOn(error, 'markMemberRemoved');
    return data ? toMember(data as unknown as Row) : null;
  },

  /**
   * Keyset page over (added_at DESC, id DESC), matching
   * `idx_prospect_list_members_list`.
   *
   * One row more than asked for is fetched to decide whether a next page
   * exists, and then dropped. A count query would be a second round trip and
   * would still not tell the caller whether the NEXT page is empty.
   */
  async pageMembers(input): Promise<MemberPage> {
    let query = ownedDbTable(MEMBERS)
      .select(MEMBER_COLS)
      .eq('organization_id', input.organizationId)
      .eq('list_id', input.listId);

    if (input.status) query = query.eq('status', input.status);

    if (input.cursor) {
      // Strictly after the cursor in the ordering above. The `and(...)` leg is
      // what makes two members added in the same instant pageable.
      query = query.or(
        `added_at.lt.${input.cursor.addedAt},`
        + `and(added_at.eq.${input.cursor.addedAt},id.lt.${input.cursor.id})`,
      );
    }

    const { data, error } = await query
      .order('added_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.pageSize + 1);
    throwOn(error, 'pageMembers');

    const rows = ((data ?? []) as unknown as Row[]).map(toMember);
    const hasMore = rows.length > input.pageSize;
    const members = hasMore ? rows.slice(0, input.pageSize) : rows;
    const last = members[members.length - 1];

    return {
      members,
      nextCursor: hasMore && last ? encodeCursor(last.addedAt, last.id) : null,
    };
  },

  async listsForProspect(organizationId, prospectId) {
    const { data, error } = await ownedDbTable(MEMBERS)
      .select('list_id')
      .eq('organization_id', organizationId)
      .eq('prospect_id', prospectId)
      .eq('status', 'active');
    throwOn(error, 'listsForProspect');
    return ((data ?? []) as unknown as Row[]).map((r) => str(r.list_id)).sort();
  },

  // Orchestration (20261231000000): the optional ICP of a list. Selected on its
  // own so the core list reads keep working where that migration has not run.
  async getListIcp(organizationId, listId) {
    const { data, error } = await ownedDbTable(LISTS)
      .select('id, icp_id')
      .eq('organization_id', organizationId)
      .eq('id', listId)
      .maybeSingle();
    if (error && ['42703', 'PGRST204'].includes(String(errorCode(error)))) {
      throw Object.assign(new Error('prospectLists.getListIcp: list ICP is not installed (20261231000000)'), { code: 'targeting_schema_missing' });
    }
    throwOn(error, 'getListIcp');
    if (!data) return undefined;
    const icp = (data as unknown as Row).icp_id;
    return typeof icp === 'string' && icp ? icp : null;
  },

  async setListIcp(organizationId, listId, icpId) {
    const { data, error } = await ownedDbTable(LISTS)
      .update({ icp_id: icpId })
      .eq('organization_id', organizationId)
      .eq('id', listId)
      .select('id');
    if (error && ['42703', 'PGRST204'].includes(String(errorCode(error)))) {
      throw Object.assign(new Error('prospectLists.setListIcp: list ICP is not installed (20261231000000)'), { code: 'targeting_schema_missing' });
    }
    throwOn(error, 'setListIcp');
    return Array.isArray(data) && data.length === 1;
  },
};
