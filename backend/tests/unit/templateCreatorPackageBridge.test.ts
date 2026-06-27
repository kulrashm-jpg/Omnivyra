import {
  buildCreatorCampaignPackage,
  creatorResultToPackageAssets,
  buildCampaignHandoff,
} from '../../../lib/creator-templates';

const ctx = {
  templateName: 'Statistics', templateId: 'sys-infographic-statistics', assetFamily: 'infographic',
  selectedPlatform: 'linkedin',
  campaign: { name: 'Launch', objective: 'Awareness', audience: 'Founders', platforms: ['linkedin'] },
  edited: false, regenerations: 0, inProgress: false,
};
const okResult = {
  success: true, primary_platform: 'linkedin', persisted_asset_id: 'asset-1',
  output: {
    asset_type: 'infographic',
    packaging: { caption: 'A caption', cta: 'Learn more' },
    asset_payload: { media_bundle: { url: 'https://cdn/x.png', files: ['https://cdn/x.png'], metadata: {
      brand_mode: 'brand-aware', applied_variant: { variant_family: 'mvp' },
      creator_diagnostic_report: { generatedAt: '2026-06-26T10:00:00Z', template: { id: 'sys-infographic-statistics', name: 'Statistics', version: 2 }, rendering: { brandingProfile: 'balanced' } },
    } } },
  },
};

describe('PLATFORM-001 canonical creator-result → package projection (single implementation)', () => {
  it('single asset: projects all canonical fields from existing metadata', () => {
    const assets = creatorResultToPackageAssets(okResult, ctx);
    expect(assets.length).toBe(1);
    const a = assets[0];
    expect(a.id).toBe('asset-1');
    expect(a.assetType).toBe('infographic');
    expect(a.template).toBe('Statistics');
    expect(a.templateId).toBe('sys-infographic-statistics');
    expect(a.variant).toBe('mvp');
    expect(a.platform).toBe('linkedin');
    expect(a.cta).toBe('Learn more');
    expect(a.branding).toBe('balanced');
    expect(a.url).toBe('https://cdn/x.png');
    expect(a.caption).toBe('A caption');
    expect(a.generatedAt).toBe('2026-06-26T10:00:00Z');
    expect(a.status).toBe('completed');
  });

  it('builds a complete package + feeds the canonical handoff/adapters', () => {
    const pkg = buildCreatorCampaignPackage(okResult, ctx);
    expect(pkg.metadata.name).toBe('Launch');
    expect(pkg.readyForPublishing).toBe(true);
    const h = buildCampaignHandoff(pkg);
    expect(h.publishing.items[0].url).toBe('https://cdn/x.png');
    expect(h.publishing.items[0].trace.templateId).toBe('sys-infographic-statistics');
    expect(h.readiness.readyForPublishing).toBe(true);
  });

  it('multi-asset fan-out → one PackageAsset per variant (status from ok)', () => {
    const r = { ...okResult, generated_assets: [
      { rank: 0, variant_family: 'mvp', ok: true, persisted_asset_id: 'a0', asset_type: 'image' },
      { rank: 1, variant_family: 'risk', ok: false, error: 'render timeout', asset_type: 'carousel' },
    ] };
    const assets = creatorResultToPackageAssets(r, ctx);
    expect(assets.length).toBe(2);
    expect(assets[0].status).toBe('completed');
    expect(assets[1].status).toBe('failed');
    const pkg = buildCreatorCampaignPackage(r, ctx);
    expect(pkg.metadata.status).toBe('partial');
    expect(pkg.readyForPublishing).toBe(false);
  });

  it('in-progress + no diagnostic: degrades gracefully to template context', () => {
    const assets = creatorResultToPackageAssets({ output: { asset_type: 'image' } }, { ...ctx, inProgress: true });
    expect(assets[0].status).toBe('processing');
    expect(assets[0].template).toBe('Statistics'); // falls back to ctx template name
    expect(assets[0].templateId).toBe('sys-infographic-statistics');
  });

  it('is deterministic', () => {
    expect(buildCreatorCampaignPackage(okResult, ctx)).toEqual(buildCreatorCampaignPackage(okResult, ctx));
  });
});
