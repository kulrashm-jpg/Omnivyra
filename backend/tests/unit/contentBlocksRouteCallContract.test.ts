/**
 * pages/api/content/[id]/blocks.ts — THE CALL CONTRACT, ASSERTED BEHAVIOURALLY.
 *
 * WHY THIS SUITE EXISTS. An independent review swapped the argument order at
 * BOTH service call sites of this route — `upsertBlocks(id, scopedCompanyId,
 * parsed)` and `setBlockLocked(scopedCompanyId, blockId, locked)` — and the
 * whole 377-test RBAC suite for these routes still passed. A repository-wide
 * grep for `toHaveBeenCalledWith`, `mock.calls` or `calls[0]` against
 * `upsertBlocks` or `setBlockLocked` returned NOTHING: no test anywhere
 * asserted what arguments the route passes.
 *
 * The reason that suite is blind is structural, not an oversight of detail:
 * sec91W2GContentWriteRbac.test.ts mocks the whole collaboration service and
 * asserts only `called(...)` / `not.toHaveBeenCalled()`. A mock records that a
 * function ran; it cannot notice that the content id arrived where the company
 * id belongs. And collaborationBlockTenantSafety.test.ts calls the service
 * DIRECTLY, so it never exercises the route's own argument passing at all.
 *
 * HOW THIS SUITE IS DIFFERENT. It runs the REAL route against the REAL
 * collaboration service and the REAL `getContent`, with only the database, the
 * identity provider and the config faked. Argument order is therefore
 * observable in the statements that reach the fake database — the filters of
 * the ownership lookup, the filters of the lock update, and the columns of the
 * persisted row. A swap moves a content uuid into `company_id` and a company
 * uuid into `content_id`, which these assertions read directly.
 *
 * WHAT THIS SUITE ESTABLISHES: the order and meaning of the arguments the route
 * passes, and the consequences of getting them wrong — a save attributed to the
 * wrong tenant, a row stamped with a content uuid as its company, and a lock
 * that reports nothing mutated.
 *
 * WHAT IT DOES NOT ESTABLISH: anything about PostgreSQL or PostgREST. The
 * database is the in-memory fake; see the limits note in routeAuthHarness.
 */
import {
  seed,
  invoke,
  rows,
  calls,
  writeCalls,
  completedWrites,
  uniqueKey,
  resolveUpsertConflicts,
  assertNoHarnessConfigurationError,
  CO_A,
  CO_B,
} from '../helpers/routeAuthHarness';
import { roleRows } from '../helpers/sec91W2AHarness';
import { as, w2gRoleRows } from '../helpers/sec91W2GHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const blocksRoute = require('../../../pages/api/content/[id]/blocks').default;

// Well-formed uuids: the route validates each element's shape, and
// upsertBlocks rejects a malformed id before any database access.
const CONTENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTENT_A2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BLOCK_A1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BLOCK_A2_OTHER_CONTENT = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const BLOCK_B1 = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';

/** A legitimate writer in company A (role ADMIN, active). */
const WRITER = 'LEGACY_ADMIN' as const;

function world(): void {
  seed({
    user_company_roles: [...roleRows(), ...w2gRoleRows()],
    // The REAL getContent runs against this table, so the route's ownership
    // proof is exercised rather than stubbed.
    content: [
      { id: CONTENT_A, company_id: CO_A, content_type: 'post', body: 'A', current_revision: 1 },
      { id: CONTENT_A2, company_id: CO_A, content_type: 'post', body: 'A2', current_revision: 1 },
      { id: CONTENT_B, company_id: CO_B, content_type: 'post', body: 'B', current_revision: 1 },
    ],
    content_block: [
      { id: BLOCK_A1, company_id: CO_A, content_id: CONTENT_A, block_type: 'body', position: 0, text: 'A original', locked: false },
      { id: BLOCK_A2_OTHER_CONTENT, company_id: CO_A, content_id: CONTENT_A2, block_type: 'body', position: 0, text: 'A other content', locked: false },
      { id: BLOCK_B1, company_id: CO_B, content_id: CONTENT_B, block_type: 'body', position: 0, text: 'B CONFIDENTIAL', locked: false },
    ],
  });
  // Same declarations the service-level tenant-safety suite makes, and for the
  // same reason: the upsert must RESOLVE its conflict target, not append. See
  // that suite's note on what `['id']` as a default arbiter does and does not
  // claim — it is this suite's stated BELIEF about the server's default, not
  // established behaviour.
  uniqueKey('content_block', 'id');
  resolveUpsertConflicts('content_block', ['id']);
}

