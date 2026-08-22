/**
 * Canonical Template Taxonomy (PHASE-1 / audit finding B4).
 *
 * WHY THIS EXISTS
 * ---------------
 * Two INDEPENDENT system registries feed the same product surface:
 *
 *   #1  lib/creator-templates/systemTemplates.ts   — 78 STRUCTURAL templates
 *       (purpose-built forms + purposeful rendering contracts, no previews)
 *   #2  content/creator-templates/system-templates.gallery.json — 173 CURATED
 *       STYLE templates (71 visual blueprints x families; generic forms +
 *       generic contracts, real showcase previews)
 *
 * They were merged without deduplication, so the gallery exposed the SAME
 * logical template twice (e.g. two "Comparison" cards in the image family).
 * This module is the ONE place that decides what a *logical* template is, and
 * the ONE place that elects a canonical representative for it.
 *
 * WHAT IT IS NOT
 * --------------
 * It is NOT a third registry. It holds no template data of its own: every
 * function here is PURE over a caller-supplied list. `getTemplateById()`
 * remains the authoritative resolver and the `CreatorTemplate` model remains
 * the authoritative model (see ./index.ts).
 *
 * SAFETY CONTRACT (non-negotiable — existing content must render unchanged)
 * ------------------------------------------------------------------------
 *  - Deduplication removes a template from *listings* only. It NEVER changes
 *    how an already-persisted `template_id` renders: `getTemplateById(id)`
 *    still resolves every id to its own exact record (see index.ts).
 *  - The canonical inherits ONLY PRESENTATIONAL fields from the duplicates it
 *    absorbs (preview image, discovery tags, design-family label, blueprint
 *    provenance). It NEVER inherits `renderingContract`, `formDefinition`,
 *    `imageStyle`/`carouselStyle`/`infographicStyle`, `generationDNA`,
 *    `composition` or `semanticStructure` — i.e. nothing the renderer or the
 *    form reads. Rendering behaviour of the canonical is untouched.
 *  - Only `ownership: 'system'` templates are ever deduplicated. User- and
 *    AI-created templates are always passed through verbatim.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';

/* ── Semantic + structural keys ──────────────────────────────────────── */

/**
 * The SEMANTIC capability a template offers, as the user perceives it —
 * its name, normalised. Two system templates advertising the same capability
 * in the same family are what the user experiences as "the same template".
 *
 * Deliberately NOT a fuzzy matcher: only case, punctuation and whitespace are
 * normalised. Distinct names ("Website Hero" vs "Hero Banner") stay distinct,
 * because they are distinct offers to the user even when their contracts
 * coincide — collapsing them would delete a legitimate design choice.
 */
