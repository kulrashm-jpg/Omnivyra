/**
 * PI LISTS-001 — the ROUTES, against the real authorization chain.
 *
 * ─── WHY THIS SUITE EXISTS SEPARATELY ────────────────────────────────────
 * `piLists001ProspectLists.test.ts` drives the service through a port double,
 * which proves the rules and deliberately never touches `ownedDbTable`. The
 * routes are the actual attack surface, and the chain in front of them —
 * resolvePrincipal, requireTenantAccess, membership resolution, the
 * bridge-principal refusal — is code this feature did not write and must not be
 * assumed. So this suite fakes ONLY the database and the identity provider and
 * runs everything in between for real, including `productionListStore`.
 *
 * ─── WHAT THE FAKE DATABASE CAN AND CANNOT PROVE ──────────────────────────
 * The shared harness speaks enough PostgREST for filters, ordering and limits,
 * and it can be told to refuse an insert with `23505`. Two honest limits:
 *
 *   `.or()` IS A NO-OP in the harness. Cursor pagination is therefore NOT
 *   asserted here — it would pass whatever the keyset predicate said, which is
 *   worse than not testing it. Paging is covered in the service suite, where
 *   the double implements the ordering faithfully.
 *
 *   DEFAULTS DO NOT EXIST. The fake applies no column default, so a freshly
 *   inserted row has no `status` or `added_at`. Assertions here are about
 *   authorization, tenant predicates, status codes and the duplicate path —
 *   never about a value the database would have supplied.
 *
 * Nothing here verifies a constraint. Uniqueness, the composite foreign keys,
 * the CHECKs and RLS are the migration's guarantees and are UNVERIFIED until a
 * real schema runs them.
 */

import {
  seed, invoke, failTable, calls, rows, uniqueKey, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// eslint-disable-next-line @typescript-eslint/no-var-requires
const listsRoute = require('../../../pages/api/prospect-lists/index').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const membersRoute = require('../../../pages/api/prospect-lists/members').default;

/**
 * The harness's own fixture ids are not uuid-shaped, and `companies.id` is
 * `uuid` in this schema, so the suite seeds its own uuid tenants and attaches
 * the harness's existing users to them. That keeps the real membership
 * resolution in play rather than relaxing the service's validation to suit a
 * fixture.
 */
const ORG_1 = '11111111-1111-4111-8111-111111111111';
const ORG_2 = '22222222-2222-4222-8222-222222222222';
const LIST_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIST_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROSPECT_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN_PROSPECT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const world = () => ({
  companies: [
    { id: ORG_1, status: 'active', name: 'Tenant One' },
    { id: ORG_2, status: 'active', name: 'Tenant Two' },
  ],
  user_company_roles: [
    { user_id: USER_A, company_id: ORG_1, role: 'COMPANY_ADMIN', status: 'active' },
    { user_id: USER_B, company_id: ORG_2, role: 'COMPANY_ADMIN', status: 'active' },
  ],
  prospect_lists: [
    {
      id: LIST_1, organization_id: ORG_1, name: 'Tenant One list', description: null,
      status: 'active', created_by_user_id: USER_A,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: LIST_2, organization_id: ORG_2, name: 'Tenant Two list', description: null,
      status: 'active', created_by_user_id: USER_B,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    },
  ],
  canonical_leads: [
    { id: PROSPECT_1, company_id: ORG_1, user_id: USER_A, source: 'manual', qualification_score: 0 },
    { id: FOREIGN_PROSPECT, company_id: ORG_2, user_id: USER_B, source: 'manual', qualification_score: 0 },
  ],
  prospect_list_members: [] as Record<string, unknown>[],
});

beforeEach(() => seed(world()));

/** Every call the route made against a table, with the filters it used. */
const callsTo = (table: string) => calls().filter((c) => c.table === table);

describe('authentication is required before anything else', () => {
  it('1. an unauthenticated caller gets 401 and reaches no table', async () => {
    const r = await invoke(listsRoute, { method: 'GET', query: { companyId: ORG_1 } });
    expect(r.status).toBe(401);
    expect(callsTo('prospect_lists')).toHaveLength(0);
  });

  it('2. an unauthenticated membership call gets 401 and writes nothing', async () => {
    const r = await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' },
    });
    expect(r.status).toBe(401);
    expect(rows('prospect_list_members')).toHaveLength(0);
  });

  it('3. an unsupported method is refused with Allow, before the guard', async () => {
    const r = await invoke(listsRoute, { method: 'DELETE', query: { companyId: ORG_1 }, as: 'A' });
    expect(r.status).toBe(405);
  });
});