beforeEach(() => {
  world();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  // A refusal is not a security outcome; fail loudly rather than let a
  // misconfigured statement read as an enforced one.
  assertNoHarnessConfigurationError();
  jest.restoreAllMocks();
});

const post = (body: unknown, id: string = CONTENT_A) =>
  invoke(blocksRoute, { method: 'POST', query: { id, companyId: CO_A }, body, headers: as(WRITER) });

const get = (id: string = CONTENT_A) =>
  invoke(blocksRoute, { method: 'GET', query: { id, companyId: CO_A }, headers: as(WRITER) });

const blockRow = (id: string): Record<string, unknown> | undefined =>
  rows('content_block').find((r) => String(r.id) === id) as Record<string, unknown> | undefined;

/** Statements against content_block, by op. */
const blockCalls = (op?: string) =>
  calls().filter((c) => c.table === 'content_block' && (!op || c.op === op));

describe('upsertBlocks — the route passes (companyId, contentId, blocks) in that order', () => {
  it('the ownership lookup carries the COMPANY in company_id and the CONTENT in content_id', async () => {
    // THE DECISIVE ASSERTION for argument order on this call site. Swapping the
    // first two arguments puts CONTENT_A in company_id and CO_A in content_id,
    // and these two lines read exactly those columns. Nothing else in the
    // repository asserted them.
    const r = await post({ blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] });
    expect(r.status).toBe(200);

    const lookup = blockCalls('select')[0];
    expect(lookup).toBeDefined();
    expect(lookup.filters.company_id).toBe(CO_A);
    expect(lookup.filters.content_id).toBe(CONTENT_A);
    // And the two are genuinely distinguishable: a swap cannot pass by accident
    // because the fixtures are different values.
    expect(lookup.filters.company_id).not.toBe(CONTENT_A);
    expect(lookup.filters.content_id).not.toBe(CO_A);
  });

  it('the persisted row keeps the caller’s company and the route’s content id', async () => {
    const r = await post({ blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] });
    expect(r.status).toBe(200);

    const row = blockRow(BLOCK_A1)!;
    expect(row.company_id).toBe(CO_A);
    expect(row.content_id).toBe(CONTENT_A);
    expect(row.text).toBe('A edited');
  });

  it('an ID-LESS save cannot persist a row carrying a CONTENT uuid as its company', async () => {
    // The shape with no id is the ordinary first save, and it is where a swap
    // does its quietest damage: the ownership lookup is skipped entirely (no
    // supplied id to validate), so nothing refuses the call and the row is
    // simply stamped with whatever the service was handed. Under a swap that is
    // `company_id = <content uuid>`, a row `listBlocks` can never read back.
    const r = await post({ blocks: [{ blockType: 'hook', position: 0, text: 'fresh' }] });
    expect(r.status).toBe(200);

    const fresh = rows('content_block').filter((x) => String(x.text) === 'fresh');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].company_id).toBe(CO_A);
    expect(fresh[0].content_id).toBe(CONTENT_A);
    // Stated as its own assertion, because this is the corrupted state itself
    // rather than merely the absence of the correct one.
    expect(fresh[0].company_id).not.toBe(CONTENT_A);
    expect(fresh[0].content_id).not.toBe(CO_A);
  });

  it('a saved block is readable back through the same route, which a swap would break', async () => {
    // The end-to-end consequence: a row stamped with the wrong company is
    // invisible to the GET, so this round trip is what a swap actually costs a
    // user. listBlocks(contentId, companyId) has its own argument order, and
    // this exercises both call sites against one another.
    await post({ blocks: [{ blockType: 'body', position: 3, text: 'round trip' }] });
    const r = await get();
    expect(r.status).toBe(200);
    const texts = ((r.body as { blocks: Array<{ text: string }> }).blocks).map((b) => b.text);
    expect(texts).toContain('round trip');
  });

  it('an existing block of ANOTHER company is refused before any write', async () => {
    // The ownership pre-validation, reached only because the lookup's company
    // predicate is the right way round.
    const r = await post({ blocks: [{ id: BLOCK_B1, blockType: 'body', position: 0, text: 'TAKEOVER' }] });
    expect(r.status).toBe(404);
    expect(writeCalls(['content_block'])).toHaveLength(0);
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
  });

  it('an existing block of another CONTENT in the same company is refused too', async () => {
    // The content predicate, isolated: same company, different content. If the
    // arguments were swapped this would be refused as well, so this is not an
    // argument-order test — it pins the content half of the pre-validation.
    const r = await post({ blocks: [{ id: BLOCK_A2_OTHER_CONTENT, blockType: 'body', position: 0, text: 'cross-content' }] });
    expect(r.status).toBe(404);
    expect(writeCalls(['content_block'])).toHaveLength(0);
    expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({ content_id: CONTENT_A2, text: 'A other content' });
  });
});

