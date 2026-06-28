/**
 * Asset Size Recommendation (CREATOR-032). A deterministic layer between Asset
 * Assembly and Template Selection that picks the SMALLEST template capable of
 * faithfully presenting the available distinct content units — so thin content
 * never produces duplicate slides. Pure: input is the canonical Asset Assembly
 * (+ the template variants' supported counts); output is a recommendation. No
 * AI, no rendering, no fabricated content, no modification to Template
 * Population / Story Blueprint / Creative Verification. Never duplicates a unit
 * to satisfy a fixed template size.
 */

import type { AssetAssembly } from './assetAssembly';

export type RecommendedFamily = 'image' | 'carousel' | 'infographic';

export interface AssetSizeRecommendation {
  recommendedFamily: RecommendedFamily;
  recommendedVariantLabel: string;        // STEP 7 editor label, e.g. "Carousel (7 Slides)"
  recommendedSlideCount: number | null;
  recommendedSectionCount: number | null;
  availableUnits: number;                 // distinct meaningful content units
  unusedUnits: number;                    // units beyond the recommended size (explicitly reported)
  coverage: number;                       // presented / available (0..1)
  status: 'PASS' | 'WARN';                // STEP 6: 100% coverage → PASS, else WARN (never FAIL)
  reason: string;
}

export interface SizeOptions {
  requestedFamily?: RecommendedFamily;
  slideCountOptions?: number[];           // carousel variants (default real system [5,7,10])
  sectionMin?: number;                    // infographic min sections (default 2)
  sectionMax?: number;                    // infographic max sections (default 6)
}

/* ── Distinct content units (no duplication — the core measurement) ────── */

/** Count distinct, meaningful units in the assembly (deduped by headline). */
export function distinctUnits(assembly: AssetAssembly): number {
  const seen = new Set<string>();
  for (const u of assembly.assets) {
    const key = (u.headline || '').trim().toLowerCase();
    if (key) seen.add(key);
  }
  // Fall back to body when headlines are absent, so a content-bearing unit still counts.
  if (seen.size === 0) {
    for (const u of assembly.assets) { const b = (u.body || '').trim().toLowerCase(); if (b) seen.add(b); }
  }
  return seen.size;
}

const largestOptionAtMost = (n: number, opts: number[]): number => {
  const sorted = opts.slice().sort((a, b) => a - b);
  let pick = sorted[0];
  for (const o of sorted) if (o <= n) pick = o;
  return pick;
};
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const labelFor = (family: RecommendedFamily, slides: number | null, sections: number | null): string =>
  family === 'image' ? 'Image'
    : family === 'carousel' ? `Carousel (${slides} Slides)`
      : `Infographic (${sections} Sections)`;

/* ── Recommendation (STEP 2/3) ─────────────────────────────────────────── */

export function recommendAssetSize(assembly: AssetAssembly, options: SizeOptions = {}): AssetSizeRecommendation {
  const units = distinctUnits(assembly);
  // Template Population (frozen) emits ONE slide/section per assembly asset (=
  // blueprint role count). If the assembly carries duplicate-headline assets,
  // every multi-slide layout duplicates content — only an Image is faithful.
  const populatedSlots = assembly.assets.length;
  const hasDuplicateUnits = units < populatedSlots;
  const slideOpts = (options.slideCountOptions && options.slideCountOptions.length ? options.slideCountOptions : [5, 7, 10]).slice().sort((a, b) => a - b);
  const carouselMin = slideOpts[0];
  const secMin = options.sectionMin ?? 2;
  const secMax = options.sectionMax ?? 6;
  const req = options.requestedFamily;

  let family: RecommendedFamily;
  let slideCount: number | null = null;
  let sectionCount: number | null = null;
  let reason: string;

  // Honor the requested family when it can hold the content without duplication;
  // otherwise pick the smallest faithful family by unit count (downgrade).
  const carouselFits = units >= carouselMin;
  const infographicFits = units >= secMin;

  if (req === 'image' || units <= 1 || hasDuplicateUnits) {
    family = 'image';
    reason = req === 'image' ? 'Image requested.'
      : units <= 1 ? `${units} distinct unit → a single Image (no carousel duplication).`
        : `${units} distinct units across ${populatedSlots} layout slots — a multi-slide layout would duplicate content. Image is the only duplicate-free option.`;
  } else if (req === 'carousel' && carouselFits) {
    family = 'carousel'; slideCount = largestOptionAtMost(units, slideOpts);
    reason = `${units} distinct units → ${slideCount}-slide Carousel (largest variant ≤ available units).`;
  } else if (req === 'infographic' && infographicFits) {
    family = 'infographic'; sectionCount = clamp(units, secMin, secMax);
    reason = `${units} distinct units → Infographic (${sectionCount} sections).`;
  } else if (carouselFits && (req === undefined || req === 'carousel')) {
    family = 'carousel'; slideCount = largestOptionAtMost(units, slideOpts);
    reason = `${units} distinct units → ${slideCount}-slide Carousel.`;
  } else if (infographicFits) {
    family = 'infographic'; sectionCount = clamp(units, secMin, secMax);
    reason = req === 'carousel'
      ? `Only ${units} distinct units — fewer than the smallest carousel (${carouselMin} slides). Recommending Infographic (${sectionCount} sections) to avoid duplicate slides.`
      : `${units} distinct units → Infographic (${sectionCount} sections).`;
  } else {
    family = 'image';
    reason = `${units} distinct units — below the infographic minimum (${secMin}). Recommending Image to avoid empty/duplicate slots.`;
  }

  const presented = slideCount ?? sectionCount ?? 1;
  const cappedPresented = Math.min(presented, units || 1);
  const unusedUnits = Math.max(0, units - presented);
  const coverage = units ? Math.round((cappedPresented / units) * 100) / 100 : 1;
  return {
    recommendedFamily: family,
    recommendedVariantLabel: labelFor(family, slideCount, sectionCount),
    recommendedSlideCount: slideCount,
    recommendedSectionCount: sectionCount,
    availableUnits: units,
    unusedUnits,
    coverage,
    status: coverage >= 1 ? 'PASS' : 'WARN',
    reason,
  };
}

/* ── Coverage validation (STEP 5) ──────────────────────────────────────── */

export interface CoverageValidation {
  ok: boolean;
  everyUnitOnce: boolean;        // recommended size never exceeds available units → no duplication
  duplicatedUnits: boolean;
  unusedUnits: number;
  findings: string[];
}

export function validateRecommendationCoverage(rec: AssetSizeRecommendation): CoverageValidation {
  const presented = rec.recommendedSlideCount ?? rec.recommendedSectionCount ?? 1;
  const duplicatedUnits = presented > rec.availableUnits;   // would require duplicating a unit
  const findings: string[] = [];
  if (duplicatedUnits) findings.push(`Recommended size ${presented} exceeds ${rec.availableUnits} distinct units — would duplicate.`);
  if (rec.unusedUnits > 0) findings.push(`${rec.unusedUnits} unit(s) omitted (intentional — not duplicated).`);
  return { ok: !duplicatedUnits, everyUnitOnce: !duplicatedUnits, duplicatedUnits, unusedUnits: rec.unusedUnits, findings };
}

/* ── Creative Verification compatibility (STEP 6) ──────────────────────── */

/** Recommendation-aware verdict: 100% coverage → PASS; omitted duplicates → WARN; never FAIL. */
export function recommendationVerdict(rec: AssetSizeRecommendation): 'PASS' | 'WARN' {
  return rec.coverage >= 1 ? 'PASS' : 'WARN';
}
