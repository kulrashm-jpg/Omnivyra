/**
 * Phase 8F — economic accounting aggregators (pure, no DB).
 *
 * Verifies the unified activity ledger, provider/activity/org profitability,
 * credit-to-cost ratios, margin reuse, and the customer/platform spend
 * separation (platform never leaks into customer aggregations).
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import {
  classifySpendType,
  partitionBySpendType,
  aggregateCreditPhases,
  aggregateActivityLedger,
  aggregateProviderProfitability,
  aggregateActivityProfitability,
  aggregateOrganizationProfitability,
  aggregatePlatformCost,
  type UnifiedTxnRow,
  type CreditPhaseRow,
} from '../../services/billing/economicAccountingService';

const ORG = 'org-A';

const customerRows: UnifiedTxnRow[] = [
  { organization_id: ORG, action_key: 'blog_generation', source_type: 'llm', provider_name: 'openai', model_name: 'gpt-4o', total_tokens: 1000, api_cost_usd: 0.50, credits_charged: 60, credits_value_usd: 0.60, margin_usd: 0.10 },
  { organization_id: ORG, action_key: 'blog_generation', source_type: 'llm', provider_name: 'openai', model_name: 'gpt-4o-mini', total_tokens: 500, api_cost_usd: 0.10, credits_charged: 0, credits_value_usd: 0, margin_usd: -0.10 },
  { organization_id: ORG, action_key: 'campaign_generation', source_type: 'llm', provider_name: 'anthropic', model_name: 'claude', total_tokens: 2000, api_cost_usd: 1.00, credits_charged: 50, credits_value_usd: 0.50, margin_usd: -0.50 },
];
const platformRow: UnifiedTxnRow = { organization_id: ORG, action_key: 'ai_visibility_probe', source_type: 'system', provider_name: 'gemini', model_name: 'gemini-1.5-flash', total_tokens: 300, api_cost_usd: 0.05, credits_charged: 0, credits_value_usd: 0, margin_usd: -0.05 };
const cacheRow: UnifiedTxnRow = { organization_id: ORG, action_key: 'blog_generation', source_type: 'cache', provider_name: 'openai', model_name: 'gpt-4o', total_tokens: 0, api_cost_usd: 0, credits_charged: 0, credits_value_usd: 0, margin_usd: 0 };

const creditRows: CreditPhaseRow[] = [
  { organization_id: ORG, reference_type: 'blog_generation', execution_phase: 'hold', credits_delta: -60 },
  { organization_id: ORG, reference_type: 'blog_generation', execution_phase: 'confirm', credits_delta: -60 },
];

describe('spend-type partition (TASK 3 separation)', () => {
  it('classifies source types', () => {
    expect(classifySpendType('llm')).toBe('customer');
    expect(classifySpendType('external_api')).toBe('customer');
    expect(classifySpendType('system')).toBe('platform');
    expect(classifySpendType('cache')).toBe('zero_cost');
    expect(classifySpendType(null)).toBe('zero_cost');
  });

  it('partitions customer / platform / zero-cost', () => {
    const { customer, platform, zeroCost } = partitionBySpendType([...customerRows, platformRow, cacheRow]);
    expect(customer).toHaveLength(3);
    expect(platform).toHaveLength(1);
    expect(zeroCost).toHaveLength(1);
  });
});

describe('aggregateCreditPhases', () => {
  it('sums reserved/confirmed/released per (org|activity)', () => {
    const m = aggregateCreditPhases([
      ...creditRows,
      { organization_id: ORG, reference_type: 'blog_generation', execution_phase: 'release', credits_delta: -10 },
    ]);
    expect(m.get(`${ORG}|blog_generation`)).toEqual({ reserved: 60, confirmed: 60, released: 10 });
  });
});

describe('aggregateActivityLedger (TASK 1 unified ledger)', () => {
  const rows = aggregateActivityLedger(customerRows, creditRows, '2026-06');
  const blog = rows.find((r) => r.activity === 'blog_generation')!;
  const camp = rows.find((r) => r.activity === 'campaign_generation')!;

  it('merges metering + ledger; dominant provider/model; reuses margin', () => {
    expect(blog.organizationId).toBe(ORG);
    expect(blog.provider).toBe('openai');
    expect(blog.model).toBe('gpt-4o'); // dominant by cost (0.50 > 0.10)
    expect(blog.tokens).toBe(1500);
    expect(blog.providerCostUsd).toBeCloseTo(0.60, 6);
    expect(blog.marginUsd).toBeCloseTo(0.0, 6); // 0.10 + (−0.10), summed not recomputed
    expect(blog.providerBreakdown).toHaveLength(2);
  });

  it('credits from ledger: reserved=hold, consumed=confirm, effective=confirm−release', () => {
    expect(blog.creditsReserved).toBe(60);
    expect(blog.creditsConsumed).toBe(60);
    expect(blog.effectiveCredits).toBe(60);
    expect(blog.creditToCostRatio).toBeCloseTo(1.0, 6); // 0.60 / 0.60
  });

  it('falls back to metered credits_charged when no ledger rows (dark mode)', () => {
    expect(camp.creditsReserved).toBe(0);
    expect(camp.creditsConsumed).toBe(50); // credits_charged fallback
    expect(camp.effectiveCredits).toBe(50);
    expect(camp.marginUsd).toBeCloseTo(-0.50, 6); // subsidy visible
    expect(camp.creditToCostRatio).toBeCloseTo(0.5, 6);
  });
});

describe('profitability rollups (TASK 4)', () => {
  it('provider profitability + margin by provider + credit-to-cost ratio', () => {
    const byProvider = aggregateProviderProfitability(customerRows);
    const openai = byProvider.find((p) => p.key === 'openai')!;
    const anthropic = byProvider.find((p) => p.key === 'anthropic')!;
    expect(openai.providerCostUsd).toBeCloseTo(0.60, 6);
    expect(openai.marginUsd).toBeCloseTo(0.0, 6);
    expect(openai.creditToCostRatio).toBeCloseTo(1.0, 6);
    expect(anthropic.marginUsd).toBeCloseTo(-0.50, 6);
    expect(anthropic.creditToCostRatio).toBeCloseTo(0.5, 6);
  });

  it('activity profitability', () => {
    const byActivity = aggregateActivityProfitability(customerRows);
    expect(byActivity.find((a) => a.key === 'campaign_generation')!.marginUsd).toBeCloseTo(-0.50, 6);
  });

  it('organization profitability', () => {
    const byOrg = aggregateOrganizationProfitability(customerRows);
    const a = byOrg.find((o) => o.key === ORG)!;
    expect(a.providerCostUsd).toBeCloseTo(1.60, 6);
    expect(a.creditsValueUsd).toBeCloseTo(1.10, 6);
    expect(a.marginUsd).toBeCloseTo(-0.50, 6); // 0.10 − 0.10 − 0.50 (== value 1.10 − cost 1.60)
    expect(a.creditToCostRatio).toBeCloseTo(1.10 / 1.60, 6);
  });
});

describe('platform-global probe rows (Phase 8G-B integration + reconciliation safety)', () => {
  // A null-org system row as synthesized by getPlatformCostAccounting from
  // usage_events (margin = −cost; pure platform spend).
  const probeRow: UnifiedTxnRow = {
    organization_id: null, action_key: 'ai_visibility_probe', source_type: 'system',
    provider_name: 'gemini', model_name: 'gemini-1.5-flash',
    total_tokens: 1500, api_cost_usd: 0.05, credits_charged: 0, credits_value_usd: 0, margin_usd: -0.05,
  };

  it('TASK 4: aggregates into platform cost (byProvider + byActivity)', () => {
    const pc = aggregatePlatformCost([probeRow]);
    expect(pc.totalPlatformCostUsd).toBeCloseTo(0.05, 6);
    expect(pc.byProvider[0]).toMatchObject({ key: 'gemini', marginUsd: -0.05 });
    expect(pc.byActivity[0]).toMatchObject({ key: 'ai_visibility_probe' });
  });

  it('TASK 4/5: excluded from customer economics; customer profitability unchanged', () => {
    const { customer, platform } = partitionBySpendType([...customerRows, probeRow]);
    expect(platform).toContain(probeRow);
    expect(customer).not.toContain(probeRow);
    // probe provider does not appear in customer provider profitability
    expect(aggregateProviderProfitability(customer).some((p) => p.key === 'gemini')).toBe(false);
    // org profitability identical to the no-probe baseline (−0.50)
    expect(aggregateOrganizationProfitability(customer).find((o) => o.key === ORG)!.marginUsd).toBeCloseTo(-0.50, 6);
  });
});

describe('platform-cost accounting (TASK 3 — never in company billing)', () => {
  it('aggregates ONLY system spend, separate from customer rollups', () => {
    const pc = aggregatePlatformCost([platformRow]);
    expect(pc.totalPlatformCostUsd).toBeCloseTo(0.05, 6);
    expect(pc.events).toBe(1);
    expect(pc.byProvider[0].key).toBe('gemini');

    // and the platform row must NOT appear in any customer aggregation
    const { customer } = partitionBySpendType([...customerRows, platformRow]);
    expect(customer.some((r) => r.provider_name === 'gemini')).toBe(false);
    expect(aggregateProviderProfitability(customer).some((p) => p.key === 'gemini')).toBe(false);
  });
});
