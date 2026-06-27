import {
  getTemplateById, resolveTemplate, resolveTemplateCreatorCardPatch,
  listTemplatesForFamily, registerUserTemplate, unregisterUserTemplate,
  clearUserTemplateRegistry, listRegisteredUserTemplates,
} from '../../../lib/creator-templates';
import { cloneTemplate, applyTemplateEdits, isUserTemplate } from '../../../lib/creator-templates/userTemplate';

describe('TEMPLATE-018 user templates resolve through the canonical resolver', () => {
  beforeEach(() => clearUserTemplateRegistry());
  afterAll(() => clearUserTemplateRegistry());

  const sysImage = listTemplatesForFamily('image').find((t) => t.imageStyle)!;
  const sysInfo = listTemplatesForFamily('infographic')[0];

  it('system resolution is unchanged while the registry is empty (backward compatible)', () => {
    expect(getTemplateById(sysImage.id)).toBe(sysImage);
    expect(resolveTemplate(sysImage.id).matched).toBe(true);
    expect(getTemplateById('user-does-not-exist')).toBeNull(); // graceful → renderer default
  });

  it('a duplicated system template resolves like a system one (same style + contract, ownership differs)', () => {
    const ut = cloneTemplate(sysImage, 'image', { id: 'ut-img-1', ownerUserId: 'u1', now: '2026-06-25T00:00:00Z' });
    expect(isUserTemplate(ut)).toBe(true);
    registerUserTemplate(ut);

    const rt = resolveTemplate(ut.id, { family: 'image' });
    expect(rt.matched).toBe(true);
    expect(rt.family).toBe('image');
    // SAME canonical style as the source system template (cloned, not defaulted).
    expect(rt.imageStyle).toEqual(sysImage.imageStyle);
    // Same rendering pipeline inputs; carries the user template_id.
    const patch = resolveTemplateCreatorCardPatch(ut);
    expect(patch.template_id).toBe('ut-img-1');
    expect(patch.writer_asset_type).toBe(sysImage.renderingContract.writerAssetType);
    // Only ownership differs.
    expect(ut.ownership).toBe('user');
    expect(sysImage.ownership).toBe('system');
  });

  it('infographic user template resolves its layout + style', () => {
    const ut = cloneTemplate(sysInfo, 'infographic', { id: 'ut-info-1', ownerUserId: 'u1' });
    registerUserTemplate(ut);
    const rt = resolveTemplate(ut.id, { family: 'infographic' });
    expect(rt.infographicStyle).toEqual(sysInfo.infographicStyle);
    expect(resolveTemplateCreatorCardPatch(ut).infographic_layout).toBe(sysInfo.renderingContract.infographicLayout);
  });

  it('duplicating a user template yields an independent copy', () => {
    const a = cloneTemplate(sysImage, 'image', { id: 'ut-a', ownerUserId: 'u1' });
    const b = cloneTemplate(a, 'image', { id: 'ut-b', ownerUserId: 'u1' });
    registerUserTemplate(a); registerUserTemplate(b);
    b.name = 'Mutated';
    expect(getTemplateById('ut-a')!.name).not.toBe('Mutated'); // independent
    expect((b.metadata as any).parentTemplateId).toBe('ut-a');
  });

  it('edits apply only to whitelisted fields; rendering contract is protected', () => {
    const ut = cloneTemplate(sysImage, 'image', { id: 'ut-edit', ownerUserId: 'u1' });
    const { template, applied, rejected } = applyTemplateEdits(ut, {
      name: 'Custom name',
      visualLanguage: { ...ut.visualLanguage, accent: '#ff0000' },
      renderingContract: { family: 'carousel' }, // must be rejected
    });
    expect(applied).toContain('name');
    expect(applied).toContain('visualLanguage');
    expect(rejected).toContain('renderingContract');
    expect(template.renderingContract).toEqual(ut.renderingContract); // unchanged
  });

  it('register / unregister / clear lifecycle', () => {
    const ut = cloneTemplate(sysImage, 'image', { id: 'ut-life', ownerUserId: 'u1' });
    registerUserTemplate(ut);
    expect(listRegisteredUserTemplates().map((t) => t.id)).toContain('ut-life');
    unregisterUserTemplate('ut-life');
    expect(getTemplateById('ut-life')).toBeNull();
  });
});
