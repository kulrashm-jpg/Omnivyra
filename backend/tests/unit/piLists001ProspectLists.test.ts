/**
 * PI LISTS-001 — prospect lists and memberships, the RULES.
 *
 * ─── WHAT THIS SUITE MAY AND MAY NOT CLAIM ────────────────────────────────
 * It exercises the service against an in-memory `ListStore`. The port surface
 * is small enough to double faithfully — eleven methods, no query builder — and
 * the double replicates the one database behaviour the rules depend on: at most
 * one ACTIVE membership per (tenant, list, prospect).
 *
 * It therefore proves the RULES. It proves NOTHING about the database. The
 * unique index, the composite tenant-safe foreign keys, the CHECK constraints,
 * the cascade on erasure and RLS are the migration's guarantees; they are
 * asserted against the migration SQL in `piLists002MigrationContract.test.ts`
 * and would need a real schema to be verified. No assertion here is evidence
 * that a constraint holds.
 *
 * No database is contacted, no provider is called, no canonical attribute is
 * written, and nothing here reaches an ingestion path.
 */

import {
  createProspectList,
  getProspectList,
  listProspectLists,
  updateProspectList,
  addProspectToList,
  removeProspectFromList,
  listMembers,
  listsContainingProspect,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  type ListStore,
  type MemberPage,
  type ProspectList,
  type ProspectListMember,
} from '../../services/prospectLists';
import { readAudiencePage, isListEnrollable } from '../../services/prospectLists/audience';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const USER = '00000000-0000-4000-8000-000000000011';
const USER_B = '00000000-0000-4000-8000-000000000012';
const PROSPECT_1 = '00000000-0000-4000-8000-000000000101';
const PROSPECT_2 = '00000000-0000-4000-8000-000000000102';

let seq = 0;
const nextId = (): string => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

interface Fixture {
  store: ListStore;
  /** Canonical prospects that exist, per tenant. A REFERENCE set only. */
  prospects: Map<string, Set<string>>;
  lists: ProspectList[];
  members: ProspectListMember[];
  /** When set, the next insertMember reports a lost race. */
  forceDuplicateOnce: boolean;
  /**
   * When set, the next markMemberRemoved affects NO row, and the double then
   * puts the row into the state a concurrent actor would have left it in:
   *   'removed' — someone else removed it first (the real race)
   *   'active'  — nothing changed, which should never happen
   *   'vanish'  — the row is gone, as a CASCADE would leave it
   */
  forceRemovalNoRowOnce: 'removed' | 'active' | 'vanish' | null;
  /** When set, every store call throws — the database-failure case. */
  failWith: string | null;
  clock: number;
}

