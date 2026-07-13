/**
 * longFormCapabilityProfile.ts — the canonical Long-form Capability Profile (PMF-003 §1/§2).
 *
 * ONE declarative profile per long-form content type. The platform runtime EXECUTES
 * the profile (config + orchestration) instead of hardcoded flows — adding a new
 * long-form type becomes "add a profile", not "write another execution path". The
 * profile references PMF-002 extracted intelligence by component id and the engine's
 * content type (which selects the existing prompts — prompt selection behind the
 * profile, §7). It changes no prompt and no generation behavior.
 */

import type { IntelligenceComponentId } from '../longFormIntelligence/intelligenceRegistry';

export type LongFormCapabilityId =
  | 'BLOG' | 'ARTICLE' | 'GUIDE' | 'NEWSLETTER' | 'CASE_STUDY'
  | 'WHITEPAPER' | 'LANDING_PAGE' | 'PILLAR_PAGE' | 'STORY' | 'EBOOK';

export interface LongFormCapabilityProfile {
  id: LongFormCapabilityId;
  /** The engine content type this profile maps to (selects existing prompts). */
  engineContentType: string;
  /** CKC knowledge requirements (domains/confidence/freshness/language/version/mode). */
  knowledge: {
    consumer: string;
    minConfidence?: number;
    maxAgeMs?: number;
    mode?: 'summary' | 'full' | 'compressed';
  };
  /** PMF-002 planning intelligence used (outline validation + normalization). */
  planningStrategy: IntelligenceComponentId[];
  /** PMF-002 validators applied. */
  validationStrategy: IntelligenceComponentId[];
  /** PMF-002 repair intelligence. */
  repairStrategy: IntelligenceComponentId[];
  /** PMF-002 quality gates. */
  qualityGates: IntelligenceComponentId[];
  /** PMF-002 post-processing. */
  postProcessing: IntelligenceComponentId[];
  /** Output contract id (AIC). */
  outputContract: string;
  preferredModels: string[];
  fallbackModels: string[];
  timeoutMs: number;
  retryPolicy: { maxRetries: number };
  approvalRequirements: { required: boolean };
  featureFlags: { runtimeFlag: string };
  executionMetadata: { multiStep: boolean; inline: boolean };
}

const VALIDATORS: IntelligenceComponentId[] = ['OUTLINE_VALIDATOR', 'SECTION_VALIDATOR', 'DUPLICATION_DETECTOR', 'QUALITY_VALIDATOR'];
const QUALITY: IntelligenceComponentId[] = ['QUALITY_SCORER', 'DIFFERENTIATION_SCORER', 'AUTHORITY_VALIDATOR', 'THOUGHT_LEADERSHIP_VALIDATOR'];

function profile(id: LongFormCapabilityId, engineContentType: string, overrides: Partial<LongFormCapabilityProfile> = {}): LongFormCapabilityProfile {
  return {
    id, engineContentType,
    knowledge: { consumer: 'CONTENT_WRITER', mode: 'summary', ...(overrides.knowledge ?? {}) },
    planningStrategy: overrides.planningStrategy ?? ['OUTLINE_VALIDATOR', 'POST_PROCESSING'],
    validationStrategy: overrides.validationStrategy ?? VALIDATORS,
    repairStrategy: overrides.repairStrategy ?? ['SECTION_VALIDATOR', 'REGENERATION_STRATEGY'],
    qualityGates: overrides.qualityGates ?? QUALITY,
    postProcessing: overrides.postProcessing ?? ['POST_PROCESSING'],
    outputContract: overrides.outputContract ?? 'long_form',
    preferredModels: overrides.preferredModels ?? ['gpt-4o-mini'],
    fallbackModels: overrides.fallbackModels ?? [],
    timeoutMs: overrides.timeoutMs ?? 300_000,
    retryPolicy: overrides.retryPolicy ?? { maxRetries: 0 },
    approvalRequirements: overrides.approvalRequirements ?? { required: false },
    featureFlags: overrides.featureFlags ?? { runtimeFlag: 'LONG_FORM_RUNTIME' },
    executionMetadata: overrides.executionMetadata ?? { multiStep: true, inline: true },
  };
}

const REGISTRY_INTERNAL: Record<LongFormCapabilityId, LongFormCapabilityProfile> = {
  BLOG:         profile('BLOG', 'blog'),
  ARTICLE:      profile('ARTICLE', 'article'),
  GUIDE:        profile('GUIDE', 'guide'),
  NEWSLETTER:   profile('NEWSLETTER', 'newsletter'),
  CASE_STUDY:   profile('CASE_STUDY', 'case-study'),
  WHITEPAPER:   profile('WHITEPAPER', 'whitepaper'),
  LANDING_PAGE: profile('LANDING_PAGE', 'landing-page'),
  PILLAR_PAGE:  profile('PILLAR_PAGE', 'pillar-page'),
  STORY:        profile('STORY', 'story', { postProcessing: ['POST_PROCESSING_STORY'] }),
  EBOOK:        profile('EBOOK', 'ebook', { timeoutMs: 420_000 }),
};

export const LONG_FORM_PROFILES: Readonly<Record<LongFormCapabilityId, LongFormCapabilityProfile>> = REGISTRY_INTERNAL;
export const LONG_FORM_CAPABILITY_IDS = Object.keys(REGISTRY_INTERNAL) as LongFormCapabilityId[];

/** Resolve a profile by capability id, or null. */
export function resolveLongFormProfile(id: LongFormCapabilityId): LongFormCapabilityProfile | null {
  return REGISTRY_INTERNAL[id] ?? null;
}

/** Resolve the profile whose engine content type matches (the migration wiring key). */
export function profileForEngineContentType(engineContentType: string): LongFormCapabilityProfile | null {
  const key = String(engineContentType || '').toLowerCase();
  return LONG_FORM_CAPABILITY_IDS.map((id) => REGISTRY_INTERNAL[id]).find((p) => p.engineContentType === key) ?? null;
}