describe('setBlockLocked — the route passes (blockId, companyId, locked) in that order', () => {
  it('the update filters carry the BLOCK in id and the COMPANY in company_id', async () => {
    // THE DECISIVE ASSERTION for this call site. The documented signature in
    // the route's own header was `setBlockLocked(id, blockId, locked)` — whose
    // first parameter is the CONTENT id, which the real function never
    // receives. A maintainer following that doc would swap these two, and
    // nothing in the repository would have failed.
    const r = await post({ action: 'lock', blockId: BLOCK_A1, locked: true });
    expect(r.status).toBe(200);

    const update = blockCalls('update')[0];
    expect(update).toBeDefined();
    expect(update.filters.id).toBe(BLOCK_A1);
    expect(update.filters.company_id).toBe(CO_A);
    expect(update.filters.id).not.toBe(CO_A);
    expect(update.filters.company_id).not.toBe(BLOCK_A1);
    // The payload is the lock flag and only the lock flag.
    expect(update.payload).toEqual({ locked: true });
  });

  it('a legitimate same-company lock reports the mutated block and applies it', async () => {
    const r = await post({ action: 'lock', blockId: BLOCK_A1, locked: true });
    expect(r.status).toBe(200);
    expect((r.body as { block: { id: string; locked: boolean } }).block).toMatchObject({ id: BLOCK_A1, locked: true });
    expect(blockRow(BLOCK_A1)).toMatchObject({ locked: true });
    expect(completedWrites(['content_block'])).toHaveLength(1);
  });

  it('an explicit unlock works the same way round', async () => {
    await post({ action: 'lock', blockId: BLOCK_A1, locked: true });
    const r = await post({ action: 'lock', blockId: BLOCK_A1, locked: false });
    expect(r.status).toBe(200);
    expect((r.body as { block: { locked: boolean } }).block).toMatchObject({ locked: false });
    expect(blockRow(BLOCK_A1)).toMatchObject({ locked: false });
  });

  it('locking a block OUTSIDE the authorized company mutates nothing and reports no block', async () => {
    // What the response must not do is represent a mutation that did not
    // happen. The body carries `block: null` and company B's row is untouched.
    //
    // THE STATUS IS 200, AND THAT IS THE CURRENT ROUTE BEHAVIOUR, pinned here
    // rather than asserted as desirable: the service answers null and the route
    // forwards it. A 200 with a null block is a weak signal to a client — the
    // shipped hook does not read it at all — but it is NOT a report of a
    // successful mutation, and changing the status is a route-semantics
    // decision this suite does not make.
    const snapshotBefore = JSON.stringify(rows('content_block'));
    const r = await post({ action: 'lock', blockId: BLOCK_B1, locked: true });
    expect(r.status).toBe(200);
    expect((r.body as { block: unknown }).block).toBeNull();
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, locked: false, text: 'B CONFIDENTIAL' });
    // A snapshot comparison, not a tautology. An earlier version asserted
    // `completedWrites(...).length` was `toBeGreaterThanOrEqual(0)`, which is
    // true of every array and could never fail, while sitting among real
    // evidence and reading as some.
    expect(JSON.stringify(rows('content_block'))).toBe(snapshotBefore);
    // The statement was company-scoped, which is why it matched nothing.
    const update = blockCalls('update')[0];
    expect(update.filters.company_id).toBe(CO_A);
    expect(update.filters.id).toBe(BLOCK_B1);
  });

  it('the lock path is COMPANY-scoped and NOT content-scoped — pinned, not endorsed', async () => {
    // CURRENT BEHAVIOUR, recorded so it cannot drift silently either way.
    //
    // `collaborationService.setBlockLocked` filters `.eq('id', blockId)
    // .eq('company_id', companyId)` and never `content_id`. So a writer in
    // company A, holding content A, can lock a block belonging to a DIFFERENT
    // document of the same company by naming it directly — here CONTENT_A in
    // the path and a block of CONTENT_A2 in the body.
    //
    // This is NOT cross-tenant: the company predicate holds throughout. It is
    // narrower than the route's own header claimed — that header said the route
    // is "tenant-isolated by loading the canonical content row with
    // getContent(id, companyId) before any block read / write", which is true
    // of the CONTENT and not of the BLOCK on this path. The header has been
    // corrected to say so. Whether the lock path SHOULD be content-scoped is an
    // owner decision; this test fails if the behaviour changes without one.
    const r = await post({ action: 'lock', blockId: BLOCK_A2_OTHER_CONTENT, locked: true }, CONTENT_A);
    expect(r.status).toBe(200);
    expect((r.body as { block: { id: string } | null }).block).toMatchObject({ id: BLOCK_A2_OTHER_CONTENT, locked: true });
    expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({ locked: true, content_id: CONTENT_A2 });
  });
});