describe('tenant isolation runs through the real guard', () => {
  it('4. tenant One reads its own list', async () => {
    const r = await invoke(listsRoute, {
      method: 'GET', query: { companyId: ORG_1, listId: LIST_1 }, as: 'A',
    });
    expect(r.status).toBe(200);
    expect((r.body as any)?.list?.id).toBe(LIST_1);
  });

  it('5. tenant Two CANNOT read tenant One\'s list', async () => {
    // Asking for ORG_1 as USER_B: the guard refuses before the service runs.
    const foreignTenant = await invoke(listsRoute, {
      method: 'GET', query: { companyId: ORG_1, listId: LIST_1 }, as: 'B',
    });
    expect([401, 403]).toContain(foreignTenant.status);
    expect(callsTo('prospect_lists')).toHaveLength(0);
  });

  it('6. naming a foreign LIST id under your OWN tenant is 404, not 403', async () => {
    // USER_B is legitimately in ORG_2 and names ORG_1's list. The guard passes;
    // the service's tenant predicate makes the row invisible. 404 and not 403,
    // so the refusal is not an existence oracle for another tenant's ids.
    const r = await invoke(listsRoute, {
      method: 'GET', query: { companyId: ORG_2, listId: LIST_1 }, as: 'B',
    });
    expect(r.status).toBe(404);
    expect((r.body as any)?.code).toBe('list_not_found');
  });

  it('7. every query the route makes carries the verified tenant', async () => {
    await invoke(listsRoute, { method: 'GET', query: { companyId: ORG_1 }, as: 'A' });
    const listQueries = callsTo('prospect_lists');
    expect(listQueries.length).toBeGreaterThan(0);
    for (const c of listQueries) {
      expect(c.filters.organization_id).toBe(ORG_1);
    }
  });

  it('8. a foreign PROSPECT cannot be added, and nothing is written', async () => {
    const r = await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: FOREIGN_PROSPECT, addedVia: 'manual' },
      as: 'A',
    });
    expect(r.status).toBe(404);
    expect((r.body as any)?.code).toBe('prospect_not_found');
    expect(rows('prospect_list_members')).toHaveLength(0);
  });

  it('9. the canonical prospect is looked up by its OWN tenant column', async () => {
    await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' },
      as: 'A',
    });
    const leadQueries = callsTo('canonical_leads');
    expect(leadQueries.length).toBeGreaterThan(0);
    // canonical_leads keys its tenant `company_id`, not `organization_id`.
    for (const c of leadQueries) {
      expect(c.filters.company_id).toBe(ORG_1);
      expect(c.op).toBe('select');
    }
  });
});

describe('membership writes, and what they are not allowed to touch', () => {
  it('10. adding a member returns 201 and writes one row in this tenant', async () => {
    const r = await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'icp_query' },
      as: 'A',
    });
    expect(r.status).toBe(201);
    expect((r.body as any)?.alreadyMember).toBe(false);

    const written = rows('prospect_list_members');
    expect(written).toHaveLength(1);
    expect(written[0].organization_id).toBe(ORG_1);
    expect(written[0].list_id).toBe(LIST_1);
    expect(written[0].prospect_id).toBe(PROSPECT_1);
    expect(written[0].added_via).toBe('icp_query');
    expect(written[0].added_by_user_id).toBe(USER_A);
  });

  it('11. the route NEVER writes a canonical table', async () => {
    await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' },
      as: 'A',
    });
    await invoke(membersRoute, {
      method: 'DELETE',
      query: { companyId: ORG_1, listId: LIST_1, prospectId: PROSPECT_1 },
      as: 'A',
    });

    const forbidden = ['canonical_leads', 'unified_persons', 'prospect_accounts',
      'source_records', 'source_assertions', 'canonical_attribute_decisions'];
    for (const table of forbidden) {
      for (const c of callsTo(table)) {
        // Reading canonical_leads to check a reference is allowed. Writing is not.
        expect(c.op).toBe('select');
      }
    }
  });

  it('12. adding the same prospect twice is idempotent — 200, and one row', async () => {
    const body = { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' };

    const first = await invoke(membersRoute, {
      method: 'POST', query: { companyId: ORG_1 }, body, as: 'A',
    });
    expect(first.status).toBe(201);
    expect((first.body as any)?.alreadyMember).toBe(false);

    const second = await invoke(membersRoute, {
      method: 'POST', query: { companyId: ORG_1 }, body, as: 'A',
    });
    // 200, not 201 and not a conflict: the end state the caller asked for holds.
    expect(second.status).toBe(200);
    expect((second.body as any)?.alreadyMember).toBe(true);
    expect(rows('prospect_list_members')).toHaveLength(1);

    // NOTE on what is deliberately NOT tested here. The LOST-RACE branch — the
    // index refusing an insert that passed the pre-check — needs the partial,
    // three-column index's semantics, and the harness's `uniqueKey` models only
    // a total single-column one, which would also refuse a legitimate re-add
    // after removal. Constructing it here produced a state that cannot occur in
    // production, so the branch is covered in piLists001 instead, where the
    // double replicates the real predicate.
    expect(typeof uniqueKey).toBe('function');
  });

  it('13. DELETE removes the MEMBERSHIP and never the prospect', async () => {
    await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' },
      as: 'A',
    });

    const r = await invoke(membersRoute, {
      method: 'DELETE',
      query: { companyId: ORG_1, listId: LIST_1, prospectId: PROSPECT_1, reason: 'bounced' },
      as: 'A',
    });
    expect(r.status).toBe(200);
    expect((r.body as any)?.alreadyRemoved).toBe(false);

    // The membership row SURVIVES, marked removed. No DELETE statement is used.
    const membership = rows('prospect_list_members');
    expect(membership).toHaveLength(1);
    expect(membership[0].status).toBe('removed');
    expect(membership[0].removed_by_user_id).toBe(USER_A);
    expect(membership[0].removal_reason).toBe('bounced');
    for (const c of callsTo('prospect_list_members')) {
      expect(c.op).not.toBe('delete');
    }
    // The canonical prospect is untouched.
    expect(rows('canonical_leads').some((l) => l.id === PROSPECT_1)).toBe(true);
  });

  it('14. removing a non-member is idempotent, not an error', async () => {
    const r = await invoke(membersRoute, {
      method: 'DELETE',
      query: { companyId: ORG_1, listId: LIST_1, prospectId: PROSPECT_1 },
      as: 'A',
    });
    expect(r.status).toBe(200);
    expect((r.body as any)?.alreadyRemoved).toBe(true);
  });
});

