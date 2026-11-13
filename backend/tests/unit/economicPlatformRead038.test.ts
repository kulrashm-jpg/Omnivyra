/**
 * economicAccountingService platform read after migration 20270217000038 (6f; e9 / e1).
 * Platform spend = every usage_events row with organization_id NULL (billing_scope 'platform'), ANY source_type -
 * the read used to filter `.eq('source_type','system')`, which would have dropped the platform AI / cache /
 * external-API spend once it stops sitting under the fake all-zero org. Platform rows never reach
 * unified_transactions (P1), so the combined total counts each cost exactly once.
 */
const filters: Record<string, Array<[string, unknown[]]>> = {};
let usageRows: Array<Record<string, unknown>> = [];
let unifiedRows: Array<Record<string, unknown>> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      filters[table] = [];
      let data = table === 'usage_events' ? usageRows : table === 'unified_transactions' ? unifiedRows : [];
      const b: any = {};
      for (const op of ['select', 'eq', 'is', 'gte', 'lte', 'limit', 'in', 'not', 'neq']) {
        b[op] = (...args: unknown[]) => {
          filters[table].push([op, args]);
          // Applied like PostgREST, so the fake is never kinder than the real read (a recorded-but-ignored
          // filter let the total test pass on the pre-fix code).
          if (op === 'eq') data = data.filter((r) => r[args[0] as string] === args[1]);
          if (op === 'is') data = data.filter((r) => (args[1] === null ? r[args[0] as string] == null : r[args[0] as string] === args[1]));
          return b;
        };
      }
      b.then = (res: any, rej: any) => Promise.resolve({ data, error: null }).then(res, rej);
      return b;
    },
  },
}));

import { getPlatformCostAccounting } from '../../services/billing/economicAccountingService';

const ORG = '11111111-1111-4111-8111-111111111111';
const W = { since: '2026-11-01T00:00:00Z' };

beforeEach(() => {
  // The backfilled platform population (NULL org): llm, cache, external_api and system.
  usageRows = [
    { organization_id: null, process_type: 'content_basic', reference_type: null, provider_name: 'openai', model_name: 'gpt-4o', total_tokens: 100, total_cost_usd: 1.0, source_type: 'llm' },
    { organization_id: null, process_type: 'insight_generation', reference_type: null, provider_name: 'openai', model_name: 'gpt-4o', total_tokens: 0, total_cost_usd: 0, source_type: 'cache' },
    { organization_id: null, process_type: 'ga4', reference_type: null, provider_name: 'google', model_name: null, total_tokens: 0, total_cost_usd: 0.5, source_type: 'external_api' },
    { organization_id: null, process_type: 'probe', reference_type: 'ai_visibility_probe', provider_name: 'gemini', model_name: 'g', total_tokens: 10, total_cost_usd: 0.25, source_type: 'system' },
  ];
  // The unified ledger holds ONLY company rows (P1): one customer llm row, one org-attributed system row.
  unifiedRows = [
    { organization_id: ORG, final_attempt: true, action_key: 'blog_generation', source_type: 'llm', provider_name: 'openai', model_name: 'gpt-4o', total_tokens: 50, api_cost_usd: 2.0, credits_charged: 10, credits_value_usd: 3.0, margin_usd: 1.0 },
    { organization_id: ORG, final_attempt: true, action_key: 'ai_visibility_probe', source_type: 'system', provider_name: 'gemini', model_name: 'g', total_tokens: 5, api_cost_usd: 0.125, credits_charged: 0, credits_value_usd: 0, margin_usd: -0.125 },
  ];
});

it('the platform read takes EVERY null-org usage row - it no longer filters source_type = system', async () => {
  await getPlatformCostAccounting(W);
  const ops = filters.usage_events;
  expect(ops).toEqual(expect.arrayContaining([['is', ['organization_id', null]]]));
  expect(ops.filter(([op, args]) => op === 'eq' && args[0] === 'source_type')).toEqual([]);
});

it('platform total = the null-org population (1.75) + org-attributed system spend (0.125), each counted ONCE', async () => {
  const r = await getPlatformCostAccounting(W);
  expect(r.totalPlatformCostUsd).toBeCloseTo(1.0 + 0 + 0.5 + 0.25 + 0.125, 10);
  expect(r.events).toBe(4 + 1);
  // the platform activities are there (so the next line is not vacuous) and the customer llm row is NOT platform spend
  const keys = r.byActivity.map((a) => a.key);
  expect(keys).toEqual(expect.arrayContaining(['content_basic', 'ga4', 'ai_visibility_probe']));
  expect(keys).not.toContain('blog_generation');
});

it('CONTROL: with no platform rows, the platform total is only the org-attributed system spend', async () => {
  usageRows = [];
  const r = await getPlatformCostAccounting(W);
  expect(r.totalPlatformCostUsd).toBeCloseTo(0.125, 10);
  expect(r.events).toBe(1);
});
