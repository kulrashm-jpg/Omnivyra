/**
 * A6 — the `POST /api/prospects/:id/enrich` transport shell.
 *
 * The route is an entry point, not a second executor: it resolves the tenant,
 * validates input, and hands off to `executeProspectEnrichment`. These tests
 * hold exactly that — reachability, the existing validation/authorization
 * taxonomy, and delegation to the canonical entry point with the tenant and the
 * caller's named attribute carried through unchanged.
 *
 * The executor itself is covered by `a6ExecutorBoundary.test.ts`. Here it is
 * mocked, so no provider transport, no port composition and no database read
 * occurs — a route test that reached a provider would be testing the wrong
 * thing and spending real quota to do it.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// The shared route wrapper is infrastructure with its own coverage; identity
// here keeps the assertions on this route's own behaviour.
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (handler: unknown) => handler,
}));

const tenantOk = jest.fn(async () => ({ userId: 'u-1', companyId: 'co-1' }));
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...args: unknown[]) => tenantOk(...(args as [])),
}));

// OD-A / PI-ADR-007 — the capability gate. A SECOND fake beside the tenant one,
// not a replacement: membership and capability answer different questions and
// the route asks both, so a test that could not fail one independently of the
// other could not prove the gate exists at all.
const capabilityOk = jest.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...args: unknown[]) => capabilityOk(...(args as [])),
}));

const execute = jest.fn(async () => ({ status: 'not_planned', reason: 'stub' }));
jest.mock('../../apiHandlers/prospects/prospectIntelligenceRead', () => ({
  executeProspectEnrichment: (...args: unknown[]) => execute(...(args as [])),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../../../pages/api/prospects/[id]/enrich').default as
  (req: unknown, res: unknown) => Promise<unknown>;

type Captured = { code: number | null; body: unknown; allow: string | null };

const call = async (over: Record<string, unknown> = {}) => {
  const captured: Captured = { code: null, body: null, allow: null };
  const res = {
    status(code: number) { captured.code = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(name: string, value: string) { if (name === 'Allow') captured.allow = value; },
  };
  const req = {
    method: 'POST',
    query: { companyId: 'co-1', id: 'prospect-1' },
    body: { attribute: 'employee_count', subject: 'account' },
    ...over,
  };
  await route(req, res);
  return captured;
};

beforeEach(() => {
  jest.clearAllMocks();
  tenantOk.mockImplementation(async () => ({ userId: 'u-1', companyId: 'co-1' }));
  capabilityOk.mockImplementation(async () => ({ ok: true }));
  execute.mockImplementation(async () => ({ status: 'not_planned', reason: 'stub' }));
});

describe('A6 / OD-A — spending requires PROSPECT_ENRICH_EXECUTE', () => {
  // Before OD-A this route was membership-only. `requireTenantAccess` filters by
  // role only when `requireRoleIn` is supplied and no PI route supplies it, so
  // every active member at any of the seven canonical roles — VIEW_ONLY included
  // — could cause a real, billable provider call, while importing one prospect
  // required admin-tier PROSPECT_INGEST. PI-ADR-007 closes that asymmetry.

  it('demands the capability, bound to the VERIFIED tenant id', async () => {
    await call();
    expect(capabilityOk).toHaveBeenCalledTimes(1);
    const [, , opts] = capabilityOk.mock.calls[0] as unknown as [unknown, unknown, {
      capability: string; organizationId: string; reason?: string;
    }];
    expect(opts.capability).toBe('prospect.enrich.execute');
    expect(opts.organizationId).toBe('co-1');
  });

  it('a principal without the capability never reaches the executor', async () => {
    capabilityOk.mockImplementation(async () => ({ ok: false }));
    await call();
    // The property that matters is not the status code — requireCapability
    // writes that itself — but that NO billable path was entered.
    expect(execute).not.toHaveBeenCalled();
  });

  it('membership is evaluated BEFORE the capability', async () => {
    // Anti-vacuity: with no gate at all this assertion would pass trivially,
    // because a capability that is never consulted is also never consulted on
    // the denied path. So prove it IS consulted normally, first.
    await call();
    expect(capabilityOk).toHaveBeenCalledTimes(1);
    capabilityOk.mockClear();
    execute.mockClear();

    tenantOk.mockImplementation(async () => null as unknown as { userId: string; companyId: string });
    await call();
    expect(capabilityOk).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('a body-supplied companyId cannot redirect the capability check', async () => {
    await call({ body: { attribute: 'employee_count', subject: 'account', companyId: 'co-OTHER' } });
    const [, , opts] = capabilityOk.mock.calls[0] as unknown as [unknown, unknown, { organizationId: string }];
    expect(opts.organizationId).toBe('co-1');
  });

  it('an authorized principal still reaches the executor — the gate is not a block', async () => {
    const { code } = await call();
    expect(code).toBe(200);
    expect(capabilityOk).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('A6 — POST /api/prospects/[id]/enrich', () => {
  describe('reachability and delegation', () => {
    it('is reachable and answers 200', async () => {
      const { code } = await call();
      expect(code).toBe(200);
    });

    it('delegates to the canonical entry point exactly once', async () => {
      await call();
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('carries the tenant, prospect and the CALLER-NAMED attribute through unchanged', async () => {
      await call();
      const arg = (execute.mock.calls[0] as unknown as Array<Record<string, unknown>>)[0];
      expect(arg.organizationId).toBe('co-1');
      expect(arg.prospectId).toBe('prospect-1');
      expect(arg.attribute).toBe('employee_count');
      expect(arg.subject).toBe('account');
      expect(typeof arg.now).toBe('string');
    });

    it('orchestrates nothing itself — the result is returned verbatim', async () => {
      execute.mockImplementation(async () => ({ status: 'executed', execution: { outcome: 'duplicate_suppressed' } } as never));
      const { body } = await call();
      expect(body).toEqual({ status: 'executed', execution: { outcome: 'duplicate_suppressed' } });
    });
  });

  describe('authorization and validation, using the existing conventions', () => {
    it('rejects a non-POST method with 405 and an Allow header', async () => {
      const { code, allow } = await call({ method: 'GET' });
      expect(code).toBe(405);
      expect(allow).toBe('POST');
      expect(execute).not.toHaveBeenCalled();
    });

    it('requires companyId', async () => {
      const { code } = await call({ query: { id: 'prospect-1' } });
      expect(code).toBe(400);
      expect(execute).not.toHaveBeenCalled();
    });

    it('stops when tenant access is refused, and never executes', async () => {
      // The guard writes its own response and returns null; the route must not
      // proceed to spend a tenant's provider quota after a refused membership.
      tenantOk.mockImplementation(async () => null as never);
      await call();
      expect(execute).not.toHaveBeenCalled();
    });

    it('requires an attribute and a valid subject', async () => {
      expect((await call({ body: { subject: 'account' } })).code).toBe(400);
      expect((await call({ body: { attribute: 'employee_count' } })).code).toBe(400);
      expect((await call({ body: { attribute: 'employee_count', subject: 'company' } })).code).toBe(400);
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses an unparseable asOf rather than silently using now', async () => {
      const { code } = await call({ body: { attribute: 'employee_count', subject: 'account', asOf: 'not-a-date' } });
      expect(code).toBe(400);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('the executor taxonomy is preserved, not reinterpreted', () => {
    it('reports an unreadable prospect as 404, never as a server error', async () => {
      execute.mockImplementation(async () => { throw new Error('prospect p-1 not found in tenant co-1'); });
      const { code, body } = await call();
      expect(code).toBe(404);
      expect(body).toEqual({ error: 'prospect_not_found' });
    });

    it('reports an infrastructure failure as a retryable 503', async () => {
      execute.mockImplementation(async () => { throw new Error('source_assertions read failed'); });
      const { code, body } = await call();
      expect(code).toBe(503);
      expect(body).toMatchObject({ error: 'prospect_enrichment_unavailable', retryable: true });
    });

    it('does not convert a declining outcome into an error', async () => {
      // `credential_missing` is a successful execution that correctly declined
      // to spend. Mapping it to 4xx/5xx would make a refusal look like a fault.
      execute.mockImplementation(async () => ({ status: 'executed', execution: { outcome: 'credential_missing' } } as never));
      const { code } = await call();
      expect(code).toBe(200);
    });
  });
});
