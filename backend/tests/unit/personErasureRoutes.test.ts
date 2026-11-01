/**
 * Person erasure API routes — transport, authN/authZ order, validation, HTTP
 * mapping and the audit event.
 *
 *   pages/api/prospect-identity/erasure-requests/index.ts        GET list / POST start
 *   pages/api/prospect-identity/erasure-requests/[requestId].ts  GET status / POST retry
 *
 * The service is doubled (its own suites: personErasureRequestsService unit +
 * pi_person_erasure_api_wiring realschema). The gates are doubled SEPARATELY,
 * so each can be failed on its own and the order between them is observable.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const order: string[] = [];
type Tenant = { userId: string; organizationId: string; role: string | null; bypass: boolean } | null;
const tenantOk = jest.fn(async (..._a: unknown[]): Promise<Tenant> => ({ userId: 'u-1', organizationId: ORG, role: 'COMPANY_ADMIN', bypass: false }));
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: async (...a: unknown[]) => { order.push('tenant'); return tenantOk(...a); },
}));
const capabilityOk = jest.fn(async (..._a: unknown[]): Promise<{ ok: boolean; principal?: unknown }> =>
  ({ ok: true, principal: { userId: 'u-1', sessionId: 's-1', supabaseUid: 'sb-1' } }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (...a: unknown[]) => { order.push('capability'); return capabilityOk(...a); },
}));
const audit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: (...a: unknown[]) => audit(...a) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const start = jest.fn();
const retry = jest.fn();
const getOne = jest.fn();
const list = jest.fn();
const schemaReady = jest.fn(async (..._a: unknown[]) => true);
jest.mock('../../services/prospectIdentity/personErasureRequests', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/personErasureRequests');
  return {
    ...actual,
    startPersonErasure: (...a: unknown[]) => { order.push('service'); return start(...a); },
    retryErasureRequest: (...a: unknown[]) => { order.push('service'); return retry(...a); },
    getErasureRequest: (...a: unknown[]) => getOne(...a),
    listErasureRequests: (...a: unknown[]) => list(...a),
    erasureSchemaReady: (...a: unknown[]) => { order.push('schema'); return schemaReady(...a); },
  };
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn(), ownedDbRpc: jest.fn() }));

const ORG = '00000000-0000-4000-8000-00000000000a';
const PERSON = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';

/* eslint-disable @typescript-eslint/no-var-requires */
const collection = require('../../../pages/api/prospect-identity/erasure-requests/index').default as (q: unknown, s: unknown) => Promise<unknown>;
const single = require('../../../pages/api/prospect-identity/erasure-requests/[requestId]').default as (q: unknown, s: unknown) => Promise<unknown>;

const view = (status: string, over: Record<string, unknown> = {}) => ({
  requestId: REQ, status, personId: null, attempts: 1,
  steps: { governanceReanchored: true, governanceRevoked: true, evidenceLinksCleared: true, provenanceErased: true, personDeleted: true },
  lastErrorCode: null, policies: null, verification: null, createdAt: 't', completedAt: 't', ...over,
});

async function call(route: typeof collection, over: Record<string, unknown> = {}) {
  const captured = { code: null as number | null, body: null as any, headers: {} as Record<string, string> };
  const res = {
    status(c: number) { captured.code = c; return this; },
    json(b: unknown) { captured.body = b; return this; },
    setHeader(n: string, v: string) { captured.headers[n] = v; },
  };
  const req = {
    method: 'POST', headers: { 'user-agent': 'jest' },
    query: { companyId: ORG, requestId: REQ },
    body: { personId: PERSON, reasonCode: 'data_subject_request', reference: 'TICKET-1' },
    ...over,
  };
  await route(req, res);
  return captured;
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  tenantOk.mockImplementation(async () => ({ userId: 'u-1', organizationId: ORG, role: 'COMPANY_ADMIN', bypass: false }));
  capabilityOk.mockImplementation(async () => ({ ok: true, principal: { userId: 'u-1', sessionId: 's-1', supabaseUid: 'sb-1' } }));
  start.mockResolvedValue({ kind: 'request', errorCode: null, view: view('COMPLETED') });
  retry.mockResolvedValue({ kind: 'request', errorCode: null, view: view('COMPLETED') });
  schemaReady.mockImplementation(async () => true);
});

