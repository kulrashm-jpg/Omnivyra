/**
 * Closure-014 (B) — idempotency reservations and authorization.
 *
 *  1. Authorization/rate-limit refusals (401/403/429) are NOT cached as
 *     `completed`: the same caller + key re-evaluates (e.g. after a passkey
 *     step-up) instead of replaying the refusal forever.
 *  2. `authorize` (a pure pre-reservation predicate): a caller that cannot be
 *     authorized reserves NO row; the handler still runs and answers.
 *  3. Keys are caller-scoped: one caller can neither reserve nor poison
 *     another caller's key.
 * Harness copied from withIdempotencyCallerScoping.test.ts (stateful fake
 * keyed as the migration's composite unique index).
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


describe('authorization refusals are not cached', () => {
  it.each([401, 403, 429])('a %i is stored as failed and the SAME key re-runs the handler next time', async (status) => {
    asCaller('user-A');
    let allow = false;
    const handler = jest.fn(async (_q: any, r: any) => (allow ? r.status(200).json({ ok: true }) : r.status(status).json({ code: 'DENIED' })));
    const wrapped = withIdempotency(handler, { scope: 's' });

    const first = makeReqRes('k1', { a: 1 });
    await wrapped(first.req, first.res);
    expect(first.res.statusCode).toBe(status);
    expect(store.rows[0].status).toBe('failed');
    expect(store.rows[0].last_error).toBe(`denied:${status}`);

    allow = true; // e.g. the operator completed the passkey step-up
    const retry = makeReqRes('k1', { a: 1 });
    await wrapped(retry.req, retry.res);
    expect(retry.res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(store.rows[0].status).toBe('completed');
  });

  it('a 2xx and an ordinary 4xx (409/400) are still cached and replayed (contract unchanged)', async () => {
    asCaller('user-A');
    for (const [key, status] of [['k-ok', 201], ['k-409', 409], ['k-400', 400]] as const) {
      const handler = jest.fn(async (_q: any, r: any) => r.status(status).json({ s: status }));
      const wrapped = withIdempotency(handler, { scope: 's' });
      const a = makeReqRes(key, { x: 1 }); await wrapped(a.req, a.res);
      const b = makeReqRes(key, { x: 1 }); await wrapped(b.req, b.res);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(b.res.statusCode).toBe(status);
    }
  });
});

describe('authorize: pre-reservation authorization', () => {
  it('a caller that cannot be authorized reserves nothing; the handler still answers', async () => {
    asCaller('user-unprivileged');
    const handler = jest.fn(async (_q: any, r: any) => r.status(403).json({ code: 'PLATFORM_SUPER_ADMIN_REQUIRED' }));
    const authorize = jest.fn(async () => false);
    const wrapped = withIdempotency(handler, { scope: 's', authorize });
    const { req, res } = makeReqRes('k1', { a: 1 });
    await wrapped(req, res);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(store.rows).toEqual([]);
  });

  it('repeated unauthorized attempts never grow the store', async () => {
    asCaller('user-unprivileged');
    const wrapped = withIdempotency(async (_q: any, r: any) => r.status(403).json({}), { scope: 's', authorize: async () => false });
    for (let i = 0; i < 25; i++) { const { req, res } = makeReqRes(`k${i}`, { i }); await wrapped(req, res); }
    expect(store.rows).toEqual([]);
  });

  it('an authorized caller reserves, executes once and replays as before', async () => {
    asCaller('user-SA');
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's', authorize: async () => true });
    const a = makeReqRes('k1', { a: 1 }); await wrapped(a.req, a.res);
    const b = makeReqRes('k1', { a: 1 }); await wrapped(b.req, b.res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ caller_id: 'user-SA', status: 'completed' });
  });

  it('a predicate error fails toward the normal reserving path, never toward skipping authorization', async () => {
    asCaller('user-SA');
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ ok: true }));
    const wrapped = withIdempotency(handler, { scope: 's', authorize: async () => { throw new Error('boom'); } });
    const { req, res } = makeReqRes('k1', { a: 1 });
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(1);
  });

  it('an unauthenticated caller is still refused before the predicate is consulted', async () => {
    asCaller(null);
    const authorize = jest.fn(async () => true);
    const handler = jest.fn();
    const { req, res } = makeReqRes('k1', { a: 1 });
    await withIdempotency(handler, { scope: 's', authorize })(req, res);
    expect(res.statusCode).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('caller scoping: no reservation or poisoning of a key owned by another caller', () => {
  it('an unauthorized caller using the same key and payload neither blocks nor alters the record of the authorized caller', async () => {
    const handler = jest.fn(async (_q: any, r: any) => r.status(200).json({ who: 'executed' }));
    const deny = jest.fn(async (_q: any, r: any) => r.status(403).json({ code: 'DENIED' }));

    asCaller('attacker');
    const atk = makeReqRes('shared-key', { op: 'grant' });
    await withIdempotency(deny, { scope: 's' })(atk.req, atk.res);

    asCaller('user-SA');
    const sa = makeReqRes('shared-key', { op: 'grant' });
    await withIdempotency(handler, { scope: 's' })(sa.req, sa.res);
    expect(sa.res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    const saRow = store.rows.find((r) => r.caller_id === 'user-SA');
    const atkRow = store.rows.find((r) => r.caller_id === 'attacker');
    expect(saRow).toMatchObject({ status: 'completed', response_status: 200 });
    expect(atkRow).toMatchObject({ status: 'failed', response_status: 403 });
  });
});
