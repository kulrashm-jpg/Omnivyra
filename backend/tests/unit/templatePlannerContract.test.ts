import { getTemplateById } from '../../../lib/creator-templates';
import { describeTemplatePlan, validatePlannedAsset, validateCampaignPlan } from '../../../lib/creator-templates/plannerContract';

const car = getTemplateById('sys-carousel-educational-5')!;     // [5,7,10] default 5
const timeline = getTemplateById('sys-infographic-timeline')!;  // layout timeline
const stats = getTemplateById('sys-infographic-statistics')!;   // layout stats
const imgCta = getTemplateById('sys-image-headline-sub-cta')!;  // has cta field
const quote = getTemplateById('sys-image-quote-author')!;       // no cta field
const banner = getTemplateById('sys-banner-website-hero')!;     // banner lane

describe('CAMPAIGN-003 planner descriptor (from contract + formDefinition)', () => {
  it('derives planning facts deterministically', () => {
    const d = describeTemplatePlan(car);
    expect(d.family).toBe('carousel');
    expect(d.slideCountOptions).toEqual([5, 7, 10]);
    expect(d.defaultSlideCount).toBe(5);
    expect(describeTemplatePlan(timeline).layout).toBe('timeline');
    expect(describeTemplatePlan(imgCta).hasCTA).toBe(true);
    expect(describeTemplatePlan(quote).hasCTA).toBe(false);
    expect(describeTemplatePlan(banner).isBanner).toBe(true);
    expect(typeof describeTemplatePlan(stats).variantKey).toBe('string');
  });
});

describe('CAMPAIGN-003 planned-asset validation', () => {
  it('carousel slide count must be template-allowed', () => {
    expect(validatePlannedAsset(car, { templateId: car.id, slideCount: 7 }).ok).toBe(true);
    const bad = validatePlannedAsset(car, { templateId: car.id, slideCount: 6, label: 'Day 1' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/Planned 6 slide\(s\)/);
  });
  it('timeline plan must resolve a timeline-capable template', () => {
    expect(validatePlannedAsset(timeline, { templateId: timeline.id, layout: 'timeline' }).ok).toBe(true);
    const bad = validatePlannedAsset(stats, { templateId: stats.id, layout: 'timeline' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/Planned a timeline layout but the selected template renders stats/);
  });
  it('banner plan must resolve a banner-capable template', () => {
    expect(validatePlannedAsset(banner, { templateId: banner.id, banner: true }).ok).toBe(true);
    const bad = validatePlannedAsset(car, { templateId: car.id, banner: true, assetFamily: 'image' });
    expect(bad.ok).toBe(false);
  });
  it('CTA-requiring plan must expose a CTA', () => {
    expect(validatePlannedAsset(imgCta, { templateId: imgCta.id, requiresCTA: true }).ok).toBe(true);
    const bad = validatePlannedAsset(quote, { templateId: quote.id, requiresCTA: true });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/no CTA field/);
  });
  it('family mismatch + unresolved template are rejected', () => {
    expect(validatePlannedAsset(imgCta, { templateId: imgCta.id, assetFamily: 'carousel' }).ok).toBe(false);
    expect(validatePlannedAsset(null, { templateId: 'nope', label: 'X' }).ok).toBe(false);
    expect(validatePlannedAsset(null, { templateId: '' }).errors.join(' ')).toMatch(/No template selected/);
  });
});

describe('CAMPAIGN-003 campaign-plan approval (multi-asset, mixed families)', () => {
  it('approves only when every planned asset passes', () => {
    const ok = validateCampaignPlan([
      { planned: { templateId: car.id, slideCount: 5, label: 'Carousel' }, template: car },
      { planned: { templateId: imgCta.id, requiresCTA: true, label: 'Image' }, template: imgCta },
      { planned: { templateId: timeline.id, layout: 'timeline', label: 'Timeline' }, template: timeline },
    ]);
    expect(ok.ok).toBe(true);

    const bad = validateCampaignPlan([
      { planned: { templateId: car.id, slideCount: 5, label: 'Carousel' }, template: car },
      { planned: { templateId: stats.id, layout: 'timeline', label: 'Bad infographic' }, template: stats },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.perAsset[0].ok).toBe(true);
    expect(bad.perAsset[1].ok).toBe(false);
  });
});
