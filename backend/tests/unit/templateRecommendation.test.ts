import { ALL_SYSTEM_TEMPLATES, listTemplatesForFamily } from '../../../lib/creator-templates';
import { recommendTemplatesForContext } from '../../../lib/creator-templates/templateRecommendation';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';

const IMAGES = listTemplatesForFamily('image');

describe('CAMPAIGN-005 template recommendation (deterministic)', () => {
  it('different objectives recommend different templates', () => {
    const a = recommendTemplatesForContext(IMAGES, { assetFamily: 'image', objective: 'product launch' });
    const b = recommendTemplatesForContext(IMAGES, { assetFamily: 'image', objective: 'thought leadership' });
    expect(a.recommended!.template.id).not.toBe(b.recommended!.template.id);
    expect(a.recommended!.reasons.some((r) => /objective/i.test(r))).toBe(true);
  });

  it('different platforms affect ranking (cross-family aspect geometry)', () => {
    const onX = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, { platform: 'x' });
    const onIg = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, { platform: 'instagram' });
    // Instagram (portrait) lifts infographic/portrait; X (landscape) lifts image/landscape.
    expect(onX.top.map((t) => t.template.id)).not.toEqual(onIg.top.map((t) => t.template.id));
  });

  it('different asset families produce different rankings (hard family filter)', () => {
    const car = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, { assetFamily: 'carousel' });
    const info = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, { assetFamily: 'infographic' });
    expect(car.all.every((r) => r.template.assetFamily === 'carousel')).toBe(true);
    expect(info.all.every((r) => r.template.assetFamily === 'infographic')).toBe(true);
    expect(car.recommended!.template.id).not.toBe(info.recommended!.template.id);
  });

  it('system AND user templates participate in ranking', () => {
    const userTpl = cloneTemplate(IMAGES.find((t) => t.imageStyle)!, 'image', { id: 'ut-rec-1', ownerUserId: 'u' });
    userTpl.name = 'My Launch Promo'; userTpl.category = 'Promotional'; (userTpl as any).tags = ['promotion', 'launch', 'product'];
    const res = recommendTemplatesForContext([...IMAGES, userTpl], { assetFamily: 'image', objective: 'product launch promotion' });
    expect(res.all.some((r) => r.template.id === 'ut-rec-1')).toBe(true);          // participates
    expect(res.all.find((r) => r.template.id === 'ut-rec-1')!.score).toBeGreaterThan(0);
  });

  it('contract/planner compatibility down-ranks an incompatible template', () => {
    const carousels = listTemplatesForFamily('carousel');
    const good = recommendTemplatesForContext(carousels, { assetFamily: 'carousel', plannerIntent: { templateId: '', slideCount: 5 } });
    // 5 ∈ every carousel countOptions → all contractCompatible.
    expect(good.recommended!.dimensions.find((d) => d.dimension === 'contractCompatibility')!.score).toBe(1);
    const bad = recommendTemplatesForContext(carousels, { assetFamily: 'carousel', plannerIntent: { templateId: '', slideCount: 6 } });
    // 6 ∉ [5,7,10] → contract mismatch for all.
    expect(bad.recommended!.dimensions.find((d) => d.dimension === 'contractCompatibility')!.score).toBe(0);
  });

  it('is fully explainable + deterministic + confident in [0,1]', () => {
    const ctx = { assetFamily: 'infographic' as const, objective: 'comparison', funnelStage: 'consideration', platform: 'instagram' };
    const r1 = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, ctx);
    const r2 = recommendTemplatesForContext(ALL_SYSTEM_TEMPLATES, ctx);
    expect(r1.top.map((t) => t.template.id)).toEqual(r2.top.map((t) => t.template.id)); // deterministic
    expect(r1.top.length).toBe(5);
    for (const rec of r1.top) {
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
      expect(rec.dimensions.length).toBeGreaterThan(0);   // every score explained
    }
    expect(r1.recommended!.reasons.length).toBeGreaterThan(0);
  });
});
