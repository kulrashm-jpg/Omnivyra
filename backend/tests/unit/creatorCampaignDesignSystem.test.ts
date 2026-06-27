import type { CreatorTemplate } from '../../../lib/creator-templates';
import { createCollection, addTemplate, removeTemplate, bumpCollectionVersion, type TemplateResolver } from '../../../lib/creator-templates/collection';
import {
  canAttachCollection, attachCollection, resolveCampaignTemplate, campaignDesignHealth,
  compareCollectionVersions, upgradeCampaign,
} from '../../../lib/creator-templates/campaignDesignSystem';

const tpl = (id: string, family: string): CreatorTemplate => ({
  id, assetFamily: family as CreatorTemplate['assetFamily'], name: id, category: 'C', description: '',
  preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: {} },
  visualLanguage: {}, formDefinition: { fields: [] }, renderingContract: { renderingContractVersion: 'v', family: family as any },
  version: 1, status: 'draft', ownership: 'system', tags: [], metadata: {},
});
const LIB: Record<string, CreatorTemplate> = { img: tpl('img', 'image'), car: tpl('car', 'carousel'), inf: tpl('inf', 'infographic') };
const resolve: TemplateResolver = (id) => LIB[id] ?? null;
const col = (ids: string[], version = 1) => ({ ...createCollection({ id: 'col-1', ownerUserId: 'u1', templateIds: ids }), version });

describe('Campaign Design System — attach + validation', () => {
  it('gates attachment on collection validity + required families', () => {
    expect(canAttachCollection(col(['img', 'car', 'inf']), resolve, ['image', 'carousel']).ok).toBe(true);
    const missing = canAttachCollection(col(['img']), resolve, ['image', 'infographic']);
    expect(missing.ok).toBe(false);
    expect(missing.missingFamilies).toContain('infographic');
    expect(canAttachCollection(col(['img', 'ghost']), resolve).ok).toBe(false);
  });

  it('pins version + a frozen snapshot (immune to later collection edits)', () => {
    const collection = col(['img', 'car'], 1);
    const ds = attachCollection({ campaignId: 'camp-1', collection });
    expect(ds.pinnedVersion).toBe(1);
    // Mutating the source collection must NOT affect the pinned snapshot.
    const evolved = removeTemplate(addTemplate(collection, 'inf'), 'img');
    expect(ds.pinnedSnapshot.templateIds).toEqual(['img', 'car']);
    expect(evolved.templateIds).not.toEqual(ds.pinnedSnapshot.templateIds);
  });
});

describe('Campaign Design System — recommendation + health', () => {
  const ds = attachCollection({ campaignId: 'camp-1', collection: col(['img', 'car', 'inf']), requiredFamilies: ['image', 'carousel', 'infographic'] });

  it('recommends from the pinned snapshot per family', () => {
    expect(resolveCampaignTemplate(ds, 'carousel', resolve)?.id).toBe('car');
    expect(resolveCampaignTemplate(ds, 'infographic', resolve)?.id).toBe('inf');
  });

  it('reports health incl. missing families', () => {
    expect(campaignDesignHealth(ds, resolve).ok).toBe(true);
    const partial = attachCollection({ campaignId: 'c2', collection: col(['img']), requiredFamilies: ['image', 'infographic'] });
    const h = campaignDesignHealth(partial, resolve);
    expect(h.ok).toBe(false);
    expect(h.missingFamilies).toContain('infographic');
    expect(h.presentFamilies).toEqual(['image']);
  });
});

describe('Campaign Design System — version pinning + upgrade', () => {
  it('stays pinned while the collection evolves, then upgrades deterministically', () => {
    const v1 = col(['img', 'car'], 1);
    const ds = attachCollection({ campaignId: 'camp-1', collection: v1 });

    // Collection evolves to v2 (adds infographic).
    const v2 = bumpCollectionVersion(addTemplate(v1, 'inf'));
    expect(v2.version).toBe(2);

    const diff = compareCollectionVersions(ds.pinnedSnapshot, v2, resolve);
    expect(diff.upgradeAvailable).toBe(true);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.addedTemplateIds).toEqual(['inf']);
    expect(diff.addedFamilies).toEqual(['infographic']);

    // Campaign still pinned to v1 until upgraded.
    expect(ds.pinnedVersion).toBe(1);
    expect(resolveCampaignTemplate(ds, 'infographic', resolve)).toBeNull();

    const upgraded = upgradeCampaign(ds, v2, '2026-06-25T00:00:00.000Z');
    expect(upgraded.pinnedVersion).toBe(2);
    expect(resolveCampaignTemplate(upgraded, 'infographic', resolve)?.id).toBe('inf');
    // Deterministic diff.
    expect(JSON.stringify(compareCollectionVersions(ds.pinnedSnapshot, v2, resolve))).toBe(JSON.stringify(diff));
  });
});