export function semanticKey(t: CreatorTemplate): string {
  return String(t.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** `${family}::${semanticKey}` — the logical identity of a template. */
export function capabilityKey(t: CreatorTemplate): string {
  return `${t.assetFamily}::${semanticKey(t)}`;
}

/** Sorted, comma-joined field keys of a field list. */
function keysOf(fields: ReadonlyArray<{ key: string }> | undefined): string {
  return (fields ?? []).map((f) => f.key).slice().sort().join(',');
}

/**
 * A stable fingerprint of everything that determines HOW a template renders
 * and WHAT it asks the user for. Used for diagnostics and for the
 * compatibility guard — never as the grouping key on its own: 78 image
 * templates legitimately share one contract+form fingerprint, so grouping by
 * it would collapse the entire family.
 */
export function structuralSignature(t: CreatorTemplate): string {
  const c = t.renderingContract;
  const fd = t.formDefinition;
  return [
    t.assetFamily,
    c.infographicLayout ?? '',
    c.purposeKey ?? '',
    c.subtype ?? '',
    c.writerAssetType ?? '',
    c.attachmentMode ?? '',
    c.imageComposition ?? '',
    c.frameCount ?? '',
    keysOf(fd.fields),
    fd.slides ? `slides(${keysOf(fd.slides.fields)}|${fd.slides.defaultCount})` : '',
    fd.sections ? `sections(${keysOf(fd.sections.fields)}|${fd.sections.kind}|${fd.sections.min}-${fd.sections.max})` : '',
  ].join('|');
}

/* ── Renderer-lane compatibility guard ───────────────────────────────── */

/** The renderer lane a family falls back to when a contract omits it. */
const DEFAULT_LANE: Readonly<Record<TemplateAssetFamily, string>> = {
  image: 'supporting_image',
  carousel: 'carousel',
  infographic: 'infographic',
};

function lane(t: CreatorTemplate): string {
  return t.renderingContract.writerAssetType ?? DEFAULT_LANE[t.assetFamily];
}

/**
 * Two same-named templates may only be merged when they also behave as the
 * same KIND of asset. This is the guard that stops a name coincidence from
 * collapsing genuinely different capabilities — e.g. a text-embedding
 * ('banner') image template can never absorb a clean-visual
 * ('supporting_image') one, and two infographics can never merge across
 * different layout engines.
 */
export function structurallyCompatible(a: CreatorTemplate, b: CreatorTemplate): boolean {
  if (a.assetFamily !== b.assetFamily) return false;
  if (lane(a) !== lane(b)) return false;
  if ((a.renderingContract.infographicLayout ?? null) !== (b.renderingContract.infographicLayout ?? null)) return false;
  if ((a.renderingContract.imageComposition ?? null) !== (b.renderingContract.imageComposition ?? null)) return false;
  if ((a.renderingContract.attachmentMode ?? null) !== (b.renderingContract.attachmentMode ?? null)) return false;
  return true;
}

/* ── Structural specificity (which member OWNS the capability) ────────── */

/** The generic, contributes-no-structure field vocabulary per family. */
const GENERIC_FLAT_KEYS: Readonly<Record<TemplateAssetFamily, ReadonlySet<string>>> = {
  image: new Set(['headline', 'subheadline', 'cta']),
  carousel: new Set(['cta']),
  infographic: new Set(['headline']),
};
const GENERIC_SECTION_KEYS: ReadonlySet<string> = new Set(['title', 'description']);
const GENERIC_SLIDE_KEYS: ReadonlySet<string> = new Set(['title', 'body']);
/** The purpose the materialised curated templates all carry (i.e. "none chosen"). */
const GENERIC_IMAGE_PURPOSE = 'promotional-image';
/** The repeat counts the materialiser emits for its generic forms. */
const GENERIC_SLIDE_COUNT = 4;
const GENERIC_SECTION_MIN = 2;
const GENERIC_SECTION_MAX = 6;

function exceeds(keys: ReadonlyArray<{ key: string }> | undefined, generic: ReadonlySet<string>): boolean {
  return (keys ?? []).some((f) => !generic.has(f.key));
}

/**
 * How much genuine STRUCTURE a template contributes, counted from objective
 * signals in its own data (never from its id, registry or name). The member
 * with the most structure owns the capability: it is the one whose form and
 * contract were purpose-built for it, rather than a generic shell that merely
 * borrowed the name for a visual style pack.
 */
export function structuralSpecificity(t: CreatorTemplate): number {
  const fd = t.formDefinition;
  const c = t.renderingContract;
  let n = 0;
  if (exceeds(fd.fields, GENERIC_FLAT_KEYS[t.assetFamily])) n += 1;
  if (fd.sections) {
    if (exceeds(fd.sections.fields, GENERIC_SECTION_KEYS)) n += 1;
    if (fd.sections.min !== GENERIC_SECTION_MIN || fd.sections.max !== GENERIC_SECTION_MAX) n += 1;
  }
  if (fd.slides) {
    if (exceeds(fd.slides.fields, GENERIC_SLIDE_KEYS)) n += 1;
    if (fd.slides.defaultCount !== GENERIC_SLIDE_COUNT) n += 1;
  }
  if (c.purposeKey && !(t.assetFamily === 'image' && c.purposeKey === GENERIC_IMAGE_PURPOSE)) n += 1;
  if (typeof c.frameCount === 'number' && c.frameCount !== GENERIC_SLIDE_COUNT) n += 1;
  if (c.imageComposition) n += 1;
  return n;
}

/* ── Canonicalisation ────────────────────────────────────────────────── */

export interface CanonicalGroup {
  /** `${family}::${semanticKey}` shared by every member. */
  capabilityKey: string;
  /** The elected representative — the only member that appears in listings. */
  canonical: CreatorTemplate;
  /** The absorbed members, in deterministic election order. */
  duplicates: CreatorTemplate[];
}

export interface CanonicalizationResult {
  /** The deduplicated pool, in the input order of each surviving template. */
  templates: CreatorTemplate[];
  /** duplicateId → canonicalId, for every absorbed template. */
  aliases: Readonly<Record<string, string>>;
  /** Every group that had more than one member. */
  groups: CanonicalGroup[];
}

/** Is this a curated/materialised style template (`sys-curated-<bp>-<family>`)? */
export function isCuratedTemplateId(id: string): boolean {
  return /^sys-curated-.+-(image|carousel|infographic)$/.test(String(id || '').trim());
}

/**
 * Deterministic election ranking, most significant first:
 *   1. structural specificity  — the member that owns the capability
 *   2. structural registry     — a hand-authored template beats a materialised
 *                                style shell on a tie (audit: #1 = structure)
 *   3. has a real preview      — prefer a card the gallery can actually show
 *   4. input order, then id    — total order, so the result never varies
 */
function electionRank(t: CreatorTemplate, index: number): [number, number, number, number] {
  return [
    structuralSpecificity(t),
    isCuratedTemplateId(t.id) ? 0 : 1,
    t.preview?.thumbnailUrl ? 1 : 0,
    -index,
  ];
}

function compareRank(a: [number, number, number, number], b: [number, number, number, number], aId: string, bId: string): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return aId.localeCompare(bId);
}

/** Union two tag lists, canonical first, order-stable, de-duplicated. */
function unionTags(base: readonly string[], extra: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...base, ...extra]) {
    const v = String(tag || '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/** Metadata keys the canonical may inherit — provenance + discovery only. */
const INHERITABLE_METADATA = [
  'sourceBlueprintId',
  'previewRecipe',
  'generationRecipe',
  'industryTags',
  'audienceTags',
  'businessPurpose',
  'businessGoal',
] as const;

/**
 * Fold the duplicates' PRESENTATIONAL value into the canonical so nothing the
 * user could see is lost by deduplication — most importantly the showcase
 * preview, which only the curated registry carries (0 of 78 structural
 * templates have one, 173 of 173 curated do).
 *
 * Returns the canonical unchanged (same object identity) when there is nothing
 * to inherit, so the common path allocates nothing.
 */
export function mergePresentation(canonical: CreatorTemplate, duplicates: readonly CreatorTemplate[]): CreatorTemplate {
  if (duplicates.length === 0) return canonical;

  const thumb = canonical.preview?.thumbnailUrl
    ?? duplicates.find((d) => d.preview?.thumbnailUrl)?.preview.thumbnailUrl
    ?? null;
  const sampleAsset = canonical.preview?.sampleAssetUrl
    ?? duplicates.find((d) => d.preview?.sampleAssetUrl)?.preview.sampleAssetUrl
    ?? null;
  const designFamily = canonical.designFamily
    ?? duplicates.find((d) => d.designFamily)?.designFamily;

  let tags = canonical.tags ?? [];
  for (const d of duplicates) tags = unionTags(tags, d.tags ?? []);

  const metadata: Record<string, unknown> = { ...(canonical.metadata ?? {}) };
  for (const key of INHERITABLE_METADATA) {
    if (metadata[key] !== undefined) continue;
    const donor = duplicates.find((d) => (d.metadata as Record<string, unknown> | undefined)?.[key] !== undefined);
    if (donor) metadata[key] = (donor.metadata as Record<string, unknown>)[key];
  }
  // Provenance so telemetry / debugging can see what this card absorbed.
  metadata.canonicalAbsorbedIds = duplicates.map((d) => d.id);

  return {
    ...canonical,
    preview: { ...canonical.preview, thumbnailUrl: thumb, sampleAssetUrl: sampleAsset },
    designFamily,
    tags,
    metadata,
  };
}

/* ── Display disambiguation (collisions that must NOT be merged) ─────── */

function titleCase(s: string): string {
  return s.split(/[^a-z0-9]+/i).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * The suffix that tells two same-named-but-genuinely-different templates apart,
 * built from data the template already carries (its design family, else its
 * category). Never invented copy.
 */
function disambiguator(t: CreatorTemplate): string {
  if (t.designFamily) return `${titleCase(t.designFamily)} style`;
  return titleCase(t.category || 'Alternate');
}

/**
 * Some same-named templates MUST NOT be merged: they render through different
 * compositions (e.g. `sys-image-statistic` dispatches the dedicated 'stat'
 * composition while `sys-curated-statistic-image` uses the generic overlay), so
 * they are different capabilities that happen to share a word. Deleting either
 * would remove a legitimate design choice.
 *
 * They must still not read as two identical cards, so the member that owns the
 * capability keeps the bare name and the others are labelled with their own
 * design family / category. Presentational only: `name` drives the gallery
 * label, search text and story-blueprint signal — never the rendering contract,
 * the form or the visual style — and `category` (already the same word) is
 * itself part of the story-blueprint signal, so classification is unchanged.
 * The original is preserved on `metadata.originalName`.
 */
function disambiguateCollidingNames(templates: readonly CreatorTemplate[]): CreatorTemplate[] {
  const buckets = new Map<string, Array<{ t: CreatorTemplate; i: number }>>();
  templates.forEach((t, i) => {
    if (t.ownership !== 'system') return;
    const k = capabilityKey(t);
    const arr = buckets.get(k);
    if (arr) arr.push({ t, i });
    else buckets.set(k, [{ t, i }]);
  });

  const renamed = new Map<string, CreatorTemplate>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) =>
      compareRank(electionRank(a.t, a.i), electionRank(b.t, b.i), a.t.id, b.t.id));
    // ordered[0] keeps the bare name — it owns the capability.
    for (const m of ordered.slice(1)) {
      const t = m.t;
      renamed.set(t.id, {
        ...t,
        name: `${t.name} · ${disambiguator(t)}`,
        metadata: { ...(t.metadata ?? {}), originalName: t.name },
      });
    }
  }
  return renamed.size === 0 ? [...templates] : templates.map((t) => renamed.get(t.id) ?? t);
}