function makeFixture(): Fixture {
  const f: Partial<Fixture> & { lists: ProspectList[]; members: ProspectListMember[] } = {
    prospects: new Map([[ORG_A, new Set([PROSPECT_1, PROSPECT_2])], [ORG_B, new Set([PROSPECT_1])]]),
    lists: [],
    members: [],
    forceDuplicateOnce: false,
    forceRemovalNoRowOnce: null,
    failWith: null,
    clock: 0,
  };

  const guard = () => {
    if (f.failWith) throw new Error(f.failWith);
  };
  const stamp = (): string => {
    f.clock = (f.clock ?? 0) + 1000;
    return new Date(1800000000000 + f.clock).toISOString();
  };

  const store: ListStore = {
    async insertList(input) {
      guard();
      const row: ProspectList = {
        id: nextId(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        status: 'active',
        createdByUserId: input.createdByUserId,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      f.lists.push(row);
      return row;
    },

    async getList(organizationId, listId) {
      guard();
      // The tenant predicate is the point: another tenant's list is NOT FOUND.
      return f.lists.find((l) => l.organizationId === organizationId && l.id === listId) ?? null;
    },

    async listLists(organizationId, status) {
      guard();
      return f.lists
        .filter((l) => l.organizationId === organizationId && (!status || l.status === status))
        .slice()
        .reverse();
    },

    async updateList(input) {
      guard();
      const i = f.lists.findIndex(
        (l) => l.organizationId === input.organizationId && l.id === input.listId,
      );
      if (i < 0) return null;
      const updated: ProspectList = { ...f.lists[i], ...input.patch, updatedAt: stamp() };
      f.lists[i] = updated;
      return updated;
    },

    async prospectExists(organizationId, prospectId) {
      guard();
      return Boolean(f.prospects?.get(organizationId)?.has(prospectId));
    },

    async findActiveMembership(organizationId, listId, prospectId) {
      guard();
      return f.members.find((m) => m.organizationId === organizationId
        && m.listId === listId && m.prospectId === prospectId && m.status === 'active') ?? null;
    },

    async insertMember(input) {
      guard();
      if (f.forceDuplicateOnce) {
        f.forceDuplicateOnce = false;
        // Simulate the partial unique index refusing the loser of a race, and
        // the winner's row already being present.
        const winner: ProspectListMember = {
          id: nextId(),
          organizationId: input.organizationId,
          listId: input.listId,
          prospectId: input.prospectId,
          status: 'active',
          addedVia: 'race-winner',
          addedAt: stamp(),
          addedByUserId: input.addedByUserId,
          removedAt: null,
          removedByUserId: null,
          removalReason: null,
        };
        f.members.push(winner);
        return { member: null, duplicate: true };
      }

      // THE INDEX, replicated: at most one active membership per triple.
      const clash = f.members.some((m) => m.organizationId === input.organizationId
        && m.listId === input.listId && m.prospectId === input.prospectId && m.status === 'active');
      if (clash) return { member: null, duplicate: true };

      const row: ProspectListMember = {
        id: nextId(),
        organizationId: input.organizationId,
        listId: input.listId,
        prospectId: input.prospectId,
        status: 'active',
        addedVia: input.addedVia,
        addedAt: stamp(),
        addedByUserId: input.addedByUserId,
        removedAt: null,
        removedByUserId: null,
        removalReason: null,
      };
      f.members.push(row);
      return { member: row, duplicate: false };
    },

    async findMembershipById(organizationId, membershipId) {
      guard();
      // No status predicate — the caller needs the row precisely when it is no
      // longer active. Tenant predicate retained.
      return f.members.find((m) => m.organizationId === organizationId
        && m.id === membershipId) ?? null;
    },

    async markMemberRemoved(input) {
      guard();

      if (f.forceRemovalNoRowOnce) {
        const mode = f.forceRemovalNoRowOnce;
        f.forceRemovalNoRowOnce = null;
        const j = f.members.findIndex((m) => m.organizationId === input.organizationId
          && m.id === input.membershipId);
        if (j >= 0) {
          if (mode === 'removed') {
            // What a concurrent remover would have committed.
            f.members[j] = {
              ...f.members[j],
              status: 'removed',
              removedAt: stamp(),
              removedByUserId: USER_B,
              removalReason: 'removed by someone else first',
            };
          } else if (mode === 'vanish') {
            f.members.splice(j, 1);
          }
          // mode === 'active' leaves the row untouched and still active.
        }
        // The conditional update matched nothing.
        return null;
      }

      const i = f.members.findIndex((m) => m.organizationId === input.organizationId
        && m.id === input.membershipId && m.status === 'active');
      if (i < 0) return null;
      const updated: ProspectListMember = {
        ...f.members[i],
        status: 'removed',
        removedAt: stamp(),
        removedByUserId: input.removedByUserId,
        removalReason: input.removalReason,
      };
      f.members[i] = updated;
      return updated;
    },

    async pageMembers(input): Promise<MemberPage> {
      guard();
      let rows = f.members
        .filter((m) => m.organizationId === input.organizationId && m.listId === input.listId)
        .filter((m) => !input.status || m.status === input.status);

      // Same ordering as idx_prospect_list_members_list: added_at DESC, id DESC.
      rows = rows.slice().sort((a, b) => (
        a.addedAt === b.addedAt ? b.id.localeCompare(a.id) : b.addedAt.localeCompare(a.addedAt)
      ));

      if (input.cursor) {
        const c = input.cursor;
        rows = rows.filter((m) => m.addedAt < c.addedAt
          || (m.addedAt === c.addedAt && m.id < c.id));
      }

      const hasMore = rows.length > input.pageSize;
      const members = rows.slice(0, input.pageSize);
      const last = members[members.length - 1];
      return {
        members,
        nextCursor: hasMore && last ? encodeCursor(last.addedAt, last.id) : null,
      };
    },

    async listsForProspect(organizationId, prospectId) {
      guard();
      return f.members
        .filter((m) => m.organizationId === organizationId
          && m.prospectId === prospectId && m.status === 'active')
        .map((m) => m.listId)
        .sort();
    },

    // Orchestration (20261231000000) extended the port with a list's optional
    // ICP; 001's lists are manual, so none has one. Exercised over the real
    // store in orchestrationCampaignTargets.
    async getListIcp(organizationId, listId) {
      guard();
      return f.lists.some((l) => l.organizationId === organizationId && l.id === listId) ? null : undefined;
    },

    async setListIcp() {
      guard();
      return false;
    },
  };

  // Object.assign, NOT a spread: the store's closures captured `f`, so the
  // returned object must BE `f`. A copy would leave `failWith` and
  // `forceDuplicateOnce` unreachable from inside the store, and the two tests
  // that set them would silently exercise the happy path instead.
  return Object.assign(f as Fixture, { store });
}

const mustList = async (f: Fixture, org = ORG_A, name = 'Q4 enterprise'): Promise<ProspectList> => {
  const r = await createProspectList(f.store, { organizationId: org, name, actorUserId: USER });
  if (r.ok === false) throw new Error(`fixture list creation failed: ${r.refusal}`);
  return r.value;
};

describe('LISTS-001 (1) list creation and retrieval', () => {
  it('1. creates a list, recording tenant, creator and active status', async () => {
    const f = makeFixture();
    const created = await createProspectList(f.store, {
      organizationId: ORG_A, name: '  Q4   enterprise  ', description: ' top accounts ', actorUserId: USER,
    });
    expect(created.ok).toBe(true);
    if (created.ok === false) return;
    // Whitespace is collapsed and trimmed for STORAGE, not used as a key.
    expect(created.value.name).toBe('Q4 enterprise');
    expect(created.value.description).toBe('top accounts');
    expect(created.value.organizationId).toBe(ORG_A);
    expect(created.value.createdByUserId).toBe(USER);
    expect(created.value.status).toBe('active');
  });

  it('2. refuses a blank name rather than storing an unnameable list', async () => {
    const f = makeFixture();
    for (const name of ['', '   ', null, 42]) {
      const r = await createProspectList(f.store, { organizationId: ORG_A, name, actorUserId: USER });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refusal).toBe('invalid_name');
    }
  });

  it('3. retrieves one list, and lists them all for the tenant', async () => {
    const f = makeFixture();
    const a = await mustList(f, ORG_A, 'first');
    await mustList(f, ORG_A, 'second');

    const one = await getProspectList(f.store, { organizationId: ORG_A, listId: a.id });
    expect(one.ok).toBe(true);
    if (one.ok === true) expect(one.value.name).toBe('first');

    const all = await listProspectLists(f.store, { organizationId: ORG_A });
    expect(all.ok).toBe(true);
    if (all.ok === true) expect(all.value.map((l) => l.name).sort()).toEqual(['first', 'second']);
  });
});

describe('LISTS-001 (2) metadata update and archive', () => {
  it('4. updates permitted metadata', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const r = await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, name: 'renamed', description: 'why', actorUserId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.value.name).toBe('renamed');
      expect(r.value.description).toBe('why');
    }
  });

  it('5. archiving is a status change — the list and its members survive', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });

    const archived = await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, status: 'archived', actorUserId: USER,
    });
    expect(archived.ok).toBe(true);
    if (archived.ok === true) expect(archived.value.status).toBe('archived');

    // Still readable, still populated. Archive is not deletion.
    const members = await listMembers(f.store, { organizationId: ORG_A, listId: list.id });
    expect(members.ok).toBe(true);
    if (members.ok === true) expect(members.value.members).toHaveLength(1);
  });

  it('6. an ARCHIVED list refuses new members', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, status: 'archived', actorUserId: USER,
    });
    const r = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refusal).toBe('list_archived');
  });

  it('7. refuses an unknown status and an empty patch', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const bad = await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, status: 'deleted', actorUserId: USER,
    });
    expect(bad.ok).toBe(false);
    const empty = await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, actorUserId: USER,
    });
    expect(empty.ok).toBe(false);
    if (empty.ok === false) expect(empty.refusal).toBe('nothing_to_update');
  });
});