describe('listBlocks — the route passes (contentId, companyId) in that order', () => {
  it('the read is scoped by both columns, each in its own place', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const lookup = blockCalls('select')[0];
    expect(lookup.filters.content_id).toBe(CONTENT_A);
    expect(lookup.filters.company_id).toBe(CO_A);
    expect(lookup.filters.content_id).not.toBe(CO_A);
    expect(lookup.filters.company_id).not.toBe(CONTENT_A);
  });

  it('it returns this content’s blocks and no other company’s', async () => {
    const r = await get();
    const returned = (r.body as { blocks: Array<{ id: string }> }).blocks.map((b) => b.id);
    expect(returned).toContain(BLOCK_A1);
    expect(returned).not.toContain(BLOCK_B1);
    expect(returned).not.toContain(BLOCK_A2_OTHER_CONTENT);
  });
});

describe('the route still refuses what it refused before', () => {
  it('content of another company → 404 before any block statement', async () => {
    const r = await invoke(blocksRoute, {
      method: 'POST', query: { id: CONTENT_B, companyId: CO_A }, body: { blocks: [] }, headers: as(WRITER),
    });
    expect(r.status).toBe(404);
    expect(blockCalls()).toHaveLength(0);
  });

  it('a body with no blocks array → 400, nothing written', async () => {
    const r = await post({});
    expect(r.status).toBe(400);
    expect(writeCalls(['content_block'])).toHaveLength(0);
  });

  it('an unsupported method → 405 with an Allow header', async () => {
    const r = await invoke(blocksRoute, {
      method: 'DELETE', query: { id: CONTENT_A, companyId: CO_A }, headers: as(WRITER),
    });
    expect(r.status).toBe(405);
    expect(r.headers.Allow ?? r.headers.allow).toBe('GET, POST');
    expect(writeCalls(['content_block'])).toHaveLength(0);
  });
});

