import {
  buildCampaignPackage,
  buildCampaignHandoff,
  packageReadiness,
  PublishingAdapter,
  SchedulingAdapter,
  CalendarAdapter,
  AnalyticsAdapter,
  EngagementAdapter,
  type PackageAsset,
} from '../../../lib/creator-templates';

const A = (over: Partial<PackageAsset>): PackageAsset => ({
  id: 'a1', assetType: 'image', template: 'Headline', templateId: 'sys-image', variant: 'mvp', platform: 'linkedin',
  cta: 'Learn more', branding: 'balanced', status: 'completed', previewUrl: 'u', url: 'https://cdn/a.png', files: ['https://cdn/a.png'],
  caption: 'Caption', generatedAt: '2026-06-26T10:00:00Z', ...over,
});
const campaign = { name: 'Launch', objective: 'Awareness', audience: 'Founders', platforms: ['linkedin'] };
const completePkg = buildCampaignPackage({ campaign, assets: [A({ id: '1' }), A({ id: '2', assetType: 'carousel', template: 'Edu' })] });
const partialPkg = buildCampaignPackage({ campaign, assets: [A({ id: '1' }), A({ id: '2', assetType: 'carousel', status: 'failed' })] });

describe('CAMPAIGN-006 campaign package handoff (canonical, adapters, ready flags)', () => {
  it('exposes the 5 channel ready flags from existing consistency', () => {
    const r = packageReadiness(completePkg);
    expect(r).toEqual({
      readyForPublishing: true,
      readyForScheduling: true,
      readyForCalendar: true,
      readyForAnalytics: true,
      readyForEngagement: true,
    });
  });

  it('partial package is not ready for publish/schedule/calendar/engagement, but analytics has data', () => {
    const r = packageReadiness(partialPkg);
    expect(r.readyForPublishing).toBe(false);
    expect(r.readyForScheduling).toBe(false);
    expect(r.readyForCalendar).toBe(false);
    expect(r.readyForEngagement).toBe(false);
    expect(r.readyForAnalytics).toBe(true); // the one completed asset is measurable
  });

  it('every adapter consumes the package and passes asset references (never regenerates)', () => {
    const pub = PublishingAdapter(completePkg);
    expect(pub.channel).toBe('publishing');
    expect(pub.items.length).toBe(2);
    expect(pub.items[0].url).toBe('https://cdn/a.png');
    expect(pub.items[0].files.length).toBe(1);
    expect(pub.ready).toBe(true);

    expect(SchedulingAdapter(completePkg).items.length).toBe(2);
    expect(CalendarAdapter(completePkg).entries[0].title).toBeTruthy();
    expect(AnalyticsAdapter(completePkg).targets[0].variant).toBe('mvp');
    expect(EngagementAdapter(completePkg).surfaces[0].cta).toBe('Learn more');
  });

  it('partial package adapters only hand off COMPLETED assets', () => {
    expect(PublishingAdapter(partialPkg).items.length).toBe(1);
    expect(SchedulingAdapter(partialPkg).items.length).toBe(1);
    expect(AnalyticsAdapter(partialPkg).targets.length).toBe(1);
  });

  it('every adapter item carries traceability back to package/asset/template/generation', () => {
    const t = PublishingAdapter(completePkg).items[0].trace;
    expect(t.package).toBe('Launch');
    expect(t.assetId).toBe('1');
    expect(t.templateId).toBe('sys-image');
    expect(t.generatedAt).toBe('2026-06-26T10:00:00Z');
  });

  it('buildCampaignHandoff is the single object referencing the package + all channels', () => {
    const h = buildCampaignHandoff(completePkg);
    expect(h.package).toBe(completePkg); // referenced, not duplicated
    expect(Object.keys(h)).toEqual(['package', 'readiness', 'publishing', 'scheduling', 'calendar', 'analytics', 'engagement']);
    expect(h.publishing.items.length).toBe(2);
    expect(h.readiness.readyForPublishing).toBe(true);
  });

  it('is deterministic and does not duplicate campaign metadata (single source = package)', () => {
    expect(buildCampaignHandoff(completePkg)).toEqual(buildCampaignHandoff(completePkg));
    const h = buildCampaignHandoff(completePkg);
    expect(h.publishing.campaign.name).toBe(h.package.metadata.name);
    expect(h.analytics.campaign.platforms).toEqual(h.package.metadata.platforms);
  });
});
