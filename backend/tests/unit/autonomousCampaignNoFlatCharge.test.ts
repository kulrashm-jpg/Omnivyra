/**
 * Owner ruling 2026-11-13 (via e9, Q1): autonomous campaign generation carries NO flat charge.
 *
 * generateNextCampaign makes no LLM call; the AI work it can trigger (predictCampaignOutcome) bills itself under its
 * own action. A daily run that triggers no AI therefore touches NO credit function at all - the former fixed
 * 50-credit/day reservation (reserveCreditsForWork 'campaign_generation') is gone - and a billing refusal raised by
 * the AI work it does trigger still propagates (it is not swallowed into a free plan).
 */
const creditCalls: string[] = [];
const recordCall = (name: string) => jest.fn(async () => { creditCalls.push(name); return { status: 'reserved' }; });

jest.mock('../../services/creditExecutionService', () => ({
  reserveCreditsForWork: recordCall('reserveCreditsForWork'),
  confirmCreditReservation: recordCall('confirmCreditReservation'),
  releaseCreditReservation: recordCall('releaseCreditReservation'),
  executeWithCredits: recordCall('executeWithCredits'),
  makeIdempotencyKey: jest.fn(() => 'k'),
}));
jest.mock('../../services/creditDeductionService', () => ({
  getCreditCost: recordCall('getCreditCost'),
  deductCreditsAwaited: recordCall('deductCreditsAwaited'),
}));

// PostgREST-shaped thenable chain: every read returns no rows and count 0 (a company's first autonomous run).
function chain(): any {
  const result = { data: null, error: null, count: 0 };
  const c: any = {};
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit', 'is', 'neq']) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => chain() } }));

jest.mock('../../services/performanceInsightGenerator', () => ({ generatePerformanceInsights: jest.fn(async () => null) }));
jest.mock('../../services/platformPerformanceRanker', () => ({ rankPlatformsByPerformance: jest.fn(async () => []) }));
jest.mock('../../services/engagementInsightService', () => ({ generateEngagementInsights: jest.fn(async () => null) }));
jest.mock('../../services/campaignDecisionEngine', () => ({ evaluateCampaignDecision: jest.fn(async () => null) }));
jest.mock('../../services/campaignLearningsStore', () => ({
  getTopLearnings: jest.fn(async () => []),
  formatLearningsForPrompt: jest.fn(() => ''),
}));
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: jest.fn(async () => undefined) }));
const predict = jest.fn();
jest.mock('../../services/campaignPredictionEngine', () => ({ predictCampaignOutcome: (...a: unknown[]) => predict(...a) }));

import { generateNextCampaign } from '../../services/autonomousCampaignAgent';
import { PaymentRequiredError } from '../../services/billing/phase2EnforcementGate';

beforeEach(() => {
  creditCalls.length = 0;
  predict.mockReset();
});

describe('autonomous campaign generation - no flat charge (owner ruling Q1)', () => {
  it('a run that triggers no AI makes NO credit call (costs 0) and still returns a plan', async () => {
    predict.mockResolvedValue({ predicted_engagement_rate: 0.02, confidence_score: 0.5, warnings: [] });
    const plan = await generateNextCampaign('co_1');
    expect(plan.company_id).toBe('co_1');
    expect(plan.platforms.length).toBeGreaterThan(0);
    expect(creditCalls).toEqual([]);
  });

  it('a billing refusal from the AI work it triggers (prediction) propagates - never a silent free plan', async () => {
    predict.mockRejectedValue(new PaymentRequiredError('campaigns.prediction' as never, 'insufficient'));
    await expect(generateNextCampaign('co_1')).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(creditCalls).toEqual([]);
  });

  it('a genuine (non-billing) prediction failure stays non-blocking enrichment', async () => {
    predict.mockRejectedValue(new Error('model timeout'));
    const plan = await generateNextCampaign('co_1');
    expect(plan.generation_meta.predicted_engagement_rate).toBe(0);
    expect(creditCalls).toEqual([]);
  });
});
