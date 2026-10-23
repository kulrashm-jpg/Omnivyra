/**
 * Fix 3 retention follow-up — `GET /api/content/approval-history` authorization.
 *
 * WHY THIS MATTERS MORE THAN THE PER-CONTENT ROUTE.
 * `/api/content/:id/approval` proves tenancy TWICE: `enforceCompanyAccess`, and
 * then loading the content row with `getContent(id, companyId)`. A retained
 * audit row has `content_id = NULL`, so there is no content row left to prove
 * ownership against — `enforceCompanyAccess` is the ONLY tenant control on this
 * path. These tests therefore assert the gate ORDER and the side-effect
 * boundary, not just status codes: an unauthorized caller must never reach the
 * history service at all.
 *
 * Owner decision D1 adds the existing CONTENT_WRITE_ROLES capability on top of
 * membership, deliberately stricter than the per-content route's membership-only
 * GET, because this endpoint exposes every approval decision, actor and note
 * across all of a company's content including deleted content.
 *
 * MOCKED. The two authorization helpers are stubbed so each outcome is
 * deterministic. This proves the route's wiring and ordering — NOT that
 * `enforceCompanyAccess`, RBAC or RLS behave correctly at runtime.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import type { NextApiRequest, NextApiResponse } from 'next';

const CO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Scripted outcome of enforceCompanyAccess for the next request. */
type AccessOutcome =
  | { kind: 'allow' }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'missingCompany' }
  | { kind: 'lookupError' };

let accessOutcome: AccessOutcome = { kind: 'allow' };
let capabilityAllowed = true;
let allowedCompany: string = CO_A;

const enforceCompanyAccess = jest.fn(
  async (input: { res: NextApiResponse; companyId?: string | null }) => {
    if (accessOutcome.kind === 'unauthenticated') {
      input.res.status(401).json({ error: 'Authentication required. Please sign in again.', code: 'UNAUTHENTICATED' });
      return null;
    }
    if (!input.companyId) {
      input.res.status(400).json({ error: 'companyId required' });
      return null;
    }
    if (accessOutcome.kind === 'missingCompany') {
      input.res.status(400).json({ error: 'companyId required' });
      return null;
    }
    if (accessOutcome.kind === 'lookupError') {
      input.res.status(503).json({ error: 'Membership check is temporarily unavailable. Please try again.', code: 'TENANT_LOOKUP_ERROR', retryable: true });
      return null;
    }
    // A denial is identical whether the company does not exist or simply is not
    // the caller's — the real helper emits this same body for both.
    if (accessOutcome.kind === 'forbidden' || input.companyId !== allowedCompany) {
      input.res.status(403).json({ error: 'Access denied to company' });
      return null;
    }
    return { userId: 'user-1', role: 'user', companyIds: [allowedCompany] };
  },
);
jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (enforceCompanyAccess as any)(...a),
}));

const enforceContentWriteRole = jest.fn(async (input: { res: NextApiResponse }) => {
  if (capabilityAllowed) return true;
  input.res.status(403).json({ error: 'Insufficient role', code: 'ROLE_REQUIRED' });
  return false;
});
jest.mock('@/backend/services/content/contentWriteAuthz', () => ({
  CONTENT_WRITE_ROLES: ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'SUPER_ADMIN'],
  enforceContentWriteRole: (...a: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (enforceContentWriteRole as any)(...a),
}));

