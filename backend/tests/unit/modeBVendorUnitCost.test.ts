/**
 * Mode B: vendor unit cost -> tenant credits, through the EXISTING pricing layer.
 * Owner rule: price = vendor cost x 1.5 (action cost_multiplier), converted at
 * the org's own credit_rate_usd. No vendor cost configured -> refuse.
 */
const rows: Record<string, unknown> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lte', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    return chain;
  },
}));

import { PricingMissingError, resolveVendorUnitCost } from '../../services/pricingService';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const unitRow = (usdPerUnit: number) => ({
  provider: 'apollo', model_name: 'credit', kind: 'unit',
  input_per_1k_usd: usdPerUnit * 1000, output_per_1k_usd: 0, effective_from: '2026-11-01T00:00:00Z',
});
const actionRow = (over: Record<string, unknown> = {}) => ({
  action_key: 'prospect_enrichment', cost_multiplier: 1.5, minimum_charge_usd: 0, ceiling_usd: 5, effective_from: '2026-11-01T00:00:00Z', ...over,
});

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  rows.llm_model_pricing = unitRow(0.2);
  rows.action_pricing_config = actionRow();
  rows.organization_credits = { credit_rate_usd: 0.02 };
});

const call = (units = 1) => resolveVendorUnitCost({ provider: 'Apollo', unit: 'credit', units, actionKey: 'prospect_enrichment', orgId: ORG });

it('price = units x unit cost x 1.5, credits = ceil(price / the org credit rate)', async () => {
  const r = await call(1);
  expect(r.total_cost_usd).toBeCloseTo(0.2);
  expect(r.final_price_usd).toBeCloseTo(0.3);
  expect(r.credits).toBe(15);
  const two = await call(2);
  expect(two.credits).toBe(30);
  expect(r.pricing_snapshot).toMatchObject({ provider: 'apollo', unit: 'credit', kind: 'unit', usd_per_unit: 0.2, cost_multiplier: 1.5, credit_rate_usd: 0.02 });
});

it('uses each org\'s OWN credit rate (the $0.018 divisor was dropped)', async () => {
  rows.organization_credits = { credit_rate_usd: 0.026 };
  expect((await call(1)).credits).toBe(Math.ceil(0.3 / 0.026));
});

it('the action ceiling and minimum still apply', async () => {
  rows.action_pricing_config = actionRow({ ceiling_usd: 0.1 });
  expect((await call(1)).final_price_usd).toBeCloseTo(0.1);
  rows.action_pricing_config = actionRow({ minimum_charge_usd: 1 });
  expect((await call(1)).final_price_usd).toBeCloseTo(1);
});

it('NO vendor cost set -> PricingMissingError (platform-funded calls refuse)', async () => {
  delete rows.llm_model_pricing;
  await expect(call(1)).rejects.toBeInstanceOf(PricingMissingError);
});

it('a zero vendor cost is a misconfiguration, never "free"', async () => {
  rows.llm_model_pricing = unitRow(0);
  await expect(call(1)).rejects.toBeInstanceOf(PricingMissingError);
});

it('no action pricing row -> refuses', async () => {
  delete rows.action_pricing_config;
  await expect(call(1)).rejects.toThrow(/Missing action_pricing_config row/);
});

it('units must be positive', async () => {
  await expect(call(0)).rejects.toThrow(/units must be a positive number/);
});

it('floating-point noise never adds a credit (0.2 x 1.5 / 0.02 is exactly 15)', async () => {
  expect((await call(1)).credits).toBe(15);
  rows.llm_model_pricing = unitRow(0.1);
  rows.organization_credits = { credit_rate_usd: 0.01 };
  expect((await call(3)).credits).toBe(45); // 0.1*3*1.5/0.01 = 45, not 46
});

it('a genuine fraction of a credit still rounds UP', async () => {
  rows.llm_model_pricing = unitRow(0.21);
  expect((await call(1)).credits).toBe(16); // 0.315 / 0.02 = 15.75 -> 16
});

describe('creditsForPriceUsd: the ONE shared rounding (83 request)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { creditsForPriceUsd } = require('../../services/pricingService');
  it('an exact ratio is not over-rounded by float noise', () => {
    expect(0.2 * 1.5 / 0.02).toBeGreaterThan(15);         // the float noise is real
    expect(creditsForPriceUsd(0.2 * 1.5, 0.02)).toBe(15);
  });
  it('a real fraction still rounds UP', () => {
    expect(creditsForPriceUsd(0.301, 0.02)).toBe(16);
  });
  it('refuses a non-positive rate or a negative/NaN price', () => {
    expect(() => creditsForPriceUsd(1, 0)).toThrow();
    expect(() => creditsForPriceUsd(-1, 0.01)).toThrow();
    expect(() => creditsForPriceUsd(Number.NaN, 0.01)).toThrow();
  });
});