describe('tenant PROVENANCE — the service gets the company the route AUTHORIZED', () => {
  // WHY THIS GROUP EXISTS. Everything above pins argument ORDER. A review showed
  // that is not the same as argument PROVENANCE, and the gap was exploitable:
  // `resolveCompanyId` (lib/content/contentApiHelpers.ts:19-30) accepts
  // `req.body.companyId` and `req.body.company_id` as well as the query, with the
  // QUERY winning. So a route can be mutated to let `enforceCompanyAccess`
  // authorize the query company while handing the SERVICE the body company —
  // and every test above passed, because each one used CO_A in the query and
  // never put a company in the body at all. Two such mutants produced a
  // cross-tenant lock (with the other tenant's text in the response) and a row
  // injected into another tenant's scope, with 16/16 and 377/377 green.
  //
  // Each test below therefore supplies a DIFFERENT company in the body from the
  // one in the query, and asserts the company that reached the statement.
  const postMixed = (body: Record<string, unknown>, id: string = CONTENT_A) =>
    invoke(blocksRoute, {
      method: 'POST',
      query: { id, companyId: CO_A },
      body: { ...body, companyId: CO_B },
      headers: as(WRITER),
    });

  it('a body-supplied company does NOT reach the upsert ownership lookup', async () => {
    const r = await postMixed({ blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] });
    expect(r.status).toBe(200);
    const lookup = blockCalls('select')[0];
    expect(lookup.filters.company_id).toBe(CO_A);
    expect(lookup.filters.company_id).not.toBe(CO_B);
  });

  it('an ID-LESS save stamps the AUTHORIZED company, not the body’s', async () => {
    // The decisive one: with no supplied id the ownership lookup is skipped
    // entirely, so nothing refuses the call and the row is stamped with whatever
    // the service was handed. Under the provenance mutant that was CO_B — a row
    // written straight into another tenant's scope.
    const r = await postMixed({ blocks: [{ blockType: 'hook', position: 0, text: 'provenance' }] });
    expect(r.status).toBe(200);
    const fresh = rows('content_block').filter((x) => String(x.text) === 'provenance');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].company_id).toBe(CO_A);
    expect(fresh[0].company_id).not.toBe(CO_B);
  });

  it('a body-supplied company does NOT reach the lock statement', async () => {
    const r = await postMixed({ action: 'lock', blockId: BLOCK_A1, locked: true });
    expect(r.status).toBe(200);
    const update = blockCalls('update')[0];
    expect(update.filters.company_id).toBe(CO_A);
    expect(update.filters.company_id).not.toBe(CO_B);
    expect(rows('content_block').find((x) => String(x.id) === BLOCK_A1)).toMatchObject({ locked: true });
  });

  it('a body-supplied company cannot reach ANOTHER tenant’s block through the lock path', async () => {
    // The shape the surviving mutant turned into a cross-tenant write AND a
    // disclosure: company B's block named in the body, B named as the company.
    const r = await postMixed({ action: 'lock', blockId: BLOCK_B1, locked: true });
    expect(r.status).toBe(200);
    expect((r.body as { block: unknown }).block).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain('B CONFIDENTIAL');
    expect(rows('content_block').find((x) => String(x.id) === BLOCK_B1))
      .toMatchObject({ company_id: CO_B, locked: false, text: 'B CONFIDENTIAL' });
    // NOTE WHAT IS AND IS NOT ASSERTED HERE. The statement DID run and returned
    // no error, so it is a COMPLETED write by the harness's definition even
    // though it matched zero rows — `completedWrites(...).toHaveLength(1)` is
    // never evidence that a row changed. What proves nothing was taken over is
    // the row state above plus the statement's own company predicate below.
    const scoped = blockCalls('update')[0];
    expect(scoped.filters.company_id).toBe(CO_A);
    expect(scoped.filters.id).toBe(BLOCK_B1);
  });

  it('snake_case `company_id` in the body is no different', async () => {
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: CONTENT_A, companyId: CO_A },
      body: { action: 'lock', blockId: BLOCK_A1, locked: true, company_id: CO_B },
      headers: as(WRITER),
    });
    expect(r.status).toBe(200);
    expect(blockCalls('update')[0].filters.company_id).toBe(CO_A);
  });

  it('a principal who is a member of BOTH companies is still scoped to the authorized one', async () => {
    // SPLIT holds VIEW_ONLY in A and COMPANY_ADMIN in B, so authorization
    // genuinely differs per company and a provenance slip cannot be dismissed as
    // "membership would have refused it anyway". Authorizing against B must not
    // let a statement reach A's data, and the write role is what decides.
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: CONTENT_A, companyId: CO_B },
      body: { action: 'lock', blockId: BLOCK_A1, locked: true },
      headers: as('SPLIT'),
    });
    // CONTENT_A belongs to CO_A, so proving the content against CO_B must fail.
    expect(r.status).toBe(404);
    expect(blockCalls()).toHaveLength(0);
    expect(rows('content_block').find((x) => String(x.id) === BLOCK_A1)).toMatchObject({ locked: false });
  });
});

describe('the content ownership proof runs BEFORE the lock branch', () => {
  // A mutant that simply MOVED the `action === 'lock'` branch above the
  // `getContent(id, scopedCompanyId)` call left the whole suite green, and then
  // locked a block while naming another company's content in the path. The
  // header's central guarantee was deletable with no test failing.
  it('a lock naming FOREIGN content is refused before any block statement', async () => {
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: CONTENT_B, companyId: CO_A },
      body: { action: 'lock', blockId: BLOCK_A1, locked: true },
      headers: as(WRITER),
    });
    expect(r.status).toBe(404);
    expect(blockCalls()).toHaveLength(0);
    expect(rows('content_block').find((x) => String(x.id) === BLOCK_A1)).toMatchObject({ locked: false });
  });

  it('a lock naming UNKNOWN content is refused before any block statement', async () => {
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', companyId: CO_A },
      body: { action: 'lock', blockId: BLOCK_A1, locked: true },
      headers: as(WRITER),
    });
    expect(r.status).toBe(404);
    expect(blockCalls()).toHaveLength(0);
  });

  it('a GET naming foreign content is refused before any block statement', async () => {
    const r = await invoke(blocksRoute, {
      method: 'GET', query: { id: CONTENT_B, companyId: CO_A }, headers: as(WRITER),
    });
    expect(r.status).toBe(404);
    expect(blockCalls()).toHaveLength(0);
  });
});

