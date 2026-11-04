/**
 * PI-LDB — the mapping APPROVAL endpoint.
 *
 * This route cannot succeed yet: the versioned profile store is owned by the
 * ingestion track and is not delivered. Its value today is that it is the
 * boundary where a browser-supplied destination is checked against the
 * canonical registry, and that boundary is worth having under test before
 * anything can write through it.
 *
 * So the suite asserts two things above all:
 *   1. a destination the browser invented is REFUSED — the check that stops a
 *      client naming an arbitrary field;
 *   2. the missing store FAILS CLOSED with a machine-readable 501, and never
 *      answers 200. A tenant told "mapping saved" who then finds it was not is
 *      worse off than one told plainly that saving is unavailable.
 */

const enforceCompanyAccess = jest.fn();
const requireCapability = jest.fn();

let ingestionEnabled = true;
let tenantGateAllowed = true;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

jest.mock('../../services/leadIngestion/orchestrator', () => ({
  isLeadIngestionEnabled: () => ingestionEnabled,
  resolveLeadIngestionGate: async () => ({ allowed: tenantGateAllowed, reason: 'test' }),
}));

// The idempotency wrapper is DB-backed. Bypassed here so the handler is
// exercised directly — exactly as campaign_release_seam.test.ts does. That the
// wrapper is applied at all is asserted separately below, against the real
// module.
jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: (handler: unknown) => handler,
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler from '../../../pages/api/lead-ingestion/mapping-approval';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-00000000u001';
const FINGERPRINT = 'a'.repeat(64);

type Res = NextApiResponse & {
  _status: number;
  _json: Record<string, unknown>;
  _headers: Record<string, string>;
};

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => {
    (r as Res)._status = c;
    return r as Res;
  }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => {
    (r as Res)._json = b;
    return r as Res;
  }) as Res['json'];
  r.setHeader = ((k: string, v: string) => {
    (r as Res)._headers[k] = v;
    return r as Res;
  }) as unknown as Res['setHeader'];
  return r as Res;
};

const entry = (over: Record<string, unknown> = {}) => ({
  sourceField: 'Email',
  target: 'email',
  transformation: 'lowercase_email',
  decision: 'approved',
  mappingMethod: 'tenant_confirmed',
  ...over,
});

const req = (over: Partial<NextApiRequest> = {}): NextApiRequest =>
  ({
    method: 'POST',
    query: { company_id: ORG_A },
    headers: { 'idempotency-key': 'key-1' },
    body: {
      source: 'csv',
      schemaFingerprint: FINGERPRINT,
      headers: ['Email'],
      entries: [entry()],
    },
    ...over,
  }) as NextApiRequest;

const call = async (r: NextApiRequest = req()) => {
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(r, res);
  return res;
};

/** Convenience: the body with a single overridden entry. */
const withEntry = (over: Record<string, unknown>) =>
  req({
    body: {
      source: 'csv',
      schemaFingerprint: FINGERPRINT,
      headers: ['Email'],
      entries: [entry(over)],
    },
  });

beforeEach(() => {
  ingestionEnabled = true;
  tenantGateAllowed = true;
  enforceCompanyAccess.mockResolvedValue({ userId: USER });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER } });
});

describe('method and gates', () => {
  it('accepts POST only', async () => {
    const res = await call(req({ method: 'DELETE' }));
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
  });

  it('checks the global flag before any membership lookup', async () => {
    ingestionEnabled = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('LEAD_INGESTION_DISABLED');
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it('checks the tenant gate only after authorization', async () => {
    tenantGateAllowed = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(enforceCompanyAccess).toHaveBeenCalled();
    expect(requireCapability).toHaveBeenCalled();
  });

  it('requires the same capability as ingestion, bound to the verified tenant', async () => {
    await call();
    expect(requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ capability: PROSPECT_INGEST, organizationId: ORG_A }),
    );
  });

  it('refuses a tenant named in the body', async () => {
    const res = await call(
      req({
        body: {
          source: 'csv',
          schemaFingerprint: FINGERPRINT,
          headers: ['Email'],
          entries: [entry()],
          organizationId: 'other-org',
        },
      }),
    );
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toContain('organizationId');
  });
});