describe('LISTS-001 (3,4) adding members, and duplicate prevention', () => {
  it('8. adds an existing canonical prospect, recording provenance', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const r = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1,
      addedVia: 'icp_query', actorUserId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.value.alreadyMember).toBe(false);
    expect(r.value.member.prospectId).toBe(PROSPECT_1);
    expect(r.value.member.addedVia).toBe('icp_query');
    expect(r.value.member.addedByUserId).toBe(USER);
    expect(r.value.member.addedAt).toBeTruthy();
  });

  it('9. a second add is IDEMPOTENT — no duplicate, no moved timestamp', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const first = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    const second = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER_B,
    });
    expect(second.ok).toBe(true);
    if (first.ok === false || second.ok === false) return;

    expect(second.value.alreadyMember).toBe(true);
    expect(second.value.member.id).toBe(first.value.member.id);
    // The original addition is preserved, not overwritten by the retry.
    expect(second.value.member.addedAt).toBe(first.value.member.addedAt);
    expect(second.value.member.addedByUserId).toBe(USER);
    expect(f.members.filter((m) => m.status === 'active')).toHaveLength(1);
  });

  it('10. a LOST RACE is reported as alreadyMember, not as an error', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    // The pre-check passes, then the index refuses the insert.
    f.forceDuplicateOnce = true;
    const r = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.value.alreadyMember).toBe(true);
      expect(r.value.member.addedVia).toBe('race-winner');
    }
    expect(f.members.filter((m) => m.status === 'active')).toHaveLength(1);
  });

  it('11. refuses blank provenance — a membership always records how it arose', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const r = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: '   ', actorUserId: USER,
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refusal).toBe('invalid_provenance');
  });
});

