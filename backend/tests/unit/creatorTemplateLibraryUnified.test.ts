/**
 * Item 3a — unify the two template registries. listTemplatesForFamily stays blueprint-only
 * (its tested contract); listAllTemplatesForFamily is the additive superset (blueprint + curated
 * STYLE pool), so the curated templates are reachable from the main library, not just the gallery.
 */
import {
  listTemplatesForFamily,
  listAllTemplatesForFamily,
  listCuratedTemplatesForFamily,
} from '../../../lib/creator-templates';

describe('unified template library (blueprint + curated)', () => {
  it('listTemplatesForFamily stays blueprint-only (contract unchanged)', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as const) {
      const list = listTemplatesForFamily(fam);
      expect(list.length).toBeGreaterThan(0);
      // No curated ids leak into the blueprint-only contract.
      expect(list.every((t) => !t.id.startsWith('sys-curated-'))).toBe(true);
      expect(list.every((t) => t.assetFamily === fam)).toBe(true);
    }
  });

  it('listCuratedTemplatesForFamily returns only curated style templates for the family', () => {
    const curated = listCuratedTemplatesForFamily('infographic');
    expect(curated.length).toBeGreaterThan(0); // gallery JSON has curated infographics
    expect(curated.every((t) => t.assetFamily === 'infographic')).toBe(true);
    expect(curated.every((t) => t.id.startsWith('sys-curated-'))).toBe(true);
  });

  it('listAllTemplatesForFamily = blueprint ++ curated (superset, blueprint first)', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as const) {
      const blueprint = listTemplatesForFamily(fam);
      const all = listAllTemplatesForFamily(fam);
      const curated = listCuratedTemplatesForFamily(fam);
      expect(all.length).toBe(blueprint.length + curated.length);
      // Blueprint appears first, curated appended.
      expect(all.slice(0, blueprint.length).map((t) => t.id)).toEqual(blueprint.map((t) => t.id));
      // Every item is the right family; no duplicate ids.
      expect(all.every((t) => t.assetFamily === fam)).toBe(true);
      expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    }
  });
});
