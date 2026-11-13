/**
 * C75 (BLOCKING money; e1 rulings Q1-Q4; owner ruling via e9): the interactive planner is billed token-actual.
 * Behaviour runs through the REAL runInteractivePlanBilled -> runEntryConsumptionBilled -> executeWithEntryConsumption
 * (shared ledger fake: backend/tests/helpers/entryConsumptionLedgerFake). Wiring of plan.ts and the worker is pinned
 * by source checks (the route's dependency surface is too wide to drive here).
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../repositories/creditExecutionRepository', () => require('../helpers/entryConsumptionLedgerFake').repositoryModule());
jest.mock('../../services/creditExecutionServiceContracts', () => require('../helpers/entryConsumptionLedgerFake').contractsModule());
jest.mock('../../services/creditPriorityService', () => require('../helpers/entryConsumptionLedgerFake').engineStubs.priority());
const recordCostAnomaly = jest.fn();
jest.mock('../../services/pricingService', () => require('../helpers/entryConsumptionLedgerFake').engineStubs.pricing((...a: unknown[]) => recordCostAnomaly(...a)));
jest.mock('../../services/creditExecutionService', () => require('../helpers/entryConsumptionLedgerFake').engineStubs.executionService());
jest.mock('../../services/billing/phase2EnforcementGate', () => require('../helpers/entryConsumptionLedgerFake').engineStubs.gate());
jest.mock('../../services/usageTrackingService', () => ({ trackUsage: async () => undefined }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: async () => undefined }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async () => undefined }));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: async () => 0, getSmartModeDedupSeconds: async () => 0, wasRecentlyRun: async () => false }));
jest.mock('../../services/billing/creditEconomyObservability', () => ({ recordSettlementObservation: async () => undefined }));
jest.mock('../../services/billing/holdPolicySnapshot', () => ({ buildHoldPolicySnapshot: () => ({}), freezeHoldPolicySnapshot: (x: unknown) => x }));
jest.mock('../../services/billing/creditSafetyGate', () => ({ evaluateCreditSafetyGate: () => 'allow' }));
jest.mock('../../services/billing/billingPolicyResolver', () => ({ resolveBillingPolicy: async () => ({}) }));
jest.mock('../../services/creditExecutionServiceRuntimeCore', () => ({ executeWithCredits: async () => { throw new Error('not used'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));

import * as fake from '../helpers/entryConsumptionLedgerFake';
import { PLANNER_BILLING_ACTIONS, plannerActionFor, plannerIdentityRoot, runInteractivePlanBilled } from '../../services/billing/plannerBilling';
import { precheckEntryConsumption } from '../../services/billing/entryConsumptionHttp';
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';
import { recordProviderUsage } from '../../services/aiUsageCollector';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
let planRuns = 0;
const plan = (fail = false) => async () => {
  planRuns += 1;
  recordProviderUsage(1500, 500); // provider call 1
  if (fail) throw new Error('planner failed');
  recordProviderUsage(1200, 800); // provider call 2
  return { plan: { weeks: [1] } };
};

beforeEach(() => {
  fake.reset(1000);
  planRuns = 0;
  process.env.PHASE2_ENTRY_CONSUMPTION = 'true';
});
afterAll(() => { delete process.env.PHASE2_ENTRY_CONSUMPTION; });

describe('the ONE mode -> action table (e1 Q1)', () => {
  it('is exactly this', () => {
    expect(PLANNER_BILLING_ACTIONS).toEqual({
      generate_plan: 'campaign_generation',
      refine_day: 'content_rewrite',
      platform_customize: 'content_rewrite',
      planner_command: 'content_rewrite',
      plan_preview: 'content_rewrite',
    });
    expect(() => plannerActionFor('something_else')).toThrow();
  });
  it('identity: generate_plan is actor-free (inline + worker actors differ); other modes are per actor', () => {
    const k = 'pk-1';
    expect(plannerIdentityRoot({ kind: 'generate_plan', companyId: ORG, actorUserId: USER_A, pollKey: k }))
      .toBe(plannerIdentityRoot({ kind: 'generate_plan', companyId: ORG, actorUserId: USER_B, pollKey: k }));
    expect(plannerIdentityRoot({ kind: 'refine_day', companyId: ORG, actorUserId: USER_A, pollKey: k }))
      .not.toBe(plannerIdentityRoot({ kind: 'refine_day', companyId: ORG, actorUserId: USER_B, pollKey: k }));
  });
});

describe('runInteractivePlanBilled (REAL engine)', () => {
  const run = (actor: string, fail = false, pollKey = 'pk-1') =>
    runInteractivePlanBilled({ kind: 'generate_plan', companyId: ORG, actorUserId: actor, campaignId: 'camp-1', pollKey, executor: plan(fail) });

  it('settles the SUM of both provider calls as campaign_generation; remainder released', async () => {
    const r = await run(USER_A);
    expect(r).toEqual({ kind: 'billed', result: expect.objectContaining({ status: 'executed' }) });
    // actual (sum of both calls) exceeds the AUTOMATION entry, so the settle is the actual, not the entry minimum
    const actual = fake.creditsFor(1500 + 500 + 1200 + 800);
    expect(actual).toBeGreaterThan(resolveActivityEconomics('campaign_generation').entryConsumption);
    expect(fake.totalCharged()).toBe(actual);
    expect(fake.state.wallet.balance).toBe(1000 - actual);
  });

  it('the same inputs inline then on the worker (different actor) -> ONE run, ONE charge', async () => {
    await run(USER_A);            // inline
    const worker = await run(USER_B); // worker, same poll key
    expect(worker).toEqual({ kind: 'billed', result: { status: 'already_settled' } });
    expect(planRuns).toBe(1);
    expect(fake.state.charged.filter((c) => c.key.endsWith(':exposure:confirm'))).toHaveLength(1);
  });

  it('a failed run releases the exposure; the identical retry runs again and settles once', async () => {
    await expect(run(USER_A, true)).rejects.toThrow('planner failed');
    const retry = await run(USER_A);
    expect(retry.kind === 'billed' && retry.result.status).toBe('executed');
    expect(planRuns).toBe(2);
    expect(fake.state.charged.filter((c) => c.key.endsWith(':exposure:confirm'))).toHaveLength(1);
  });

  it('insufficient at run time (the worker is the authority) -> no planner run, insufficient_credits', async () => {
    const max = resolveActivityEconomics('campaign_generation').maximumCredits;
    fake.state.wallet.balance = max - 1;
    const r = await run(USER_A);
    expect(r).toEqual({ kind: 'billed', result: { status: 'insufficient_credits', available: max - 1, required: max } });
    expect(planRuns).toBe(0);
  });

  it('CONTROL doubly dark: flag off -> legacy (nothing held)', async () => {
    delete process.env.PHASE2_ENTRY_CONSUMPTION;
    expect(await run(USER_A)).toEqual({ kind: 'legacy' });
    expect(fake.state.ledger.size).toBe(0);
  });
});

describe('precheckEntryConsumption (402 at enqueue, non-reserving)', () => {
  it('enforced + balance below the max exposure -> shared 402; nothing reserved', async () => {
    const max = resolveActivityEconomics('campaign_generation').maximumCredits;
    fake.state.wallet.balance = max - 1;
    expect(await precheckEntryConsumption({ surface: 'campaigns.ai-plan', orgId: ORG, action: 'campaign_generation' }))
      .toEqual({ status: 402, body: { error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: max, balance: max - 1 } });
    expect(fake.state.ledger.size).toBe(0);
  });
  it('enough balance, or not enforced -> null', async () => {
    expect(await precheckEntryConsumption({ surface: 'campaigns.ai-plan', orgId: ORG, action: 'campaign_generation' })).toBeNull();
    fake.state.wallet.balance = 0;
    fake.state.gateMode = 'off';
    expect(await precheckEntryConsumption({ surface: 'campaigns.ai-plan', orgId: ORG, action: 'campaign_generation' })).toBeNull();
  });
});

describe('wiring: plan.ts + the ai-heavy worker', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
  const planSrc = read('pages/api/campaigns/ai/plan.ts');
  const workerSrc = read('backend/workers/main.ts');

  it('planner_command and the preview are billed through the table (content_rewrite)', () => {
    expect(planSrc).toMatch(/action:\s*plannerActionFor\('planner_command'\)[\s\S]{0,700}executor:\s*extract,/);
    expect(planSrc).toMatch(/action:\s*plannerActionFor\('plan_preview'\)[\s\S]{0,700}executor:\s*runPreview,/);
    expect(planSrc).not.toMatch(/const commands = await extractPlannerCommands\(/);
    expect(planSrc).not.toMatch(/const previewResult = await generatePlanPreview\(/);
  });
  it('async generate_plan: polls return BEFORE the non-reserving 402 pre-check, which runs before the enqueue', () => {
    const poll = planSrc.indexOf('const stored = await pollRunwayResult(pollKey);');
    const status = planSrc.indexOf('const jobStatus = await getRunwayJobStatus(');
    const pre = planSrc.indexOf("const enqueueRefusal = await precheckEntryConsumption({");
    const enq = planSrc.indexOf('const envelope = await enqueueRunwayOperation({');
    expect(poll).toBeGreaterThan(0);
    expect(status).toBeGreaterThan(poll);
    expect(pre).toBeGreaterThan(status);
    expect(enq).toBeGreaterThan(pre);
    expect(planSrc).toContain('const pollKey = planPollKey;');
    expect(planSrc.slice(pre, enq)).toContain('if (enqueueRefusal) return res.status(enqueueRefusal.status).json(enqueueRefusal.body);');
  });
  it('inline: runCampaignAiPlan runs through runInteractivePlanBilled with the SAME poll key', () => {
    expect(planSrc).toMatch(/runInteractivePlanBilled\(\{\s*kind:\s*effectiveMode as PlannerBillingKind,[\s\S]{0,300}pollKey:\s*planPollKey,\s*executor:\s*runPlan,/);
    expect(planSrc).not.toMatch(/const result = await runCampaignAiPlan\(/);
  });
  it('worker: generate_plan billed under the job poll key; a non-executed outcome FAILS the job (no AI call)', () => {
    const block = workerSrc.slice(workerSrc.indexOf("if (job.name === 'interactive-plan')"));
    expect(block).toMatch(/runInteractivePlanBilled\(\{\s*kind: 'generate_plan',[\s\S]{0,200}pollKey,\s*executor: runPlan,/);
    expect(block).toMatch(/throw Object\.assign\(new Error\(/);
    expect(block.indexOf('runInteractivePlanBilled(')).toBeLessThan(block.indexOf('completeRunwayOperation({'));
  });
});