describe('authentication and authorization', () => {
  it('unauthenticated / non-member: the tenant guard answers and NOTHING else runs', async () => {
    tenantOk.mockResolvedValue(null);
    await call(collection);
    await call(single, { body: { action: 'retry' } });
    expect(order).toEqual(['tenant', 'tenant']);
    expect(start).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('unauthorized role (capability not held / step-up missing): the service never runs', async () => {
    capabilityOk.mockResolvedValue({ ok: false });
    await call(collection);
    await call(single, { body: { action: 'retry' } });
    expect(start).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('order: membership, then capability, then the schema gate, then the service', async () => {
    await call(collection);
    expect(order).toEqual(['tenant', 'capability', 'schema', 'service']);
  });

  it('the capability is prospect.person.erase, bound to the VERIFIED tenant id; step-up on POST, not on GET', async () => {
    await call(collection, { body: { personId: PERSON, reasonCode: 'data_subject_request', companyId: 'co-OTHER' } });
    const opts = capabilityOk.mock.calls[0][2] as { capability: string; organizationId: string; requireStepUp: boolean };
    expect(opts).toMatchObject({ capability: 'prospect.person.erase', organizationId: ORG, requireStepUp: true });
    list.mockResolvedValue({ requests: [], inconsistencies: [] });
    await call(collection, { method: 'GET' });
    expect((capabilityOk.mock.calls[1][2] as { requireStepUp: boolean }).requireStepUp).toBe(false);
    getOne.mockResolvedValue(view('COMPLETED'));
    await call(single, { method: 'GET' });
    expect((capabilityOk.mock.calls[2][2] as { requireStepUp: boolean }).requireStepUp).toBe(false);
    await call(single, { body: { action: 'retry' } });
    expect((capabilityOk.mock.calls[3][2] as { requireStepUp: boolean }).requireStepUp).toBe(true);
  });

  it('the service receives the tenant the guard verified, never a body/query alternative', async () => {
    tenantOk.mockResolvedValue({ userId: 'u-1', organizationId: ORG, role: 'COMPANY_ADMIN', bypass: false });
    await call(collection, { query: { companyId: ORG, company_id: 'co-OTHER' }, body: { personId: PERSON, reasonCode: 'tenant_request', organizationId: 'co-OTHER' } });
    expect(start.mock.calls[0][0]).toMatchObject({ organizationId: ORG, personId: PERSON, requestedBy: 'erasure-api:company_admin' });
  });

  it('a platform super-admin bypass is labelled as such (role label, never a personal identifier)', async () => {
    tenantOk.mockResolvedValue({ userId: 'u-9', organizationId: ORG, role: null, bypass: true });
    await call(collection);
    expect(start.mock.calls[0][0].requestedBy).toBe('erasure-api:platform-super-admin');
  });
});

describe('validation', () => {
  it.each([
    ['missing companyId', { query: {} }, 400],
    ['personId not a uuid', { body: { personId: 'abc', reasonCode: 'data_subject_request' } }, 400],
    ['free-text reason refused', { body: { personId: PERSON, reasonCode: 'because Jane asked' } }, 400],
    ['reference carrying an address refused', { body: { personId: PERSON, reasonCode: 'data_subject_request', reference: 'jane@example.com' } }, 400],
    ['name-like reference refused (Jane.Doe)', { body: { personId: PERSON, reasonCode: 'data_subject_request', reference: 'Jane.Doe' } }, 400],
    ['name-like reference refused (jane_doe)', { body: { personId: PERSON, reasonCode: 'data_subject_request', reference: 'jane_doe' } }, 400],
    ['reference without a ticket number refused (JANE-DOE)', { body: { personId: PERSON, reasonCode: 'data_subject_request', reference: 'JANE-DOE' } }, 400],
    ['unsupported method', { method: 'DELETE' }, 405],
  ])('%s → %s', async (_l, over, code) => {
    const r = await call(collection, over);
    expect(r.code).toBe(code);
    expect(start).not.toHaveBeenCalled();
  });

  it('the stored reason is the code + reference, nothing else', async () => {
    await call(collection);
    expect(start.mock.calls[0][0].reason).toBe('data_subject_request ref=TICKET-1');
  });

  it('[requestId]: requestId must be a uuid; POST action must be retry', async () => {
    expect((await call(single, { query: { companyId: ORG, requestId: 'x' }, body: { action: 'retry' } })).code).toBe(400);
    expect((await call(single, { body: { action: 'erase-everything' } })).code).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('HTTP mapping — only COMPLETED is a 200 on a write (no false success)', () => {
  it.each([
    ['COMPLETED', 200, false],
    ['IN_PROGRESS', 409, true],
    ['FAILED_REQUIRES_REVIEW', 409, false],
    ['RETRY_REQUIRED', 503, true],
    ['PARTIALLY_COMPLETED', 503, true],
    ['REQUESTED', 503, true],
  ])('%s → %s (retryable %s)', async (status, code, retryable) => {
    start.mockResolvedValue({ kind: 'request', errorCode: status === 'COMPLETED' ? null : 'x', view: view(status) });
    const r = await call(collection);
    expect(r.code).toBe(code);
    expect(r.body.retryable).toBe(retryable);
    expect(r.body.request.status).toBe(status);
  });

  it('missing subject (unknown OR another tenant) → 404 subject_not_found', async () => {
    start.mockResolvedValue({ kind: 'subject_not_found' });
    const r = await call(collection);
    expect(r).toMatchObject({ code: 404, body: { error: 'subject_not_found' } });
  });

  it('duplicate concurrent request → 409 erasure_in_progress', async () => {
    start.mockResolvedValue({ kind: 'request', errorCode: 'erasure_in_progress', view: view('IN_PROGRESS', { personId: PERSON }) });
    const r = await call(collection);
    expect(r).toMatchObject({ code: 409, body: { error: 'erasure_in_progress', retryable: true } });
  });

  it('ledger not deployed → 503 erasure_unavailable (not retryable by the client)', async () => {
    start.mockResolvedValue({ kind: 'ledger_unavailable' });
    expect(await call(collection)).toMatchObject({ code: 503, body: { error: 'erasure_unavailable', retryable: false } });
  });

  it('GET status: unknown or other-tenant request → 404; known → 200 with the view', async () => {
    getOne.mockResolvedValueOnce(null);
    expect((await call(single, { method: 'GET' })).code).toBe(404);
    getOne.mockResolvedValueOnce(view('PARTIALLY_COMPLETED'));
    const r = await call(single, { method: 'GET' });
    expect(r).toMatchObject({ code: 200, body: { request: { status: 'PARTIALLY_COMPLETED' } } });
    expect(getOne.mock.calls[1]).toEqual([ORG, REQ]);
  });

  it('GET list passes the verified tenant and the bounded limit; out-of-range limit → 400', async () => {
    list.mockResolvedValue({ requests: [], inconsistencies: [] });
    expect((await call(collection, { method: 'GET', query: { companyId: ORG, limit: '20' } })).code).toBe(200);
    expect(list.mock.calls[0]).toEqual([ORG, { limit: 20 }]);
    expect((await call(collection, { method: 'GET', query: { companyId: ORG, limit: '5000' } })).code).toBe(400);
  });
});

describe('audit — one event per attempt, keyed by REQUEST id, no personal data', () => {
  it('records the derived status and error code against the request id, never the person id', async () => {
    start.mockResolvedValue({ kind: 'request', errorCode: 'reanchor_failed', view: view('RETRY_REQUIRED', { personId: PERSON }) });
    await call(collection);
    expect(audit).toHaveBeenCalledTimes(1);
    const ev = audit.mock.calls[0][0] as Record<string, unknown>;
    expect(ev).toMatchObject({
      capability: 'prospect.person.erase', decision: 'elevated_ui_action_completed',
      organizationId: ORG, resourceId: REQ, actorUserId: 'u-1', reason: 'person_erasure:RETRY_REQUIRED:reanchor_failed',
    });
    expect(JSON.stringify(ev)).not.toContain(PERSON);
  });

  it('a subject_not_found attempt is still audited (no resource id)', async () => {
    start.mockResolvedValue({ kind: 'subject_not_found' });
    await call(collection);
    expect(audit.mock.calls[0][0]).toMatchObject({ resourceId: null, reason: 'person_erasure:subject_not_found' });
  });

  it('retry is audited the same way', async () => {
    await call(single, { body: { action: 'retry' } });
    expect(retry.mock.calls[0]).toEqual([ORG, REQ, 'erasure-api:company_admin']);
    expect(audit.mock.calls[0][0]).toMatchObject({ resourceId: REQ, reason: 'person_erasure:COMPLETED' });
  });
});


describe('deploy-order gate (review M-1): 503 ERASURE_SCHEMA_NOT_READY, erasePerson never reached', () => {
  it('POST start: schema not ready → 503, not retryable, the service never runs, the attempt is audited', async () => {
    schemaReady.mockResolvedValue(false);
    const r = await call(collection);
    expect(r.code).toBe(503);
    expect(r.body).toEqual({ error: 'ERASURE_SCHEMA_NOT_READY', retryable: false });
    expect(start).not.toHaveBeenCalled();
    expect(order).toEqual(['tenant', 'capability', 'schema']);
    expect(schemaReady).toHaveBeenCalledWith(ORG);
    expect(audit).toHaveBeenCalledTimes(1);
    expect((audit.mock.calls[0][0] as { reason: string }).reason).toBe('person_erasure:schema_not_ready');
  });

  it('POST retry: schema not ready → 503 and the retry (resume) never runs', async () => {
    schemaReady.mockResolvedValue(false);
    const r = await call(single, { body: { action: 'retry' } });
    expect(r.code).toBe(503);
    expect(r.body.error).toBe('ERASURE_SCHEMA_NOT_READY');
    expect(retry).not.toHaveBeenCalled();
  });

  it('the gate runs only for writes, after authorization and validation: GETs and refused requests never probe', async () => {
    list.mockResolvedValue({ requests: [], inconsistencies: [] });
    await call(collection, { method: 'GET' });
    getOne.mockResolvedValue(view('COMPLETED'));
    await call(single, { method: 'GET' });
    await call(collection, { body: { personId: 'abc', reasonCode: 'data_subject_request' } });
    capabilityOk.mockResolvedValue({ ok: false });
    await call(collection);
    expect(schemaReady).not.toHaveBeenCalled();
  });
});
