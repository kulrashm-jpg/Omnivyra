/**
 * requireCapabilityUniform (e9, 2026-11-12): a capability DENIAL (403) becomes the byte-identical
 * UNIFORM_NOT_FOUND 404; 401 (unauthenticated / step-up) and any other status pass through with
 * their body and headers; an allow passes the principal through untouched.
 */
export {};
let mockOutcome: { status?: number; body?: unknown; header?: [string, string]; ok?: boolean } = {};
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: unknown, res: any) => {
    if (mockOutcome.ok) return { ok: true, principal: { userId: 'u1' } };
    if (mockOutcome.header) res.setHeader(mockOutcome.header[0], mockOutcome.header[1]);
    res.status(mockOutcome.status).json(mockOutcome.body);
    return { ok: false, sent: true };
  },
}));
import { requireCapabilityUniform } from '../../security/requireCapabilityUniform';
import { UNIFORM_NOT_FOUND } from '../../services/userContextService';

function resStub() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  return r;
}
const OPTS = { capability: 'organization.manage', organizationId: 'org', reason: 't' } as any;

it('a 403 denial -> the uniform 404 body', async () => {
  mockOutcome = { status: 403, body: { error: 'Forbidden', code: 'CAPABILITY_DENIED' }, header: ['x-omnivyra-correlation-id', 'c1'] };
  const res = resStub();
  const r = await requireCapabilityUniform({} as any, res, OPTS);
  expect(r).toEqual({ ok: false, sent: true });
  expect(res.statusCode).toBe(404);
  expect(JSON.stringify(res.body)).toBe(JSON.stringify(UNIFORM_NOT_FOUND));
  expect(res.headers).toEqual({}); // nothing from the denial leaks into the uniform answer
});

it('401 STEP_UP_REQUIRED passes through verbatim, headers included (a challenge stays visible)', async () => {
  mockOutcome = { status: 401, body: { code: 'STEP_UP_REQUIRED' }, header: ['x-omnivyra-correlation-id', 'c2'] };
  const res = resStub();
  await requireCapabilityUniform({} as any, res, OPTS);
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ code: 'STEP_UP_REQUIRED' });
  expect(res.headers['x-omnivyra-correlation-id']).toBe('c2');
});

it('an allow returns the principal and writes nothing', async () => {
  mockOutcome = { ok: true };
  const res = resStub();
  const r = await requireCapabilityUniform({} as any, res, OPTS);
  expect(r).toEqual({ ok: true, principal: { userId: 'u1' } });
  expect(res.statusCode).toBe(0);
});
