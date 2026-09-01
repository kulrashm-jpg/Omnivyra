/**
 * D1 — the ICP routes and the capability that governs them.
 *
 * These routes are transport shells over machinery proven elsewhere, so the
 * tests are mostly about what they REFUSE. Two refusals matter most:
 *
 *   1. THE TENANT. `company_id` comes from the authenticated query parameter
 *      and is membership-verified; a body attempting to name a tenant is
 *      rejected outright rather than quietly ignored.
 *   2. THE RATIFIER. It is `guard.principal.userId` and has NO other source. A
 *      body attempting to name one is rejected. That is what makes "an AI model
 *      may never ratify" structural: a model has no session, so it cannot
 *      become the principal, and it cannot pass a ratifier in either.
 */

const enforceCompanyAccess = jest.fn();
const requireCapability = jest.fn();
const ensureIcp = jest.fn();
const createIcpVersion = jest.fn();
const ratifyIcpVersion = jest.fn();
const resolveIcpByKey = jest.fn();

/** The real error type, so `instanceof` in the routes behaves as in production. */
class IcpContractError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'IcpContractError'; }
}

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

jest.mock('../../services/prospectIcp', () => ({
  ensureIcp: (...a: unknown[]) => ensureIcp(...a),
  createIcpVersion: (...a: unknown[]) => createIcpVersion(...a),
  ratifyIcpVersion: (...a: unknown[]) => ratifyIcpVersion(...a),
  resolveIcpByKey: (...a: unknown[]) => resolveIcpByKey(...a),
  IcpContractError,
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import proposeHandler from '../../../pages/api/prospect-icp/propose';
import ratifyHandler from '../../../pages/api/prospect-icp/ratify';
import {
  ALL_CAPABILITIES, CAPABILITY_HIERARCHY, PROSPECT_ICP_MANAGE, PROSPECT_INGEST,
  STEP_UP_REQUIRED_CAPABILITIES,
} from '../../../shared/contracts/security';
import { ROLE_CAPABILITIES, expandWithHierarchy } from '../../security/capabilityRegistry';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ICP_ID = '00000000-0000-4000-8000-0000000000c1';
const USER = 'user-9';

const CRITERIA = [{
  id: 'ind', kind: 'required', subject: 'account', attribute: 'industry',
  predicate: { op: 'one_of', values: ['Software'] },
}];

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown>; _headers: Record<string, string> };

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = ((k: string, v: string) => { (r as Res)._headers[k] = v; return r as Res; }) as unknown as Res['setHeader'];
  return r as Res;
};

const callPropose = async (over: Partial<NextApiRequest> = {}) => {
  const req = {
    method: 'POST', query: { company_id: ORG_A },
    body: { icpKey: 'default', criteria: CRITERIA },
    url: '/api/prospect-icp/propose', ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await proposeHandler(req, res);
  return res;
};

const callRatify = async (over: Partial<NextApiRequest> = {}) => {
  const req = {
    method: 'POST', query: { company_id: ORG_A },
    body: { icpKey: 'default', version: 2 },
    url: '/api/prospect-icp/ratify', ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await ratifyHandler(req, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  enforceCompanyAccess.mockResolvedValue({ authenticated: true, userId: USER });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER } });
  ensureIcp.mockResolvedValue({ icpId: ICP_ID, outcome: 'created' });
  createIcpVersion.mockResolvedValue({ versionId: 'ver-1', version: 1, outcome: 'created' });
  resolveIcpByKey.mockResolvedValue(ICP_ID);
  ratifyIcpVersion.mockResolvedValue({ versionId: 'ver-2', version: 2, supersededVersion: 1 });
});