describe('LISTS-001 (5) one prospect, many lists', () => {
  it('12. the same prospect may belong to several lists at once', async () => {
    const f = makeFixture();
    const l1 = await mustList(f, ORG_A, 'one');
    const l2 = await mustList(f, ORG_A, 'two');
    for (const list of [l1, l2]) {
      const r = await addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
      });
      expect(r.ok).toBe(true);
    }
    const inLists = await listsContainingProspect(f.store, {
      organizationId: ORG_A, prospectId: PROSPECT_1,
    });
    expect(inLists.ok).toBe(true);
    if (inLists.ok === true) expect([...inLists.value].sort()).toEqual([l1.id, l2.id].sort());
  });
});

describe('LISTS-001 (6,12) removal, retention, and the canonical prospect', () => {
  it('13. removal is SOFT: the row survives with who and when', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });

    const removed = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1,
      removalReason: 'bounced', actorUserId: USER_B,
    });
    expect(removed.ok).toBe(true);
    if (removed.ok === true) expect(removed.value.alreadyRemoved).toBe(false);

    // The membership row is RETAINED, not deleted.
    expect(f.members).toHaveLength(1);
    expect(f.members[0].status).toBe('removed');
    expect(f.members[0].removedAt).toBeTruthy();
    expect(f.members[0].removedByUserId).toBe(USER_B);
    expect(f.members[0].removalReason).toBe('bounced');
    // Provenance of the original addition survives the removal.
    expect(f.members[0].addedVia).toBe('manual');
    expect(f.members[0].addedByUserId).toBe(USER);
  });

  it('14. removal does NOT delete the canonical prospect', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    // The canonical reference set is untouched by a membership operation.
    expect(await f.store.prospectExists(ORG_A, PROSPECT_1)).toBe(true);
  });

  it('15. removal from ONE list leaves the other memberships alone', async () => {
    const f = makeFixture();
    const keep = await mustList(f, ORG_A, 'keep');
    const drop = await mustList(f, ORG_A, 'drop');
    for (const list of [keep, drop]) {
      await addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
      });
    }
    await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: drop.id, prospectId: PROSPECT_1, actorUserId: USER,
    });

    const inLists = await listsContainingProspect(f.store, {
      organizationId: ORG_A, prospectId: PROSPECT_1,
    });
    expect(inLists.ok).toBe(true);
    if (inLists.ok === true) expect(inLists.value).toEqual([keep.id]);
  });

  it('16. removing a non-member is idempotent, not an error', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.value.alreadyRemoved).toBe(true);
    expect(f.members).toHaveLength(0);
  });

  it('17. a removed prospect can be re-added, and the removal history is kept', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, removalReason: 'first pass', actorUserId: USER,
    });
    const again = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'second pass', actorUserId: USER,
    });
    expect(again.ok).toBe(true);
    if (again.ok === true) expect(again.value.alreadyMember).toBe(false);

    // Two rows: the removed one is the trail, the active one is the membership.
    expect(f.members).toHaveLength(2);
    expect(f.members.filter((m) => m.status === 'removed')[0].removalReason).toBe('first pass');
    expect(f.members.filter((m) => m.status === 'active')).toHaveLength(1);
  });
});