/** The service sink — the side-effect boundary these tests guard. */
let serviceBehaviour: 'ok' | 'queryFailure' = 'ok';
const getCompanyApprovalHistory = jest.fn(async (companyId: string, q?: Record<string, unknown>) => {
  if (serviceBehaviour === 'queryFailure') {
    const err = new Error('Failed to load company approval history') as Error & { status: number; code: string };
    err.status = 500;
    err.code = 'HISTORY_QUERY_FAILED';
    throw err;
  }
  return {
    items: [],
    page: (q?.page as number) ?? 0,
    pageSize: (q?.pageSize as number) ?? 50,
    hasMore: false,
    scope: (q?.scope as string) ?? 'orphaned',
    __companyId: companyId,
  };
});
jest.mock('@/backend/services/content/approvalService', () => ({
  getCompanyApprovalHistory: (...a: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getCompanyApprovalHistory as any)(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../../../pages/api/content/approval-history').default;

function invoke(opts: { method?: string; query?: Record<string, string> } = {}) {
  const res: Record<string, unknown> = {};
  const captured: { status: number | null; body: unknown; headers: Record<string, string> } = {
    status: null, body: undefined, headers: {},
  };
  res.status = (code: number) => { captured.status = code; return res; };
  res.json = (body: unknown) => { captured.body = body; return res; };
  res.setHeader = (k: string, v: string) => { captured.headers[k] = v; return res; };
  res.end = () => res;

  const req = {
    method: opts.method ?? 'GET',
    url: '/api/content/approval-history',
    query: opts.query ?? { companyId: CO_A },
    headers: {},
    body: undefined,
  } as unknown as NextApiRequest;

  return route(req, res as unknown as NextApiResponse).then(() => captured);
}

beforeEach(() => {
  accessOutcome = { kind: 'allow' };
  capabilityAllowed = true;
  allowedCompany = CO_A;
  serviceBehaviour = 'ok';
  enforceCompanyAccess.mockClear();
  enforceContentWriteRole.mockClear();
  getCompanyApprovalHistory.mockClear();
});

describe('authorized access', () => {
  it('200 for an active member holding a CONTENT_WRITE_ROLES role', async () => {
    const r = await invoke();

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('history');
    expect(getCompanyApprovalHistory).toHaveBeenCalledTimes(1);
  });

  it('queries with the server-authorized company id', async () => {
    await invoke({ query: { companyId: CO_A } });

    expect(getCompanyApprovalHistory).toHaveBeenCalledWith(CO_A, expect.objectContaining({ scope: 'orphaned' }));
  });

  it('defaults scope to orphaned when unspecified', async () => {
    await invoke({ query: { companyId: CO_A } });

    expect(getCompanyApprovalHistory).toHaveBeenCalledWith(CO_A, expect.objectContaining({ scope: 'orphaned' }));
  });

  it('passes scope=all only when explicitly requested', async () => {
    await invoke({ query: { companyId: CO_A, scope: 'all' } });

    expect(getCompanyApprovalHistory).toHaveBeenCalledWith(CO_A, expect.objectContaining({ scope: 'all' }));
  });
});

describe('authentication and membership', () => {
  it('401 when unauthenticated, and the service is never called', async () => {
    accessOutcome = { kind: 'unauthenticated' };

    const r = await invoke();

    expect(r.status).toBe(401);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('403 for an authenticated non-member, and the service is never called', async () => {
    accessOutcome = { kind: 'forbidden' };

    const r = await invoke();

    expect(r.status).toBe(403);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('403 when a member of company A requests company B', async () => {
    allowedCompany = CO_A;

    const r = await invoke({ query: { companyId: CO_B } });

    expect(r.status).toBe(403);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('denies inactive membership', async () => {
    // An inactive row is not an active member; the helper denies it.
    accessOutcome = { kind: 'forbidden' };

    const r = await invoke();

    expect(r.status).toBe(403);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('fails closed on a membership lookup failure — never 200', async () => {
    accessOutcome = { kind: 'lookupError' };

    const r = await invoke();

    expect(r.status).toBe(503);
    expect(r.status).not.toBe(200);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('the forbidden body does not reveal whether the company exists', async () => {
    accessOutcome = { kind: 'forbidden' };
    const nonMember = await invoke({ query: { companyId: CO_B } });

    allowedCompany = CO_A;
    accessOutcome = { kind: 'allow' };
    const nonExistent = await invoke({ query: { companyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });

    expect(nonMember.status).toBe(403);
    expect(nonExistent.status).toBe(403);
    expect(nonMember.body).toEqual(nonExistent.body);
  });
});

describe('capability gate (D1)', () => {
  it('403 for a member without a content role, including view-only', async () => {
    capabilityAllowed = false;

    const r = await invoke();

    expect(r.status).toBe(403);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('runs the capability gate after membership and before the service', async () => {
    await invoke();

    expect(enforceCompanyAccess).toHaveBeenCalledTimes(1);
    expect(enforceContentWriteRole).toHaveBeenCalledTimes(1);
    const membershipOrder = enforceCompanyAccess.mock.invocationCallOrder[0];
    const capabilityOrder = enforceContentWriteRole.mock.invocationCallOrder[0];
    const serviceOrder = getCompanyApprovalHistory.mock.invocationCallOrder[0];
    expect(membershipOrder).toBeLessThan(capabilityOrder);
    expect(capabilityOrder).toBeLessThan(serviceOrder);
  });

  it('does not run the capability gate when membership already failed', async () => {
    accessOutcome = { kind: 'forbidden' };

    await invoke();

    expect(enforceContentWriteRole).not.toHaveBeenCalled();
  });
});

describe('parameter validation', () => {
  it('400 when companyId is missing', async () => {
    const r = await invoke({ query: {} });

    expect(r.status).toBe(400);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('400 for a malformed page', async () => {
    const r = await invoke({ query: { companyId: CO_A, page: '-1' } });

    expect(r.status).toBe(400);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('400 for a malformed pageSize', async () => {
    expect((await invoke({ query: { companyId: CO_A, pageSize: 'abc' } })).status).toBe(400);
    expect((await invoke({ query: { companyId: CO_A, pageSize: '0' } })).status).toBe(400);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('400 for an unknown scope', async () => {
    const r = await invoke({ query: { companyId: CO_A, scope: 'everything' } });

    expect(r.status).toBe(400);
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('validates parameters only AFTER authorization, so 400-vs-403 cannot probe tenancy', async () => {
    accessOutcome = { kind: 'forbidden' };

    // Deliberately invalid params on an unauthorized company: the response must
    // be the authorization denial, not a parameter hint.
    const r = await invoke({ query: { companyId: CO_B, page: 'nonsense' } });

    expect(r.status).toBe(403);
  });
});

describe('method handling and query failures', () => {
  it('405 with an Allow header for a non-GET method', async () => {
    const r = await invoke({ method: 'POST' });

    expect(r.status).toBe(405);
    expect(r.headers.Allow).toBe('GET');
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(getCompanyApprovalHistory).not.toHaveBeenCalled();
  });

  it('500 on a history query failure — never a 200 empty page', async () => {
    serviceBehaviour = 'queryFailure';

    const r = await invoke();

    expect(r.status).toBe(500);
    expect(r.status).not.toBe(200);
    expect(r.body).not.toHaveProperty('history');
  });

  it('the 500 body carries no driver or SQL detail', async () => {
    serviceBehaviour = 'queryFailure';

    const r = await invoke();

    expect(JSON.stringify(r.body)).not.toMatch(/permission denied|relation|select|postgres/i);
  });
});
