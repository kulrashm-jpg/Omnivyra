import { generatePromotionMetadata } from '../../services/promotionMetadataService';
import { formatPlatformContent } from '../../services/platformContentFormatter';
import { validatePlatformCompliance } from '../../services/platformComplianceService';
import * as platformPromotionStore from '../../db/platformPromotionStore';
import * as campaignMemoryService from '../../services/campaignMemoryService';
import * as contentOverlapService from '../../services/contentOverlapService';

jest.mock('../../db/platformPromotionStore', () => ({
  savePromotionMetadata: jest.fn(async (input: any) => input),
  savePlatformVariant: jest.fn(async (input: any) => input),
  saveComplianceReport: jest.fn(async (input: any) => input),
  getPlatformRule: jest.fn(async () => null),
}));
jest.mock('../../services/campaignMemoryService', () => ({
  getCampaignMemory: jest.fn().mockResolvedValue({
    pastThemes: [],
    pastTopics: [],
    pastHooks: [],
    pastTrendsUsed: [],
    pastPlatforms: [],
    pastContentSummaries: [],
  }),
}));
jest.mock('../../services/contentOverlapService', () => ({
  detectContentOverlap: jest.fn().mockResolvedValue({
    overlapDetected: false,
    similarityScore: 0.1,
  }),
}));

describe('Platform promotion metadata', () => {
  beforeEach(() => {
    process.env.OMNIVYRA_BASE_URL = 'https://omnivyra.test';
    delete process.env.USE_OMNIVYRA;
    (global as any).fetch = jest.fn();
  });

  it('generates promotion metadata', async () => {
    const metadata = await generatePromotionMetadata({
      companyId: 'comp-1',
      contentAssetId: 'asset-1',
      platform: 'linkedin',
      content: { headline: 'Headline', caption: 'Caption', hook: 'Hook', callToAction: 'CTA' },
    });
    expect(metadata.hashtags.length).toBeGreaterThan(0);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('uses OmniVyra metadata when enabled', async () => {
    process.env.USE_OMNIVYRA = 'true';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          decision_id: 'dec-10',
          confidence: 0.8,
          placeholders: [],
          explanation: 'Promo intelligence',
          contract_version: 'v1',
          data: {
            hashtags: ['#omnivyra'],
            keywords: ['omnivyra'],
            seo_title: 'SEO Title',
            seo_description: 'SEO Desc',
            meta_tags: ['tag1'],
            alt_text: 'Alt text',
            cta: 'Act now',
            confidence: 0.9,
          },
        }),
    });
    const metadata = await generatePromotionMetadata({
      companyId: 'comp-1',
      contentAssetId: 'asset-2',
      platform: 'linkedin',
      content: { headline: 'Headline', caption: 'Caption', hook: 'Hook', callToAction: 'CTA' },
    });
    expect((global as any).fetch).toHaveBeenCalled();
    expect(metadata.hashtags).toEqual(['#omnivyra']);
    expect(metadata.seo_title).toBe('SEO Title');
  });

  it('formats platform content', async () => {
    jest.spyOn(platformPromotionStore, 'getPlatformRule').mockResolvedValue({
      platform: 'linkedin',
      content_type: 'text',
      max_length: 300,
      min_length: 50,
      allowed_formats: ['text'],
      required_fields: [],
    } as any);
    const formatted = await formatPlatformContent({
      contentAssetId: 'asset-1',
      platform: 'linkedin',
      contentType: 'text',
      content: { caption: 'Caption', hook: 'Hook', callToAction: 'CTA' },
      hashtags: ['#test'],
    });
    expect(formatted.variant.formatted_content).toContain('Caption');
  });

  it('validates compliance', async () => {
    const compliance = await validatePlatformCompliance({
      contentAssetId: 'asset-1',
      platform: 'linkedin',
      contentType: 'text',
      formattedContent: 'Short content',
      rule: { min_length: 5, max_length: 100, required_fields: [] },
      promotionMetadata: {},
    });
    expect(compliance.status).toBe('ok');
  });
});
