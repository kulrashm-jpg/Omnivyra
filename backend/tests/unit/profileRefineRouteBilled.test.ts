/**
 * e9 2026-11-13: POST /api/company-profile/refine (the manual refine) is ONE billed 'profile_refine' unit through
 * wirePhase2Route; an enforced refusal is a 402, never a 500 and never a free refine. Also: getProfile's auto refine
 * goes through the billed helper, and a skipped (unpaid) refine returns the UNREFINED profile.
 */
const mockWire = jest.fn();
jest.mock('../../services/billing/phase2RouteWiring', () => ({ wirePhase2Route: (a: unknown) => mockWire(a) }));
const mockRefine = jest.fn(async () => ({ profile: { company_id: 'c-1', name: 'R' }, details: {} }));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => ({ company_id: 'c-1', name: 'P', website_url: null })),
  refineProfileWithAIWithDetails: (...a: unknown[]) => (mockRefine as any)(...a),
  saveProfile: jest.fn(async (p: unknown) => p),
  toLimitedCompanyProfile: jest.fn(() => null),
}));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: jest.fn(async () => ({ userId: 'u-1', role: 'CONTENT_CREATOR' })) }));
jest.mock('../../db/supabaseClient', () => {
  const b: any = {};
  for (const m of ['select', 'eq', 'maybeSingle', 'single', 'update', 'limit']) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return { supabase: { from: () => b } };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
export {};
const route = require('../../../pages/api/company-profile/refine').default;
const { PaymentRequiredError } = jest.requireActual('../../services/billing/phase2EnforcementGate');
/* eslint-enable @typescript-eslint/no-var-requires */

async function post() {
  const out = { code: 0, body: null as any };
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; }, setHeader: () => res };
  await route({ method: 'POST', query: { companyId: 'c-1' }, body: { companyId: 'c-1' }, headers: {} }, res);
  return out;
}

beforeEach(() => { mockWire.mockReset(); mockRefine.mockClear(); });

it('the manual refine runs INSIDE wirePhase2Route as one profile_refine unit', async () => {
  mockWire.mockImplementation(async (a: { run: () => Promise<unknown> }) => a.run());
  const r = await post();
  expect(r.code).toBe(200);
  expect(mockWire).toHaveBeenCalledTimes(1);
  expect(mockWire.mock.calls[0][0]).toMatchObject({
    surface: 'company-profile.refine', organizationId: 'c-1', userId: 'u-1', action: 'profile_refine', referenceType: 'profile_refine',
  });
  expect(mockRefine).toHaveBeenCalledTimes(1);
});

it('an enforced refusal is 402 INSUFFICIENT_CREDITS and NO refine ran', async () => {
  mockWire.mockRejectedValue(new PaymentRequiredError('company-profile.refine', 'insufficient'));
  const r = await post();
  expect([r.code, r.body.code]).toEqual([402, 'INSUFFICIENT_CREDITS']);
  expect(mockRefine).not.toHaveBeenCalled();
});