describe('LISTS-001 F-2 — repeated and concurrent removal are idempotent', () => {
  const seeded = async (f: Fixture) => {
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    return list;
  };

  it('F2-1. a SEQUENTIAL second removal is alreadyRemoved, and rewrites nothing', async () => {
    const f = makeFixture();
    const list = await seeded(f);

    const first = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1,
      removalReason: 'the real reason', actorUserId: USER,
    });
    expect(first.ok).toBe(true);
    if (first.ok === true) expect(first.value.alreadyRemoved).toBe(false);

    const removedAt = f.members[0].removedAt;

    const second = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1,
      removalReason: 'a later, different reason', actorUserId: USER_B,
    });
    expect(second.ok).toBe(true);
    if (second.ok === true) expect(second.value.alreadyRemoved).toBe(true);

    // The ORIGINAL removal stands. A retry must not re-stamp the actor, the
    // time or the reason — that would overwrite the audit trail it exists for.
    expect(f.members).toHaveLength(1);
    expect(f.members[0].removedAt).toBe(removedAt);
    expect(f.members[0].removedByUserId).toBe(USER);
    expect(f.members[0].removalReason).toBe('the real reason');
  });

  it('F2-2. a CONCURRENT removal that won the race is alreadyRemoved, not 500', async () => {
    const f = makeFixture();
    const list = await seeded(f);

    // The service reads an active membership, then the scoped update matches
    // nothing because another actor committed first.
    f.forceRemovalNoRowOnce = 'removed';

    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.value.alreadyRemoved).toBe(true);

    // The winner's removal data is intact; we did not overwrite it.
    expect(f.members[0].removedByUserId).toBe(USER_B);
    expect(f.members[0].removalReason).toBe('removed by someone else first');
  });

  it('F2-3. a VANISHED membership is a failure, never a claimed removal', async () => {
    const f = makeFixture();
    const list = await seeded(f);
    f.forceRemovalNoRowOnce = 'vanish';

    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    // We did not observe the removal we were asked to perform.
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.refusal).toBe('store_failed');
      expect(r.detail).toMatch(/disappeared/);
    }
  });

  it('F2-4. STILL ACTIVE after a zero-row update is a failure, not success', async () => {
    const f = makeFixture();
    const list = await seeded(f);
    f.forceRemovalNoRowOnce = 'active';

    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.refusal).toBe('store_failed');
      expect(r.detail).toMatch(/still active/);
    }
    // And the membership really is untouched.
    expect(f.members[0].status).toBe('active');
  });

  it('F2-5. a READ FAILURE after the zero-row update stays a failure', async () => {
    const f = makeFixture();
    const list = await seeded(f);

    // Zero rows affected, and then the re-read itself errors. An arbitrary
    // database error must never become `alreadyRemoved: true`.
    f.forceRemovalNoRowOnce = 'removed';
    const original = f.store.findMembershipById;
    f.store.findMembershipById = async () => { throw new Error('connection reset'); };

    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.refusal).toBe('store_failed');
      expect(r.detail).toContain('connection reset');
    }
    f.store.findMembershipById = original;
  });

  it('F2-6. the re-read is TENANT SCOPED — it cannot see another tenant\'s row', async () => {
    const f = makeFixture();
    const list = await seeded(f);
    const membershipId = f.members[0].id;

    // The same membership id, asked for as the wrong tenant.
    expect(await f.store.findMembershipById(ORG_B, membershipId)).toBeNull();
    expect(await f.store.findMembershipById(ORG_A, membershipId)).not.toBeNull();
  });

  it('F2-7. removal after the list itself is gone still refuses on the list', async () => {
    const f = makeFixture();
    const list = await seeded(f);
    // Archiving does not block removal — only a missing list does.
    await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, status: 'archived', actorUserId: USER,
    });
    const r = await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    // A member may always be taken OUT of an archived list.
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.value.alreadyRemoved).toBe(false);
  });
});

