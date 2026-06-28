/**
 * Template Variant Resolver (CREATOR-033). Removes the dependency on a fixed
 * template catalog by deterministically DERIVING an N-slide / N-section template
 * variant from a master template — preserving theme, branding, typography
 * regions, safe areas, spacing, animation metadata, component hierarchy and
 * field definitions, trimming ONLY the slide/section COUNT metadata. Pure +
 * metadata-driven (no hardcoded counts), so custom templates participate with no
 * new code. No AI, no new template engine, no renderer change, no Template
 * Population change — the resolver hands Template Population a normal template.
 */

import type { CreatorTemplate, TemplateAssetFamily, TemplateFormDefinition } from './types';
import type { AssetSizeRecommendation } from './assetSizeRecommendation';

export type Resolution = 'exact' | 'compatible' | 'derived' | 'family-change';

export interface ResolvedTemplate {
  template: CreatorTemplate;
  resolution: Resolution;
  derivedFrom: string | null;
  count: number | null;
  family: TemplateAssetFamily | 'image';
}

/* ── Metadata-driven derivable ranges (STEP 6 — no hardcoded counts) ────── */

const DEFAULT_SLIDE_FLOOR = 2;
const DEFAULT_SECTION_FLOOR = 2;

/** Slide counts a carousel master can be trimmed to: 2 .. max(countOptions). */
export function derivableSlideCounts(template: CreatorTemplate): number[] {
  const g = template.formDefinition.slides;
  if (!g) return [];
  const max = Math.max(g.defaultCount, ...g.countOptions);
  const out: number[] = [];
  for (let n = DEFAULT_SLIDE_FLOOR; n <= max; n++) out.push(n);
  return out;
}

/** Section counts an infographic master can be trimmed to: min .. max. */
export function derivableSectionCounts(template: CreatorTemplate): number[] {
  const g = template.formDefinition.sections;
  if (!g) return [];
  const floor = Math.min(g.min, DEFAULT_SECTION_FLOOR);
  const out: number[] = [];
  for (let n = floor; n <= g.max; n++) out.push(n);
  return out;
}

/* ── Deterministic derivation (STEP 3/4/5) ─────────────────────────────── */

function withSlideCount(master: CreatorTemplate, n: number, derived: boolean): CreatorTemplate {
  const slides = master.formDefinition.slides!;
  const formDefinition: TemplateFormDefinition = {
    ...master.formDefinition,
    // Preserve the per-slide field definitions (component hierarchy/typography
    // regions) verbatim; only the COUNT metadata changes.
    slides: { ...slides, countOptions: derived ? [n] : slides.countOptions, defaultCount: n },
  };
  return {
    ...master,                                   // theme, branding, visualLanguage, *Style, ownership, tags preserved
    id: derived ? `${master.id}--s${n}` : master.id,
    formDefinition,
    // Rendering contract preserved; only the frame count reflects the variant.
    renderingContract: { ...master.renderingContract, frameCount: n },
    metadata: derived ? { ...master.metadata, derivedFrom: master.id, derivedCount: n } : master.metadata,
  };
}

function withSectionCount(master: CreatorTemplate, n: number, derived: boolean): CreatorTemplate {
  const sections = master.formDefinition.sections!;
  const formDefinition: TemplateFormDefinition = {
    ...master.formDefinition,
    // Pin the variant to EXACTLY n sections (min === max === n); only the count
    // changes, the per-section field defs are preserved verbatim.
    sections: { ...sections, min: n, max: n },
  };
  return {
    ...master,
    id: derived ? `${master.id}--sec${n}` : master.id,
    formDefinition,
    metadata: derived ? { ...master.metadata, derivedFrom: master.id, derivedCount: n } : master.metadata,
  };
}

/* ── Resolver (STEP 2) ─────────────────────────────────────────────────── */

export interface ResolveInput {
  recommendation: AssetSizeRecommendation;
  requestedTemplate: CreatorTemplate;
}

