/**
 * withIdempotency — stale-lock takeover tests
 *
 * The bug: a `processing` row left by a crashed handler blocked every
 * future request with the same key forever (HTTP 409 IDEMPOTENCY_IN_PROGRESS),
 * requiring manual SQL. The fix: the middleware reclaims a provably-dead
 * lock (locked_at older than staleLockMs) via a guarded UPDATE.
 *
 * Replay protection MUST remain intact: COMPLETED rows still short-circuit;
 * a freshly-locked `processing` row is still rejected.
 *
 * The fake table is STATEFUL and keyed by (scope, idempotency_key) so it
 * mirrors the middleware's real flow (loadExisting → createRecord →
 * loadExisting; loadExisting → takeover UPDATE; markRecord; etc.) without
 * depending on call ordinals.
 */

import { createHash } from 'crypto';

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../services/requestContext', () => ({
  getOrCreateRequestId: jest.fn(() => 'req-test-1'),
  runWithRequestContext: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

import { ownedDbTable } from '../../db/writeOwner';
import { withIdempotency } from '../../middleware/withIdempotency';

type AnyMock = jest.Mock;

// Mirror of the middleware's private stableStringify + buildRequestHash so
// fixtures can carry the request_hash the middleware will actually compute.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
function expectedHash(scope: string, req: { method: string; query: unknown; body: unknown }): string {
  const payload = { scope, method: req.method, query: req.query, body: req.body };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

interface Row {
  id: string;
  idempotency_key: string;
  status: 'processing' | 'completed' | 'failed';
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  locked_at: string | null;
  request_id: string | null;
}

/**
 * Stateful in-memory api_idempotency_keys fake. `seed` installs the initial
 * row (or null for first-ever). `takeoverWins` controls whether the guarded
 * stale-lock UPDATE matches a row (simulating winning vs losing the race).
 */
function installFakeTable(seed: Row | null, takeoverWins = true) {
  let row: Row | null = seed ? { ...seed } : null;

  (ownedDbTable as AnyMock).mockImplementation(() => {
    const q: any = { _op: 'select', _updatePatch: undefined as Record<string, unknown> | undefined };
    q.select = () => q;
    q.eq = () => q;
    q.lt = () => q;
    q.is = () => q;
    q.insert = (vals: Record<string, unknown>) => {
      row = {
        id: 'created-1',
        idempotency_key: String(vals.idempotency_key),
        status: 'processing',
        request_hash: String(vals.request_hash),
        response_status: null,
        response_body: null,
        locked_at: String(vals.locked_at ?? new Date().toISOString()),
        request_id: vals.request_id ? String(vals.request_id) : null,
      };
      return Promise.resolve({ error: null });
    };
    q.update = (patch: Record<string, unknown>) => { q._op = 'update'; q._updatePatch = patch; return q; };
    q.maybeSingle = () => {
      if (q._op === 'update') {
        // takeover or markRecord-with-select. Apply patch if a row exists
        // and the takeover is configured to win.
        if (row && takeoverWins) {
          row = { ...row, ...(q._updatePatch ?? {}) } as Row;
          return Promise.resolve({ data: { id: row.id }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
      // loadExisting
      return Promise.resolve({ data: row, error: null });
    };
    // markRecord awaits the update chain directly (no .select())
    q.then = (resolve: (v: unknown) => unknown) => {
      if (q._op === 'update' && row && q._updatePatch) {
        row = { ...row, ...q._updatePatch } as Row;
      }
      return Promise.resolve({ error: null }).then(resolve);
    };
    return q;
  });
}

const SCOPE = 'admin-credits-grant';
const reqShape = { method: 'POST', query: {}, body: { organizationId: 'o', credits: 5000 } };
const baseReq = () => ({ headers: { 'idempotency-key': 'grant-abc' }, ...reqShape }) as any;
const HASH = expectedHash(SCOPE, reqShape);

function seedRow(overrides: Partial<Row>): Row {
  return {
    id: 'r1',
    idempotency_key: 'grant-abc',
    status: 'processing',
    request_hash: HASH,
    response_status: null,
    response_body: null,
    locked_at: new Date().toISOString(),
    // A DIFFERENT request than the current one (mocked getOrCreateRequestId
    // returns 'req-test-1') — i.e. the lock is held by some other/dead
    // handler, not us. Tests that want "our own lock" override this.
    request_id: 'dead-handler-req',
    ...overrides,
  };
}

describe('withIdempotency stale-lock takeover', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects with 409 IN_PROGRESS when a FRESH processing row holds the lock', async () => {
    installFakeTable(seedRow({ status: 'processing', locked_at: new Date().toISOString() }));
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'], staleLockMs: 600_000 });
    const res = makeRes();
    await wrapped(baseReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(handler).not.toHaveBeenCalled();
  });

  it('reclaims a STALE processing lock and runs the handler', async () => {
    installFakeTable(seedRow({
      status: 'processing',
      locked_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    }), true);
    // The middleware wraps res.status/res.json, so assert via a handler
    // side-effect instead of the (now non-mock) res methods.
    let handlerRan = false;
    const handler = jest.fn(async (_req: unknown, res: any) => {
      handlerRan = true;
      res.status(200); res.json({ ok: true });
    });
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'], staleLockMs: 600_000 });
    const res = makeRes();
    await wrapped(baseReq(), res);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handlerRan).toBe(true);
  });

  it('treats null locked_at as stale and reclaims', async () => {
    installFakeTable(seedRow({ status: 'processing', locked_at: null }), true);
    const handler = jest.fn(async (_req: unknown, res: any) => { res.status(200); res.json({ ok: true }); });
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'] });
    const res = makeRes();
    await wrapped(baseReq(), res);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when stale row exists but takeover UPDATE loses the race', async () => {
    installFakeTable(seedRow({
      status: 'processing',
      locked_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    }), /* takeoverWins */ false);
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'], staleLockMs: 600_000 });
    const res = makeRes();
    await wrapped(baseReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(handler).not.toHaveBeenCalled();
  });

  it('REPLAY PROTECTION: a COMPLETED row short-circuits before any takeover', async () => {
    installFakeTable(seedRow({
      status: 'completed',
      response_status: 200,
      response_body: { ok: true, replayed: true },
      locked_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    }));
    const handler = jest.fn();
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'] });
    const res = makeRes();
    await wrapped(baseReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(handler).not.toHaveBeenCalled();
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.replayed).toBe(true);
  });

  it('first-ever request (no existing row) proceeds normally', async () => {
    installFakeTable(null);
    const handler = jest.fn(async (_req: unknown, res: any) => { res.status(200); res.json({ ok: true }); });
    const wrapped = withIdempotency(handler, { scope: SCOPE, methods: ['POST'] });
    const res = makeRes();
    await wrapped(baseReq(), res);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