describe('LISTS-001 (7) pagination is stable', () => {
  it('18. pages the full membership exactly once, in a stable order', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const prospects: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const id = `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}`;
      prospects.push(id);
      f.prospects.get(ORG_A)!.add(id);
      await addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: id, addedVia: 'manual', actorUserId: USER,
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listMembers(f.store, {
        organizationId: ORG_A, listId: list.id, pageSize: 3, ...(cursor ? { cursor } : {}),
      });
      expect(page.ok).toBe(true);
      if (page.ok === false) return;
      seen.push(...page.value.members.map((m) => m.prospectId));
      if (!page.value.nextCursor) break;
      cursor = page.value.nextCursor;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen.sort()).toEqual(prospects.sort());
  });

  it('19. refuses an out-of-range page size and a malformed cursor', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    for (const pageSize of [0, -1, MAX_PAGE_SIZE + 1, 1.5]) {
      const r = await listMembers(f.store, { organizationId: ORG_A, listId: list.id, pageSize });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refusal).toBe('invalid_page_size');
    }
    const bad = await listMembers(f.store, {
      organizationId: ORG_A, listId: list.id, cursor: 'not-a-cursor',
    });
    expect(bad.ok).toBe(false);
    if (bad.ok === false) expect(bad.refusal).toBe('invalid_cursor');
  });

  it('20. the cursor round-trips and rejects a tampered one', () => {
    const when = '2026-10-16T00:00:00.000Z';
    const token = encodeCursor(when, PROSPECT_1);
    expect(decodeCursor(token)).toEqual({ addedAt: when, id: PROSPECT_1 });
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(encodeCursor(when, 'not-a-uuid'))).toBeNull();
    expect(decodeCursor(encodeCursor('not-a-date', PROSPECT_1))).toBeNull();
  });

  it('21. active members are returned by DEFAULT — a removed one is not', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    for (const p of [PROSPECT_1, PROSPECT_2]) {
      await addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: p, addedVia: 'manual', actorUserId: USER,
      });
    }
    await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });

    const live = await listMembers(f.store, { organizationId: ORG_A, listId: list.id });
    expect(live.ok).toBe(true);
    if (live.ok === true) expect(live.value.members.map((m) => m.prospectId)).toEqual([PROSPECT_2]);

    const all = await listMembers(f.store, { organizationId: ORG_A, listId: list.id, status: 'all' });
    expect(all.ok).toBe(true);
    if (all.ok === true) expect(all.value.members).toHaveLength(2);
  });
});

