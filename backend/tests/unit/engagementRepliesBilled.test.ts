/**
 * e9 2026-11-13 (BLOCKING for the enforcement flip): GET /api/engagement/suggestions and
 * POST /api/engagement/thread/bulk-ai-reply ran their AI (engagementAiAssistantService.generateReplySuggestions)
 * UNBILLED. Both now run through wirePhase2Route as reply_generation:
 *   - suggestions: one call = one unit; NO usable AI output is thrown inside the unit (released - never charged for
 *     the canned fallbacks) and answered with the fallbacks exactly as before;
 *   - bulk: the whole batch = one unit, HOLD scaled by the actionable threads, a retried click is 409 (never sends
 *     twice); nothing actionable -> no AI -> not billed.
 */
const mockWire = jest.fn();
jest.mock('../../services/billing/phase2RouteWiring', () => {
  const actual = jest.requireActual('../../services/billing/phase2RouteWiring');
  return { ...actual, wirePhase2Route: (a: unknown) => mockWire(a) };
});
const mockGen = jest.fn();
jest.mock('../../services/engagementAiAssistantService', () => ({
  generateReplySuggestions: (...a: unknown[]) => mockGen(...a),
  isThreadNotActionableError: (e: any) => e?.name === 'ThreadNotActionableError',
}));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: 'u-1', defaultCompanyId: 'org-1' }),
  enforceCompanyAccess: async () => ({ ok: true }),
}));
jest.mock('../../services/engagementGovernanceService', () => ({
  getControls: async () => ({ ai_suggestions_enabled: true, bulk_reply_enabled: true }),
}));
jest.mock('../../services/rbacService', () => ({ enforceRole: async () => ({ userId: 'u-1' }) }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ COMMUNITY_AI_CAPABILITIES: { EXECUTE_ACTIONS: ['ADMIN'] } }));
let mockActionable: string[] = [];
jest.mock('../../services/engagementThreadService', () => ({
  getThreadActionability: async (_o: string, ids: string[]) => new Map(ids.map((id) => [id, mockActionable.includes(id)])),
}));
const mockBulk = jest.fn();
jest.mock('../../services/bulkEngagementService', () => ({ bulkReplyThreads: (...a: unknown[]) => mockBulk(...a) }));
jest.mock('../../db/supabaseClient', () => {
  const row = (data: unknown) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }), maybeSingle: async () => ({ data }) }) }) });
  return {
    supabase: {
      from: (t: string) => t === 'engagement_messages'
        ? row({ id: 'm-1', thread_id: 't-1', content: 'hi', platform: 'linkedin' })
        : row({ organization_id: 'org-1' }),
    },
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// OFF-path harness: the REAL wirePhase2Route and the REAL enforcement gate (OFF by default), the engine spied.
const mockEngine = { executeWithEntryConsumption: jest.fn(), makeIdempotencyKey: jest.fn(() => 'k') };
jest.mock('../../services/creditExecutionService', () => mockEngine);
jest.mock('../../services/requestContext', () => ({ getRequestContext: () => ({ idempotencyKey: 'click-1', requestId: 'req-1' }) }));
jest.mock('../../services/billing/billingFeatureFlags', () => ({
  ...jest.requireActual('../../services/billing/billingFeatureFlags'),
  isBillingFlagEnabled: jest.fn(async () => ({ enabled: false })),
}));
jest.mock('../../services/creditDeductionService', () => ({ hasEnoughCredits: jest.fn(async () => ({ sufficient: true })) }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));

/* eslint-disable @typescript-eslint/no-var-requires */
export {};
const suggestions = require('../../../pages/api/engagement/suggestions').default;
const bulk = require('../../../pages/api/engagement/thread/bulk-ai-reply').default;
const { BilledRoutePaymentRequiredError, BilledRouteAlreadyProcessedError, routeLlmPricingFor, MAX_ROUTE_UNIT_CALLS, wirePhase2Route: realWire } =
  jest.requireActual('../../services/billing/phase2RouteWiring');
/* eslint-enable @typescript-eslint/no-var-requires */

function mkRes() {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
  return res;
}
const getSuggestions = async () => { const res = mkRes(); await suggestions({ method: 'GET', query: { message_id: 'm-1', organization_id: 'org-1' }, headers: {} }, res); return res; };
const postBulk = async (ids: string[]) => { const res = mkRes(); await bulk({ method: 'POST', query: {}, headers: {}, body: { organization_id: 'org-1', thread_ids: ids } }, res); return res; };
const passthrough = async (a: { run: () => Promise<unknown> }) => a.run();

beforeEach(() => { mockWire.mockReset(); mockGen.mockReset(); mockBulk.mockReset(); mockActionable = []; });

describe('GET /api/engagement/suggestions', () => {
  it('the AI runs INSIDE wirePhase2Route as reply_generation, keyed by org + message', async () => {
    mockWire.mockImplementation(passthrough);
    mockGen.mockResolvedValue({ suggested_replies: [{ text: 'A', tone: 'warm' }, { text: 'B' }, { text: 'C' }] });
    const r = await getSuggestions();
    expect(r.statusCode).toBe(200);
    expect(r.body.suggestions.map((s: any) => s.text)).toEqual(['A', 'B', 'C']);
    expect(mockWire.mock.calls[0][0]).toMatchObject({
      surface: 'engagement.suggestions', organizationId: 'org-1', action: 'reply_generation',
      referenceType: 'engagement_reply_suggestions', referenceId: 'org-1:m-1',
    });
    expect(mockWire.mock.calls[0][0].unitCalls).toBeUndefined();
  });

  it('NO usable AI output is thrown INSIDE the unit (so it is released, never charged) and answered with the fallbacks', async () => {
    let unitOutcome: unknown = null;
    mockWire.mockImplementation(async (a: { run: () => Promise<unknown> }) => a.run().catch((e) => { unitOutcome = e; throw e; }));
    mockGen.mockResolvedValue({ suggested_replies: [{ text: '   ' }] });
    const r = await getSuggestions();
    expect(unitOutcome).toBeInstanceOf(Error);                 // the billed unit FAILED -> engine releases
    expect(r.statusCode).toBe(200);
    expect(r.body.suggestions).toHaveLength(3);               // fallbacks, exactly as before
  });

  it('insufficient credits -> 402 with required/balance, no AI', async () => {
    mockWire.mockRejectedValue(new BilledRoutePaymentRequiredError('engagement.suggestions', 'INSUFFICIENT_CREDITS', 2, 0));
    const r = await getSuggestions();
    expect([r.statusCode, r.body.code, r.body.required, r.body.balance]).toEqual([402, 'INSUFFICIENT_CREDITS', 2, 0]);
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('a thread that is not actionable keeps its 409 THREAD_NOT_ACTIONABLE (propagates through the unit)', async () => {
    mockWire.mockImplementation(passthrough);
    mockGen.mockRejectedValue(Object.assign(new Error('answered'), { name: 'ThreadNotActionableError' }));
    const r = await getSuggestions();
    expect([r.statusCode, r.body.code]).toEqual([409, 'THREAD_NOT_ACTIONABLE']);
  });
});

describe('POST /api/engagement/thread/bulk-ai-reply', () => {
  it('the batch is ONE unit: reply_generation, HOLD scaled by the actionable threads, id independent of order', async () => {
    mockActionable = ['t-1', 't-2', 't-3'];
    mockWire.mockImplementation(passthrough);
    mockBulk.mockResolvedValue({ sent: 3, skipped: 0, errors: [], outcomes: {} });
    const a = await postBulk(['t-3', 't-1', 't-2', 't-9']);
    expect(a.statusCode).toBe(200);
    expect(a.body.sent).toBe(3);
    const args = mockWire.mock.calls[0][0];
    expect(args).toMatchObject({ surface: 'engagement.bulk-ai-reply', action: 'reply_generation', referenceType: 'engagement_bulk_reply', unitCalls: 3 });
    expect(mockBulk.mock.calls[0][1]).toEqual(['t-3', 't-1', 't-2']); // only actionable threads reach the AI
    await postBulk(['t-1', 't-2', 't-3']);
    expect(mockWire.mock.calls[1][0].referenceId).toBe(args.referenceId);
  });

  it('a retried click (already charged) -> 409 ALREADY_PROCESSED: nothing generated, nothing SENT', async () => {
    mockActionable = ['t-1'];
    mockWire.mockRejectedValue(new BilledRouteAlreadyProcessedError('engagement.bulk-ai-reply'));
    const r = await postBulk(['t-1']);
    expect([r.statusCode, r.body.code]).toEqual([409, 'ALREADY_PROCESSED']);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('nothing actionable -> no AI -> NOT billed (the batch still answers as before)', async () => {
    mockActionable = [];
    mockBulk.mockResolvedValue({ sent: 0, skipped: 0, errors: [], outcomes: {} });
    const r = await postBulk(['t-1', 't-2']);
    expect(r.statusCode).toBe(200);
    expect(r.body.skipped).toBe(2);
    expect(mockWire).not.toHaveBeenCalled();
  });
});

describe('hold sizing', () => {
  it('reply_generation holds its own call bound (3000 in / 700 out = the service max_tokens), scaled by unitCalls', () => {
    expect(routeLlmPricingFor('reply_generation')).toMatchObject({ maxInputTokens: 3000, maxOutputTokens: 700 });
    expect(routeLlmPricingFor('reply_generation', 20)).toMatchObject({ maxInputTokens: 60000, maxOutputTokens: 14000, ceilingScale: 20 });
    expect(routeLlmPricingFor('reply_generation')).not.toHaveProperty('ceilingScale');
  });
  it('unitCalls is capped and a non-integer falls back to the action default', () => {
    expect(routeLlmPricingFor('reply_generation', 10_000).maxOutputTokens).toBe(700 * MAX_ROUTE_UNIT_CALLS);
    expect(routeLlmPricingFor('reply_generation', 2.5).maxOutputTokens).toBe(700);
    expect(routeLlmPricingFor('insight_generation')).toMatchObject({ maxInputTokens: 8000 * 5, maxOutputTokens: 2000 * 5 });
  });
});

describe('OFF path (enforcement off - today): byte-identical behaviour, no engine call, no 409 on a repeat', () => {
  const ENV = ['PHASE2_BILLING_KILL_SWITCH', 'PHASE2_BILLING_FORCE_ENFORCE', 'PHASE2_BILLING_SHADOW', 'PHASE2_BILLING_SHADOW_DEFAULT'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterAll(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  beforeEach(() => { mockWire.mockImplementation((a: unknown) => realWire(a)); mockEngine.executeWithEntryConsumption.mockReset(); });

  it('suggestions: the same request twice answers 200 both times from the AI, the engine is never called', async () => {
    mockGen.mockResolvedValue({ suggested_replies: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] });
    const a = await getSuggestions(); const b = await getSuggestions();
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.body.suggestions.map((x: any) => x.text)).toEqual(['A', 'B', 'C']);
    expect(mockGen).toHaveBeenCalledTimes(2);
    expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  });
  it('suggestions: empty AI output still answers the 3 fallbacks (as before)', async () => {
    mockGen.mockResolvedValue({ suggested_replies: [] });
    const r = await getSuggestions();
    expect([r.statusCode, r.body.suggestions.length]).toEqual([200, 3]);
  });
  it('bulk: the same batch twice runs (and sends) both times as today, the engine is never called', async () => {
    mockActionable = ['t-1'];
    mockBulk.mockResolvedValue({ sent: 1, skipped: 0, errors: [], outcomes: {} });
    const a = await postBulk(['t-1']); const b = await postBulk(['t-1']);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(mockBulk).toHaveBeenCalledTimes(2);
    expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  });
  it('positive control: with FORCE_ENFORCE the SAME harness reaches the engine (the OFF pins are not vacuous)', async () => {
    process.env.PHASE2_BILLING_FORCE_ENFORCE = 'true';
    try {
      mockEngine.executeWithEntryConsumption.mockResolvedValueOnce({ status: 'executed', result: [{ text: 'E' }] });
      const r = await getSuggestions();
      expect(mockEngine.executeWithEntryConsumption).toHaveBeenCalledTimes(1);
      expect(r.body.suggestions[0].text).toBe('E');
    } finally { delete process.env.PHASE2_BILLING_FORCE_ENFORCE; }
  });
});
