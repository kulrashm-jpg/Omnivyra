// Cross-Content-Type Editorial Compatibility Contract
//
// Advisory-only, non-enforcing contract describing how the long-form editorial
// architecture is expected to behave consistently across content types. This
// is contract data only: it does not gate, enforce, or mutate anything.

import type { NarrativeProgressionStage } from './narrativePlanningEngine';

export type EditorialContentTypeKind =
  | 'blog'
  | 'article'
  | 'guide'
  | 'newsletter'
  | 'story'
  | 'long_form_educational';

export type EditorialDepthExpectation = 'standard' | 'deep' | 'authority' | 'narrative';
export type EditorialAuthorityExpectation = 'low' | 'standard' | 'high';
export type EditorialAntiRepetitionExpectation = 'standard' | 'strict';
export type EditorialTransitionExpectation = 'light' | 'standard' | 'strong';

export interface EditorialSectionDensityExpectation {
  min: number;
  typical: number;
  max: number;
}

export interface EditorialCompatibilityContract {
  contentType: EditorialContentTypeKind;
  allowedNarrativeStages: readonly NarrativeProgressionStage[];
  sectionDensity: EditorialSectionDensityExpectation;
  depthExpectation: EditorialDepthExpectation;
  authorityExpectation: EditorialAuthorityExpectation;
  antiRepetitionExpectation: EditorialAntiRepetitionExpectation;
  transitionExpectation: EditorialTransitionExpectation;
  notes: readonly string[];
}

const ALL_STAGES: readonly NarrativeProgressionStage[] = [
  'diagnose',
  'reframe',
  'expand',
  'operationalize',
  'validate',
  'resolve',
];

export const EDITORIAL_CONTENT_TYPE_KINDS: readonly EditorialContentTypeKind[] = [
  'blog',
  'article',
  'guide',
  'newsletter',
  'story',
  'long_form_educational',
];

export const CROSS_CONTENT_TYPE_EDITORIAL_COMPATIBILITY: Record<
  EditorialContentTypeKind,
  EditorialCompatibilityContract
> = {
  blog: {
    contentType: 'blog',
    allowedNarrativeStages: ALL_STAGES,
    sectionDensity: { min: 3, typical: 5, max: 7 },
    depthExpectation: 'deep',
    authorityExpectation: 'high',
    antiRepetitionExpectation: 'strict',
    transitionExpectation: 'standard',
    notes: ['progressive argument', 'avoid repeating prior series coverage'],
  },
  article: {
    contentType: 'article',
    allowedNarrativeStages: ['diagnose', 'reframe', 'expand', 'validate', 'resolve'],
    sectionDensity: { min: 3, typical: 5, max: 8 },
    depthExpectation: 'authority',
    authorityExpectation: 'high',
    antiRepetitionExpectation: 'strict',
    transitionExpectation: 'strong',
    notes: ['narrative or investigative throughline', 'evidence-led reframes'],
  },
  guide: {
    contentType: 'guide',
    allowedNarrativeStages: ['diagnose', 'expand', 'operationalize', 'validate', 'resolve'],
    sectionDensity: { min: 4, typical: 7, max: 10 },
    depthExpectation: 'deep',
    authorityExpectation: 'standard',
    antiRepetitionExpectation: 'standard',
    transitionExpectation: 'standard',
    notes: ['operational sequencing', 'step-level differentiation per section'],
  },
  newsletter: {
    contentType: 'newsletter',
    allowedNarrativeStages: ['diagnose', 'reframe', 'expand', 'resolve'],
    sectionDensity: { min: 2, typical: 4, max: 5 },
    depthExpectation: 'standard',
    authorityExpectation: 'standard',
    antiRepetitionExpectation: 'standard',
    transitionExpectation: 'light',
    notes: ['concise cadence', 'single dominant insight per issue'],
  },
  story: {
    contentType: 'story',
    allowedNarrativeStages: ['diagnose', 'reframe', 'expand', 'validate', 'resolve'],
    sectionDensity: { min: 3, typical: 5, max: 7 },
    depthExpectation: 'narrative',
    authorityExpectation: 'low',
    antiRepetitionExpectation: 'strict',
    transitionExpectation: 'strong',
    notes: ['scene-to-scene continuity', 'reader-state movement over framework reuse'],
  },
  long_form_educational: {
    contentType: 'long_form_educational',
    allowedNarrativeStages: ALL_STAGES,
    sectionDensity: { min: 5, typical: 8, max: 12 },
    depthExpectation: 'authority',
    authorityExpectation: 'high',
    antiRepetitionExpectation: 'strict',
    transitionExpectation: 'standard',
    notes: ['concept scaffolding', 'progressive complexity', 'explicit validation stages'],
  },
};

const CONTENT_TYPE_ALIASES: Record<string, EditorialContentTypeKind> = {
  blog: 'blog',
  article: 'article',
  guide: 'guide',
  newsletter: 'newsletter',
  story: 'story',
  'short-story': 'story',
  educational: 'long_form_educational',
  'long-form-educational': 'long_form_educational',
  long_form_educational: 'long_form_educational',
};

export function resolveEditorialContentTypeKind(contentType: string): EditorialContentTypeKind | undefined {
  const key = String(contentType || '').toLowerCase().trim().replace(/\s+/g, '-');
  return CONTENT_TYPE_ALIASES[key] || CONTENT_TYPE_ALIASES[key.replace(/-/g, '_')];
}

export function getEditorialCompatibilityContract(
  contentType: string,
): EditorialCompatibilityContract {
  const kind = resolveEditorialContentTypeKind(contentType);
  // Advisory default: fall back to blog, the most general long-form contract.
  return CROSS_CONTENT_TYPE_EDITORIAL_COMPATIBILITY[kind || 'blog'];
}

export function serializeEditorialCompatibilityContract(contract: EditorialCompatibilityContract): string {
  return [
    '## CROSS-CONTENT-TYPE EDITORIAL COMPATIBILITY',
    `Content type: ${contract.contentType}`,
    `Allowed narrative stages: ${contract.allowedNarrativeStages.join(', ')}`,
    `Section density: ${contract.sectionDensity.min}-${contract.sectionDensity.typical}-${contract.sectionDensity.max}`,
    `Depth expectation: ${contract.depthExpectation}`,
    `Authority expectation: ${contract.authorityExpectation}`,
    `Anti-repetition expectation: ${contract.antiRepetitionExpectation}`,
    `Transition expectation: ${contract.transitionExpectation}`,
    `Notes: ${contract.notes.join('; ') || 'none'}`,
  ].join('\n');
}