// ── H2: COMPANY provenance, every source resolveCompanyId consults ──────────
describe('COMPANY provenance — every source, with authorized and candidate diverging', () => {
  // WHY THE PREVIOUS GROUP WAS NOT ENOUGH. It generated divergence in exactly
  // one way: query `companyId` = A, body `companyId` = B. `resolveCompanyId`
  // reads FOUR sources, so a mutant taking the service company from
  // `query.company_id` — or from a header, which is not a source at all — was
  // invisible, and a review proved both produce a cross-tenant lock that
  // returns the other tenant's confidential text.
  //
  // THE PRECEDENCE, PROVEN FROM SOURCE, not chosen here.
  // lib/content/contentApiHelpers.ts:19-30 tries, in order:
  //     query.companyId → query.company_id → body.companyId → body.company_id
  // and takes the first candidate that is a non-empty STRING after trimming.
  // `x-company-id` is NOT among them: the only production reader of that header
  // is backend/lib/railwayComputeMiddleware.ts, which this route does not use.
  //
  // THE INVARIANT PINNED: the company handed to every service call is the one
  // `resolveCompanyId` returned — which is also the one `enforceCompanyAccess`
  // authorized. Asserting "the body is ignored" would be too weak; these assert
  // the positive identity.
  //
  // KNOWN AMBIGUITY, RECORDED NOT RESOLVED: the `typeof candidate === 'string'`
  // test skips an ARRAY, which Next.js produces for a repeated query parameter.
  // So `?companyId=X&companyId=X` falls through to the body. Authorization and
  // use stay the same value, so it is not exploitable — but it means "the query
  // always wins" is false, and changing it would be a policy change this phase
  // is not authorized to make. Pinned below as current behaviour.
  const req = (over: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    method?: string;
  }) =>
    invoke(blocksRoute, {
      method: over.method ?? 'POST',
      query: { id: CONTENT_A, ...(over.query ?? {}) },
      body: over.body,
      headers: { ...as(WRITER), ...(over.headers ?? {}) },
    });

  const LOCK_B = { action: 'lock', blockId: BLOCK_B1, locked: true };
  const FRESH = { blocks: [{ blockType: 'hook', position: 0, text: 'provenance-probe' }] };
  const EDIT_A1 = { blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] };

  /** Every company-divergent request shape, named by which source holds the rival. */
  const DIVERGENCES: Array<{ name: string; query: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> }> = [
    { name: 'body.companyId', query: { companyId: CO_A }, body: { companyId: CO_B } },
    { name: 'body.company_id', query: { companyId: CO_A }, body: { company_id: CO_B } },
    { name: 'query.company_id (lower precedence than query.companyId)', query: { companyId: CO_A, company_id: CO_B } },
    { name: 'x-company-id header (not a source at all)', query: { companyId: CO_A }, headers: { 'x-company-id': CO_B } },
  ];

  for (const d of DIVERGENCES) {
    it(`a foreign-tenant LOCK cannot borrow the company from ${d.name}`, async () => {
      const r = await req({ query: d.query, body: { ...LOCK_B, ...(d.body ?? {}) }, headers: d.headers });
      expect(r.status).toBe(200);
      expect((r.body as { block: unknown }).block).toBeNull();
      // nothing of company B's leaked, and nothing of B's changed
      expect(JSON.stringify(r.body)).not.toContain('B CONFIDENTIAL');
      expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, locked: false, text: 'B CONFIDENTIAL' });
      // and the statement carried the AUTHORIZED company
      const update = blockCalls('update')[0];
      expect(update.filters.company_id).toBe(CO_A);
      expect(update.filters.company_id).not.toBe(CO_B);
    });

    it(`an ID-LESS save stamps the authorized company, not ${d.name}`, async () => {
      const r = await req({ query: d.query, body: { ...FRESH, ...(d.body ?? {}) }, headers: d.headers });
      expect(r.status).toBe(200);
      const fresh = rows('content_block').filter((x) => String(x.text) === 'provenance-probe');
      expect(fresh).toHaveLength(1);
      expect(fresh[0].company_id).toBe(CO_A);
      expect(fresh[0].company_id).not.toBe(CO_B);
    });

    it(`an EXISTING-BLOCK update is scoped to the authorized company, not ${d.name}`, async () => {
      const r = await req({ query: d.query, body: { ...EDIT_A1, ...(d.body ?? {}) }, headers: d.headers });
      expect(r.status).toBe(200);
      const lookup = blockCalls('select')[0];
      expect(lookup.filters.company_id).toBe(CO_A);
      expect(lookup.filters.company_id).not.toBe(CO_B);
      expect(blockRow(BLOCK_A1)).toMatchObject({ company_id: CO_A, text: 'A edited' });
    });
  }

  it('a lower-precedence source is used when the higher one is ABSENT', async () => {
    // Proves the chain is actually consulted rather than hard-coded to
    // query.companyId: with no query company at all, body.companyId is what
    // authorizes, and it must then also be what the service receives.
    const r = await req({ query: {}, body: { ...EDIT_A1, companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(blockCalls('select')[0].filters.company_id).toBe(CO_A);
  });

  it('an ARRAY query company falls through to the body — current behaviour, pinned', async () => {
    // The recorded ambiguity. A repeated query parameter is a string[], which
    // `typeof === 'string'` skips, so the body decides. Authorization and use
    // remain the SAME value, so this is not a privilege path — it is pinned so
    // the precedence comment above cannot drift from the code.
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: CONTENT_A, companyId: [CO_A, CO_A] as unknown as string },
      body: { ...EDIT_A1, companyId: CO_A },
      headers: as(WRITER),
    });
    expect(r.status).toBe(200);
    expect(blockCalls('select')[0].filters.company_id).toBe(CO_A);
  });

  it('CONTROL: a clean same-company request still works', async () => {
    const r = await req({ query: { companyId: CO_A }, body: EDIT_A1 });
    expect(r.status).toBe(200);
    expect(blockRow(BLOCK_A1)).toMatchObject({ text: 'A edited', company_id: CO_A });
  });
});

