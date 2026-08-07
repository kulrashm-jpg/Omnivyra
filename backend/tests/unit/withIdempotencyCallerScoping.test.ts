/**
 * OR-09 — caller-scoped idempotency (behavioural).
 *
 * THE DEFECT THIS CLOSES
 * `withIdempotency` performs its replay lookup BEFORE the handler runs, and
 * every adopting route authorizes INSIDE its handler. On a completed replay the
 * middleware returns the stored response and the handler never executes — so
 * all authorization is skipped. While the record was keyed only by
 * (scope, idempotency_key), any caller presenting a valid key with an identical
 * payload received another caller's stored response.
 *
 * THE FIX
 * Records are scoped to the authenticated principal, so a cache entry belongs to
 * exactly one caller and cross-caller replay is impossible by construction.
 * Ordering relative to authorization stops mattering.
 *
 * These tests are BEHAVIOURAL: they drive the real middleware against a stateful
 * fake table keyed by (scope, caller_id, idempotency_key) — the same composite
 * the migration enforces — and assert on responses and handler invocation, never
 * on source text.
 */
import { createHash } from 'crypto';

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../services/requestContext', () => ({
  getOrCreateRequestId: jest.fn(() => 'req-1'),
  runWithRequestContext: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

const resolvePrincipalMock = jest.fn();
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: (...args: unknown[]) => resolvePrincipalMock(...args),
}));

import { ownedDbTable } from '../../db/writeOwner';
import { withIdempotency } from '../../middleware/withIdempotency';

type Row = Record<string, any>;

