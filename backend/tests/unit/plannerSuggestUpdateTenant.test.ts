/**
 * POST /api/campaigns/planner/suggest-update - S2 tenant seam (two-id sweep UNBOUND-READ, 2026-11-13).
 *
 * THE DEFECT: the route authorized the caller for company A (enforceCompanyAccess) and then read
 * engagement_opportunities by insight_id ALONE. Company B's opportunity text went into the LLM prompt and the derived
 * suggestion was returned to A (and charged to A). Also: the company grounding was read BEFORE the access check, and
 * companyId fell back to campaignId.
 *
 * The Supabase fake is FAITHFUL (a row matches only when every eq filter matches; the seam adds organization_id).
 * Authorization itself (enforceCompanyAccess) and the LLM are faked: this suite tests the binding, not those.
 */
type Row = Record<string, unknown>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const CAMP_A = 'c0c00000-0000-4000-8000-0000000000a1';
const OPP_A = 'c0d00000-0000-4000-8000-0000000000a1';
const OPP_B = 'c0d00000-0000-4000-8000-0000000000b1';

let tables: Record<string, Row[]> = {};
const calls: string[] = [];
const prompts: string[] = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  const q: any = {};
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
  q.limit = () => q;
  q.maybeSingle = async () => { calls.push(`read:${table}`); return { data: rows()[0] ?? null, error: null }; };
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t), ownedDbRpc: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  // The caller is a member of company A only (and A owns CAMP_A). Real authorization is not what this suite tests.
  enforceCompanyAccess: jest.fn(async ({ res, companyId, campaignId }: any) => {
    calls.push(`access:${companyId}`);
    if (companyId === CO_A && campaignId === CAMP_A) return { userId: 'u-1' };
    res.status(403).json({ error: 'Access denied' });
    return null;
  }),
}));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveCompanyGroundingGuard: jest.fn(async (companyId: string) => { calls.push(`grounding:${companyId}`); return { directive: '' }; }),
}));
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (input: any) => {
    calls.push('llm');
    prompts.push(String(input.messages?.[1]?.content ?? ''));
    return { output: 'Week 4 should address pricing.' };
  }),
}));
jest.mock('../../services/billing/phase2RouteWiring', () => ({ wirePhase2Route: async (o: any) => ({ output: (await o.run()).output }) }));
jest.mock('../../services/billing/phase2EnforcementGate', () => ({ PaymentRequiredError: class PaymentRequiredError extends Error {} }));

import handler from '../../../pages/api/campaigns/planner/suggest-update';

const suggest = async (body: Row) => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await (handler as any)({ method: 'POST', query: {}, body }, res);
  return res;
};

beforeEach(() => {
  calls.length = 0;
  prompts.length = 0;
  tables = {
    engagement_opportunities: [
      { id: OPP_A, organization_id: CO_A, opportunity_type: 'question', opportunity_text: 'A asks about pricing', platform: 'linkedin' },
      { id: OPP_B, organization_id: CO_B, opportunity_type: 'complaint', opportunity_text: 'B SECRET complaint text', platform: 'x' },
    ],
  };
});

describe('planner/suggest-update: the insight is bound to the authorized company', () => {
  it('CONTROL: A suggests from its OWN insight → 200, A text in the prompt', async () => {
    const res = await suggest({ companyId: CO_A, campaignId: CAMP_A, insight_id: OPP_A });
    expect(res.statusCode).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('A asks about pricing');
  });

  it("CRITICAL: A naming B's insight → uniform 404, the LLM is NEVER called, B's text never reaches a prompt", async () => {
    const res = await suggest({ companyId: CO_A, campaignId: CAMP_A, insight_id: OPP_B });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Insight not found' });
    expect(calls).not.toContain('llm');
    expect(prompts.join('\n')).not.toContain('B SECRET');
  });

  it("foreign == unknown: B's insight answers exactly like a missing one", async () => {
    const foreign = await suggest({ companyId: CO_A, campaignId: CAMP_A, insight_id: OPP_B });
    const missing = await suggest({ companyId: CO_A, campaignId: CAMP_A, insight_id: 'c0d00000-0000-4000-8000-0000000000ff' });
    expect([foreign.statusCode, foreign.body]).toEqual([missing.statusCode, missing.body]);
  });

  it('companyId is REQUIRED (no fallback to campaignId): 400 before any access check, read or LLM call', async () => {
    const res = await suggest({ campaignId: CAMP_A, insight_id: OPP_A });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('the company grounding is read only AFTER access is granted (a denied caller triggers no grounding read)', async () => {
    const denied = await suggest({ companyId: CO_B, campaignId: CAMP_A, insight_id: OPP_B });
    expect(denied.statusCode).toBe(403);
    expect(calls).toEqual([`access:${CO_B}`]);
    calls.length = 0;
    await suggest({ companyId: CO_A, campaignId: CAMP_A, insight_id: OPP_A });
    expect(calls.indexOf(`access:${CO_A}`)).toBeLessThan(calls.indexOf(`grounding:${CO_A}`));
  });
});
