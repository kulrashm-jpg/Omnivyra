/**
 * Strategic Mix R3-P1 — characterization of POST /api/planner/generate-
 * workspace-content, written BEFORE the Content Workspace starts
 * orchestrating it.
 *
 * This route is the EXISTING per-activity text-generation seam (billed
 * content_basic per platform, runCompletionWithOperation operation
 * 'generatePlatformVariants', processContent per platform). Today its output
 * is ephemeral (the Activity Workspace Drawer discards it); R3-P1 captures it
 * into planner_state. The route itself must not change — every assertion
 * here locks its pre-R3 contract.
 */

type Row = Record<string, unknown>;

const completionCalls: Row[] = [];
const processCalls: Row[] = [];
const billingCalls: Row[] = [];
let completionOutput = '{"linkedin": "raw linkedin copy", "x": "raw x copy"}';
let chargeStatus: Row = { status: 'executed' };
let admissionError: Error | null = null;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1' })),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
}));
jest.mock('../../services/companyContextService', () => ({
  buildCompanyContext: jest.fn(() => ({ identity: {}, brand: {}, customer: {} })),
}));
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (req: Row) => {
    completionCalls.push(req);
    return { output: completionOutput };
  }),
}));
jest.mock('../../services/unifiedContentProcessor', () => ({
  processContent: jest.fn(async (req: Row) => {
    processCalls.push(req);
    return { content: `processed:${req.content}` };
  }),
}));
jest.mock('../../services/creditDeductionService', () => ({
  getCreditCost: jest.fn(async () => 3),
}));
jest.mock('../../services/creditExecutionService', () => ({
  makeIdempotencyKey: jest.fn(() => 'idem-key'),
  executeWithCredits: jest.fn(async (args: any) => {
    billingCalls.push({ mode: 'credits', ...args });
    if (chargeStatus.status !== 'executed') return chargeStatus;
    return { status: 'executed', result: await args.executor() };
  }),
  executeWithEntryConsumption: jest.fn(async (args: any) => {
    billingCalls.push({ mode: 'entry', ...args });
    if (chargeStatus.status !== 'executed') return chargeStatus;
    return { status: 'executed', result: await args.executor() };
  }),
}));
jest.mock('../../services/billing/creditEconomyActivation', () => ({
  getCreditEconomyExecutionMode: jest.fn(async () => 'shadow'),
}));
jest.mock('../../services/billing/creditEconomyShadow', () => ({
  emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined),
}));
jest.mock('../../services/billing/admissionControl', () => ({
  evaluateActivityAdmission: jest.fn(async () => {
    if (admissionError) throw admissionError;
  }),
}));

import handler from '../../../pages/api/planner/generate-workspace-content';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}

const post = (body: Row) => ({ method: 'POST', body, headers: {} }) as any;

const validBody = (over: Row = {}): Row => ({
  companyId: 'co-1',
  topic: 'Why CFOs adopt AI',
  platforms: ['linkedin', 'x'],
  contentTypes: { linkedin: 'carousel' },
  theme: 'Week theme',
  objective: 'Educate',
  week: 2,
  ...over,
});

beforeEach(() => {
  completionCalls.length = 0;
  processCalls.length = 0;
  billingCalls.length = 0;
  completionOutput = '{"linkedin": "raw linkedin copy", "x": "raw x copy"}';
  chargeStatus = { status: 'executed' };
  admissionError = null;
});

describe('generate-workspace-content — pre-R3 contract', () => {
  test('rejects non-POST with 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });

  test('validates companyId, topic and platforms (400)', async () => {
    for (const bad of [
      validBody({ companyId: undefined }),
      validBody({ topic: undefined }),
      validBody({ platforms: [] }),
      validBody({ platforms: undefined }),
    ]) {
      const res = mockRes();
      await handler(post(bad), res);
      expect(res.statusCode).toBe(400);
    }
  });

  test('bills content_basic × platform count and returns processed variants keyed by platform', async () => {
    const res = mockRes();
    await handler(post(validBody()), res);

    expect(res.statusCode).toBe(200);
    // Billing: one charge, amount = cost(3) × 2 platforms, action content_basic
    expect(billingCalls).toHaveLength(1);
    expect(billingCalls[0].action).toBe('content_basic');
    expect(billingCalls[0].amountOverride).toBe(6);
    // One LLM call via the gateway with the workspace operation key
    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0].operation).toBe('generatePlatformVariants');
    expect(completionCalls[0].response_format).toEqual({ type: 'json_object' });
    // processContent runs per platform with the requested content type
    expect(processCalls).toHaveLength(2);
    const linkedinCall = processCalls.find((c) => c.platform === 'linkedin');
    expect(linkedinCall?.content_type).toBe('carousel');
    // Response shape: { variants } with processed content
    expect(res.body).toEqual({
      variants: {
        linkedin: 'processed:raw linkedin copy',
        x: 'processed:raw x copy',
      },
    });
  });

  test('surfaces insufficient credits as 402', async () => {
    chargeStatus = { status: 'insufficient_credits', required: 6, available: 1 };
    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(402);
  });

  test('admission block surfaces as 402 ADMISSION_BLOCKED', async () => {
    const err: any = new Error('blocked');
    err.name = 'AdmissionBlockedError';
    err.decision = { requiredCredits: 6, effectiveCredits: 0 };
    admissionError = err;
    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(402);
    expect((res.body as Row).code).toBe('ADMISSION_BLOCKED');
  });

  test('tolerates code-fenced LLM output and lowercases platform keys', async () => {
    completionOutput = '```json\n{"LinkedIn": "fenced copy", "x": "x copy"}\n```';
    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { variants: Record<string, string> }).variants.linkedin).toBe('processed:fenced copy');
  });
});
