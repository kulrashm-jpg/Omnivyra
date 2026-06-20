/**
 * Phase 6B-2 — proves `allowed_formats` was removed from platformRulesService
 * without breaking the service, and that no runtime dependency on it remains.
 * Platform↔format capability is owned solely by PLATFORM_CAPABILITY_REGISTRY.
 */

jest.mock('@/backend/services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: () => false,
  getPlatformRules: jest.fn(),
}));
jest.mock('@/backend/db/platformPromotionStore', () => ({
  getPlatformRule: jest.fn().mockResolvedValue(null),   // force the in-code fallback path
  listPlatformRules: jest.fn().mockResolvedValue([]),
  upsertPlatformRule: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/backend/services/omnivyraHealthService', () => ({
  setLastFallbackReason: jest.fn(),
}));

import { getRulesForPlatform } from '@/backend/services/platformRulesService';

describe('Phase 6B-2 — allowed_formats authority removed', () => {
  test('fallback rule still resolves with its real fields, but no allowed_formats', async () => {
    const rule = await getRulesForPlatform({ platform: 'linkedin', contentType: 'text' });
    // service still works (other fields intact)
    expect(rule.max_length).toBe(3000);
    expect(rule.frequency_per_week).toBe(3);
    expect(Array.isArray(rule.best_times)).toBe(true);
    // the removed authority is gone
    expect(rule.allowed_formats).toBeUndefined();
    expect('allowed_formats' in rule).toBe(false);
  });

  test('a former video-format platform also carries no allowed_formats', async () => {
    const rule = await getRulesForPlatform({ platform: 'youtube', contentType: 'video' });
    expect(rule.max_length).toBe(5000);
    expect(rule.allowed_formats).toBeUndefined();
  });

  test('placeholder rule (unknown platform) carries no allowed_formats', async () => {
    const rule = await getRulesForPlatform({ platform: 'nonexistent', contentType: 'text' });
    expect(rule.source).toBe('placeholder');
    expect(rule.allowed_formats).toBeUndefined();
  });
});