/** Stateful fake keyed exactly as the migration's unique index is. */
function makeStore() {
  const rows: Row[] = [];
  const rowKey = (r: Row) => `${r.scope}|${r.caller_id}|${r.idempotency_key}`;

  const table = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingUpdate: Row | null = null;
    let insertRow: Row | null = null;

    const api: any = {
      select: () => api,
      insert: (row: Row) => {
        // Enforce the composite UNIQUE the migration creates.
        if (rows.some((r) => rowKey(r) === rowKey(row))) {
          const err: any = new Error('duplicate key'); err.code = '23505';
          return Promise.reject(err);
        }
        insertRow = row; rows.push(row);
        return Promise.resolve({ data: row, error: null });
      },
      update: (patch: Row) => { pendingUpdate = patch; return api; },
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
      lt: (col: string, val: string) => { filters.push((r) => String(r[col]) < String(val)); return api; },
      is: (col: string, val: null) => { filters.push((r) => r[col] === val); return api; },
      maybeSingle: () => {
        const match = rows.filter((r) => filters.every((f) => f(r)));
        if (pendingUpdate) {
          match.forEach((r) => Object.assign(r, pendingUpdate));
          return Promise.resolve({ data: match[0] ?? null, error: null });
        }
        return Promise.resolve({ data: match[0] ?? null, error: null });
      },
      then: (resolve: (v: any) => unknown) => {
        // markRecord awaits the builder directly (no .maybeSingle()).
        const match = rows.filter((r) => filters.every((f) => f(r)));
        if (pendingUpdate) match.forEach((r) => Object.assign(r, pendingUpdate));
        return Promise.resolve({ data: match, error: null }).then(resolve);
      },
    };
    void insertRow;
    return api;
  };

  return { rows, table };
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const e = Object.entries(v as Row).sort(([a], [b]) => a.localeCompare(b));
  return `{${e.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}
void createHash; void stableStringify;

function makeReqRes(key: string, body: unknown) {
  const req: any = { method: 'POST', headers: { 'idempotency-key': key }, query: {}, body };
  const res: any = {
    statusCode: 0, payload: undefined as any, headers: {} as Row,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(p: unknown) { this.payload = p; return this; },
  };
  return { req, res };
}

const asCaller = (userId: string | null) =>
  resolvePrincipalMock.mockResolvedValue(
    userId ? { ok: true, principal: { userId } } : { ok: false, reason: 'NO_TOKEN' },
  );

let store: ReturnType<typeof makeStore>;

beforeEach(() => {
  jest.clearAllMocks();
  store = makeStore();
  (ownedDbTable as jest.Mock).mockImplementation(() => store.table());
});

describe('same caller', () => {
  it('replays the cached response for the same key + same body', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(201).json({ id: 'created-1' }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    const first = makeReqRes('k1', { a: 1 });
    await wrapped(first.req, first.res);
    expect(first.res.statusCode).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);

    const second = makeReqRes('k1', { a: 1 });
    await wrapped(second.req, second.res);

    expect(second.res.payload).toEqual({ id: 'created-1' });
    expect(second.res.statusCode).toBe(201);
    // The defining property of replay: the handler did NOT run again.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns 409 for the same key with a different body', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    const first = makeReqRes('k1', { a: 1 });
    await wrapped(first.req, first.res);

    const conflicting = makeReqRes('k1', { a: 999 });
    await wrapped(conflicting.req, conflicting.res);

    expect(conflicting.res.statusCode).toBe(409);
    expect(conflicting.res.payload).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('cross-caller isolation — the defect this change closes', () => {
  it('a DIFFERENT caller reusing the same key does NOT receive the cached response', async () => {
    const handler = jest.fn(async (_q: any, r: any) =>
      r.status(200).json({ secret: `for-${resolvePrincipalMock.mock.results.length}` }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asCaller('user-A');
    const a = makeReqRes('shared-key', { a: 1 });
    await wrapped(a.req, a.res);
    const victimBody = a.res.payload;
    expect(handler).toHaveBeenCalledTimes(1);

    // Attacker: same scope, same key, byte-identical body — differs only in caller.
    asCaller('user-B');
    const b = makeReqRes('shared-key', { a: 1 });
    await wrapped(b.req, b.res);

    // Must NOT be served the victim's stored response...
    expect(b.res.payload).not.toEqual(victimBody);
    // ...and the handler MUST run, so the route's own authorization executes.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('stores independent records per caller', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asCaller('user-A');
    const a = makeReqRes('same-key', { a: 1 });
    await wrapped(a.req, a.res);

    asCaller('user-B');
    const b = makeReqRes('same-key', { a: 1 });
    await wrapped(b.req, b.res);

    const owners = store.rows.map((r) => r.caller_id).sort();
    expect(owners).toEqual(['user-A', 'user-B']);
    expect(store.rows.every((r) => typeof r.caller_id === 'string' && r.caller_id.length > 0)).toBe(true);
  });

  it('different caller + different body is likewise independent', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asCaller('user-A');
    const a = makeReqRes('k', { a: 1 });
    await wrapped(a.req, a.res);

    asCaller('user-B');
    const b = makeReqRes('k', { b: 2 });
    await wrapped(b.req, b.res);

    // No cross-caller 409 — B's record is its own, not a conflict with A's.
    expect(b.res.statusCode).not.toBe(409);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('unauthenticated callers', () => {
  it('are rejected and never create a record', async () => {
    asCaller(null);
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: 's' });

    const { req, res } = makeReqRes('k1', { a: 1 });
    await wrapped(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toMatchObject({ code: 'IDEMPOTENCY_PRINCIPAL_REQUIRED' });
    expect(handler).not.toHaveBeenCalled();
    // Fail-closed: no unscoped record may exist.
    expect(store.rows).toHaveLength(0);
  });

  it('cannot read a record created by an authenticated caller', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ secret: 'private' }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asCaller('user-A');
    const a = makeReqRes('k1', { a: 1 });
    await wrapped(a.req, a.res);

    asCaller(null);
    const anon = makeReqRes('k1', { a: 1 });
    await wrapped(anon.req, anon.res);

    expect(anon.res.statusCode).toBe(401);
    expect(anon.res.payload).not.toMatchObject({ secret: 'private' });
  });

  it('a principal resolving without a userId is treated as unauthenticated', async () => {
    resolvePrincipalMock.mockResolvedValue({ ok: true, principal: {} });
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: 's' });
    const { req, res } = makeReqRes('k1', { a: 1 });
    await wrapped(req, res);
    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a throwing resolver fails CLOSED rather than falling back to unscoped lookup', async () => {
    resolvePrincipalMock.mockRejectedValue(new Error('identity subsystem down'));
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: 's' });
    const { req, res } = makeReqRes('k1', { a: 1 });
    await wrapped(req, res);
    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

describe('D-1 — legacy (pre-OR-09) records', () => {
  const seedLegacy = (scope: string, key: string, hash: string, body: unknown, status = 'completed') =>
    store.rows.push({
      scope, caller_id: null, idempotency_key: key, request_hash: hash,
      status, response_status: 200, response_body: body, locked_at: null, request_id: 'old-req',
    });

  it('replays a legacy completed record instead of re-executing business logic', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(201).json({ fresh: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    // Learn the hash the middleware computes, then seed a legacy row with it.
    const probe = makeReqRes('probe', { a: 1 });
    await wrapped(probe.req, probe.res);
    const hash = store.rows[0].request_hash;
    store.rows.length = 0;
    seedLegacy('s', 'legacy-key', hash, { legacy: 'response' });

    handler.mockClear();
    const retry = makeReqRes('legacy-key', { a: 1 });
    await wrapped(retry.req, retry.res);

    expect(retry.res.payload).toEqual({ legacy: 'response' });
    // The defect this closes: business logic must NOT run again.
    expect(handler).not.toHaveBeenCalled();
  });

  it('does NOT consult a legacy row whose payload differs', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(201).json({ fresh: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });
    seedLegacy('s', 'k', 'some-other-hash', { legacy: 'response' });

    const { req, res } = makeReqRes('k', { a: 1 });
    await wrapped(req, res);

    expect(res.payload).toEqual({ fresh: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never claims a legacy row — non-completed legacy rows are ignored', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(201).json({ fresh: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    const probe = makeReqRes('probe', { a: 1 });
    await wrapped(probe.req, probe.res);
    const hash = store.rows[0].request_hash;
    store.rows.length = 0;
    // A legacy row still 'processing' must not block or be reclaimed.
    seedLegacy('s', 'k', hash, { legacy: 'x' }, 'processing');

    handler.mockClear();
    const { req, res } = makeReqRes('k', { a: 1 });
    await wrapped(req, res);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(409);
    // The legacy row is untouched; a new caller-owned row was created alongside.
    const legacyRow = store.rows.find((r) => r.caller_id === null);
    expect(legacyRow.status).toBe('processing');
    expect(store.rows.some((r) => r.caller_id === 'user-A')).toBe(true);
  });

  it('new records are never written with a NULL caller_id', async () => {
    asCaller('user-A');
    const wrapped = withIdempotency(async (_q: any, r: any) => r.status(200).json({ ok: true }), { scope: 's' });
    const { req, res } = makeReqRes('k', { a: 1 });
    await wrapped(req, res);
    expect(store.rows.every((r) => r.caller_id !== null)).toBe(true);
  });
});

describe('D-2 — legacy bridge principals do not share an identity', () => {
  const asBridge = (cookie: string) => {
    resolvePrincipalMock.mockResolvedValue({
      ok: true,
      principal: { userId: 'legacy:cookie-super-admin', legacyCookieSuperAdmin: true },
    });
    return cookie;
  };

  const bridgeReqRes = (cookie: string, key: string, body: unknown) => {
    const { req, res } = makeReqRes(key, body);
    req.headers.cookie = `super_admin_session=${cookie}`;
    return { req, res };
  };

  it('two bridge operators cannot replay each other despite a shared userId', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ n: handler.mock.calls.length }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asBridge('cookie-operator-1');
    const a = bridgeReqRes('cookie-operator-1', 'shared', { a: 1 });
    await wrapped(a.req, a.res);

    asBridge('cookie-operator-2');
    const b = bridgeReqRes('cookie-operator-2', 'shared', { a: 1 });
    await wrapped(b.req, b.res);

    // Distinct scoping keys → the handler ran for both.
    expect(handler).toHaveBeenCalledTimes(2);
    const owners = store.rows.map((r) => r.caller_id);
    expect(new Set(owners).size).toBe(2);
    expect(owners.every((o: string) => o.startsWith('bridge:'))).toBe(true);
    // The shared constant must never be used as a scoping key.
    expect(owners).not.toContain('legacy:cookie-super-admin');
  });

  it('the same bridge session replays its own request', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(201).json({ id: 'x' }));
    const wrapped = withIdempotency(handler, { scope: 's' });

    asBridge('cookie-operator-1');
    const first = bridgeReqRes('cookie-operator-1', 'k', { a: 1 });
    await wrapped(first.req, first.res);
    const second = bridgeReqRes('cookie-operator-1', 'k', { a: 1 });
    await wrapped(second.req, second.res);

    expect(second.res.payload).toEqual({ id: 'x' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a bridge principal with no cookie fails closed', async () => {
    asBridge('unused');
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: 's' });
    const { req, res } = makeReqRes('k', { a: 1 });
    req.headers.cookie = '';
    await wrapped(req, res);

    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

describe('preserved contracts', () => {
  it('still requires the Idempotency-Key header, before any identity work', async () => {
    asCaller('user-A');
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: 's' });
    const req: any = { method: 'POST', headers: {}, query: {}, body: {} };
    const res: any = {
      statusCode: 0, payload: undefined as any,
      setHeader() {}, status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.payload = p; return this; },
    };
    await wrapped(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(resolvePrincipalMock).not.toHaveBeenCalled();
  });

  it('passes non-mutating methods straight through, unscoped and unchanged', async () => {
    asCaller('user-A');
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's' });
    const req: any = { method: 'GET', headers: {}, query: {}, body: undefined };
    const res: any = {
      statusCode: 0, payload: undefined as any,
      setHeader() {}, status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.payload = p; return this; },
    };
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(resolvePrincipalMock).not.toHaveBeenCalled();
  });
});
