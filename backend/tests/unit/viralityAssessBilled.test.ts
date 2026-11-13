/**
 * e1 2026-11-13 (C75, BLOCKING money): POST /api/campaigns/:id/virality/assess is a PAID insight (featureRegistry maps
 * its 5 operations to insight_generation, requires_credit_hold) and ran UNCHARGED. It now runs as ONE billed unit
 * through wirePhase2Route (token-metered: hold the prescribed max, settle the actual usage of all 5 calls).
 */
const mockWire = jest.fn();
jest.mock('../../services/billing/phase2RouteWiring', () => {
  const actual = jest.requireActual('../../services/billing/phase2RouteWiring');
  return { ...actual, wirePhase2Route: (a: unknown) => mockWire(a) };
});
const mockAssess = jest.fn(async () => ({ score: 7 }));
jest.mock('../../services/viralityAdvisorService', () => ({ assessVirality: (...a: unknown[]) => (mockAssess as any)(...a) }));
jest.mock('../../services/viralitySnapshotBuilder', () => ({
  buildCampaignSnapshotWithHash: async () => ({ snapshot: { s: 1 }, snapshot_hash: 'h1' }),
}));
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: async () => ({ userId: 'u-1', companyId: 'org-1', campaignId: 'c-1' }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
// A MODULE, not a global script (83 CI-363 TS2451: a top-level `const route` collided with a6EnrichRoute.test.ts).
export {};
const route = require('../../../pages/api/campaigns/[id]/virality/assess').default;
const { BilledRoutePaymentRequiredError, BilledRouteAlreadyProcessedError } = jest.requireActual('../../services/billing/phase2RouteWiring');
/* eslint-enable @typescript-eslint/no-var-requires */

async function post() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await route({ method: 'POST', query: { id: 'c-1' }, headers: {}, body: {} }, res);
  return res;
}

beforeEach(() => { mockWire.mockReset(); mockAssess.mockClear(); });

it('the assessment runs INSIDE wirePhase2Route as insight_generation, keyed by campaign + snapshot', async () => {
  mockWire.mockImplementation(async (a: { run: () => Promise<unknown> }) => a.run());
  const r = await post();
  expect([r.statusCode, r.body]).toEqual([200, { score: 7 }]);
  expect(mockWire).toHaveBeenCalledTimes(1);
  expect(mockWire.mock.calls[0][0]).toMatchObject({
    surface: 'campaigns.virality.assess', organizationId: 'org-1', userId: 'u-1',
    action: 'insight_generation', referenceType: 'virality_assessment', referenceId: 'virality:c-1:h1',
  });
  expect(mockAssess).toHaveBeenCalledTimes(1);
});

it('insufficient credits -> 402 INSUFFICIENT_CREDITS with required/balance, and NO assessment ran', async () => {
  mockWire.mockRejectedValue(new BilledRoutePaymentRequiredError('campaigns.virality.assess', 'INSUFFICIENT_CREDITS', 17, 3));
  const r = await post();
  expect([r.statusCode, r.body.code, r.body.required, r.body.balance]).toEqual([402, 'INSUFFICIENT_CREDITS', 17, 3]);
  expect(mockAssess).not.toHaveBeenCalled();
});

it('an already-charged identical request -> 409 ALREADY_PROCESSED (not a free re-run)', async () => {
  mockWire.mockRejectedValue(new BilledRouteAlreadyProcessedError('campaigns.virality.assess'));
  const r = await post();
  expect([r.statusCode, r.body.code]).toEqual([409, 'ALREADY_PROCESSED']);
  expect(mockAssess).not.toHaveBeenCalled();
});

it('control: an unrelated failure keeps the route\'s own 500', async () => {
  mockWire.mockRejectedValue(new Error('boom'));
  const r = await post();
  expect(r.statusCode).toBe(500);
});