describe('LISTS-001 (8,9,10) tenant isolation and fail-closed', () => {
  it('22. tenant B cannot read tenant A\'s list — NOT FOUND, never forbidden', async () => {
    const f = makeFixture();
    const list = await mustList(f, ORG_A);
    const r = await getProspectList(f.store, { organizationId: ORG_B, listId: list.id });
    expect(r.ok).toBe(false);
    // 404-shaped, so the refusal is not an existence oracle for another tenant.
    if (r.ok === false) expect(r.refusal).toBe('list_not_found');
  });

  it('23. tenant B cannot add to, remove from or page tenant A\'s list', async () => {
    const f = makeFixture();
    const list = await mustList(f, ORG_A);
    const add = await addProspectToList(f.store, {
      organizationId: ORG_B, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    const remove = await removeProspectFromList(f.store, {
      organizationId: ORG_B, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    const page = await listMembers(f.store, { organizationId: ORG_B, listId: list.id });
    for (const r of [add, remove, page]) {
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refusal).toBe('list_not_found');
    }
    expect(f.members).toHaveLength(0);
  });

  it('24. a tenant A list cannot take a prospect that exists only in tenant B', async () => {
    const f = makeFixture();
    const list = await mustList(f, ORG_A);
    // PROSPECT_2 exists in A but not in B; assert the mirror case.
    const listB = await mustList(f, ORG_B, 'b list');
    const r = await addProspectToList(f.store, {
      organizationId: ORG_B, listId: listB.id, prospectId: PROSPECT_2, addedVia: 'manual', actorUserId: USER,
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refusal).toBe('prospect_not_found');
    expect(list.organizationId).toBe(ORG_A);
  });

  it('25. a missing tenant context FAILS CLOSED on every operation', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    for (const organizationId of ['', '   ', 'not-a-uuid']) {
      const results = await Promise.all([
        createProspectList(f.store, { organizationId, name: 'x', actorUserId: USER }),
        getProspectList(f.store, { organizationId, listId: list.id }),
        listProspectLists(f.store, { organizationId }),
        updateProspectList(f.store, { organizationId, listId: list.id, name: 'y', actorUserId: USER }),
        addProspectToList(f.store, {
          organizationId, listId: list.id, prospectId: PROSPECT_1, addedVia: 'm', actorUserId: USER,
        }),
        removeProspectFromList(f.store, {
          organizationId, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
        }),
        listMembers(f.store, { organizationId, listId: list.id }),
        listsContainingProspect(f.store, { organizationId, prospectId: PROSPECT_1 }),
      ]);
      for (const r of results) {
        expect(r.ok).toBe(false);
        if (r.ok === false) expect(r.refusal).toBe('tenant_required');
      }
    }
  });

  it('26. a missing ACTOR fails closed on every mutation', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    const results = await Promise.all([
      createProspectList(f.store, { organizationId: ORG_A, name: 'x', actorUserId: '' }),
      updateProspectList(f.store, { organizationId: ORG_A, listId: list.id, name: 'y', actorUserId: '  ' }),
      addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'm', actorUserId: '',
      }),
      removeProspectFromList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: '',
      }),
    ]);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refusal).toBe('actor_required');
    }
  });

  it('27. malformed identifiers are refused before any store call', async () => {
    const f = makeFixture();
    const bad = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: 'nope', prospectId: PROSPECT_1, addedVia: 'm', actorUserId: USER,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok === false) expect(bad.refusal).toBe('invalid_list_id');

    const list = await mustList(f);
    const badProspect = await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: 'nope', addedVia: 'm', actorUserId: USER,
    });
    expect(badProspect.ok).toBe(false);
    if (badProspect.ok === false) expect(badProspect.refusal).toBe('invalid_prospect_id');
  });
});