// ── H3: CONTENT provenance, a separate dimension from company ───────────────
describe('CONTENT provenance — the service gets the content the route AUTHORIZED', () => {
  // WHY THIS IS SEPARATE. Every assertion in the company group reads
  // `company_id`. A review showed a mutant reading the content id from
  // `body.contentId` survived all of them and OVERWROTE ANOTHER DOCUMENT'S
  // BLOCK — same company, different document — because `upsertBlocks`' own
  // pre-validation then endorsed the substituted content. Passing the company
  // dimension proves nothing about the content dimension.
  //
  // PROVEN FROM SOURCE: the route takes the content id from
  // `firstQueryValue(req.query.id)` (blocks.ts:110) and nothing else. `contentId`
  // and `content_id` are not sources anywhere in this route — the only
  // occurrences of the word are in its docblock. So every case below supplies a
  // rival through a source the route must ignore entirely.
  const reqC = (over: { query?: Record<string, unknown>; body?: Record<string, unknown>; method?: string }) =>
    invoke(blocksRoute, {
      method: over.method ?? 'POST',
      query: { id: CONTENT_A, companyId: CO_A, ...(over.query ?? {}) },
      body: over.body,
      headers: as(WRITER),
    });

  const RIVALS: Array<{ name: string; query?: Record<string, unknown>; body?: Record<string, unknown> }> = [
    { name: 'body.contentId', body: { contentId: CONTENT_A2 } },
    { name: 'body.content_id', body: { content_id: CONTENT_A2 } },
    { name: 'query.contentId', query: { contentId: CONTENT_A2 } },
    { name: 'query.content_id', query: { content_id: CONTENT_A2 } },
  ];

  for (const r0 of RIVALS) {
    it(`the ownership lookup uses the PATH content, not ${r0.name}`, async () => {
      const r = await reqC({
        query: r0.query,
        body: { ...(r0.body ?? {}), blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] },
      });
      expect(r.status).toBe(200);
      const lookup = blockCalls('select')[0];
      expect(lookup.filters.content_id).toBe(CONTENT_A);
      expect(lookup.filters.content_id).not.toBe(CONTENT_A2);
    });

    it(`another document's block cannot be overwritten via ${r0.name}`, async () => {
      // BLOCK_A2_OTHER_CONTENT belongs to CONTENT_A2 — same company, different
      // document. Authorized for CONTENT_A, this must be refused.
      const r = await reqC({
        query: r0.query,
        body: {
          ...(r0.body ?? {}),
          blocks: [{ id: BLOCK_A2_OTHER_CONTENT, blockType: 'body', position: 0, text: 'HIJACKED' }],
        },
      });
      expect(r.status).toBe(404);
      expect(writeCalls(['content_block'])).toHaveLength(0);
      expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({
        content_id: CONTENT_A2,
        text: 'A other content',
      });
    });

    it(`an ID-LESS block is stamped with the PATH content, not ${r0.name}`, async () => {
      const r = await reqC({
        query: r0.query,
        body: { ...(r0.body ?? {}), blocks: [{ blockType: 'hook', position: 0, text: 'content-probe' }] },
      });
      expect(r.status).toBe(200);
      const fresh = rows('content_block').filter((x) => String(x.text) === 'content-probe');
      expect(fresh).toHaveLength(1);
      expect(fresh[0].content_id).toBe(CONTENT_A);
      expect(fresh[0].content_id).not.toBe(CONTENT_A2);
    });

    it(`a GET cannot return another document's blocks via ${r0.name}`, async () => {
      const r = await reqC({ method: 'GET', query: r0.query, body: r0.body });
      expect(r.status).toBe(200);
      const returned = (r.body as { blocks: Array<{ id: string; text: string }> }).blocks;
      expect(returned.map((b) => b.id)).toContain(BLOCK_A1);
      expect(returned.map((b) => b.id)).not.toContain(BLOCK_A2_OTHER_CONTENT);
      expect(JSON.stringify(r.body)).not.toContain('A other content');
      expect(blockCalls('select')[0].filters.content_id).toBe(CONTENT_A);
    });
  }

  it('an ID-LESS block cannot be inserted under a FOREIGN TENANT’s content', async () => {
    const r = await reqC({
      body: { contentId: CONTENT_B, content_id: CONTENT_B, blocks: [{ blockType: 'hook', position: 0, text: 'foreign-probe' }] },
    });
    expect(r.status).toBe(200);
    const fresh = rows('content_block').filter((x) => String(x.text) === 'foreign-probe');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].content_id).toBe(CONTENT_A);
    expect(fresh[0].company_id).toBe(CO_A);
    expect(fresh[0].content_id).not.toBe(CONTENT_B);
  });

  it('a REPEATED ?id= resolves to the FIRST element — current behaviour, pinned', async () => {
    // THE ASYMMETRY THIS PINS. The two helpers that read caller input disagree
    // about arrays, and only one side was pinned:
    //   resolveCompanyId   (contentApiHelpers.ts:19-30) SKIPS a non-string, so a
    //                      repeated ?companyId= falls through to the body. That
    //                      is pinned by the array case in the COMPANY group.
    //   firstQueryValue    (contentApiHelpers.ts:33-36) returns value[0], so a
    //                      repeated ?id= resolves to the FIRST element.
    // Next.js delivers `string | string[]` for any repeated query parameter, so
    // both paths are reachable from an ordinary request. Leaving the content
    // side unpinned meant the dimension this group exists to cover separately
    // had an unexercised input shape.
    //
    // NOT A PRIVILEGE PATH, and the assertions say why: the ONE resolved value
    // is what getContent() proves ownership of AND what every service call
    // receives, so there is no split between what is authorized and what is
    // used. The second element is simply discarded. Whether a repeated ?id=
    // should instead be REJECTED is a policy question this test does not decide.
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: [CONTENT_A, CONTENT_A2] as unknown as string, companyId: CO_A },
      body: { blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] },
      headers: as(WRITER),
    });
    expect(r.status).toBe(200);
    // element [0] won: the lookup, the stored row and the untouched sibling all agree
    expect(blockCalls('select')[0].filters.content_id).toBe(CONTENT_A);
    expect(blockCalls('select')[0].filters.content_id).not.toBe(CONTENT_A2);
    expect(blockRow(BLOCK_A1)).toMatchObject({ content_id: CONTENT_A, text: 'A edited' });
    expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({ content_id: CONTENT_A2, text: 'A other content' });
  });

  it('the repeated ?id= is POSITIONAL, not a set — reversing it changes which document is used', async () => {
    // Proves [0] is genuinely what decides, rather than the test above passing
    // because both elements happen to be reachable by this caller. With the
    // order reversed the route authorizes and operates on CONTENT_A2, so
    // BLOCK_A1 — a block of CONTENT_A — is no longer owned by the resolved
    // document and the write is refused 404 by upsertBlocks' own pre-validation.
    const r = await invoke(blocksRoute, {
      method: 'POST',
      query: { id: [CONTENT_A2, CONTENT_A] as unknown as string, companyId: CO_A },
      body: { blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'should not land' }] },
      headers: as(WRITER),
    });
    expect(r.status).toBe(404);
    expect(blockCalls('select')[0].filters.content_id).toBe(CONTENT_A2);
    expect(writeCalls(['content_block'])).toHaveLength(0);
    expect(blockRow(BLOCK_A1)).toMatchObject({ content_id: CONTENT_A, text: 'A original' });
  });

  it('CONTROL: the same document, same company, still reads and writes', async () => {
    const w = await reqC({ body: { blocks: [{ id: BLOCK_A1, blockType: 'body', position: 0, text: 'A edited' }] } });
    expect(w.status).toBe(200);
    expect(blockRow(BLOCK_A1)).toMatchObject({ text: 'A edited', content_id: CONTENT_A });
    const g = await reqC({ method: 'GET' });
    expect(g.status).toBe(200);
    expect((g.body as { blocks: Array<{ id: string }> }).blocks.map((b) => b.id)).toContain(BLOCK_A1);
  });
});
