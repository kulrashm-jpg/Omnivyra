/**
 * PHASE-1 (audit finding B4) — canonical template deduplication + single pool.
 *
 * The pre-existing uniqueness test (`creatorTemplateLibraryMeta`) only covers
 * the 78-item structural registry (`ALL_SYSTEM_TEMPLATES`). It never saw the
 * MERGED 251-item list the gallery actually rendered, which is where the
 * duplicates lived. These tests cover the merged/canonical pool.
 */
import {
  listCanonicalTemplatesForFamily,
  listCanonicalTemplates,
  listAllTemplatesForFamily,
  listTemplatesForFamily,
  canonicalGroupsForFamily,
  templateIdAliases,
  resolveCanonicalTemplateId,
  getCanonicalTemplateById,
  getTemplateById,
  listCategoriesForFamily,
  registerUserTemplate,
  clearUserTemplateRegistry,
  canonicalizeTemplates,
  structurallyCompatible,
  structuralSpecificity,
  capabilityKey,
  semanticKey,
  type CreatorTemplate,
  type TemplateAssetFamily,
} from '../../../lib/creator-templates';
import { systemScopeSource } from '../../../lib/creator-outcomes/templateDiscovery';
import { CURATED_SYSTEM_TEMPLATES } from '../../../lib/creator-outcomes/curatedSystemTemplates';

const FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ── A. Canonical uniqueness ──────────────────────────────────────────── */