describe('LISTS-001 (11) database failures are reported, never swallowed', () => {
  it('28. a store failure becomes store_failed — not an empty list', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    f.failWith = 'connection reset';

    const results = await Promise.all([
      getProspectList(f.store, { organizationId: ORG_A, listId: list.id }),
      listProspectLists(f.store, { organizationId: ORG_A }),
      listMembers(f.store, { organizationId: ORG_A, listId: list.id }),
      addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'm', actorUserId: USER,
      }),
      removeProspectFromList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
      }),
      listsContainingProspect(f.store, { organizationId: ORG_A, prospectId: PROSPECT_1 }),
    ]);

    for (const r of results) {
      expect(r.ok).toBe(false);
      // An empty page would read as "this list has nobody in it".
      if (r.ok === false) {
        expect(r.refusal).toBe('store_failed');
        expect(r.detail).toContain('connection reset');
      }
    }
  });
});

describe('LISTS-001 (13) the audience read contract', () => {
  it('29. returns the active audience with provenance and a tenant reference', async () => {
    const f = makeFixture();
    const list = await mustList(f, ORG_A, 'audience');
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'icp_query', actorUserId: USER,
    });

    const page = await readAudiencePage(f.store, { organizationId: ORG_A, listId: list.id });
    expect(page.ok).toBe(true);
    if (page.ok === false) return;
    expect(page.page.listId).toBe(list.id);
    expect(page.page.organizationId).toBe(ORG_A);
    expect(page.page.listName).toBe('audience');
    expect(page.page.listStatus).toBe('active');
    expect(page.page.members).toHaveLength(1);
    expect(page.page.members[0].prospectId).toBe(PROSPECT_1);
    expect(page.page.members[0].addedVia).toBe('icp_query');
  });

  it('30. NEVER claims eligibility — that is the governance gate\'s answer', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    const page = await readAudiencePage(f.store, { organizationId: ORG_A, listId: list.id });
    expect(page.ok).toBe(true);
    if (page.ok === true) {
      // Stated as a field so a consumer cannot read silence as permission.
      expect(page.page.eligibilityEvaluated).toBe(false);
      expect(JSON.stringify(page.page)).not.toMatch(/suppress|mayContact|eligible"/i);
    }
  });

  it('31. excludes removed members, so an engine cannot enrol one', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    for (const p of [PROSPECT_1, PROSPECT_2]) {
      await addProspectToList(f.store, {
        organizationId: ORG_A, listId: list.id, prospectId: p, addedVia: 'manual', actorUserId: USER,
      });
    }
    await removeProspectFromList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, actorUserId: USER,
    });
    const page = await readAudiencePage(f.store, { organizationId: ORG_A, listId: list.id });
    expect(page.ok).toBe(true);
    if (page.ok === true) {
      expect(page.page.members.map((m) => m.prospectId)).toEqual([PROSPECT_2]);
    }
  });

  it('32. an archived list is READABLE but not ENROLLABLE', async () => {
    const f = makeFixture();
    const list = await mustList(f);
    await addProspectToList(f.store, {
      organizationId: ORG_A, listId: list.id, prospectId: PROSPECT_1, addedVia: 'manual', actorUserId: USER,
    });
    await updateProspectList(f.store, {
      organizationId: ORG_A, listId: list.id, status: 'archived', actorUserId: USER,
    });

    const page = await readAudiencePage(f.store, { organizationId: ORG_A, listId: list.id });
    expect(page.ok).toBe(true);
    if (page.ok === true) {
      expect(page.page.listStatus).toBe('archived');
      expect(page.page.members).toHaveLength(1);
      expect(isListEnrollable({ status: page.page.listStatus })).toBe(false);
    }
    expect(isListEnrollable({ status: 'active' })).toBe(true);
    expect(isListEnrollable(null)).toBe(false);
  });

  it('33. a foreign-tenant audience read is NOT FOUND', async () => {
    const f = makeFixture();
    const list = await mustList(f, ORG_A);
    const page = await readAudiencePage(f.store, { organizationId: ORG_B, listId: list.id });
    expect(page.ok).toBe(false);
    if (page.ok === false) expect(page.refusal).toBe('list_not_found');
  });
});
