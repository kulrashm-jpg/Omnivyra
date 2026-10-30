/**
 * PI WS-4B — the owned-identity control plane, INVOKED.
 *
 * A source-shape check cannot see what a handler DOES with a request, and every
 * property that matters on this surface is behavioural: that a method neither
 * route serves executes nothing, that a malformed tenant is refused BEFORE a
 * guard is consulted, that the capability is bound to the VERIFIED tenant on
 * EVERY method including the reads, that an ordinary member reaches no service,
 * that a client-supplied identity pair can never become the attestation target,
 * that an author in another tenant is neither listed nor attestable and is
 * reported exactly as an absent one, and that an unreadable store is never an
 * empty 200. So this suite calls the handlers.
 *
 * Nothing here reaches a database. `writeOwner` is replaced by a RECORDING
 * in-memory query builder, so the candidate service's REAL filters run and the
 * suite can assert on them — in particular that `engagement_authors` is only
 * ever read by `id`, which is what makes a deployment-wide author scan
 * test-visible rather than a promise in a header comment.
 *
 * `TenantGuard` and `requireCapability` internals are NOT re-tested here; this
 * suite asserts only that the routes consult them in the right order, with the
 * right arguments, and stop when they say stop.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

// The wrapper passes through, so the default export IS the handler — the pattern
// `piWs3dProblemObservationRoute.test.ts` already uses for this repository.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const requireTenantAccess = jest.fn();
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));

const requireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

jest.mock('../../services/logger', () => ({
  logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
}));

/**
 * The recording stub database. Assigned in `beforeEach`; the factory below only
 * closes over the binding, so there is no temporal-dead-zone problem.
 */
let db: StubDb;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => db.table(table),
  ownedDbRpc: () => { throw new Error('WS-4B reads only — no rpc'); },
}));

import fs from 'fs';
import path from 'path';
import candidatesHandler from '../../../pages/api/prospect-identity/owned-identity-candidates';
import identitiesHandler, {
  __setOwnedIdentityRegistryPorts,
} from '../../../pages/api/prospect-identity/owned-identities';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { PROSPECT_API_VERSION } from '../../apiHandlers/prospects/prospectIntelligenceRead';
import {
  OWNED_IDENTITY_API_CONTRACT_VERSION,
  OWNED_IDENTITY_CANDIDATES_PERFORMS_NO_WRITE,
  OWNED_IDENTITY_CANDIDATES_LIMIT_DEFAULT,
  OWNED_IDENTITY_CANDIDATES_LIMIT_MAX,
  classifyOwnedIdentityCandidate,
  resolveOwnedIdentityCandidatesLimit,
} from '../../services/engagementIdentity/ownedIdentityCandidates';
// The relation is named through the contract, never as a literal here: a
// repo-wide scan in `piWs4aAttestedIdentityRegistry.test.ts` flags any file
// outside `backend/services/engagementIdentity` that opens it by its string.
import { ATTESTED_ENGAGEMENT_IDENTITY_RELATION } from '../../services/engagementIdentity/attestedIdentityContract';
// The repository's own read bound, so the port-contract section at the end of
// this file pins the number the repository chose rather than restating it.
import { ATTESTED_IDENTITY_READ_LIMIT_DEFAULT } from '../../services/engagementIdentity/attestedIdentityRepository';

const REPO_ROOT = path.resolve(__dirname, '../../..');

// ═══════════════════════════════════════════════════════════════════════════
// The recording stub database.
// ═══════════════════════════════════════════════════════════════════════════

interface ReadRecord {
  table: string;
  select: string | null;
  filters: Array<{ op: 'eq' | 'in'; col: string; val?: unknown; vals?: unknown[] }>;
  order: { col: string; opts: unknown } | null;
  limit: number | null;
}

type Row = Record<string, unknown>;

class StubDb {
  readonly reads: ReadRecord[] = [];

  /** Tables made unreadable, so "we could not look" can be exercised. */
  readonly broken = new Set<string>();

  constructor(private readonly data: Record<string, Row[]>) {}

