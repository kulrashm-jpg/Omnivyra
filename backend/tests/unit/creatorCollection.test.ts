import type { CreatorTemplate } from '../../../lib/creator-templates';
import {
  createCollection, addTemplate, removeTemplate, reorderTemplates, applyCollectionEdits,
  duplicateCollection, validateCollection, recommendTemplateForFamily, collectionFamilies,
  type TemplateResolver,
} from '../../../lib/creator-templates/collection';

const tpl = (id: string, family: string, thumb: string | null = null): CreatorTemplate => ({
  id, assetFamily: family as CreatorTemplate['assetFamily'], name: id, category: 'C', description: '',
  preview: { thumbnailUrl: thumb, sampleAssetUrl: null, sample: {} },
  visualLanguage: {}, formDefinition: { fields: [] }, renderingContract: { renderingContractVersion: 'v', family: family as any },
  version: 1, status: 'draft', ownership: 'system', tags: [], metadata: {},
});
const LIB: Record<string, CreatorTemplate> = {
  img: tpl('img', 'image', 'https://x/img.png'),
  car: tpl('car', 'carousel'),
  inf: tpl('inf', 'infographic'),
};
const resolve: TemplateResolver = (id) => LIB[id] ?? null;
const opts = { id: 'col-1', ownerUserId: 'u1', now: '2026-06-25T00:00:00.000Z' };

describe('Template Collection — pure model', () => {
  it('creates a collection, de-duplicating references and seeding the cover', () => {
    const c = createCollection({ ...opts, templateIds: ['img', 'car', 'img'] });
    expect(c.templateIds).toEqual(['img', 'car']);
    expect(c.preview.coverTemplateId).toBe('img');
    expect(c.ownership).toBe('user');
  });

  it('adds idempotently and removes (reassigning the cover)', () => {
    let c = createCollection({ ...opts, templateIds: ['img'] });
    c = addTemplate(c, 'car');
    c = addTemplate(c, 'car'); // idempotent
    expect(c.templateIds).toEqual(['img', 'car']);
    c = removeTemplate(c, 'img'); // was the cover
    expect(c.templateIds).toEqual(['car']);
    expect(c.preview.coverTemplateId).toBe('car');
  });

  it('reorders only present references', () => {
    const c = reorderTemplates(createCollection({ ...opts, templateIds: ['img', 'car', 'inf'] }), ['inf', 'img']);
    expect(c.templateIds).toEqual(['inf', 'img', 'car']);
  });

  it('applies whitelisted edits incl. cover (only if member)', () => {
    const c = applyCollectionEdits(createCollection({ ...opts, templateIds: ['img', 'car'] }), { name: 'Launch', tags: ['a', 'a', 'b'], coverTemplateId: 'car' });
    expect(c.name).toBe('Launch');
    expect(c.tags).toEqual(['a', 'b']);
    expect(c.preview.coverTemplateId).toBe('car');
    // non-member cover ignored
    expect(applyCollectionEdits(c, { coverTemplateId: 'zzz' }).preview.coverTemplateId).toBe('car');
  });

  it('duplicates into an independent draft linked to its parent', () => {
    const src = createCollection({ ...opts, templateIds: ['img'] });
    const dup = duplicateCollection(src, { id: 'col-2', ownerUserId: 'u2' });
    expect(dup.id).toBe('col-2');
    expect(dup.version).toBe(1);
    expect(dup.metadata.parentCollectionId).toBe('col-1');
    expect(dup.templateIds).toEqual(['img']); // references shared, not duplicated
  });
});

describe('Template Collection — validation', () => {
  it('passes for resolvable, unique, compatible references', () => {
    const v = validateCollection(createCollection({ ...opts, templateIds: ['img', 'car', 'inf'] }), resolve);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it('flags missing references', () => {
    const v = validateCollection(createCollection({ ...opts, templateIds: ['img', 'ghost'] }), resolve);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain('ghost');
  });
});

describe('Template Collection — recommendation', () => {
  it('returns the collection template for the chosen family (cover preferred)', () => {
    const c = applyCollectionEdits(createCollection({ ...opts, templateIds: ['img', 'car', 'inf'] }), { coverTemplateId: 'car' });
    expect(recommendTemplateForFamily(c, 'carousel', resolve)?.id).toBe('car'); // cover matches
    expect(recommendTemplateForFamily(c, 'image', resolve)?.id).toBe('img');
    expect(recommendTemplateForFamily(c, 'infographic', resolve)?.id).toBe('inf');
  });

  it('returns null when no member covers the family', () => {
    const c = createCollection({ ...opts, templateIds: ['img'] });
    expect(recommendTemplateForFamily(c, 'carousel', resolve)).toBeNull();
    expect(collectionFamilies(c, resolve)).toEqual(['image']);
  });
});