describe('THE BOUNDARY — a browser cannot name an arbitrary destination', () => {
  it.each([
    'id',
    'qualification_score',
    'canonical_leads.id',
    'password',
    'organizationId',
    'DROP TABLE users',
    '__proto__',
    'Email',
  ])('refuses the invented target %p', async (target) => {
    const res = await call(withEntry({ target }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNKNOWN_TARGET');
  });

  it("accepts 'description', which the ingestion contract now carries", async () => {
    // This replaces its own inverse. The premise it was written against —
    // "`description` is real in the registry and absent from CsvLeadInput" —
    // is false in this tree: `CsvLeadInput = ManualLeadInput`
    // (csvAdapter.ts:67), `ManualLeadInput.description` exists
    // (manualAdapter.ts:105), `toNormalizedManualRecord` reads it
    // (manualAdapter.ts:289) and the orchestrator persists it to
    // `prospect_accounts.description` (orchestrator.ts:207, permitted by
    // ACCOUNT_ATTRIBUTE_COLUMNS). Refusing it would record the opposite of
    // what the pipeline does. Reaching the fail-closed 501 is what proves
    // BOTH destination checks passed — the same proxy the two tests below use.
    const res = await call(withEntry({ target: 'description', transformation: 'none' }));
    expect(res._status).toBe(501);
    expect(res._json.code).toBe('MAPPING_PROFILE_STORE_UNAVAILABLE');
  });

  it('refuses a non-string target', async () => {
    const res = await call(withEntry({ target: 42 }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNKNOWN_TARGET');
  });

  it('accepts a real, submittable registry key', async () => {
    const res = await call(withEntry({ target: 'companyDomain', transformation: 'url_to_domain' }));
    // Reaches the fail-closed refusal, which means validation passed.
    expect(res._status).toBe(501);
  });

  it('accepts a null target as a first-class IGNORE decision', async () => {
    const res = await call(withEntry({ target: null, decision: 'ignored', transformation: 'none' }));
    expect(res._status).toBe(501);
  });
});

describe('enum and consistency validation', () => {
  it('refuses an unrecognised decision', async () => {
    expect((await call(withEntry({ decision: 'maybe' })))._status).toBe(400);
  });

  it('refuses an unrecognised mapping method', async () => {
    expect((await call(withEntry({ mappingMethod: 'vibes' })))._status).toBe(400);
  });

  it('refuses an unrecognised transformation, so a decision cannot become code', async () => {
    const res = await call(withEntry({ transformation: 'eval(payload)' }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNKNOWN_TRANSFORMATION');
  });

  it('refuses an ignored decision that still names a target', async () => {
    const res = await call(withEntry({ decision: 'ignored' }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INCONSISTENT_DECISION');
  });

  it('refuses an approved decision with no target', async () => {
    const res = await call(withEntry({ decision: 'approved', target: null }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INCONSISTENT_DECISION');
  });

  it('refuses a sourceField that is not one of the submitted headers', async () => {
    const res = await call(withEntry({ sourceField: 'Smuggled' }));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNKNOWN_SOURCE_FIELD');
  });

  it('refuses two decisions for one column', async () => {
    const res = await call(
      req({
        body: {
          source: 'csv',
          schemaFingerprint: FINGERPRINT,
          headers: ['Email'],
          entries: [entry(), entry({ target: 'referenceId', transformation: 'trim' })],
        },
      }),
    );
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('DUPLICATE_ENTRY');
  });
});

describe('shape validation', () => {
  it('requires a 64-hex fingerprint, matching the table CHECK', async () => {
    for (const bad of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64)]) {
      const res = await call(
        req({
          body: {
            source: 'csv',
            schemaFingerprint: bad,
            headers: ['Email'],
            entries: [entry()],
          },
        }),
      );
      expect(res._status).toBe(400);
    }
  });

  it('refuses a source outside the allowlist', async () => {
    const res = await call(
      req({
        body: {
          source: 'crm',
          schemaFingerprint: FINGERPRINT,
          headers: ['Email'],
          entries: [entry()],
        },
      }),
    );
    expect(res._status).toBe(400);
  });

  it('refuses empty headers or empty entries', async () => {
    expect(
      (
        await call(
          req({
            body: { source: 'csv', schemaFingerprint: FINGERPRINT, headers: [], entries: [entry()] },
          }),
        )
      )._status,
    ).toBe(400);
    expect(
      (
        await call(
          req({
            body: { source: 'csv', schemaFingerprint: FINGERPRINT, headers: ['Email'], entries: [] },
          }),
        )
      )._status,
    ).toBe(400);
  });

  it('refuses a non-object entry', async () => {
    const res = await call(
      req({
        body: {
          source: 'csv',
          schemaFingerprint: FINGERPRINT,
          headers: ['Email'],
          entries: ['Email'],
        },
      }),
    );
    expect(res._status).toBe(400);
  });
});

describe('FAIL CLOSED — the missing store never answers success', () => {
  it('refuses with 501 and a machine-readable code', async () => {
    const res = await call();
    expect(res._status).toBe(501);
    expect(res._json.code).toBe('MAPPING_PROFILE_STORE_UNAVAILABLE');
  });

  it('never answers 2xx for any valid request', async () => {
    const valid = [
      withEntry({ target: 'email', transformation: 'lowercase_email' }),
      withEntry({ target: null, decision: 'ignored', transformation: 'none' }),
      withEntry({ target: 'companyName', transformation: 'trim', mappingMethod: 'tenant_override' }),
    ];
    for (const r of valid) {
      const res = await call(r);
      expect(res._status).toBeGreaterThanOrEqual(400);
    }
  });

  it('tells the tenant their import is unaffected', async () => {
    const res = await call();
    // The copy matters: this is a missing feature, not a failed import.
    expect(String(res._json.error)).toMatch(/still applies to this import/i);
  });

  it('echoes what WOULD have been saved, so the contract is observable', async () => {
    const res = await call();
    expect(res._json.validated).toEqual({
      source: 'csv',
      schemaFingerprint: FINGERPRINT,
      entryCount: 1,
    });
  });
});

describe('idempotency is actually applied', () => {
  it('wraps the handler, because approving versions a profile', async () => {
    // Asserted against the REAL module rather than the mock above: a retried
    // approval must not create two versions from one decision.
    jest.resetModules();
    // Both parameters, because the real call passes two:
    // `withIdempotency(handler, { scope: 'lead-mapping-approval' })`. A
    // one-parameter double still records the second argument at runtime, so
    // the assertion below passed — but `calls[0][1]` was a type error against
    // a 1-tuple, and nothing in CI typechecks a test file to say so.
    const spy = jest.fn((h: unknown, _options?: unknown) => h);
    jest.doMock('../../middleware/withIdempotency', () => ({ withIdempotency: spy }));
    jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../../../pages/api/lead-ingestion/mapping-approval');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual(
      expect.objectContaining({ scope: 'lead-mapping-approval' }),
    );
  });
});

describe('the TARGET_NOT_SUBMITTABLE boundary is still reachable', () => {
  // WHY THIS EXISTS: `NON_SUBMITTABLE_TARGETS` is now empty, so no REAL
  // canonical key can drive `isSubmittableTarget` to false, and the branch at
  // mapping-approval.ts:240-245 would otherwise have no test at all. Rewriting
  // the `description` case above without this would leave a security-relevant
  // refusal branch at zero coverage. The partition is MOCKED rather than faked
  // in the request, so nothing here claims a real key is blocked; it asserts
  // only that the route still consults the partition and refuses when it says
  // no. Same resetModules/doMock/require idiom as the idempotency test above.
  afterEach(() => {
    jest.dontMock('../../../lib/prospects/import/submittableTargets');
    jest.resetModules();
  });

  it('refuses a canonical key the partition reports as non-carryable', async () => {
    jest.resetModules();
    const real = jest.requireActual<Record<string, unknown>>(
      '../../../lib/prospects/import/submittableTargets',
    );
    jest.doMock('../../../lib/prospects/import/submittableTargets', () => ({
      ...real,
      isSubmittableTarget: (t: string) => t !== 'description',
      nonSubmittableReason: (t: string) =>
        t === 'description' ? 'the ingestion contract has no field for it' : null,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../pages/api/lead-ingestion/mapping-approval');
    const fresh = mod.default as unknown as (
      q: NextApiRequest,
      s: NextApiResponse,
    ) => Promise<void>;

    const res = makeRes();
    await fresh(withEntry({ target: 'description', transformation: 'none' }), res);

    // The REGISTRY check must still have passed — this is the second gate, not
    // the first — and the refusal must be the submittability one.
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('TARGET_NOT_SUBMITTABLE');
    expect(String(res._json.error)).toContain('description');
  });
});
