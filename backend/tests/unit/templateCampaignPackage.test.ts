import {
  buildCampaignPackage,
  checkPackageConsistency,
  buildPackageTimeline,
  buildPackageExportManifest,
  assetFamily,
  type PackageAsset,
} from '../../../lib/creator-templates';

const A = (over: Partial<PackageAsset>): PackageAsset => ({
  id: 'a', assetType: 'image', template: 'Headline', templateId: 'sys-image', variant: null, platform: 'linkedin',
  cta: 'Learn more', branding: 'balanced', status: 'completed', previewUrl: 'u', url: 'u', files: ['u'], caption: 'cap',
  generatedAt: '2026-06-26T10:00:00Z', ...over,
});

const campaign = { name: 'Launch', objective: 'Awareness', audience: 'Founders', platforms: ['linkedin'] };

describe('CAMPAIGN-005 campaign package (deterministic, reference-only)', () => {
  it('single-asset package: metadata, slot, summary, ready flags', () => {
    const p = buildCampaignPackage({ campaign, assets: [A({})] });
    expect(p.metadata.assetCount).toBe(1);
    expect(p.metadata.status).toBe('complete');
    expect(p.slots.hero).not.toBeNull();
    expect(p.includedAssets.length).toBe(1);
    expect(p.readyForPublishing).toBe(true);
    expect(p.readyForScheduling).toBe(true);
    expect(p.cta).toBe('Learn more');
    expect(p.missingAssets).toEqual(expect.arrayContaining(['Carousel', 'Infographic', 'Banner']));
  });

  it('multi-asset mixed families fill distinct slots', () => {
    const p = buildCampaignPackage({ campaign, assets: [
      A({ id: '1', assetType: 'image' }),
      A({ id: '2', assetType: 'carousel', template: 'Edu' }),
      A({ id: '3', assetType: 'infographic', template: 'Stats' }),
      A({ id: '4', assetType: 'banner', template: 'Hero' }),
    ] });
    expect(p.slots.hero?.id).toBe('1');
    expect(p.slots.carousel?.id).toBe('2');
    expect(p.slots.infographic?.id).toBe('3');
    expect(p.slots.banner?.id).toBe('4');
    expect(p.missingAssets.length).toBe(0);
    expect(p.metadata.templates.length).toBe(4);
  });

  it('partial generation: failed asset → partial status + warning, not publish-ready', () => {
    const p = buildCampaignPackage({ campaign, assets: [A({ id: '1' }), A({ id: '2', assetType: 'carousel', status: 'failed' })] });
    expect(p.metadata.status).toBe('partial');
    expect(p.readyForPublishing).toBe(false);
    expect(p.warnings.join(' ')).toMatch(/failed/);
  });

  it('consistency: detects CTA + branding + platform mismatch', () => {
    const checks = checkPackageConsistency([
      A({ id: '1', cta: 'Learn more', branding: 'balanced', platform: 'linkedin' }),
      A({ id: '2', cta: 'Buy now', branding: 'strong', platform: 'tiktok' }),
    ], campaign);
    expect(checks.find((c) => c.key === 'cta')!.ok).toBe(false);
    expect(checks.find((c) => c.key === 'branding')!.ok).toBe(false);
    expect(checks.find((c) => c.key === 'platform')!.ok).toBe(false);
    expect(checks.find((c) => c.key === 'objective')!.ok).toBe(true);
  });

  it('consistency passes when assets align', () => {
    const p = buildCampaignPackage({ campaign, assets: [A({ id: '1' }), A({ id: '2', assetType: 'carousel' })] });
    expect(p.consistency.every((c) => c.ok)).toBe(true);
    expect(p.warnings.length).toBe(0);
  });

  it('timeline reflects generated/edited/regenerated/published/scheduled', () => {
    const t = buildPackageTimeline([A({ edited: true, regenerations: 2, published: true, scheduledAt: '2026-06-27T00:00:00Z' })]);
    expect(t.map((e) => e.kind)).toEqual(['generated', 'edited', 'regenerated', 'published', 'scheduled']);
  });

  it('export manifest bundles references + metadata + summary (no pixels)', () => {
    const p = buildCampaignPackage({ campaign, assets: [A({})] });
    const m = buildPackageExportManifest(p, '2026-06-26T12:00:00Z');
    expect(m.campaign.name).toBe('Launch');
    expect(m.assets[0].url).toBe('u');
    expect(m.summary).toContain('asset');
    expect(m.exportedAt).toBe('2026-06-26T12:00:00Z');
  });

  it('empty package is deterministic and not ready', () => {
    const p = buildCampaignPackage({ campaign: { name: 'X' }, assets: [] });
    expect(p.metadata.status).toBe('empty');
    expect(p.readyForPublishing).toBe(false);
    expect(buildCampaignPackage({ campaign: { name: 'X' }, assets: [] })).toEqual(p);
    expect(assetFamily('slider')).toBe('carousel');
  });
});