describe('list lifecycle through the route', () => {
  it('15. POST creates a list bound to the verified tenant', async () => {
    const r = await invoke(listsRoute, {
      method: 'POST', query: { companyId: ORG_1 }, body: { name: 'New audience' }, as: 'A',
    });
    expect(r.status).toBe(201);
    const created = rows('prospect_lists').find((l) => l.name === 'New audience');
    expect(created?.organization_id).toBe(ORG_1);
    expect(created?.created_by_user_id).toBe(USER_A);
  });

  it('16. PATCH archives, and an archived list then refuses new members with 409', async () => {
    const archived = await invoke(listsRoute, {
      method: 'PATCH', query: { companyId: ORG_1 }, body: { listId: LIST_1, status: 'archived' }, as: 'A',
    });
    expect(archived.status).toBe(200);

    const add = await invoke(membersRoute, {
      method: 'POST',
      query: { companyId: ORG_1 },
      body: { listId: LIST_1, prospectId: PROSPECT_1, addedVia: 'manual' },
      as: 'A',
    });
    expect(add.status).toBe(409);
    expect((add.body as any)?.code).toBe('list_archived');
    expect(rows('prospect_list_members')).toHaveLength(0);
  });

  it('17. a malformed identifier is 400, and reaches no table', async () => {
    const r = await invoke(listsRoute, {
      method: 'GET', query: { companyId: ORG_1, listId: 'not-a-uuid' }, as: 'A',
    });
    expect(r.status).toBe(400);
    expect((r.body as any)?.code).toBe('invalid_list_id');
    expect(callsTo('prospect_lists')).toHaveLength(0);
  });
});

describe('a database failure is reported, never swallowed', () => {
  it('18. a failing table becomes 500 — not an empty list', async () => {
    failTable('prospect_lists');
    const r = await invoke(listsRoute, { method: 'GET', query: { companyId: ORG_1 }, as: 'A' });
    expect(r.status).toBe(500);
    // Emphatically NOT 200 with `lists: []`, which a caller would act on.
    expect((r.body as any)?.lists).toBeUndefined();
  });

  it('19. a failing membership table becomes 500 on a read', async () => {
    failTable('prospect_list_members');
    const r = await invoke(membersRoute, {
      method: 'GET', query: { companyId: ORG_1, listId: LIST_1 }, as: 'A',
    });
    expect(r.status).toBe(500);
    expect((r.body as any)?.members).toBeUndefined();
  });

  it('20. no error response leaks a table name or a tenant identifier', async () => {
    failTable('prospect_lists');
    const r = await invoke(listsRoute, { method: 'GET', query: { companyId: ORG_1 }, as: 'A' });
    const body = JSON.stringify(r.body ?? {});
    expect(body).not.toMatch(/prospect_lists|organization_id|connection/i);
    expect(body).not.toContain(ORG_1);
  });
});