/**
 * THE deduplication function. Every surface that lists system templates goes
 * through this so the gallery, the API, recommendation, collections and
 * outcome discovery all describe the same taxonomy.
 *
 * Pure and deterministic: identical input list → identical output, aliases and
 * groups. Order of surviving templates follows the input order.
 */
export function canonicalizeTemplates(templates: readonly CreatorTemplate[]): CanonicalizationResult {
  // 1) Bucket only SYSTEM templates by logical identity. User/AI templates are
  //    never candidates — a user template named "Comparison" is theirs to keep.
  const buckets = new Map<string, Array<{ t: CreatorTemplate; i: number }>>();
  templates.forEach((t, i) => {
    if (t.ownership !== 'system') return;
    const k = capabilityKey(t);
    const arr = buckets.get(k);
    if (arr) arr.push({ t, i });
    else buckets.set(k, [{ t, i }]);
  });

  const aliases: Record<string, string> = {};
  const groups: CanonicalGroup[] = [];
  /** canonicalId → the merged record that replaces it in the output. */
  const replacement = new Map<string, CreatorTemplate>();

  for (const [key, members] of buckets) {
    if (members.length < 2) continue;

    // 2) Elect deterministically.
    const ordered = [...members].sort((a, b) =>
      compareRank(electionRank(a.t, a.i), electionRank(b.t, b.i), a.t.id, b.t.id));
    const winner = ordered[0].t;

    // 3) Only members that are renderer-compatible with the winner may be
    //    absorbed. An incompatible same-named template keeps its own card —
    //    a name collision is not licence to delete a different capability.
    const absorbed: CreatorTemplate[] = [];
    for (const m of ordered.slice(1)) {
      if (structurallyCompatible(winner, m.t)) absorbed.push(m.t);
    }
    if (absorbed.length === 0) continue;

    for (const d of absorbed) aliases[d.id] = winner.id;
    const merged = mergePresentation(winner, absorbed);
    replacement.set(winner.id, merged);
    groups.push({ capabilityKey: key, canonical: merged, duplicates: absorbed });
  }

  // 4) Project: drop absorbed ids, swap in merged canonicals, keep input order.
  const projected: CreatorTemplate[] = [];
  for (const t of templates) {
    if (aliases[t.id]) continue;
    projected.push(replacement.get(t.id) ?? t);
  }

  // 5) Any name collision that SURVIVED step 3 is a genuine capability
  //    difference (the compatibility guard refused to merge it). Label it so
  //    the gallery never shows two cards a user cannot tell apart.
  const out = disambiguateCollidingNames(projected);

  return { templates: out, aliases: Object.freeze(aliases), groups };
}
