/**
 * Trim mismatch (pre-launch): /api/planner/chat-themes checked access on companyId.trim() but grounded and BILLED
 * (wirePhase2Route organizationId + key) on the raw value. One normalized id must reach all three.
 */
const seen: { access: string[]; grounding: string[]; billedOrg: string[] } = { access: [], grounding: [], billedOrg: [] };
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async ({ companyId }: { companyId: string }) => { seen.access.push(companyId); return { userId: 'u1' }; },
}));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveCompanyGroundingGuard: async (id: string) => { seen.grounding.push(id); return { directive: '' }; },
}));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: async () => ({ output: '{"themes":[]}' }) }));
jest.mock('../../services/billing/phase2RouteWiring', () => ({
  wirePhase2Route: async (o: { organizationId: string; run: () => Promise<unknown> }) => { seen.billedOrg.push(o.organizationId); return o.run(); },
}));

import handler from '../../../pages/api/planner/chat-themes';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

describe('chat-themes: one normalized companyId', () => {
  beforeEach(() => { seen.access.length = 0; seen.grounding.length = 0; seen.billedOrg.length = 0; });
  it('a padded companyId reaches access, grounding and billing as the SAME trimmed id', async () => {
    const res = mockRes();
    await (handler as any)({ method: 'POST', body: { companyId: '  co-1  ', message: 'More themes please' }, headers: {}, query: {} }, res);
    expect(seen.access).toEqual(['co-1']);
    expect(seen.grounding).toEqual(['co-1']);
    expect(seen.billedOrg).toEqual(['co-1']);
  });
  it('a blank companyId -> 400', async () => {
    const res = mockRes();
    await (handler as any)({ method: 'POST', body: { companyId: '   ', message: 'x' }, headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(seen.access).toHaveLength(0);
  });
});
