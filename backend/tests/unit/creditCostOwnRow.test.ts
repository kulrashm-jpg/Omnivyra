/**
 * MONEY (owner ruling via e9, 2026-11-12, BLOCKING): an action is priced by
 * its OWN credit_cost_config row.
 *
 * Defect: getCreditCost / getSmartModeDedupSeconds / fetchFlatCreditCost
 * resolved the row through resolveMonetizationFeature(), whose last resort is
 * a report lookup that, for a key no registry entry names, returns the first
 * report entry - website_audit. 21 CreditActions fell through: each was
 * charged 50 credits (blog_generation under-charged 60 -> 50; campaign_chat
 * over-charged 1 -> 50) and given website_audit's 24h smart-dedup window, and
 * the billing page's "Blog article" preview read 50.
 */
const ORG = '00000000-0000-4000-8000-0000000000a1';
let mockDb: ReturnType<typeof import('../support/fakeCreditCatalogDb').makeFakeCatalogDb>;
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn() },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));

import { makeFakeCatalogDb, SEEDED_CREDIT_COST_CONFIG } from '../support/fakeCreditCatalogDb';
import { CREDIT_ACTIONS, getCreditCost, getSmartModeDedupSeconds, type CreditAction } from '../../services/creditDeductionService';
import { resolveActivityCreditRange } from '../../services/pricingService';
import {
  resolveCreditCostConfigKey,
  resolveFeatureFromActionKey,
  resolveMonetizationFeature,
} from '../../../shared/monetization/featureRegistry';

const OWN_PRICE = new Map(SEEDED_CREDIT_COST_CONFIG.map((r) => [r.action_type as string, r.credits as number]));
const FORMER_FALLBACKS = SEEDED_CREDIT_COST_CONFIG.map((r) => r.action_type as CreditAction).filter((k) => k !== 'website_audit');

beforeEach(() => {
  mockDb = makeFakeCatalogDb({
    credit_cost_config: SEEDED_CREDIT_COST_CONFIG,
    action_pricing_config: [],
    organization_credits: [{ organization_id: ORG, credit_rate_usd: 0.01 }],
  });
});

it('the 19 seeded former-fallback keys are exactly the unregistered CreditActions with a flat row', () => {
  expect(FORMER_FALLBACKS).toHaveLength(19);
  for (const k of FORMER_FALLBACKS) {
    expect(CREDIT_ACTIONS).toContain(k);
    expect(resolveFeatureFromActionKey(k)).toBeNull();
  }
});

it.each(FORMER_FALLBACKS)('getCreditCost(%s) charges its OWN row, never website_audit', async (k) => {
  await expect(getCreditCost(k)).resolves.toBe(OWN_PRICE.get(k));
  expect(mockDb.queried.at(-1)).toEqual({ table: 'credit_cost_config', filters: [['action_type', k]] });
});

it('blog_generation: 60 (was 50); campaign_chat: 1 (was 50)', async () => {
  await expect(getCreditCost('blog_generation')).resolves.toBe(60);
  await expect(getCreditCost('campaign_chat')).resolves.toBe(1);
});

it('no CreditAction other than website_audit itself resolves to the website_audit row', () => {
  for (const k of CREDIT_ACTIONS) {
    if (k === 'website_audit') continue;
    expect([k, resolveCreditCostConfigKey(k)]).not.toEqual([k, 'website_audit']);
  }
});

it('registered keys are unchanged: the exact-match key equals what the registry declared before', () => {
  const registered = CREDIT_ACTIONS.filter((k) => resolveFeatureFromActionKey(k));
  expect(registered.length).toBeGreaterThan(0);
  for (const k of registered) {
    const before = resolveMonetizationFeature({ action_key: k })?.feature.pricing_keys.credit_cost_config ?? k;
    expect([k, resolveCreditCostConfigKey(k)]).toEqual([k, before]);
  }
});

it('measured: lead_qualification and lead_predictive_scoring resolve exactly to their own rows', () => {
  expect(resolveCreditCostConfigKey('lead_qualification')).toBe('lead_qualification');
  expect(resolveCreditCostConfigKey('lead_predictive_scoring')).toBe('lead_predictive_scoring');
});

it('a key with no row of its own fails LOUDLY, naming the key - never another action\'s price', async () => {
  await expect(getCreditCost('video_generation')).rejects.toThrow(/missing credit cost config for video_generation/);
});

it('smart-mode dedup reads the action\'s own window: campaign_chat none (was 24h), recommendations_generate 3600', async () => {
  await expect(getSmartModeDedupSeconds('campaign_chat')).resolves.toBeUndefined();
  await expect(getSmartModeDedupSeconds('recommendations_generate')).resolves.toBe(3600);
});

it('cost preview (resolveActivityCreditRange): blog_generation is a flat 60 from its own row', async () => {
  await expect(resolveActivityCreditRange('blog_generation', ORG)).resolves.toMatchObject({
    actionKey: 'blog_generation', minCredits: 60, maxCredits: 60, expectedCredits: 60, tokenPriced: false, source: 'credit_cost_config',
  });
});
