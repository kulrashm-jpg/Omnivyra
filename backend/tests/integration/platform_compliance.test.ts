import { validatePlatformCompliance } from '../../services/platformComplianceService';

jest.mock('../../db/platformPromotionStore', () => ({
  saveComplianceReport: jest.fn(async (input: any) => input),
}));

describe('Platform compliance', () => {
  beforeEach(() => {
    process.env.OMNIVYRA_BASE_URL = 'https://omnivyra.test';
    delete process.env.USE_OMNIVYRA;
    (global as any).fetch = jest.fn();
  });

  it('flags missing required fields', async () => {
    const report = await validatePlatformCompliance({
      contentAssetId: 'asset-1',
      platform: 'instagram',
      contentType: 'image',
      formattedContent: 'Test content',
      rule: { required_fields: ['hashtags'], min_length: 5, max_length: 100 },
      promotionMetadata: {},
    });
    expect(report.status).toBe('blocked');
  });

  it('blocks scheduling when OmniVyra returns block', async () => {
    process.env.USE_OMNIVYRA = 'true';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          decision_id: 'dec-block',
          confidence: 0.6,
          placeholders: [],
          explanation: 'Compliance blocked',
          contract_version: 'v1',
          data: { status: 'block', violations: ['Unsafe content'], warnings: [] },
        }),
    });
    const report = await validatePlatformCompliance({
      contentAssetId: 'asset-1',
      platform: 'instagram',
      contentType: 'image',
      formattedContent: 'Test content',
      rule: { required_fields: ['hashtags'], min_length: 5, max_length: 100 },
      promotionMetadata: {},
    });
    expect(report.status).toBe('blocked');
  });

  it('warns when below min length', async () => {
    const report = await validatePlatformCompliance({
      contentAssetId: 'asset-1',
      platform: 'x',
      contentType: 'text',
      formattedContent: 'Tiny',
      rule: { required_fields: [], min_length: 10, max_length: 280 },
      promotionMetadata: {},
    });
    expect(report.status).toBe('warning');
  });
});