export function resolveTemplateVariant(input: ResolveInput): ResolvedTemplate {
  const rec = input.recommendation;
  const master = input.requestedTemplate;
  const family = rec.recommendedFamily;

  // Recommendation downgraded to a different family (e.g. Image) — that's a
  // Template-Selection decision, not a count variant. Pass through the signal.
  if (family !== master.assetFamily) {
    return { template: master, resolution: 'family-change', derivedFrom: null, count: null, family };
  }

  if (family === 'carousel') {
    const n = rec.recommendedSlideCount;
    const slides = master.formDefinition.slides;
    if (n == null || !slides) return { template: master, resolution: 'exact', derivedFrom: null, count: null, family };
    // 1. exact — the master already supports this count.
    if (slides.countOptions.includes(n)) return { template: withSlideCount(master, n, false), resolution: 'exact', derivedFrom: null, count: n, family };
    // 2/3. compatible/derived — within the derivable range → derive deterministically.
    if (derivableSlideCounts(master).includes(n)) return { template: withSlideCount(master, n, true), resolution: 'derived', derivedFrom: master.id, count: n, family };
    // Out of range — clamp to the master's max (no fabrication beyond metadata).
    const max = Math.max(slides.defaultCount, ...slides.countOptions);
    return { template: withSlideCount(master, Math.min(n, max), n > max ? false : true), resolution: n > max ? 'exact' : 'derived', derivedFrom: n > max ? null : master.id, count: Math.min(n, max), family };
  }

  if (family === 'infographic') {
    const n = rec.recommendedSectionCount;
    const sections = master.formDefinition.sections;
    if (n == null || !sections) return { template: master, resolution: 'exact', derivedFrom: null, count: null, family };
    if (n >= sections.min && n <= sections.max) return { template: withSectionCount(master, n, false), resolution: 'compatible', derivedFrom: null, count: n, family };
    if (derivableSectionCounts(master).includes(n)) return { template: withSectionCount(master, n, true), resolution: 'derived', derivedFrom: master.id, count: n, family };
    return { template: master, resolution: 'exact', derivedFrom: null, count: sections.min, family };
  }

  // Image — single canvas, no count variant.
  return { template: master, resolution: 'exact', derivedFrom: null, count: null, family };
}

/* ── Preservation verification (STEP 8) ────────────────────────────────── */

export interface VariantPreservation {
  ok: boolean;
  preserved: { theme: boolean; branding: boolean; typographyRegions: boolean; safeAreasFields: boolean; renderingContract: boolean; family: boolean };
  changedOnly: string[];   // the metadata keys that legitimately changed (count)
  findings: string[];
}

/** Verify a derived variant preserves everything except the count metadata. */
export function verifyVariantPreservation(master: CreatorTemplate, derived: CreatorTemplate): VariantPreservation {
  const j = (v: unknown) => JSON.stringify(v);
  const theme = j(master.visualLanguage) === j(derived.visualLanguage);
  const branding = master.assetFamily === 'image'
    ? j(master.imageStyle) === j(derived.imageStyle)
    : master.assetFamily === 'carousel'
      ? j(master.carouselStyle) === j(derived.carouselStyle)
      : j(master.infographicStyle) === j(derived.infographicStyle);
  // Per-slide / per-section field defs (typography regions + component hierarchy).
  const masterSlotFields = j(master.formDefinition.slides?.fields ?? master.formDefinition.sections?.fields ?? null);
  const derivedSlotFields = j(derived.formDefinition.slides?.fields ?? derived.formDefinition.sections?.fields ?? null);
  const typographyRegions = masterSlotFields === derivedSlotFields;
  const safeAreasFields = j(master.formDefinition.fields) === j(derived.formDefinition.fields);
  // Rendering contract preserved except frameCount (the variant's frame count).
  const rcMaster = { ...master.renderingContract, frameCount: null };
  const rcDerived = { ...derived.renderingContract, frameCount: null };
  const renderingContract = j(rcMaster) === j(rcDerived);
  const family = master.assetFamily === derived.assetFamily;

  const preserved = { theme, branding, typographyRegions, safeAreasFields, renderingContract, family };
  const findings: string[] = [];
  for (const [k, v] of Object.entries(preserved)) if (!v) findings.push(`${k} not preserved`);
  return {
    ok: findings.length === 0,
    preserved,
    changedOnly: ['formDefinition.slides.count/defaultCount', 'renderingContract.frameCount'],
    findings,
  };
}
