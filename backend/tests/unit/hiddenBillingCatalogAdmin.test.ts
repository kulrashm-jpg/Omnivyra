/**
 * /api/super-admin/billing-catalog — hidden pricing-governance endpoint tests.
 *
 * Covers: admin authorization, CRUD correctness, duplicate prevention,
 * disabled-entry behavior, validation, hidden-pricing preservation, no public
 * exposure, resolver-shape compatibility, and the append-only audit trail
 * (operation_type derivation, before/after snapshots, operator identity,
 * audit-table-absent tolerance).
 */

let __authOk = true;
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: any, res: any) => {
    if (__authOk) return { ok: true, principal: { userId: 'admin-user-007' } };
    res.status(403).json({ error: 'forbidden' });
    return { ok: false };
  },
}));

// In-memory mocks for BOTH tables the endpoint touches:
//  - hidden_billing_catalog        (select/order, insert, select-by-eq, update)
//  - hidden_billing_catalog_audit  (append-only insert)
let __rows: any[] = [];
let __audit: any[] = [];
let __failTable = false;
let __auditFailTable = false;

jest.mock('@/backend/db/supabaseClient', () => {
  const TABLE_MISSING = 'relation "hidden_billing_catalog" does not exist';
  const AUDIT_MISSING = 'relation "hidden_billing_catalog_audit" does not exist';

  const makeCatalogBuilder = () => {
    const b: any = { _insert: null, _update: null, _eqField: null, _eqValue: null };
    b.select = () => b;
    b.order = () => Promise.resolve(
      __failTable ? { data: null, error: { message: TABLE_MISSING } }
                  : { data: [...__rows], error: null },
    );
    b.insert = (payload: any) => { b._insert = payload; return b; };
    b.update = (payload: any) => { b._update = payload; return b; };
    b.eq = (f: string, v: unknown) => { b._eqField = f; b._eqValue = v; return b; };
    b.maybeSingle = () => {
      if (b._insert) {
        if (__failTable) return Promise.resolve({ data: null, error: { message: TABLE_MISSING } });
        if (__rows.some((r) => r.reference_key === b._insert.reference_key)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
        }
        const row = { id: `id_${b._insert.reference_key}`, ...b._insert };
        __rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (b._update) {
        const idx = __rows.findIndex((r) => r[b._eqField] === b._eqValue);
        if (idx < 0) return Promise.resolve({ data: null, error: null });
        __rows[idx] = { ...__rows[idx], ...b._update };
        return Promise.resolve({ data: __rows[idx], error: null });
      }
      // select-by-eq read (the PATCH before_snapshot pre-read).
      if (b._eqField) {
        const row = __rows.find((r) => r[b._eqField] === b._eqValue);
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return b;
  };

  const makeAuditBuilder = () => ({
    // The audit write is `await supabase.from(...).insert({...})` — insert
    // resolves directly (no .select()/.maybeSingle() chain).
    insert: (payload: any) => {
      if (__auditFailTable) {
        return Promise.resolve({ error: { message: AUDIT_MISSING } });
      }
      __audit.push({ ...payload });
      return Promise.resolve({ error: null });
    },
  });

  return {
    supabase: {
      from: (table: string) =>
        table === 'hidden_billing_catalog_audit' ? makeAuditBuilder() : makeCatalogBuilder(),
    },
  };
});

import handler from '../../../pages/api/super-admin/billing-catalog/index';

function mockReqRes(method: string, body?: unknown) {
  const req: any = { method, query: {}, headers: {}, body };
  const res: any = {
    _status: 0, _json: null, _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  __authOk = true; __rows = []; __audit = []; __failTable = false; __auditFailTable = false;
});

describe('billing-catalog admin — authorization', () => {
  test('non-super-admin → 403, no DB access', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(403);
  });
  test('POST as non-super-admin → 403', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('POST', { reference_key: 'plan_x', kind: 'subscription', amount_minor: 100, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(403);
    expect(__rows).toHaveLength(0); // never reached the DB
    expect(__audit).toHaveLength(0);
  });
  test('disallowed method → 405', async () => {
    const { req, res } = mockReqRes('DELETE');
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

describe('billing-catalog admin — CRUD correctness', () => {
  test('POST creates an entry → 201', async () => {
    const { req, res } = mockReqRes('POST', {
      reference_key: 'plan_team_monthly', kind: 'subscription',
      amount_minor: 299900, currency: 'inr', internal_label: 'Team (monthly)',
    });
    await handler(req, res);
    expect(res._status).toBe(201);
    const created = (res._json as any).created;
    expect(created.reference_key).toBe('plan_team_monthly');
    expect(created.currency).toBe('INR'); // normalized uppercase
    expect(created.enabled).toBe(true);   // default
  });

  test('GET lists created entries', async () => {
    __rows = [{ id: 'id_a', reference_key: 'topup_a', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).entries).toHaveLength(1);
  });

  test('PATCH updates amount_minor → 200', async () => {
    __rows = [{ id: 'id_p', reference_key: 'plan_pro_monthly', kind: 'subscription', amount_minor: 199900, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'plan_pro_monthly', amount_minor: 249900 });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).updated.amount_minor).toBe(249900);
  });

  test('PATCH on a non-existent reference → 404', async () => {
    const { req, res } = mockReqRes('PATCH', { reference_key: 'plan_ghost', amount_minor: 100 });
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  test('PATCH with no updatable fields → 400', async () => {
    __rows = [{ id: 'id_p', reference_key: 'plan_pro_monthly', kind: 'subscription', amount_minor: 199900, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'plan_pro_monthly' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('no_updatable_fields');
  });
});

describe('billing-catalog admin — duplicate prevention', () => {
  test('POST with an existing reference_key → 409', async () => {
    const first = mockReqRes('POST', { reference_key: 'plan_dup', kind: 'subscription', amount_minor: 100, currency: 'INR' });
    await handler(first.req, first.res);
    expect(first.res._status).toBe(201);
    const second = mockReqRes('POST', { reference_key: 'plan_dup', kind: 'subscription', amount_minor: 200, currency: 'INR' });
    await handler(second.req, second.res);
    expect(second.res._status).toBe(409);
    expect((second.res._json as any).error).toBe('duplicate_reference_key');
  });
});

describe('billing-catalog admin — disabled-entry behavior', () => {
  test('PATCH enabled=false disables an entry', async () => {
    __rows = [{ id: 'id_x', reference_key: 'topup_x', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'topup_x', enabled: false });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).updated.enabled).toBe(false);
  });
  test('PATCH enabled=true re-enables an entry', async () => {
    __rows = [{ id: 'id_x', reference_key: 'topup_x', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: false }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'topup_x', enabled: true });
    await handler(req, res);
    expect((res._json as any).updated.enabled).toBe(true);
  });
});

describe('billing-catalog admin — validation', () => {
  test('rejects malformed reference_key', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'Bad Key!', kind: 'topup', amount_minor: 1, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_reference_key');
  });
  test('rejects invalid kind', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'plan_x', kind: 'gift', amount_minor: 1, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_kind');
  });
  test('rejects negative amount_minor', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'plan_x', kind: 'subscription', amount_minor: -1, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_amount_minor');
  });
  test('rejects non-integer amount_minor', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'plan_x', kind: 'subscription', amount_minor: 12.5, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_amount_minor');
  });
  test('rejects invalid currency', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'plan_x', kind: 'subscription', amount_minor: 1, currency: 'Rupees' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_currency');
  });
});

describe('billing-catalog admin — resolver-shape compatibility', () => {
  test('a created entry carries the columns billingAmountResolver reads', async () => {
    const { req, res } = mockReqRes('POST', {
      reference_key: 'topup_new', kind: 'topup', amount_minor: 75000, currency: 'INR',
    });
    await handler(req, res);
    const created = (res._json as any).created;
    // resolveBillingAmount selects: kind, amount_minor, currency, enabled.
    for (const col of ['kind', 'amount_minor', 'currency', 'enabled']) {
      expect(created).toHaveProperty(col);
    }
  });
});

describe('billing-catalog admin — append-only audit trail', () => {
  test('POST create writes one audit row: operation_type=create, before=null', async () => {
    const { req, res } = mockReqRes('POST', {
      reference_key: 'plan_audit_create', kind: 'subscription', amount_minor: 120000, currency: 'INR',
    });
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(__audit).toHaveLength(1);
    const row = __audit[0];
    expect(row.operation_type).toBe('create');
    expect(row.reference_key).toBe('plan_audit_create');
    expect(row.before_snapshot).toBeNull();           // no prior state on create
    expect(row.after_snapshot).toMatchObject({ reference_key: 'plan_audit_create', amount_minor: 120000 });
  });

  test('PATCH update writes an audit row with accurate before/after snapshots', async () => {
    __rows = [{
      id: 'id_p', reference_key: 'plan_audit_update', kind: 'subscription',
      amount_minor: 199900, currency: 'INR', enabled: true, internal_label: 'before',
    }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'plan_audit_update', amount_minor: 249900 });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__audit).toHaveLength(1);
    const row = __audit[0];
    expect(row.operation_type).toBe('update');
    // before_snapshot is the pre-mutation row; after_snapshot is post-mutation.
    expect(row.before_snapshot.amount_minor).toBe(199900);
    expect(row.after_snapshot.amount_minor).toBe(249900);
  });

  test('PATCH enabled=false → operation_type=disable', async () => {
    __rows = [{ id: 'id_x', reference_key: 'topup_audit_dis', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'topup_audit_dis', enabled: false });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__audit).toHaveLength(1);
    expect(__audit[0].operation_type).toBe('disable');
    expect(__audit[0].before_snapshot.enabled).toBe(true);
    expect(__audit[0].after_snapshot.enabled).toBe(false);
  });

  test('PATCH enabled=true → operation_type=enable', async () => {
    __rows = [{ id: 'id_x', reference_key: 'topup_audit_en', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: false }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'topup_audit_en', enabled: true });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__audit).toHaveLength(1);
    expect(__audit[0].operation_type).toBe('enable');
  });

  test('a multi-field PATCH that includes enabled is recorded as a generic update', async () => {
    __rows = [{ id: 'id_x', reference_key: 'topup_audit_multi', kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true }];
    const { req, res } = mockReqRes('PATCH', { reference_key: 'topup_audit_multi', enabled: false, amount_minor: 60000 });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__audit[0].operation_type).toBe('update'); // not 'disable' — more than enabled changed
  });

  test('audit captures operator identity (changed_by_user_id) on create and update', async () => {
    const create = mockReqRes('POST', { reference_key: 'plan_audit_op', kind: 'subscription', amount_minor: 100000, currency: 'INR' });
    await handler(create.req, create.res);
    __rows = [{ id: 'id_o', reference_key: 'plan_audit_op2', kind: 'subscription', amount_minor: 100000, currency: 'INR', enabled: true }];
    const patch = mockReqRes('PATCH', { reference_key: 'plan_audit_op2', amount_minor: 110000 });
    await handler(patch.req, patch.res);
    expect(__audit).toHaveLength(2);
    for (const row of __audit) {
      expect(row.changed_by_user_id).toBe('admin-user-007');
    }
  });

  test('a missing audit table does NOT fail the catalog mutation (best-effort)', async () => {
    __auditFailTable = true;
    const { req, res } = mockReqRes('POST', {
      reference_key: 'plan_no_audit_table', kind: 'subscription', amount_minor: 100000, currency: 'INR',
    });
    await handler(req, res);
    expect(res._status).toBe(201);          // catalog create still succeeds
    expect(__audit).toHaveLength(0);         // audit silently skipped
    expect(__rows.some((r) => r.reference_key === 'plan_no_audit_table')).toBe(true);
  });

  test('a rejected (invalid) request writes NO audit row', async () => {
    const { req, res } = mockReqRes('POST', { reference_key: 'Bad Key!', kind: 'topup', amount_minor: 1, currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(__audit).toHaveLength(0);
  });

  test('a 404 PATCH (no such reference) writes NO audit row', async () => {
    const { req, res } = mockReqRes('PATCH', { reference_key: 'plan_ghost_audit', amount_minor: 100 });
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(__audit).toHaveLength(0);
  });
});

describe('billing-catalog admin — hidden-pricing preservation', () => {
  test('the endpoint is the ONLY pricing surface — responses stay operator-scoped', async () => {
    // A created entry is returned to the authenticated operator (expected), but
    // the audit snapshots are never surfaced in the HTTP response body.
    const { req, res } = mockReqRes('POST', {
      reference_key: 'plan_hidden_chk', kind: 'subscription', amount_minor: 150000, currency: 'INR',
    });
    await handler(req, res);
    const serialized = JSON.stringify(res._json);
    expect(serialized).not.toContain('before_snapshot');
    expect(serialized).not.toContain('after_snapshot');
    expect(serialized).not.toContain('audit');
  });
});
