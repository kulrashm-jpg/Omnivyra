/**
 * Shared Purpose Options (P2-5).
 *
 * Single source of truth for the user-facing purpose pickers in
 * Creator + Writer (+ anywhere else that surfaces them). Before this
 * module each consumer maintained its own copy of the 5/5/6 enum
 * which created drift risk.
 *
 * Pure data. No I/O. No React.
 */

import type { CreatorTypeForVariant } from './creatorStrategyMapping';

export type PurposeOption = {
  /** Slug used for routing + analytics + strategy id resolution. */
  value: string;
  /** Operator-readable label. */
  label: string;
  /** Optional one-line description shown in tooltips / longer pickers. */
  description?: string;
};

/**
 * Canonical option lists per content type. These slugs match
 * `lib/variants/creatorStrategyMapping.ts` KNOWN_PURPOSES so the
 * strategy id resolver always recognizes them.
 */
export const PURPOSE_OPTIONS: Record<CreatorTypeForVariant, ReadonlyArray<PurposeOption>> = {
  image: [
    { value: 'promotional',      label: 'Promotional',      description: 'Direct offer or call to action.' },
    { value: 'educational',      label: 'Educational',      description: 'Teach or explain a concept.' },
    { value: 'quote',            label: 'Quote',            description: 'Typographic statement or excerpt.' },
    { value: 'product-showcase', label: 'Product Showcase', description: 'Highlight a product or feature.' },
    { value: 'brand-focus',      label: 'Brand Focus',      description: 'Reinforce brand identity.' },
  ],
  carousel: [
    { value: 'educational',      label: 'Educational',      description: 'Slide-based lesson sequence.' },
    { value: 'framework',        label: 'Framework',        description: 'Pillar / methodology breakdown.' },
    { value: 'story',            label: 'Story',            description: 'Narrative arc across slides.' },
    { value: 'product-showcase', label: 'Product Showcase', description: 'Feature tour per slide.' },
    { value: 'presentation',     label: 'Presentation',     description: 'Deck-style layout.' },
  ],
  infographic: [
    { value: 'stats',      label: 'Statistics', description: 'Numeric callouts and proof points.' },
    { value: 'process',    label: 'Process',    description: 'Step-by-step sequence.' },
    { value: 'timeline',   label: 'Timeline',   description: 'Chronological progression.' },
    { value: 'comparison', label: 'Comparison', description: 'Side-by-side decision.' },
    { value: 'framework',  label: 'Framework',  description: 'Quadrant / matrix layout.' },
    { value: 'roadmap',    label: 'Roadmap',    description: 'Phased plan or vision.' },
  ],
};

/** Lookup option for a single content type. */
export function listPurposeOptions(contentType: CreatorTypeForVariant): ReadonlyArray<PurposeOption> {
  return PURPOSE_OPTIONS[contentType];
}

/** Lookup a single option by content type + slug — null when unknown. */
export function findPurposeOption(
  contentType: CreatorTypeForVariant,
  value: string | null | undefined,
): PurposeOption | null {
  if (!value) return null;
  const opts = PURPOSE_OPTIONS[contentType];
  return opts.find((o) => o.value === value) ?? null;
}

/** Operator-readable label for a slug — falls back to the slug itself. */
export function labelForPurpose(
  contentType: CreatorTypeForVariant,
  value: string | null | undefined,
): string {
  return findPurposeOption(contentType, value)?.label ?? String(value ?? '');
}
