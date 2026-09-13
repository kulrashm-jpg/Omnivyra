/**
 * Step-up retry × withIdempotency — why the retry after a passkey ceremony
 * must carry a FRESH Idempotency-Key on idempotency-wrapped routes.
 *
 * withIdempotency finalizes every non-5xx response as `completed` and replays
 * it for the same (scope, caller, key). A step-up denial (401 STEP_UP_REQUIRED)
 * is a non-5xx response, so a retry that reuses the denied attempt's key gets
 * the cached denial back and the handler never runs — the operator completes
 * the passkey ceremony and the action still fails.
 *
 * A fresh key per attempt is safe: runStepUpFlowIfNeeded retries only after a
 * step-up denial, and requireCapability denies before the handler performs any
 * write, so the denied attempt never mutated anything. The action therefore
 * mutates exactly once.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../services/requestContext', () => ({
  getOrCreateRequestId: jest.fn(() => 'req-1'),
  runWithRequestContext: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock('super-admin-1'));

import { ownedDbTable } from '../../db/writeOwner';
import { withIdempotency } from '../../middleware/withIdempotency';
import { resetIdempotencyTable, withIdempotencyTable } from '../utils/idempotency';

function makeReqRes(key: string, body: Record<string, unknown>) {
  const req: any = { method: 'POST', headers: { 'idempotency-key': key }, body, query: {} };
  const res: any = {
    statusCode: 0,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(p: unknown) { this.payload = p; return this; },
  };
  return { req, res };
}

describe('step-up retry through withIdempotency', () => {
  let elevated: boolean;
  let mutation: jest.Mock;
  let wrapped: ReturnType<typeof withIdempotency>;
  const body = { email: 'new.user@example.com', companyId: 'company-1', role: 'COMPANY_ADMIN' };

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyTable();
    (ownedDbTable as jest.Mock).mockImplementation(withIdempotencyTable(() => ({})));
    elevated = false;
    mutation = jest.fn();
    // Models a requireCapability-gated handler: denied before any write until
    // the principal holds a fresh step-up session.
    const handler = async (_req: any, res: any) => {
      if (!elevated) return res.status(401).json({ error: 'Step-up required', code: 'STEP_UP_REQUIRED' });
      mutation();
      return res.status(201).json({ ok: true });
    };
    wrapped = withIdempotency(handler as any, { scope: 'super-admin-users-create', methods: ['POST'] });
  });

  it('a retry that REUSES the denied key replays the cached 401 and never reaches the handler', async () => {
    const first = makeReqRes('op-1', body);
    await wrapped(first.req, first.res);
    expect(first.res.statusCode).toBe(401);

    elevated = true; // passkey ceremony succeeded
    const retry = makeReqRes('op-1', body);
    await wrapped(retry.req, retry.res);

    expect(retry.res.statusCode).toBe(401);
    expect((retry.res.payload as any).code).toBe('STEP_UP_REQUIRED');
    expect(mutation).not.toHaveBeenCalled();
  });

  it('a retry with a FRESH key after elevation reaches the handler and mutates exactly once', async () => {
    const first = makeReqRes('op-1', body);
    await wrapped(first.req, first.res);
    expect(first.res.statusCode).toBe(401);
    expect(mutation).not.toHaveBeenCalled();

    elevated = true;
    const retry = makeReqRes('op-1-stepup', body);
    await wrapped(retry.req, retry.res);

    expect(retry.res.statusCode).toBe(201);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('a network-level repeat of the successful attempt still replays instead of mutating twice', async () => {
    elevated = true;
    const attempt = makeReqRes('op-2', body);
    await wrapped(attempt.req, attempt.res);
    const repeat = makeReqRes('op-2', body);
    await wrapped(repeat.req, repeat.res);

    expect(attempt.res.statusCode).toBe(201);
    expect(repeat.res.statusCode).toBe(201);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