  table(table: string): unknown {
    const rec: ReadRecord = { table, select: null, filters: [], order: null, limit: null };
    this.reads.push(rec);
    const run = () => this.run(rec);
    const builder: Record<string, unknown> = {
      select(cols: string) { rec.select = cols; return builder; },
      eq(col: string, val: unknown) { rec.filters.push({ op: 'eq', col, val }); return builder; },
      /**
       * `IS NULL`, recorded as the equality it is in this stub. The rows seeded
       * here carry explicit nulls, so `is(c, null)` and `eq(c, null)` select
       * the same ones; recording it under the existing `eq` op leaves
       * `ReadRecord` unchanged and therefore cannot disturb any assertion over
       * `reads`. Added for the port-contract section at the end of this file —
       * the REAL repository's active-list read uses `.is('revoked_at', null)`.
       */
      is(col: string, val: unknown) { rec.filters.push({ op: 'eq', col, val }); return builder; },
      in(col: string, vals: unknown[]) { rec.filters.push({ op: 'in', col, vals: [...vals] }); return builder; },
      order(col: string, opts: unknown) { rec.order = { col, opts }; return builder; },
      limit(n: number) { rec.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  readsOf(table: string): ReadRecord[] {
    return this.reads.filter((r) => r.table === table);
  }

  private run(rec: ReadRecord): { data: Row[] | null; error: { message: string } | null } {
    if (this.broken.has(rec.table)) {
      return { data: null, error: { message: `${rec.table} is unreadable in this test` } };
    }
    let rows = (this.data[rec.table] ?? []).slice();
    for (const f of rec.filters) {
      rows = f.op === 'eq'
        ? rows.filter((r) => r[f.col] === f.val)
        : rows.filter((r) => (f.vals ?? []).includes(r[f.col]));
    }
    if (rec.order) {
      // Newest first, rows with no source instant last — what the real query
      // asks for with `{ ascending: false, nullsFirst: false }`.
      rows.sort((a, b) => {
        const at = typeof a[rec.order!.col] === 'string' ? Date.parse(a[rec.order!.col] as string) : -1;
        const bt = typeof b[rec.order!.col] === 'string' ? Date.parse(b[rec.order!.col] as string) : -1;
        return bt - at;
      });
    }
    if (typeof rec.limit === 'number') rows = rows.slice(0, rec.limit);
    return { data: rows, error: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures.
// ═══════════════════════════════════════════════════════════════════════════

const ORG_A = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ORG_B = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const USER_A = 'f2f0b1c4-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const THREAD_A = '11111111-1111-4111-8111-111111111111';
const THREAD_B = '22222222-2222-4222-8222-222222222222';

const AUTHOR_OK = 'aaaaaaaa-0001-4000-8000-000000000001';
const AUTHOR_ANON = 'aaaaaaaa-0002-4000-8000-000000000002';
const AUTHOR_EXT = 'aaaaaaaa-0003-4000-8000-000000000003';
const AUTHOR_BARE = 'aaaaaaaa-0004-4000-8000-000000000004';
const AUTHOR_ALIASED = 'aaaaaaaa-0005-4000-8000-000000000005';
/** Observed ONLY through `ORG_B`'s thread. Must never be listed or attestable. */
const AUTHOR_OTHER_TENANT = 'bbbbbbbb-0001-4000-8000-000000000001';
const AUTHOR_ABSENT = 'cccccccc-0001-4000-8000-000000000001';

const ENTRY_ID = 'dddddddd-0001-4000-8000-000000000001';

/** The identity `engagement_authors` holds for the attestable author. Case matters. */
const OK_IDENTITY = 'https://www.linkedin.com/in/Dana-Okonkwo-7A1/';

/**
 * The author rows carry `display_name`, `username`, `profile_url` and
 * `avatar_url` ON PURPOSE. They are real columns on the real table, and the
 * point of the projection assertions is that a candidate carries none of them
 * even when the row does.
 */
const AUTHOR_ROWS: Row[] = [
  {
    id: AUTHOR_OK,
    platform: 'linkedin',
    platform_user_id: OK_IDENTITY,
    display_name: 'Dana Okonkwo',
    username: 'dana-okonkwo-7a1',
    profile_url: OK_IDENTITY,
    avatar_url: 'https://media.example/dana.jpg',
  },
  { id: AUTHOR_ANON, platform: 'linkedin', platform_user_id: 'anon_urn:li:comment:9912' },
  { id: AUTHOR_EXT, platform: 'linkedin', platform_user_id: 'extension_author_urn:li:msg:771' },
  { id: AUTHOR_BARE, platform: 'linkedin', platform_user_id: 'dana-okonkwo-7a1' },
  { id: AUTHOR_ALIASED, platform: 'x', platform_user_id: 'https://x.com/dana_okonkwo' },
  {
    id: AUTHOR_OTHER_TENANT,
    platform: 'linkedin',
    platform_user_id: 'https://www.linkedin.com/in/other-tenant-person/',
    display_name: 'Someone Else',
  },
];

const THREAD_ROWS: Row[] = [
  { id: THREAD_A, platform: 'linkedin', organization_id: ORG_A },
  { id: THREAD_B, platform: 'linkedin', organization_id: ORG_B },
];

const MESSAGE_ROWS: Row[] = [
  {
    id: 'm-1', thread_id: THREAD_A, author_id: AUTHOR_OK,
    platform_created_at: '2026-09-10T09:00:00.000Z',
    content: 'our three dashboards disagree', raw_payload: { sender_name: 'Dana Okonkwo' },
  },
  {
    id: 'm-2', thread_id: THREAD_A, author_id: AUTHOR_OK,
    platform_created_at: '2026-09-12T09:00:00.000Z',
    content: 'and nobody can say which to take to the board', raw_payload: { sender_username: 'dana' },
  },
  { id: 'm-3', thread_id: THREAD_A, author_id: AUTHOR_ANON, platform_created_at: '2026-09-11T09:00:00.000Z' },
  { id: 'm-4', thread_id: THREAD_A, author_id: AUTHOR_EXT, platform_created_at: '2026-09-09T09:00:00.000Z' },
  { id: 'm-5', thread_id: THREAD_A, author_id: AUTHOR_BARE, platform_created_at: '2026-09-08T09:00:00.000Z' },
  { id: 'm-6', thread_id: THREAD_A, author_id: AUTHOR_ALIASED, platform_created_at: '2026-09-07T09:00:00.000Z' },
  // ORG_B's thread. The author below is observed ONLY here.
  { id: 'm-7', thread_id: THREAD_B, author_id: AUTHOR_OTHER_TENANT, platform_created_at: '2026-09-13T09:00:00.000Z' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Harness.
// ═══════════════════════════════════════════════════════════════════════════

function makeRes() {
  const res: Record<string, unknown> = { _status: 0, _json: null, _headers: {} };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.setHeader = (k: string, v: unknown) => { (res._headers as Record<string, unknown>)[k] = v; };
  res.end = () => res;
  return res as never;
}

type Answer = { _status: number; _json: Record<string, unknown>; _headers: Record<string, unknown> };

const invoke = async (
  handler: unknown, over: Record<string, unknown>,
): Promise<Answer> => {
  const req = { method: 'GET', query: { companyId: ORG_A }, body: undefined, ...over } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res as unknown as Answer;
};

const candidates = (over: Record<string, unknown> = {}) => invoke(candidatesHandler, over);
const registry = (over: Record<string, unknown> = {}) => invoke(identitiesHandler, over);

const ATTEST_BODY = {
  candidateAuthorId: AUTHOR_OK,
  statement: 'this is our founder’s own LinkedIn account, used for outbound',
  confirmed: true,
};

const attest = (body: Record<string, unknown> = {}) => registry({
  method: 'POST', query: { companyId: ORG_A }, body: { ...ATTEST_BODY, ...body },
});

const revoke = (query: Record<string, unknown> = {}) => registry({
  method: 'DELETE',
  query: { companyId: ORG_A, id: ENTRY_ID, reason: 'the account was closed', ...query },
});

const attestIdentity = jest.fn();
const revokeIdentity = jest.fn();
const listActiveAttestedIdentities = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  db = new StubDb({
    engagement_threads: THREAD_ROWS,
    engagement_messages: MESSAGE_ROWS,
    engagement_authors: AUTHOR_ROWS,
  });
  requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: USER_A });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
  attestIdentity.mockResolvedValue({ ok: true, id: ENTRY_ID, alreadyActive: false });
  revokeIdentity.mockResolvedValue({ ok: true, revoked: true });
  listActiveAttestedIdentities.mockResolvedValue([{
    id: ENTRY_ID,
    organizationId: ORG_A,
    platform: 'linkedin',
    platformUserId: OK_IDENTITY,
    attestedAs: 'tenant_own',
    statement: 'our founder’s account',
    attestedByUserId: USER_A,
    attestedAt: '2026-10-01T10:00:00.000Z',
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
  }]);
  __setOwnedIdentityRegistryPorts({
    attestIdentity: (...a: unknown[]) => attestIdentity(...a),
    revokeIdentity: (...a: unknown[]) => revokeIdentity(...a),
    listActiveAttestedIdentities: (...a: unknown[]) => listActiveAttestedIdentities(...a),
  } as never);
});

afterAll(() => { __setOwnedIdentityRegistryPorts(null); });

const noRegistryCall = () => {
  expect(attestIdentity).not.toHaveBeenCalled();
  expect(revokeIdentity).not.toHaveBeenCalled();
  expect(listActiveAttestedIdentities).not.toHaveBeenCalled();
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · METHODS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · a method a route does not serve executes NOTHING', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'candidates: %s is 405 with Allow: GET and runs no guard and no read', async (method) => {
      const res = await candidates({ method });

      expect(res._status).toBe(405);
      expect(res._headers.Allow).toBe('GET');
      expect(res._json.error).toBe('method_not_allowed');
      expect(requireTenantAccess).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
      expect(db.reads).toHaveLength(0);
    },
  );

  it.each(['PUT', 'PATCH', 'HEAD', 'OPTIONS'])(
    'registry: %s is 405 with Allow: GET, POST, DELETE and runs nothing', async (method) => {
      const res = await registry({ method });

      expect(res._status).toBe(405);
      expect(res._headers.Allow).toBe('GET, POST, DELETE');
      expect(res._json.error).toBe('method_not_allowed');
      expect(requireTenantAccess).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
      noRegistryCall();
      expect(db.reads).toHaveLength(0);
    },
  );

  it('every envelope leads with the API version and this surface’s own contract', async () => {
    const res = await candidates();
    expect(res._json.version).toBe(PROSPECT_API_VERSION);
    expect(res._json.contract).toBe(OWNED_IDENTITY_API_CONTRACT_VERSION);
    // Not the problem-observation contract: a client that pinned that string
    // would believe it had pinned a different surface's rules.
    expect(OWNED_IDENTITY_API_CONTRACT_VERSION).not.toBe('pi-problem-obs.1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE TENANT IS NAMED IN THE QUERY, VALIDATED FIRST
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · companyId is checked BEFORE any guard is consulted', () => {
  const handlers: Array<[string, (o?: Record<string, unknown>) => Promise<Answer>, Record<string, unknown>]> = [
    ['candidates GET', candidates, { method: 'GET' }],
    ['registry GET', registry, { method: 'GET' }],
    ['registry POST', registry, { method: 'POST', body: { ...ATTEST_BODY } }],
    ['registry DELETE', registry, { method: 'DELETE' }],
  ];

  it.each(handlers)('%s · an absent companyId is 400 and no guard runs', async (_n, call, base) => {
    const res = await call({ ...base, query: {} });

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('companyId is required');
    expect(requireTenantAccess).not.toHaveBeenCalled();
    expect(requireCapability).not.toHaveBeenCalled();
    noRegistryCall();
    expect(db.reads).toHaveLength(0);
  });

  it.each(handlers)('%s · a malformed companyId is 400 BEFORE requireTenantAccess', async (_n, call, base) => {
    for (const companyId of ['not-a-uuid', '12345', `${ORG_A}x`, '']) {
      jest.clearAllMocks();
      requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: USER_A });
      requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });

      const res = await call({ ...base, query: { companyId } });

      expect(res._status).toBe(400);
      expect(requireTenantAccess).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
      noRegistryCall();
    }
  });

  it('the query is the only place the tenant comes from — a body companyId is refused', async () => {
    const res = await registry({
      method: 'POST',
      query: { companyId: ORG_A },
      body: { ...ATTEST_BODY, companyId: ORG_B, organizationId: ORG_B },
    });

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('server_owned_field');
    expect(res._json.fields).toEqual(expect.arrayContaining(['companyId', 'organizationId']));
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it('a guard that wrote its own 401/403 is not answered over', async () => {
    requireTenantAccess.mockResolvedValue(null);

    const res = await candidates();

    expect(res._status).toBe(0);
    expect(res._json).toBeNull();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(db.reads).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · THE CAPABILITY, ON EVERY METHOD, BOUND TO THE VERIFIED TENANT
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · PROSPECT_INGEST is required on every method, reads included', () => {
  it.each([
    ['candidates GET', () => candidates()],
    ['registry GET', () => registry({ method: 'GET' })],
    ['registry POST', () => attest()],
    ['registry DELETE', () => revoke()],
  ])('%s requires PROSPECT_INGEST bound to the VERIFIED tenant', async (_n, call) => {
    await call();

    expect(requireCapability).toHaveBeenCalledTimes(1);
    const options = requireCapability.mock.calls[0][2] as Record<string, unknown>;
    expect(options.capability).toBe(PROSPECT_INGEST);
    expect(options.organizationId).toBe(ORG_A);
    expect(typeof options.reason).toBe('string');
  });

  it('the capability is bound to the GUARD’S tenant, never to a repeated query value', async () => {
    // A repeated parameter: `str` takes the first, and the guard verified it.
    await candidates({ query: { companyId: [ORG_A, ORG_B] } });

    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_A);
    const options = requireCapability.mock.calls[0][2] as Record<string, unknown>;
    expect(options.organizationId).toBe(ORG_A);
  });

  it('membership is asked BEFORE the capability, on all three registry methods', async () => {
    for (const call of [() => registry({ method: 'GET' }), () => attest(), () => revoke()]) {
      const order: string[] = [];
      jest.clearAllMocks();
      requireTenantAccess.mockImplementation(async () => {
        order.push('membership'); return { organizationId: ORG_A, userId: USER_A };
      });
      requireCapability.mockImplementation(async () => {
        order.push('capability'); return { ok: true, principal: { userId: USER_A } };
      });
      attestIdentity.mockResolvedValue({ ok: true, id: ENTRY_ID, alreadyActive: false });
      revokeIdentity.mockResolvedValue({ ok: true, revoked: true });
      listActiveAttestedIdentities.mockResolvedValue([]);

      await call();

      expect(order).toEqual(['membership', 'capability']);
    }
  });

  it.each([
    ['candidates GET', () => candidates()],
    ['registry GET', () => registry({ method: 'GET' })],
    ['registry POST', () => attest()],
    ['registry DELETE', () => revoke()],
  ])('%s · an ordinary member (guard.ok !== true) reaches NO service', async (_n, call) => {
    // `requireCapability` wrote its own 403 and audited the denial.
    requireCapability.mockResolvedValue({ ok: false, sent: true });

    const res = await call();

    expect(res._status).toBe(0);
    expect(res._json).toBeNull();
    noRegistryCall();
    expect(db.reads).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE CANDIDATE READ — TENANT-PROVEN, BOUNDED, AND NARROW
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B candidates · the listing is tenant-proven and bounded', () => {
  it('lists only the attestable identity, and explains the short list in counts', async () => {
    const res = await candidates();

    expect(res._status).toBe(200);
    const list = res._json.candidates as Array<Record<string, unknown>>;
    expect(list.map((c) => c.authorId)).toEqual([AUTHOR_OK]);
    expect(list[0].platform).toBe('linkedin');
    // VERBATIM, case preserved — a profile URL path is case-significant.
    expect(list[0].platformUserId).toBe(OK_IDENTITY);
    expect(list[0].messageCount).toBe(2);
    expect(list[0].threadCount).toBe(1);
    expect(list[0].firstObservedAt).toBe('2026-09-10T09:00:00.000Z');
    expect(list[0].lastObservedAt).toBe('2026-09-12T09:00:00.000Z');

    expect(res._json.excluded).toEqual({
      examined: 5,
      identityBlank: 0,
      anonymousFallback: 1,
      extensionFallback: 1,
      identityNotAProfileUrl: 1,
      platformNotAttestable: 1,
    });
  });

  it('the excluded report carries COUNTS only — no ids, no identity strings, no text', async () => {
    const res = await candidates();

    const serialized = JSON.stringify(res._json.excluded);
    for (const leak of [AUTHOR_ANON, AUTHOR_EXT, AUTHOR_BARE, 'anon_', 'extension_author_', 'dana']) {
      expect(serialized).not.toContain(leak);
    }
    for (const v of Object.values(res._json.excluded as Record<string, unknown>)) {
      expect(typeof v).toBe('number');
    }
  });

  it('the candidate projection carries NONE of the third-party columns or the content', async () => {
    const res = await candidates();

    const list = res._json.candidates as Array<Record<string, unknown>>;
    expect(Object.keys(list[0]).sort()).toEqual([
      'authorId', 'firstObservedAt', 'lastObservedAt',
      'messageCount', 'platform', 'platformUserId', 'threadCount',
    ]);
    const serialized = JSON.stringify(res._json);
    for (const forbidden of [
      'raw_payload', 'display_name', 'username', 'profile_url', 'avatar_url',
      'Dana Okonkwo', 'media.example', 'dashboards disagree', 'take to the board',
      'sender_name', 'sender_username',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('an author observed ONLY in another tenant is not listed', async () => {
    const res = await candidates();

    const serialized = JSON.stringify(res._json);
    expect(serialized).not.toContain(AUTHOR_OTHER_TENANT);
    expect(serialized).not.toContain('other-tenant-person');
    expect(serialized).not.toContain('Someone Else');
  });

  it('threads are read under a mandatory tenant filter, and messages ONLY by those thread ids', async () => {
    await candidates();

    const threads = db.readsOf('engagement_threads');
    expect(threads).toHaveLength(1);
    expect(threads[0].filters).toEqual([{ op: 'eq', col: 'organization_id', val: ORG_A }]);

    const messages = db.readsOf('engagement_messages');
    expect(messages).toHaveLength(1);
    expect(messages[0].filters).toEqual([{ op: 'in', col: 'thread_id', vals: [THREAD_A] }]);
    // `engagement_messages.organization_id` exists only after 20261221000000,
    // whose applied state is unverified — so it is neither selected nor filtered.
    expect(messages[0].select).not.toContain('organization_id');
    expect(messages[0].filters.some((f) => f.col === 'organization_id')).toBe(false);
    // Nor is anything that would put a third party's words in reach.
    expect(messages[0].select).not.toContain('content');
    expect(messages[0].select).not.toContain('raw_payload');
  });

  it('there is NO deployment-wide author scan: engagement_authors is read by `id` ONLY', async () => {
    await candidates();
    await attest();

    const authorReads = db.readsOf('engagement_authors');
    expect(authorReads.length).toBeGreaterThan(0);
    for (const read of authorReads) {
      expect(read.filters).toHaveLength(1);
      expect(read.filters[0].op).toBe('in');
      expect(read.filters[0].col).toBe('id');
      // The one query that must never exist: "who else in the deployment holds
      // this identity?" is not a question a tenant may ask.
      expect(read.filters.some((f) => f.col === 'platform_user_id')).toBe(false);
      // Identity columns only.
      expect(read.select).toBe('id, platform, platform_user_id');
    }
  });

  it('the read is bounded by default and `limit` only ever NARROWS', async () => {
    await candidates();
    expect(db.readsOf('engagement_messages')[0].limit).toBe(OWNED_IDENTITY_CANDIDATES_LIMIT_DEFAULT);

    db = new StubDb({
      engagement_threads: THREAD_ROWS, engagement_messages: MESSAGE_ROWS, engagement_authors: AUTHOR_ROWS,
    });
    await candidates({ query: { companyId: ORG_A, limit: '5000' } });
    expect(db.readsOf('engagement_messages')[0].limit).toBe(OWNED_IDENTITY_CANDIDATES_LIMIT_MAX);

    expect(resolveOwnedIdentityCandidatesLimit(10)).toBe(10);
    expect(resolveOwnedIdentityCandidatesLimit(undefined)).toBe(OWNED_IDENTITY_CANDIDATES_LIMIT_DEFAULT);
    expect(resolveOwnedIdentityCandidatesLimit(1e9)).toBe(OWNED_IDENTITY_CANDIDATES_LIMIT_MAX);
  });

  it.each([['0'], ['-5'], ['many']])('an unusable limit=%s is 400 and reads nothing', async (limit) => {
    const res = await candidates({ query: { companyId: ORG_A, limit } });

    expect(res._status).toBe(400);
    expect(db.reads).toHaveLength(0);
  });

  it('an unreadable store is 503 and NEVER an empty 200', async () => {
    db.broken.add('engagement_threads');
    const res = await candidates();

    expect(res._status).toBe(503);
    expect(res._json.error).toBe('owned_identity_candidates_unavailable');
    expect(res._json.retryable).toBe(true);
    expect(res._json).not.toHaveProperty('candidates');
  });

  it('an unreadable AUTHOR table is 503 too, not a list with the authors silently missing', async () => {
    db.broken.add('engagement_authors');
    const res = await candidates();

    expect(res._status).toBe(503);
    expect(res._json).not.toHaveProperty('candidates');
  });

  it('a tenant with no threads gets an explained empty 200, not a 503', async () => {
    requireTenantAccess.mockResolvedValue({ organizationId: ORG_B, userId: USER_A });
    db = new StubDb({ engagement_threads: [], engagement_messages: [], engagement_authors: [] });

    const res = await candidates();

    expect(res._status).toBe(200);
    expect(res._json.candidates).toEqual([]);
    expect(typeof res._json.reason).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · THE ATTESTATION — THE SERVER CHOOSES THE IDENTITY
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B attest · every server-owned field is a NAMED 400, never ignored', () => {
  it.each([
    'platform', 'platformUserId', 'platform_user_id',
    'organizationId', 'organization_id', 'companyId', 'company_id',
    'attestedByUserId', 'attested_by_user_id',
    'attestedAt', 'attested_at', 'id',
  ])('%s in the body is refused by name', async (field) => {
    const res = await attest({ [field]: 'anything-at-all' });

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('server_owned_field');
    expect(res._json.fields).toContain(field);
    // Refused BEFORE the candidate is resolved and before anything is written.
    expect(db.reads).toHaveLength(0);
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it('all of them are named at once, so a caller fixes one request', async () => {
    const res = await attest({ platform: 'twitter', platformUserId: 'https://x.com/someone', id: ENTRY_ID });

    expect(res._status).toBe(400);
    expect(res._json.fields).toEqual(expect.arrayContaining(['platform', 'platformUserId', 'id']));
  });

  it('a client-supplied platform/identity pair NEVER becomes the attestation target', async () => {
    // Refused outright above. And when only the candidate is named, the pair the
    // repository receives is the one read OFF THE STORED ROW.
    const res = await attest();

    expect(res._status).toBe(201);
    expect(attestIdentity).toHaveBeenCalledTimes(1);
    expect(attestIdentity.mock.calls[0][0]).toEqual({
      organizationId: ORG_A,                 // the VERIFIED tenant
      platform: 'linkedin',                  // off the stored row
      platformUserId: OK_IDENTITY,           // off the stored row, verbatim
      statement: ATTEST_BODY.statement,
      attestedByUserId: USER_A,              // the AUTHORIZED principal
    });
  });

  it('the acting user comes from the principal, never from the body', async () => {
    requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
    requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: 'ignored-tenant-user' });

    await attest();

    expect(attestIdentity.mock.calls[0][0].attestedByUserId).toBe(USER_A);
  });

  it('a replay of an already-active attestation is a 200, not a second row', async () => {
    attestIdentity.mockResolvedValue({ ok: true, id: ENTRY_ID, alreadyActive: true });

    const res = await attest();

    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ entryId: ENTRY_ID, alreadyActive: true });
  });

  it('a first attestation is a 201 carrying alreadyActive: false', async () => {
    const res = await attest();
    expect(res._status).toBe(201);
    expect(res._json).toMatchObject({ entryId: ENTRY_ID, alreadyActive: false });
  });
});

describe('WS-4B attest · the administrator must explicitly confirm', () => {
  it('an absent `confirmed` is a 400 and nothing is written', async () => {
    const res = await registry({
      method: 'POST',
      query: { companyId: ORG_A },
      body: { candidateAuthorId: AUTHOR_OK, statement: ATTEST_BODY.statement },
    });

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('confirmation_required');
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it.each([[false], ['true'], [1], [{}], [null]])(
    'a non-`true` confirmed (%p) is a 400 — a truthy value is not a confirmation', async (confirmed) => {
      const res = await attest({ confirmed });

      expect(res._status).toBe(400);
      expect(res._json.error).toBe('confirmation_required');
      expect(attestIdentity).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ candidateAuthorId: undefined }, 'an absent candidate'],
    [{ candidateAuthorId: 'not-a-uuid' }, 'a malformed candidate'],
    [{ statement: undefined }, 'an absent statement'],
    [{ statement: '   ' }, 'a blank statement'],
  ])('%#: %s is a 400 and nothing is written', async (over) => {
    const res = await attest(over as Record<string, unknown>);

    expect(res._status).toBe(400);
    expect(attestIdentity).not.toHaveBeenCalled();
  });
});

describe('WS-4B attest · the candidate is RE-RESOLVED under the verified tenant', () => {
  it('an absent author and an author in another tenant are answered IDENTICALLY', async () => {
    const absent = await attest({ candidateAuthorId: AUTHOR_ABSENT });
    const otherTenant = await attest({ candidateAuthorId: AUTHOR_OTHER_TENANT });

    expect(absent._status).toBe(404);
    expect(otherTenant._status).toBe(404);
    expect(absent._json).toEqual(otherTenant._json);
    expect(absent._json.error).toBe('candidate_not_found');
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it('a cross-tenant author is not attestable even though the author row exists', async () => {
    // The row is readable by id on a global table; what is missing is any
    // message in a thread belonging to THIS tenant.
    const res = await attest({ candidateAuthorId: AUTHOR_OTHER_TENANT });

    expect(res._status).toBe(404);
    expect(attestIdentity).not.toHaveBeenCalled();
    // The message read that proved it was thread-scoped to this tenant.
    const messages = db.readsOf('engagement_messages');
    expect(messages[0].filters).toEqual([
      { op: 'in', col: 'thread_id', vals: [THREAD_A] },
      { op: 'eq', col: 'author_id', val: AUTHOR_OTHER_TENANT },
    ]);
  });

  it.each([
    [AUTHOR_ANON, 'anonymousFallback'],
    [AUTHOR_EXT, 'extensionFallback'],
    [AUTHOR_BARE, 'identityNotAProfileUrl'],
    [AUTHOR_ALIASED, 'platformNotAttestable'],
  ])('an observed but unattestable identity (%s) is refused, naming the requirement', async (authorId, requirement) => {
    const res = await attest({ candidateAuthorId: authorId });

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('candidate_not_attestable');
    expect(res._json.requirement).toBe(requirement);
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it('an unreadable engagement store is 503 and nothing is written', async () => {
    db.broken.add('engagement_threads');

    const res = await attest();

    expect(res._status).toBe(503);
    expect(res._json.error).toBe('owned_identities_unavailable');
    expect(res._json.retryable).toBe(true);
    expect(attestIdentity).not.toHaveBeenCalled();
  });

  it('a repository that reports store_unavailable is a 503, never a success', async () => {
    attestIdentity.mockResolvedValue({ ok: false, reason: 'store_unavailable', detail: 'down' });

    const res = await attest();

    expect(res._status).toBe(503);
    expect(res._json.error).toBe('owned_identities_unavailable');
    expect(res._json).not.toHaveProperty('entryId');
  });

  it('a repository that throws is a 503, and no store detail reaches the caller', async () => {
    attestIdentity.mockRejectedValue(new Error('column "platform_user_id" violates constraint foo'));

    const res = await attest();

    expect(res._status).toBe(503);
    expect(JSON.stringify(res._json)).not.toContain('constraint');
  });

  it('a repository refusal that is not a store failure is a 400 naming it', async () => {
    attestIdentity.mockResolvedValue({ ok: false, reason: 'invalid_input', detail: 'blank identity' });

    const res = await attest();

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'attestation_refused', requirement: 'invalid_input' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · THE REGISTRY READ
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B registry GET · the tenant’s own rows, and an unreadable one is 503', () => {
  it('projects exactly the five entry fields and drops the statement', async () => {
    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(200);
    expect(res._json.state).toBe('available');
    const entries = res._json.entries as Array<Record<string, unknown>>;
    expect(Object.keys(entries[0]).sort()).toEqual([
      'attestedAt', 'attestedByUserId', 'id', 'platform', 'platformUserId',
    ]);
    expect(entries[0].platformUserId).toBe(OK_IDENTITY);
    expect(listActiveAttestedIdentities).toHaveBeenCalledWith(ORG_A);
  });

  it('a row for another tenant is dropped even if the repository returned it', async () => {
    listActiveAttestedIdentities.mockResolvedValue([
      { id: ENTRY_ID, organizationId: ORG_A, platform: 'linkedin', platformUserId: OK_IDENTITY, attestedByUserId: USER_A, attestedAt: 'x' },
      { id: 'leaked', organizationId: ORG_B, platform: 'linkedin', platformUserId: 'https://www.linkedin.com/in/other/', attestedByUserId: 'u', attestedAt: 'y' },
    ]);

    const res = await registry({ method: 'GET' });

    expect((res._json.entries as unknown[]).length).toBe(1);
    expect(JSON.stringify(res._json)).not.toContain('leaked');
  });

  it('an empty registry is an empty 200 — that is a real answer', async () => {
    listActiveAttestedIdentities.mockResolvedValue([]);

    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(200);
    expect(res._json.entries).toEqual([]);
  });

  it.each([
    [{ ok: false, reason: 'store_unavailable', detail: 'down' }, 'a refusal'],
    [undefined, 'an unreadable shape'],
    [{ ok: true }, 'an envelope with no identities'],
    // THE REPOSITORY'S REAL REFUSAL SHAPE, and the one that actually shipped
    // broken. It reports an unreadable relation as a declared failure that
    // CARRIES an empty array, so a handler testing only `Array.isArray(identities)`
    // matched the success branch and answered 200 with an empty list — telling an
    // administrator their organization owns nobody when the read had failed. The
    // three cases above never caught it because none of them is the shape the
    // repository returns; they exercise an envelope it never emits.
    [{ legible: false, detail: 'relation does not exist', identities: [] }, 'a declared failure carrying an empty array'],
    [{ legible: false, detail: 'schema cache miss' }, 'a declared failure with no array at all'],
  ])('%#: %s is 503 and NEVER an empty 200', async (answer) => {
    listActiveAttestedIdentities.mockResolvedValue(answer);

    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(503);
    expect(res._json.error).toBe('owned_identities_unavailable');
    expect(res._json.retryable).toBe(true);
    expect(res._json).not.toHaveProperty('entries');
  });

  it('a repository that throws is 503, not an empty registry', async () => {
    listActiveAttestedIdentities.mockRejectedValue(new Error('relation does not exist'));

    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(503);
    expect(res._json).not.toHaveProperty('entries');
    expect(JSON.stringify(res._json)).not.toContain('relation');
  });

  it('an `{ ok: true, identities }` envelope is accepted too', async () => {
    listActiveAttestedIdentities.mockResolvedValue({
      ok: true,
      identities: [{ id: ENTRY_ID, organizationId: ORG_A, platform: 'linkedin', platformUserId: OK_IDENTITY, attestedByUserId: USER_A, attestedAt: 'x' }],
    });

    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(200);
    expect((res._json.entries as unknown[]).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · THE REVOCATION
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B revoke · by the registry row’s own uuid, with a reason', () => {
  it('revokes by the entry uuid and carries the actor and the reason', async () => {
    const res = await revoke();

    expect(res._status).toBe(200);
    expect(res._json.revoked).toBe(true);
    expect(revokeIdentity).toHaveBeenCalledWith({
      organizationId: ORG_A,
      id: ENTRY_ID,
      revokedByUserId: USER_A,
      reason: 'the account was closed',
    });
  });

  it.each([[undefined], [''], ['   '], ['\u0009']])(
    'a blank reason (%p) is a 400 — an audit record nobody can act on', async (reason) => {
      const res = await revoke({ reason });

      expect(res._status).toBe(400);
      expect(String(res._json.error)).toContain('reason is required');
      expect(revokeIdentity).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], ['not-a-uuid']])('an unusable entry id (%p) is a 400', async (id) => {
    const res = await revoke({ id });

    expect(res._status).toBe(400);
    expect(revokeIdentity).not.toHaveBeenCalled();
  });

  it('no identity string ever travels in the DELETE query', async () => {
    await revoke();

    const sent = revokeIdentity.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['id', 'organizationId', 'reason', 'revokedByUserId']);
    expect(JSON.stringify(sent)).not.toContain('linkedin.com');
  });

  it('an absent entry, and one in another tenant, are both 404 entry_not_found', async () => {
    revokeIdentity.mockResolvedValue({ ok: false, reason: 'not_found', detail: 'no row' });

    const res = await revoke();

    expect(res._status).toBe(404);
    expect(res._json.error).toBe('entry_not_found');
  });

  it('an already-revoked entry is a 200 carrying revoked: false', async () => {
    revokeIdentity.mockResolvedValue({ ok: false, reason: 'already_revoked', detail: 'was revoked' });

    const res = await revoke();

    expect(res._status).toBe(200);
    expect(res._json.revoked).toBe(false);
  });

  it.each([
    [{ ok: false, reason: 'store_unavailable', detail: 'down' }],
    [undefined],
    [{ ok: true }],
  ])('%#: an unreadable store is 503 and never a quiet success', async (answer) => {
    revokeIdentity.mockResolvedValue(answer);

    const res = await revoke();

    expect(res._status).toBe(503);
    expect(res._json.error).toBe('owned_identities_unavailable');
    expect(res._json).not.toHaveProperty('revoked');
  });

  it('a repository that throws is 503, and no store detail reaches the caller', async () => {
    revokeIdentity.mockRejectedValue(new Error('permission denied for table attested_engagement_identities'));

    const res = await revoke();

    expect(res._status).toBe(503);
    expect(JSON.stringify(res._json)).not.toContain('permission denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE EXCLUSION PREDICATES, AGAINST THE WRITERS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · attestability, in the writers’ own terms', () => {
  it.each([
    // `engagementNormalizationService` lines 243 and 334.
    ['linkedin', 'anon_urn:li:comment:9912', 'anonymousFallback'],
    ['slack', 'anon_1726045200.0001', 'anonymousFallback'],
    // `extensionEventIngestionService.buildAuthorId`.
    ['linkedin', 'extension_author_urn:li:msg:771', 'extensionFallback'],
    // `buildAuthorIdentity` prefers `author_username` FIRST, so a bare handle is
    // the COMMON shape, not an edge case — and it identifies nobody.
    ['linkedin', 'dana-okonkwo-7a1', 'identityNotAProfileUrl'],
    // `engagementNormalizationService` falls through to `author_name`.
    ['instagram', 'Dana Okonkwo', 'identityNotAProfileUrl'],
    // `lib/engagement/extensionIngestion.buildProfileUrl` default branch.
    ['tiktok', 'dana', 'identityNotAProfileUrl'],
    // The writers lower-case and do NOT alias, so a stored row may hold `'x'`.
    ['x', 'https://x.com/dana_okonkwo', 'platformNotAttestable'],
    ['li', 'https://www.linkedin.com/in/dana/', 'platformNotAttestable'],
    ['slack', 'https://example.slack.com/team/U123', 'platformNotAttestable'],
    // Blank halves can never match a blank attestation.
    ['linkedin', '', 'identityBlank'],
    ['linkedin', '   ', 'identityBlank'],
    ['', 'https://www.linkedin.com/in/dana/', 'identityBlank'],
    [null, 'https://www.linkedin.com/in/dana/', 'identityBlank'],
    ['linkedin', null, 'identityBlank'],
  ])('%s + %s is excluded as %s', (platform, identity, expected) => {
    expect(classifyOwnedIdentityCandidate(platform as string, identity as string)).toBe(expected);
  });

  it.each([
    ['linkedin', 'https://www.linkedin.com/in/Dana-Okonkwo-7A1/'],
    ['LinkedIn', 'https://www.linkedin.com/in/dana/'],
    ['facebook', 'https://www.facebook.com/dana'],
    ['instagram', 'https://www.instagram.com/dana/'],
    ['twitter', 'https://x.com/dana'],
    ['youtube', 'https://www.youtube.com/@dana'],
    ['linkedin', 'HTTPS://WWW.LINKEDIN.COM/in/Dana/'],
  ])('%s + %s is attestable', (platform, identity) => {
    expect(classifyOwnedIdentityCandidate(platform, identity)).toBeNull();
  });

  it('an `anon_` or `extension_author_` token is excluded even when it looks like a URL suffix', () => {
    expect(classifyOwnedIdentityCandidate('linkedin', 'anon_https://www.linkedin.com/in/dana/'))
      .toBe('anonymousFallback');
    expect(classifyOwnedIdentityCandidate('linkedin', 'extension_author_https://x.com/dana'))
      .toBe('extensionFallback');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · the candidate service and the routes mutate nothing', () => {
  const FILES = [
    'backend/services/engagementIdentity/ownedIdentityCandidates.ts',
    'pages/api/prospect-identity/owned-identity-candidates.ts',
    'pages/api/prospect-identity/owned-identities.ts',
  ];

  /** Comments are stripped so a file's own prose cannot match a detector. */
  const stripComments = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it.each(FILES)('%s carries no insert/update/upsert/delete call', (rel) => {
    const code = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
    expect(code).not.toMatch(/\.\s*(insert|update|upsert|delete)\s*\(/);
  });

  it.each(FILES)('%s names no verdict vocabulary', (rel) => {
    const code = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    expect(code).not.toMatch(/\b(scorable|dimension|weight|priority)\b/i);
    expect(code).not.toMatch(/\bscore[sd]?\b/i);
  });

  it.each(FILES)('%s contains no raw control bytes', (rel) => {
    const code = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    // eslint-disable-next-line no-control-regex
    expect(code).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  });

  it('the candidate service declares that it performs no write', () => {
    expect(OWNED_IDENTITY_CANDIDATES_PERFORMS_NO_WRITE).toBe(true);
  });

  it('the candidate service never selects a third-party column', () => {
    const code = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/services/engagementIdentity/ownedIdentityCandidates.ts'), 'utf8',
    );
    // Inside a `.select('...')` argument only — the header legitimately names
    // these columns to say that they are NOT read.
    const selects = code.match(/\.select\(\s*'[^']*'/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      for (const forbidden of ['display_name', 'username', 'profile_url', 'avatar_url', 'raw_payload', 'content']) {
        expect(select).not.toContain(forbidden);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE PORT CONTRACT — the route's OWN default registry binding, against
//     the REAL repository module
//
// WHY THIS LIVES HERE. Every other section of this file replaces the registry
// port wholesale, which is exactly why none of them could see the defect this
// section pins: the route's default port adapter was never executed. A real
// revision of `owned-identities.ts` forwarded the bare verified tenant string
// to `listActiveAttestedIdentities`, whose repository signature takes
// `{ organizationId, platform?, limit? }`; `requireTenant(query?.organizationId)`
// read `undefined` off a string, threw, and the handler's catch turned EVERY
// active-list read into `503 owned_identities_unavailable` — fail-closed, and
// therefore silent. Nothing surfaced it.
//
// It belongs in this file rather than in
// `piWs4dOwnedIdentityRouteAuthorization.test.ts` because the two seams it
// needs are already here and nothing else is: `requireTenantAccess` and
// `requireCapability` are `jest.fn`s defaulted to allow, and `ownedDbTable` is
// the recording stub. So a failure in this section can only be the
// route-to-repository signature, never an authorization artefact — which is
// what makes it a usable regression signal. WS-4D is the opposite trade: real
// authorization, mocked port.
//
// The port is NOT re-stubbed below. `__setOwnedIdentityRegistryPorts(null)`
// restores the route's own default binding, which lazily requires the real
// `attestedIdentityRepository` — binding the real module through the real
// adapter is the whole point.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B port contract · the default registry binding reaches the real repository', () => {
  const OTHER_ENTRY_ID = 'dddddddd-0002-4000-8000-000000000002';

  /** Stored rows, snake-cased as the relation really holds them. */
  const ATTESTED_ROWS: Row[] = [
    {
      id: ENTRY_ID,
      organization_id: ORG_A,
      platform: 'linkedin',
      platform_user_id: OK_IDENTITY,
      attested_as: 'tenant_own',
      statement: 'our founder account, used for outbound',
      attested_by_user_id: USER_A,
      attested_at: '2026-10-01T10:00:00.000Z',
      revoked_at: null,
      revoked_by_user_id: null,
      revoked_reason: null,
    },
    // Another tenant's row, in the same relation. It must not be rendered.
    {
      id: OTHER_ENTRY_ID,
      organization_id: ORG_B,
      platform: 'linkedin',
      platform_user_id: 'https://www.linkedin.com/in/other-tenant-person/',
      attested_as: 'tenant_own',
      statement: 'another tenant own account',
      attested_by_user_id: 'someone-else',
      attested_at: '2026-10-02T10:00:00.000Z',
      revoked_at: null,
      revoked_by_user_id: null,
      revoked_reason: null,
    },
  ];

  beforeEach(() => {
    db = new StubDb({
      engagement_threads: THREAD_ROWS,
      engagement_messages: MESSAGE_ROWS,
      engagement_authors: AUTHOR_ROWS,
      [ATTESTED_ENGAGEMENT_IDENTITY_RELATION]: ATTESTED_ROWS,
    });
    __setOwnedIdentityRegistryPorts(null);
  });

  // The outer `beforeEach` re-stubs the port for every later test, and the
  // file's `afterAll` restores the default; nothing else is needed here.

  it('GET answers 200 with the stored rows rendered — the adapter narrows the tenant into a query object', async () => {
    const res = await registry({ method: 'GET' });

    expect(res._status).toBe(200);
    expect(res._json.state).toBe('available');
    expect(res._json.entries).toEqual([{
      id: ENTRY_ID,
      platform: 'linkedin',
      platformUserId: OK_IDENTITY,
      attestedAt: '2026-10-01T10:00:00.000Z',
      attestedByUserId: USER_A,
    }]);
    // The projection, not the stored row: `statement` and the revocation
    // columns stay out, as the route's own list path states.
    expect(res._json.entries[0]).not.toHaveProperty('statement');
  });

  it('the repository really ran: the registry relation was opened with the tenant and the ACTIVE predicate', async () => {
    await registry({ method: 'GET' });

    const reads = db.readsOf(ATTESTED_ENGAGEMENT_IDENTITY_RELATION);
    // Guard the guard: a read that never happened would make the assertions
    // below vacuous, and would mean the default port was not the one exercised.
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toEqual(expect.arrayContaining([
      { op: 'eq', col: 'organization_id', val: ORG_A },
      { op: 'eq', col: 'revoked_at', val: null },
    ]));
    // Bounded, and ordered newest-first, by the repository — not by the route.
    expect(reads[0].limit).toBe(ATTESTED_IDENTITY_READ_LIMIT_DEFAULT);
    expect(reads[0].order?.col).toBe('attested_at');
  });

  it('a row of another tenant in the same relation is not rendered', async () => {
    const res = await registry({ method: 'GET' });

    const ids = (res._json.entries as Array<Record<string, unknown>>).map((e) => e.id);
    expect(ids).toEqual([ENTRY_ID]);
    expect(JSON.stringify(res._json)).not.toContain(OTHER_ENTRY_ID);
  });

  it('the repository refuses a BARE tenant string — the exact shape the adapter exists to prevent', async () => {
    // The regression signal, stated at the seam rather than inferred from a
    // status code: the repository's parameter is a QUERY OBJECT. Handed the
    // string the port carries, `requireTenant(query?.organizationId)` reads
    // `undefined` and throws, and the handler's catch turns that into
    // `503 owned_identities_unavailable` for every active-list read. If the
    // route's default binding ever forwards the string again, the 200 asserted
    // above becomes a 503 and this comment says why.
    const repository = jest.requireActual(
      '../../services/engagementIdentity/attestedIdentityRepository',
    ) as { listActiveAttestedIdentities: (q: unknown) => Promise<unknown> };
    await expect(repository.listActiveAttestedIdentities(ORG_A as unknown)).rejects.toThrow();
    await expect(repository.listActiveAttestedIdentities({ organizationId: ORG_A }))
      .resolves.toEqual(expect.objectContaining({ legible: true }));
  });

  it('the port a caller cannot widen: no platform filter and no caller limit reach the repository', async () => {
    await registry({ method: 'GET', query: { companyId: ORG_A, platform: 'x', limit: '500' } });

    const reads = db.readsOf(ATTESTED_ENGAGEMENT_IDENTITY_RELATION);
    expect(reads).toHaveLength(1);
    expect(reads[0].filters.some((f) => f.col === 'platform')).toBe(false);
    expect(reads[0].limit).toBe(ATTESTED_IDENTITY_READ_LIMIT_DEFAULT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · WHICH ROLES HOLD THE GATING CAPABILITY
//
// `requireCapability` is a `jest.fn` in this file, so nothing above can say
// WHO the gate admits. The registry module, however, is never mocked here, so
// `jest.requireActual` reads the real role table — the idiom
// `phase4DiscoveryRoute.test.ts` already uses for exactly this reason.
//
// WHAT THIS ESTABLISHES: that `prospect.ingest` is granted, after hierarchy
// expansion, to COMPANY_ADMIN and SUPER_ADMIN and to no other canonical role.
// WHAT IT DOES NOT: that the routes enforce it. A capability table says nothing
// about whether a handler consults it, which organisation it binds the check
// to, or whether a denial stops the request — that is
// `piWs4dOwnedIdentityRouteAuthorization.test.ts` (the real chain, real
// principals, real membership rows) and
// `crossOrganizationCapabilityScope.test.ts` (the per-organisation semantics).
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B · the gating capability is granted to administrators only', () => {
  const registryModule = () => jest.requireActual('../../security/capabilityRegistry') as {
    ROLE_CAPABILITIES: Record<string, readonly string[]>;
    capabilitiesForRole: (role: string) => readonly string[];
  };

  const NON_ADMIN_ROLES = [
    'VIEW_ONLY',
    'CONTENT_ARCHITECT',
    'CONTENT_PUBLISHER',
    'CONTENT_REVIEWER',
    'CONTENT_CREATOR',
  ];

  it.each(NON_ADMIN_ROLES)('%s does not hold the gating capability', (role) => {
    const { capabilitiesForRole } = registryModule();
    expect(capabilitiesForRole(role)).not.toContain(PROSPECT_INGEST);
  });

  it.each(['COMPANY_ADMIN', 'SUPER_ADMIN'])('%s holds the gating capability', (role) => {
    const { capabilitiesForRole } = registryModule();
    expect(capabilitiesForRole(role)).toContain(PROSPECT_INGEST);
  });

  it('the holder set is exactly those two — and is non-empty, so the assertions above are not vacuous', () => {
    const { ROLE_CAPABILITIES, capabilitiesForRole } = registryModule();
    const holders = Object.keys(ROLE_CAPABILITIES)
      .filter((r) => capabilitiesForRole(r).includes(PROSPECT_INGEST))
      .sort();
    expect(holders.length).toBeGreaterThan(0);
    expect(holders).toEqual(['COMPANY_ADMIN', 'SUPER_ADMIN']);
    // The five roles above plus the two holders are every canonical role, so a
    // new role could not be added without this list changing.
    expect(Object.keys(ROLE_CAPABILITIES).sort())
      .toEqual([...NON_ADMIN_ROLES, 'COMPANY_ADMIN', 'SUPER_ADMIN'].sort());
  });
});