// ───────────────────────────────────────────────────────────────────────────
describe('prospect.icp.manage — the capability that governs the ICP surface', () => {
  it('is a member of the canonical vocabulary', () => {
    expect(PROSPECT_ICP_MANAGE).toBe('prospect.icp.manage');
    expect(ALL_CAPABILITIES).toContain(PROSPECT_ICP_MANAGE);
  });

  it('is granted to COMPANY_ADMIN and SUPER_ADMIN — exactly as narrowly as PROSPECT_INGEST', () => {
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).toContain(PROSPECT_ICP_MANAGE);
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain(PROSPECT_ICP_MANAGE);

    const holders = (Object.keys(ROLE_CAPABILITIES) as Array<keyof typeof ROLE_CAPABILITIES>)
      .filter((r) => ROLE_CAPABILITIES[r].includes(PROSPECT_ICP_MANAGE)).sort();
    expect(holders).toEqual(['COMPANY_ADMIN', 'SUPER_ADMIN']);

    // Stated as a comparison, so the two grants cannot silently diverge.
    const ingestHolders = (Object.keys(ROLE_CAPABILITIES) as Array<keyof typeof ROLE_CAPABILITIES>)
      .filter((r) => ROLE_CAPABILITIES[r].includes(PROSPECT_INGEST)).sort();
    expect(holders).toEqual(ingestHolders);
  });

  it('is granted to NO other role — VIEW_ONLY above all cannot redefine the ICP', () => {
    for (const role of ['VIEW_ONLY', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'CONTENT_ARCHITECT'] as const) {
      expect(ROLE_CAPABILITIES[role]).not.toContain(PROSPECT_ICP_MANAGE);
    }
  });

  it('has no hierarchy relationship in EITHER direction', () => {
    for (const { parent, child } of CAPABILITY_HIERARCHY) {
      expect(parent).not.toBe(PROSPECT_ICP_MANAGE);
      expect(child).not.toBe(PROSPECT_ICP_MANAGE);
    }
    // Holding it expands into itself and nothing else.
    expect([...expandWithHierarchy([PROSPECT_ICP_MANAGE])]).toEqual([PROSPECT_ICP_MANAGE]);
  });

  it('does NOT imply PROSPECT_INGEST, and is not implied by it', () => {
    // The whole reason this is a separate capability: importing a person and
    // defining who the tenant wants are different authorities, and either may
    // legitimately be held alone.
    expect([...expandWithHierarchy([PROSPECT_ICP_MANAGE])]).not.toContain(PROSPECT_INGEST);
    expect([...expandWithHierarchy([PROSPECT_INGEST])]).not.toContain(PROSPECT_ICP_MANAGE);
  });

  it('is not step-up gated — ratification is a routine, tenant-bounded decision', () => {
    expect([...STEP_UP_REQUIRED_CAPABILITIES]).not.toContain(PROSPECT_ICP_MANAGE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/prospect-icp/propose', () => {
  it('membership is verified FIRST, then the capability, both bound to the query tenant', async () => {
    const res = await callPropose();
    expect(res._status).toBe(200);

    expect(enforceCompanyAccess).toHaveBeenCalledWith(expect.objectContaining({ companyId: ORG_A }));
    expect(requireCapability).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ capability: PROSPECT_ICP_MANAGE, organizationId: ORG_A }),
    );
    // Order matters: a membership failure must stay a membership failure.
    expect(enforceCompanyAccess.mock.invocationCallOrder[0])
      .toBeLessThan(requireCapability.mock.invocationCallOrder[0]);
  });

  it('a membership refusal stops the route before the capability check or any write', async () => {
    enforceCompanyAccess.mockResolvedValue(null);      // wrote its own 401/403
    await callPropose();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(ensureIcp).not.toHaveBeenCalled();
    expect(createIcpVersion).not.toHaveBeenCalled();
  });

  it('a capability refusal stops the route before any write', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    await callPropose();
    expect(ensureIcp).not.toHaveBeenCalled();
    expect(createIcpVersion).not.toHaveBeenCalled();
  });

  it.each(['organizationId', 'organization_id', 'companyId', 'company_id'])(
    "REFUSES a body carrying '%s' rather than ignoring it", async (key) => {
      const res = await callPropose({ body: { icpKey: 'default', criteria: CRITERIA, [key]: ORG_B } });
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toContain(key);
      expect(createIcpVersion).not.toHaveBeenCalled();
    },
  );

  it('passes the VERIFIED tenant to the writer, never one from the body', async () => {
    await callPropose();
    expect(ensureIcp).toHaveBeenCalledWith(ORG_A, 'default', null);
    expect(createIcpVersion).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
  });

  it.each(['ratifiedBy', 'ratified_by', 'ratifiedAt', 'ratified_at'])(
    "REFUSES a body carrying '%s' — proposing is not ratifying", async (key) => {
      const res = await callPropose({ body: { icpKey: 'default', criteria: CRITERIA, [key]: USER } });
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('RATIFICATION_NOT_PERMITTED_HERE');
      expect(createIcpVersion).not.toHaveBeenCalled();
    },
  );

  it.each(['ratified', 'superseded', 'active', 'live'])(
    "refuses status '%s' — a version is never created ratified", async (status) => {
      const res = await callPropose({ body: { icpKey: 'default', criteria: CRITERIA, status } });
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('STATUS_NOT_CREATABLE');
      expect(createIcpVersion).not.toHaveBeenCalled();
    },
  );

  it('defaults to draft, and accepts an explicit draft or proposed', async () => {
    await callPropose();
    expect(createIcpVersion).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));

    for (const status of ['draft', 'proposed'] as const) {
      jest.clearAllMocks();
      createIcpVersion.mockResolvedValue({ versionId: 'v', version: 1, outcome: 'created' });
      ensureIcp.mockResolvedValue({ icpId: ICP_ID, outcome: 'already_present' });
      const res = await callPropose({ body: { icpKey: 'default', criteria: CRITERIA, status } });
      expect(res._status).toBe(200);
      expect(res._json.status).toBe(status);
    }
  });

  it('rejects a non-uuid or absent company_id before the membership lookup', async () => {
    for (const q of [{}, { company_id: 'not-a-uuid' }]) {
      jest.clearAllMocks();
      const res = await callPropose({ query: q as never });
      expect(res._status).toBe(400);
      expect(enforceCompanyAccess).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-POST method', async () => {
    const res = await callPropose({ method: 'GET' });
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
  });

  it('rejects a body that is not an object, and criteria that are not an array', async () => {
    expect((await callPropose({ body: 'nope' as never }))._status).toBe(400);
    expect((await callPropose({ body: { icpKey: 'default', criteria: 'nope' } }))._status).toBe(400);
    expect((await callPropose({ body: { criteria: CRITERIA } }))._status).toBe(400);
  });

  it('surfaces a contract-17 refusal with its stable code, so the caller can fix the criterion', async () => {
    createIcpVersion.mockRejectedValue(
      new IcpContractError("criterion 'sen': 'cxo' outside the closed seniority vocabulary", 'value_outside_vocabulary'),
    );
    const res = await callPropose();
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('value_outside_vocabulary');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/prospect-icp/ratify', () => {
  it('ratifies as the AUTHENTICATED PRINCIPAL, never as a value from the body', async () => {
    const res = await callRatify();
    expect(res._status).toBe(200);
    expect(ratifyIcpVersion).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, icpId: ICP_ID, version: 2, ratifiedByUserId: USER,
    }));
    expect(res._json.ratifiedBy).toBe(USER);
    expect(res._json.supersededVersion).toBe(1);
  });

  it.each(['ratifiedBy', 'ratified_by', 'ratifiedByUserId', 'userId', 'user_id', 'actorId', 'actor_id'])(
    "REFUSES a body carrying '%s' — the ratifier cannot be supplied", async (key) => {
      const res = await callRatify({ body: { icpKey: 'default', version: 2, [key]: 'someone-else' } });
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('RATIFIER_NOT_SUPPLIABLE');
      expect(ratifyIcpVersion).not.toHaveBeenCalled();
    },
  );

  it.each(['organizationId', 'organization_id', 'companyId', 'company_id'])(
    "REFUSES a body carrying '%s'", async (key) => {
      const res = await callRatify({ body: { icpKey: 'default', version: 2, [key]: ORG_B } });
      expect(res._status).toBe(400);
      expect(ratifyIcpVersion).not.toHaveBeenCalled();
    },
  );

  it('an UNAUTHORIZED principal cannot ratify — the capability gate stops the write', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    await callRatify();
    expect(resolveIcpByKey).not.toHaveBeenCalled();
    expect(ratifyIcpVersion).not.toHaveBeenCalled();
  });

  it('a NON-MEMBER cannot ratify — membership is checked before the capability', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    await callRatify();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(ratifyIcpVersion).not.toHaveBeenCalled();
  });

  it('a principal with no user id cannot ratify — an AI model has none', async () => {
    // Unreachable through the real requireCapability, which resolves a genuine
    // principal. Asserted anyway: a ratification with no ratifier must never be
    // written, whatever produced the principal.
    requireCapability.mockResolvedValue({ ok: true, principal: { userId: null } });
    const res = await callRatify();
    expect(res._status).toBe(403);
    expect(res._json.code).toBe('RATIFIER_UNRESOLVED');
    expect(ratifyIcpVersion).not.toHaveBeenCalled();
  });

  it('cross-tenant ratification is refused: the ICP is resolved WITHIN the verified tenant', async () => {
    resolveIcpByKey.mockResolvedValue(null);        // ORG_A holds no such ICP
    const res = await callRatify();
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('ICP_NOT_FOUND');
    expect(resolveIcpByKey).toHaveBeenCalledWith(ORG_A, 'default');
    expect(ratifyIcpVersion).not.toHaveBeenCalled();
  });

  it.each([
    ['already_ratified', 409],
    ['version_superseded', 409],
    ['concurrent_ratification', 409],
    ['ratification_raced', 409],
    ['version_not_found', 404],
    ['ratifier_required', 400],
  ])('maps the %s lifecycle outcome to HTTP %i', async (code, status) => {
    ratifyIcpVersion.mockRejectedValue(new IcpContractError('nope', code));
    const res = await callRatify();
    expect(res._status).toBe(status);
    expect(res._json.code).toBe(code);
  });

  it('rejects a missing or non-integer version, and a missing icpKey', async () => {
    for (const body of [
      { icpKey: 'default' },
      { icpKey: 'default', version: 0 },
      { icpKey: 'default', version: 1.5 },
      { icpKey: 'default', version: '2' },
      { version: 2 },
    ]) {
      jest.clearAllMocks();
      const res = await callRatify({ body: body as never });
      expect(res._status).toBe(400);
      expect(ratifyIcpVersion).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-POST method and a non-uuid tenant', async () => {
    expect((await callRatify({ method: 'DELETE' }))._status).toBe(405);
    jest.clearAllMocks();
    const res = await callRatify({ query: { company_id: 'nope' } as never });
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });
});
