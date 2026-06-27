jest.mock('../../db/supabaseClient', () => {
  const builder = () => { const b: any = { select: () => b, eq: () => b, order: () => Promise.resolve({ data: [], error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }; return b; };
  return { supabase: { from: () => builder() } };
});

import { plannedAssetFromCard, validatePlannedCard, validateCampaignPlanAssets, plannedAssetsFromActivities } from '../../services/creator/campaignPlanValidationService';

describe('CAMPAIGN-004 approval-gate extraction (no inference)', () => {
  it('extracts only template-bearing activities, reading intent verbatim', () => {
    const activities = [
      { week_number: 1, platform: 'linkedin', content_type: 'carousel', template_id: 'sys-carousel-educational-5', slide_count: 7 },
      { week_number: 1, platform: 'x', content_type: 'post' }, // no template → skipped
      { week_number: 2, platform: 'linkedin', content_type: 'infographic', creator_card: { template_id: 'sys-infographic-timeline' }, infographic_layout: 'timeline' },
    ];
    const planned = plannedAssetsFromActivities(activities);
    expect(planned.length).toBe(2);
    expect(planned[0]).toMatchObject({ templateId: 'sys-carousel-educational-5', assetFamily: 'carousel', slideCount: 7 });
    expect(planned[0].sectionCount).toBeUndefined(); // not inferred
    expect(planned[1]).toMatchObject({ templateId: 'sys-infographic-timeline', assetFamily: 'infographic', layout: 'timeline' });
  });

  it('approval passes a valid plan and fails an incompatible one', async () => {
    const good = plannedAssetsFromActivities([
      { platform: 'linkedin', content_type: 'carousel', template_id: 'sys-carousel-educational-5', slide_count: 5 },
    ]);
    expect((await validateCampaignPlanAssets(good)).ok).toBe(true);

    const bad = plannedAssetsFromActivities([
      { platform: 'linkedin', content_type: 'carousel', template_id: 'sys-image-headline', slide_count: 5 }, // image template on carousel slot
    ]);
    expect((await validateCampaignPlanAssets(bad)).ok).toBe(false);
  });
});

describe('CAMPAIGN-003 plan validation service', () => {
  it('projects a creator_card onto a PlannedAsset', () => {
    const p = plannedAssetFromCard({ template_id: 'sys-carousel-educational-5', slide_count: 5, infographic_layout: '', writer_asset_type: 'carousel' }, 'carousel');
    expect(p).toMatchObject({ templateId: 'sys-carousel-educational-5', assetFamily: 'carousel', slideCount: 5 });
    expect(plannedAssetFromCard({}, 'carousel')).toBeNull(); // no template_id
  });

  it('accepts a card whose template family matches the content type', async () => {
    const r = await validatePlannedCard({ template_id: 'sys-carousel-educational-5', slide_count: 5 }, 'carousel');
    expect(r?.ok).toBe(true);
  });

  it('rejects a card whose template family mismatches the content type (before generation)', async () => {
    const r = await validatePlannedCard({ template_id: 'sys-image-headline' }, 'carousel');
    expect(r?.ok).toBe(false);
    expect(r?.errors.join(' ')).toMatch(/Planned carousel but the selected template is image/);
  });

  it('is graceful for an unresolved template id (legacy/stale → default, not rejected)', async () => {
    const r = await validatePlannedCard({ template_id: 'user-deleted-xyz' }, 'image');
    expect(r?.ok).toBe(true);
    expect(r?.descriptor).toBeNull();
  });

  it('returns null when the card carries no template', async () => {
    expect(await validatePlannedCard({}, 'image')).toBeNull();
  });

  it('validates a multi-asset, mixed-family campaign plan', async () => {
    const ok = await validateCampaignPlanAssets([
      { templateId: 'sys-carousel-educational-5', assetFamily: 'carousel', slideCount: 5, label: 'C' },
      { templateId: 'sys-image-headline-sub-cta', assetFamily: 'image', requiresCTA: true, label: 'I' },
      { templateId: 'sys-infographic-timeline', assetFamily: 'infographic', layout: 'timeline', label: 'T' },
    ]);
    expect(ok.ok).toBe(true);

    const bad = await validateCampaignPlanAssets([
      { templateId: 'sys-carousel-educational-5', assetFamily: 'carousel', label: 'C' },
      { templateId: 'sys-infographic-statistics', assetFamily: 'infographic', layout: 'timeline', label: 'Bad' },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.perAsset.find((a) => a.label === 'Bad')?.ok).toBe(false);
  });
});
