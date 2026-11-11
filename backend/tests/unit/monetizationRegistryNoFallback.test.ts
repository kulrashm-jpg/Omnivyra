/**
 * MONEY (owner ruling via e9, 2026-11-12): every billable action has its OWN
 * registry entry, and the registry FAILS CLOSED - an identifier that names no
 * entry resolves to null, never to the first report entry (website_audit).
 *
 * Static: CREDIT_ACTIONS is read from the backend union so a new action added
 * without a registry entry fails here before it can be priced by another row.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { CREDIT_ACTIONS } from '../../services/creditDeductionService';
import {
  MONETIZATION_FEATURE_REGISTRY,
  resolveCreditCostConfigKey,
  resolveFeatureFromActionKey,
  resolveFeatureFromReport,
  resolveMonetizationFeature,
  getReportChargingIdentity,
} from '../../../shared/monetization/featureRegistry';

it.each(CREDIT_ACTIONS)('%s has its own registry entry, priced by its own key or a declared remap', (k) => {
  const entry = resolveFeatureFromActionKey(k);
  expect(entry).not.toBeNull();
  const r = resolveMonetizationFeature({ action_key: k });
  expect(r?.feature_key).toBe(entry!.feature_key);
  if (k !== 'website_audit') expect(r?.feature_key).not.toBe('reports.website_audit');
});

it('the accepted family mapping: display from the family, every pricing key = the action itself', () => {
  const expectFamily: Array<[string, string]> = [
    ['blog_generation', 'Content Generation'], ['campaign_chat', 'Content Generation'],
    ['engagement_refine', 'AI Replies'], ['chat_theme_refine', 'Insights & Trends'],
    ['recommendations_opportunities', 'Insights & Trends'], ['recommendations_generate', 'Campaigns'],
    ['async_campaign_planning', 'Campaigns'],
  ];
  for (const [k, group] of expectFamily) {
    const e = resolveFeatureFromActionKey(k)!;
    expect([k, e.display_group]).toEqual([k, group]);
    expect(e.pricing_keys).toEqual({ action_key: k, credit_cost_config: k, action_pricing_config: k, usage_action_key: k });
  }
  expect(resolveFeatureFromActionKey('video_generation')?.feature_key).toBe('ai_generation.video_generation');
});

it('image_generation is claimed by EXACTLY ONE entry, and the vendor-priced one wins when present (05, merge guard)', () => {
  // On this branch the family entry is the only claimant. Once fix/image-credits
  // lands its BASE entry (creator_content.image_generation, action_pricing_config
  // vendor pricing), the family generator must SKIP image_generation: a second
  // claimant, or resolution to the family entry, fails here.
  const claimants = MONETIZATION_FEATURE_REGISTRY.filter((e) =>
    [e.pricing_keys.action_key, e.pricing_keys.credit_cost_config, e.pricing_keys.action_pricing_config, e.pricing_keys.usage_action_key]
      .includes('image_generation'));
  expect(claimants).toHaveLength(1);
  const vendorPriced = MONETIZATION_FEATURE_REGISTRY.find((e) => e.feature_key === 'creator_content.image_generation'
    && e.pricing_strategy === 'action_pricing_config');
  if (vendorPriced) {
    expect(resolveFeatureFromActionKey('image_generation')).toBe(vendorPriced);
    expect(resolveCreditCostConfigKey('image_generation')).toBe('image_generation');
  }
});

it('feature keys stay unique', () => {
  const keys = MONETIZATION_FEATURE_REGISTRY.map((e) => e.feature_key);
  expect(new Set(keys).size).toBe(keys.length);
});

it('fails closed: an unknown action / pricing key / process type / feature key resolves to null', () => {
  expect(resolveMonetizationFeature({ action_key: 'no_such_action' })).toBeNull();
  expect(resolveMonetizationFeature({ pricing_key: 'no_such_action' })).toBeNull();
  expect(resolveMonetizationFeature({ process_type: 'noSuchProcess' })).toBeNull();
  expect(resolveMonetizationFeature({ feature_key: 'no.such' })).toBeNull();
  expect(resolveMonetizationFeature({})).toBeNull();
  expect(resolveFeatureFromReport({})).toBeNull();
});

it('report resolution is unchanged when a report field IS given', () => {
  expect(getReportChargingIdentity({ report_category: 'snapshot' as never }).action_key).toBe('website_audit');
});