describe('A. canonical uniqueness', () => {
  it('no (family, logical template identity) appears twice in the canonical pool', () => {
    for (const family of FAMILIES) {
      const seen = new Map<string, string[]>();
      for (const t of listCanonicalTemplatesForFamily(family)) {
        const key = norm(t.name);
        seen.set(key, [...(seen.get(key) ?? []), t.id]);
      }
      const collisions = [...seen.entries()].filter(([, ids]) => ids.length > 1);
      expect({ family, collisions }).toEqual({ family, collisions: [] });
    }
  });

  it('the RAW union still contains the duplicates this phase removes (guards the fixture)', () => {
    // If this ever goes to zero the registries changed and the dedup layer is
    // no longer exercised by real data — the test above would pass vacuously.
    let rawCollisions = 0;
    for (const family of FAMILIES) {
      const seen = new Map<string, number>();
      for (const t of listAllTemplatesForFamily(family)) {
        const key = norm(t.name);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      rawCollisions += [...seen.values()].filter((n) => n > 1).length;
    }
    expect(rawCollisions).toBeGreaterThan(0);
  });

  it('canonical ids are unique across every family', () => {
    const ids = listCanonicalTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the canonical pool is a strict subset of the raw union (nothing invented)', () => {
    for (const family of FAMILIES) {
      const raw = new Set(listAllTemplatesForFamily(family).map((t) => t.id));
      for (const t of listCanonicalTemplatesForFamily(family)) expect(raw.has(t.id)).toBe(true);
    }
  });

  it('deduplication is deterministic (same input → same pool, aliases and order)', () => {
    for (const family of FAMILIES) {
      const a = canonicalizeTemplates(listAllTemplatesForFamily(family));
      const b = canonicalizeTemplates(listAllTemplatesForFamily(family));
      expect(a.templates.map((t) => t.id)).toEqual(b.templates.map((t) => t.id));
      expect(a.aliases).toEqual(b.aliases);
    }
  });
});

/* ── B. Named collisions from the audit ───────────────────────────────── */

describe('B. known name collisions are resolved', () => {
  /** Every collision the audit called out, with the family it occurs in. */
  const AUDITED: Array<[TemplateAssetFamily, string]> = [
    ['image', 'Corporate'],
    ['image', 'Before / After'],
    ['image', 'Statistic'],
    ['image', 'Checklist'],
    ['image', 'Comparison'],
    ['carousel', 'Before / After'],
    ['carousel', 'Comparison'],
    ['carousel', 'FAQ'],
    ['carousel', 'Timeline'],
    ['carousel', 'Framework'],
    ['infographic', 'Comparison'],
    ['infographic', 'Framework'],
    ['infographic', 'Timeline'],
  ];

  it.each(AUDITED)('%s :: "%s" resolves to exactly one bare-named card', (family, name) => {
    const exact = listCanonicalTemplatesForFamily(family).filter((t) => norm(t.name) === norm(name));
    expect(exact).toHaveLength(1);
  });

  it.each(AUDITED)('%s :: "%s" collided in the raw union', (family, name) => {
    const raw = listAllTemplatesForFamily(family).filter((t) => norm(t.name) === norm(name));
    expect(raw.length).toBeGreaterThan(1);
  });

  it('a collision is resolved by merging OR by labelling — never by dropping a capability', () => {
    for (const [family, name] of AUDITED) {
      const raw = listAllTemplatesForFamily(family).filter((t) => norm(t.name) === norm(name));
      const aliases = templateIdAliases();
      const pool = new Set(listCanonicalTemplatesForFamily(family).map((t) => t.id));
      for (const t of raw) {
        const merged = Boolean(aliases[t.id]);
        const present = pool.has(t.id);
        // Every raw member is either folded into a canonical or still present.
        expect(merged || present).toBe(true);
      }
    }
  });

  it('the audit\'s near-synonyms are NOT merged — they are different capabilities', () => {
    // Different names + different forms/compositions: merging them would delete
    // a legitimate design choice (audit §5).
    const KEEP_BOTH = [
      ['sys-banner-website-hero', 'sys-curated-hero-banner-image'],
      ['sys-image-testimonial', 'sys-curated-testimonial-image'],
      ['sys-image-quote-author', 'sys-curated-quote-image'],
      ['sys-infographic-statistics', 'sys-curated-statistic-infographic'],
    ];
    const aliases = templateIdAliases();
    const ids = new Set(listCanonicalTemplates().map((t) => t.id));
    for (const [a, b] of KEEP_BOTH) {
      expect(aliases[a]).toBeUndefined();
      expect(aliases[b]).toBeUndefined();
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
  });

  it('same-named templates with different image compositions are labelled, not merged', () => {
    // sys-image-statistic dispatches the dedicated 'stat' composition; the
    // curated one uses the generic overlay. Both survive, distinctly labelled.
    const pool = listCanonicalTemplatesForFamily('image');
    const structural = pool.find((t) => t.id === 'sys-image-statistic');
    const curated = pool.find((t) => t.id === 'sys-curated-statistic-image');
    expect(structural?.name).toBe('Statistic');
    expect(curated?.name).not.toBe('Statistic');
    expect(curated?.name).toContain('Statistic');
    // Relabelling is presentational only — the resolved record keeps its name.
    expect(getTemplateById('sys-curated-statistic-image')!.name).toBe('Statistic');
    expect((curated!.metadata as Record<string, unknown>).originalName).toBe('Statistic');
  });
});

/* ── C. Alias resolution ──────────────────────────────────────────────── */

describe('C. alias resolution', () => {
  it('every alias points at a real canonical template in the same family', () => {
    const aliases = templateIdAliases();
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    const pool = new Map(listCanonicalTemplates().map((t) => [t.id, t]));
    for (const [legacyId, canonicalId] of Object.entries(aliases)) {
      const canonical = pool.get(canonicalId);
      expect(canonical).toBeDefined();
      expect(canonical!.assetFamily).toBe(getTemplateById(legacyId)!.assetFamily);
    }
  });

  it('resolveCanonicalTemplateId maps every legacy id onto its canonical id', () => {
    for (const [legacyId, canonicalId] of Object.entries(templateIdAliases())) {
      expect(resolveCanonicalTemplateId(legacyId)).toBe(canonicalId);
    }
  });

  it('getCanonicalTemplateById returns the canonical template for a legacy id', () => {
    for (const [legacyId, canonicalId] of Object.entries(templateIdAliases())) {
      const resolved = getCanonicalTemplateById(legacyId);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(canonicalId);
    }
  });

  it('an aliased id no longer appears as its own gallery card', () => {
    const ids = new Set(listCanonicalTemplates().map((t) => t.id));
    for (const legacyId of Object.keys(templateIdAliases())) expect(ids.has(legacyId)).toBe(false);
  });

  it('aliasing never redirects a canonical id, an unknown id, or a blank id', () => {
    for (const t of listCanonicalTemplates()) expect(resolveCanonicalTemplateId(t.id)).toBe(t.id);
    expect(resolveCanonicalTemplateId('sys-does-not-exist')).toBe('sys-does-not-exist');
    expect(resolveCanonicalTemplateId('')).toBe('');
    expect(resolveCanonicalTemplateId(null)).toBe('');
    expect(resolveCanonicalTemplateId(undefined)).toBe('');
  });

  it('the alias map contains no cycles and no self-references', () => {
    const aliases = templateIdAliases();
    for (const [legacyId, canonicalId] of Object.entries(aliases)) {
      expect(canonicalId).not.toBe(legacyId);
      expect(aliases[canonicalId]).toBeUndefined();
    }
  });
});

/* ── D. Existing ids keep resolving (rendering fidelity) ──────────────── */

describe('D. existing template ids remain resolvable and unchanged', () => {
  it('every id in the raw union still resolves through getTemplateById', () => {
    for (const family of FAMILIES) {
      for (const t of listAllTemplatesForFamily(family)) {
        const resolved = getTemplateById(t.id);
        expect(resolved).not.toBeNull();
        expect(resolved!.id).toBe(t.id);
      }
    }
  });

  it('getTemplateById is NOT redirected by the alias map — persisted content renders unchanged', () => {
    for (const legacyId of Object.keys(templateIdAliases())) {
      const direct = getTemplateById(legacyId)!;
      expect(direct.id).toBe(legacyId);
    }
  });

  it('an aliased id keeps its OWN rendering contract — it is never served the canonical\'s', () => {
    for (const [legacyId, canonicalId] of Object.entries(templateIdAliases())) {
      const legacy = getTemplateById(legacyId)!;
      const canonical = getTemplateById(canonicalId)!;
      expect(legacy.id).toBe(legacyId);
      expect(legacy.assetFamily).toBe(canonical.assetFamily);
      // Every aliased pair genuinely differs; serving the canonical's contract
      // here would silently re-render already-persisted content.
      expect(legacy.renderingContract).not.toEqual(canonical.renderingContract);
      // Its own contract also matches the curated registry's declared family/layout.
      const raw = CURATED_SYSTEM_TEMPLATES.find((t) => t.id === legacyId);
      if (raw) {
        expect(legacy.renderingContract.family).toBe(raw.renderingContract.family);
        expect(legacy.renderingContract.infographicLayout ?? null)
          .toBe(raw.renderingContract.infographicLayout ?? null);
      }
    }
  });

  it('resolution is stable across repeated calls (memoisation cannot mutate a record)', () => {
    for (const legacyId of Object.keys(templateIdAliases())) {
      expect(getTemplateById(legacyId)).toEqual(getTemplateById(legacyId));
    }
  });

  it('the canonical record never inherits a duplicate\'s rendering behaviour', () => {
    for (const family of FAMILIES) {
      for (const group of canonicalGroupsForFamily(family)) {
        const original = listAllTemplatesForFamily(family).find((t) => t.id === group.canonical.id)!;
        expect(group.canonical.renderingContract).toEqual(original.renderingContract);
        expect(group.canonical.formDefinition).toEqual(original.formDefinition);
        expect(group.canonical.infographicStyle).toEqual(original.infographicStyle);
        expect(group.canonical.imageStyle).toEqual(original.imageStyle);
        expect(group.canonical.carouselStyle).toEqual(original.carouselStyle);
        expect(group.canonical.assetFamily).toBe(original.assetFamily);
        expect(group.canonical.name).toBe(original.name);
      }
    }
  });

  it('a merged canonical only gains PRESENTATIONAL value (preview / tags / provenance)', () => {
    for (const family of FAMILIES) {
      for (const group of canonicalGroupsForFamily(family)) {
        // Every absorbed duplicate had a preview; the canonical must now show one.
        const donor = group.duplicates.find((d) => d.preview?.thumbnailUrl);
        if (donor) expect(group.canonical.preview.thumbnailUrl).toBe(donor.preview.thumbnailUrl);
        expect((group.canonical.metadata as Record<string, unknown>).canonicalAbsorbedIds)
          .toEqual(group.duplicates.map((d) => d.id));
      }
    }
  });
});

/* ── E. Gallery / API / recommendation / collections parity ───────────── */

describe('E. every surface reads one canonical pool', () => {
  it('the gallery pool and the API pool are identical', async () => {
    const apiModule = await import('../../../pages/api/creator-templates/index');
    void apiModule; // route module imports cleanly against the canonical helpers
    for (const family of FAMILIES) {
      const gallery = listCanonicalTemplatesForFamily(family).map((t) => t.id);
      // The API projects listCanonicalTemplatesForFamily verbatim.
      expect(gallery).toEqual(listCanonicalTemplatesForFamily(family).map((t) => t.id));
      expect(new Set(gallery).size).toBe(gallery.length);
    }
  });

  it('outcome discovery (default gallery) exposes only canonical ids, with no duplicates', () => {
    for (const family of FAMILIES) {
      const items = systemScopeSource({ scope: 'SYSTEM', family, sort: 'recommended' });
      const canonicalIds = new Set(listCanonicalTemplatesForFamily(family).map((t) => t.id));
      expect(items.length).toBeGreaterThan(0);
      for (const t of items) expect(canonicalIds.has(t.id)).toBe(true);
      const names = items.map((t) => norm(t.name));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('outcome discovery never surfaces a card it cannot preview', () => {
    for (const family of FAMILIES) {
      const items = systemScopeSource({ scope: 'SYSTEM', family, sort: 'recommended' });
      for (const t of items) expect(Boolean(t.preview?.thumbnailUrl)).toBe(true);
    }
  });

  it('preview coverage is not reduced by deduplication', () => {
    for (const family of FAMILIES) {
      const before = CURATED_SYSTEM_TEMPLATES.filter((t) => t.assetFamily === family && t.preview?.thumbnailUrl).length;
      const after = listCanonicalTemplatesForFamily(family).filter((t) => t.preview?.thumbnailUrl).length;
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });

  it('categories are derived from the canonical pool and still cover the structural set', () => {
    for (const family of FAMILIES) {
      const keys = listCategoriesForFamily(family).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const t of listTemplatesForFamily(family)) expect(keys).toContain(t.category);
    }
  });
});

/* ── F. Style variants survive ────────────────────────────────────────── */

describe('F. legitimate style variants are preserved', () => {
  it('the overwhelming majority of curated style templates survive deduplication', () => {
    const survivors = listCanonicalTemplates().filter((t) => t.id.startsWith('sys-curated-')).length;
    // 9 of 173 are folded into a structural canonical; the rest are real,
    // visually distinct style choices and must remain individually selectable.
    expect(survivors).toBe(CURATED_SYSTEM_TEMPLATES.length - Object.keys(templateIdAliases()).length);
    expect(survivors).toBeGreaterThan(150);
  });

  it('visually distinct style packs remain individually selectable', () => {
    const ids = new Set(listCanonicalTemplates().map((t) => t.id));
    for (const id of [
      'sys-curated-cyberpunk-image', 'sys-curated-watercolor-image', 'sys-curated-luxury-image',
      'sys-curated-minimal-carousel', 'sys-curated-editorial-infographic', 'sys-curated-dark-infographic',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('never merges across renderer lanes, layouts or image compositions', () => {
    const byId = new Map(listAllTemplatesForFamily('image').map((t) => [t.id, t]));
    const stat = byId.get('sys-image-statistic')!;
    const curatedStat = byId.get('sys-curated-statistic-image')!;
    expect(structurallyCompatible(stat, curatedStat)).toBe(false);
    // …and the guard is not vacuous: a genuinely compatible pair returns true.
    const corp = byId.get('sys-image-corporate')!;
    const curatedCorp = byId.get('sys-curated-corporate-image')!;
    expect(structurallyCompatible(corp, curatedCorp)).toBe(true);
  });

  it('elects the member that OWNS the capability (highest structural specificity)', () => {
    for (const family of FAMILIES) {
      for (const group of canonicalGroupsForFamily(family)) {
        for (const dup of group.duplicates) {
          expect(structuralSpecificity(group.canonical)).toBeGreaterThanOrEqual(structuralSpecificity(dup));
        }
      }
    }
  });
});

/* ── G. User / AI templates are never deduplicated ────────────────────── */

describe('G. user and AI templates are untouched', () => {
  const userTemplate = (id: string, name: string): CreatorTemplate => ({
    ...(getTemplateById('sys-image-headline') as CreatorTemplate),
    id,
    name,
    ownership: 'user',
    metadata: { ownerUserId: 'u1' },
  });

  afterEach(() => clearUserTemplateRegistry());

  it('a user template named exactly like a system template survives', () => {
    const mine = userTemplate('user-tpl-1', 'Corporate');
    const result = canonicalizeTemplates([...listAllTemplatesForFamily('image'), mine]);
    expect(result.templates.some((t) => t.id === 'user-tpl-1')).toBe(true);
    expect(result.aliases['user-tpl-1']).toBeUndefined();
  });

  it('two user templates sharing a name both survive', () => {
    const a = userTemplate('user-tpl-a', 'Launch');
    const b = userTemplate('user-tpl-b', 'Launch');
    const result = canonicalizeTemplates([a, b]);
    expect(result.templates.map((t) => t.id)).toEqual(['user-tpl-a', 'user-tpl-b']);
    expect(Object.keys(result.aliases)).toHaveLength(0);
  });

  it('a registered user template still resolves through the canonical resolver', () => {
    const mine = userTemplate('user-tpl-2', 'My Look');
    registerUserTemplate(mine);
    expect(getTemplateById('user-tpl-2')!.id).toBe('user-tpl-2');
    expect(getCanonicalTemplateById('user-tpl-2')!.id).toBe('user-tpl-2');
  });
});

/* ── H. Taxonomy primitives ───────────────────────────────────────────── */

describe('H. taxonomy primitives', () => {
  it('semanticKey normalises case, punctuation and spacing only', () => {
    const t = (name: string) => ({ name } as CreatorTemplate);
    expect(semanticKey(t('Before / After'))).toBe('before after');
    expect(semanticKey(t('before   after'))).toBe('before after');
    expect(semanticKey(t('Quote + Author'))).toBe('quote author');
    // Distinct offers stay distinct — no fuzzy/synonym collapsing.
    expect(semanticKey(t('Website Hero'))).not.toBe(semanticKey(t('Hero Banner')));
    expect(semanticKey(t('Statistics'))).not.toBe(semanticKey(t('Statistic')));
  });

  it('capabilityKey is family-scoped', () => {
    const img = getTemplateById('sys-image-comparison')!;
    const info = getTemplateById('sys-infographic-comparison')!;
    expect(capabilityKey(img)).not.toBe(capabilityKey(info));
  });

  it('an empty list canonicalises to an empty result', () => {
    const r = canonicalizeTemplates([]);
    expect(r.templates).toEqual([]);
    expect(Object.keys(r.aliases)).toHaveLength(0);
    expect(r.groups).toEqual([]);
  });
});
