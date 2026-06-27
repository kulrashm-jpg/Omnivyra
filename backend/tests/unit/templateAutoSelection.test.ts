import { listTemplatesForFamily } from '../../../lib/creator-templates';
import { resolveAutoSelection, recommendationInputKey, planningContextChanged } from '../../../lib/creator-templates/autoSelection';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';

const IMAGES = listTemplatesForFamily('image');

describe('CAMPAIGN-006 auto-selection (deterministic)', () => {
  it('first-time: preselects the top recommendation (source = recommended)', () => {
    const s = resolveAutoSelection({ templates: IMAGES, context: { assetFamily: 'image', objective: 'product launch' } });
    expect(s.source).toBe('recommended');
    expect(s.templateId).toBe(s.result.recommended!.template.id);
    expect(s.recommendation!.reasons.length).toBeGreaterThan(0);
  });

  it('never overwrites an explicit user selection (source = user)', () => {
    const top = resolveAutoSelection({ templates: IMAGES, context: { assetFamily: 'image', objective: 'product launch' } }).templateId!;
    const other = IMAGES.find((t) => t.id !== top)!.id;
    const s = resolveAutoSelection({ templates: IMAGES, context: { assetFamily: 'image', objective: 'product launch' }, userSelectedId: other });
    expect(s.source).toBe('user');
    expect(s.templateId).toBe(other); // user wins even though it isn't the top
  });

  it('falls back to recommendation when the user selection is no longer valid', () => {
    const s = resolveAutoSelection({ templates: IMAGES, context: { assetFamily: 'image' }, userSelectedId: 'deleted-xyz' });
    expect(s.source).toBe('recommended');
  });

  it('re-evaluation key changes on planning inputs, not cosmetic ones', () => {
    const base = { assetFamily: 'image' as const, objective: 'launch', platform: 'linkedin' };
    expect(planningContextChanged(base, { ...base })).toBe(false);                       // identical
    expect(planningContextChanged(base, { ...base, audience: 'RevOps' })).toBe(true);     // planning input
    expect(planningContextChanged(base, { ...base, platform: 'instagram' })).toBe(true);  // platform
    // contentLength / attachmentMode / plannerIntent / performance are NOT in the key.
    expect(recommendationInputKey({ ...base, contentLength: 'long', attachmentMode: 'embedded_copy' }))
      .toBe(recommendationInputKey(base));
  });

  it('system + user templates both participate in auto-selection', () => {
    const userTpl = cloneTemplate(IMAGES.find((t) => t.imageStyle)!, 'image', { id: 'ut-auto-1', ownerUserId: 'u' });
    userTpl.name = 'My Promo'; userTpl.category = 'Promotional'; (userTpl as any).tags = ['promotion', 'launch'];
    const pool = [...IMAGES, userTpl];
    const auto = resolveAutoSelection({ templates: pool, context: { assetFamily: 'image', objective: 'launch promotion' } });
    expect(auto.result.all.some((r) => r.template.id === 'ut-auto-1')).toBe(true);
    const picked = resolveAutoSelection({ templates: pool, context: { assetFamily: 'image' }, userSelectedId: 'ut-auto-1' });
    expect(picked.source).toBe('user');
    expect(picked.templateId).toBe('ut-auto-1');
  });
});
