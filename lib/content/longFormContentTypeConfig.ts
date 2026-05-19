import type { ManagedContentType } from './contentTemplateRegistry';

export type LongFormContentType =
  | 'blog'
  | 'article'
  | 'guide'
  | 'newsletter'
  | 'story'
  | 'whitepaper'
  | 'case-study';

export type SeoPriority = 'high' | 'medium' | 'low';
export type LinkingStrategy = 'internal-first' | 'citation-first' | 'minimal' | 'none';

export interface LongFormContentTypeConfig {
  contentType: LongFormContentType;
  allowedFormats: readonly string[];
  defaultFormat: string;
  defaultTone: string;
  seoPriority: SeoPriority;
  linkingStrategy: LinkingStrategy;
  narrativeRules: readonly string[];
  citationStyle: 'references' | 'inline-numbered' | 'curated-links' | 'optional';
  depthLevel: 'standard' | 'deep' | 'authority' | 'narrative';
  structureStyle: string;
  summaryStyle: string;
  insightDensity: 'light' | 'standard' | 'high';
  researchEnforcement: 'none' | 'recommended' | 'required';
}

export const LONG_FORM_CONTENT_TYPES: readonly LongFormContentType[] = [
  'blog',
  'article',
  'guide',
  'newsletter',
  'story',
  'whitepaper',
  'case-study',
];

export const contentTypeConfig: Record<LongFormContentType, LongFormContentTypeConfig> = {
  blog: {
    contentType: 'blog',
    allowedFormats: ['standard', 'listicle', 'tutorial', 'case-study', 'comparison', 'pillar'],
    defaultFormat: 'standard',
    defaultTone: 'analytical, direct, thought-leadership',
    seoPriority: 'high',
    linkingStrategy: 'internal-first',
    narrativeRules: ['Build a progressive argument', 'Avoid repeating prior series coverage'],
    citationStyle: 'references',
    depthLevel: 'deep',
    structureStyle: 'H2-led editorial body with key insights, summary, and references',
    summaryStyle: 'Standalone synthesis with next-step implications',
    insightDensity: 'high',
    researchEnforcement: 'recommended',
  },
  article: {
    contentType: 'article',
    allowedFormats: ['narrative', 'investigative', 'opinion'],
    defaultFormat: 'narrative',
    defaultTone: 'journalistic, balanced, evidence-based',
    seoPriority: 'medium',
    linkingStrategy: 'citation-first',
    narrativeRules: ['Include competing viewpoints', 'Attribute claims where possible'],
    citationStyle: 'references',
    depthLevel: 'deep',
    structureStyle: 'Editorial article with sourced sections and balanced conclusion',
    summaryStyle: 'Implication-led close, not promotional CTA',
    insightDensity: 'standard',
    researchEnforcement: 'required',
  },
  guide: {
    contentType: 'guide',
    allowedFormats: ['comprehensive', 'quickstart', 'reference'],
    defaultFormat: 'comprehensive',
    defaultTone: 'authoritative educator',
    seoPriority: 'high',
    linkingStrategy: 'internal-first',
    narrativeRules: ['Build from foundations to advanced application', 'Cross-reference sections'],
    citationStyle: 'references',
    depthLevel: 'authority',
    structureStyle: 'Progressive chapters, examples, frameworks, and implementation guidance',
    summaryStyle: 'Practical recap with reader action path',
    insightDensity: 'high',
    researchEnforcement: 'required',
  },
  newsletter: {
    contentType: 'newsletter',
    allowedFormats: ['weekly-brief', 'insight-letter', 'strategic-letter', 'action-letter', 'curated', 'digest', 'editorial'],
    defaultFormat: 'weekly-brief',
    defaultTone: 'warm, concise, opinionated where useful',
    seoPriority: 'medium',
    linkingStrategy: 'citation-first',
    narrativeRules: ['Reward scanning', 'Make every section forwardable'],
    citationStyle: 'curated-links',
    depthLevel: 'standard',
    structureStyle: 'Letter-style sections with extractable insights and clear takeaways',
    summaryStyle: 'Inbox-friendly bottom line',
    insightDensity: 'high',
    researchEnforcement: 'recommended',
  },
  story: {
    contentType: 'story',
    allowedFormats: ['short_story', 'long_story', 'episodic_story'],
    defaultFormat: 'short_story',
    defaultTone: 'human, vivid, narrative',
    seoPriority: 'low',
    linkingStrategy: 'minimal',
    narrativeRules: ['Show, do not tell', 'Use emotional arc and concrete scenes'],
    citationStyle: 'optional',
    depthLevel: 'narrative',
    structureStyle: 'Scene-based story beats with natural brand insight',
    summaryStyle: 'Resolution or reflection rather than summary list',
    insightDensity: 'light',
    researchEnforcement: 'none',
  },
  whitepaper: {
    contentType: 'whitepaper',
    allowedFormats: ['research', 'strategic', 'technical'],
    defaultFormat: 'research',
    defaultTone: 'formal, rigorous, executive',
    seoPriority: 'medium',
    linkingStrategy: 'citation-first',
    narrativeRules: ['State methodology', 'Present limitations and recommendations'],
    citationStyle: 'inline-numbered',
    depthLevel: 'authority',
    structureStyle: 'Executive summary, evidence, methodology, framework, recommendations',
    summaryStyle: 'Executive synthesis with decision implications',
    insightDensity: 'high',
    researchEnforcement: 'required',
  },
  'case-study': {
    contentType: 'case-study',
    allowedFormats: ['case-study'],
    defaultFormat: 'case-study',
    defaultTone: 'proof-led, specific, outcome-oriented',
    seoPriority: 'medium',
    linkingStrategy: 'minimal',
    narrativeRules: ['Use background, challenge, solution, implementation, results', 'Quantify only when evidence is supplied'],
    citationStyle: 'references',
    depthLevel: 'deep',
    structureStyle: 'Proof narrative with measurable result mechanics',
    summaryStyle: 'Transferable lessons and buyer-relevant proof',
    insightDensity: 'standard',
    researchEnforcement: 'recommended',
  },
};

export function isLongFormContentType(value: string): value is LongFormContentType {
  return (LONG_FORM_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * DUAL-REGISTRY COLLISION GUARD — `article` is intentionally a member of BOTH
 * this long-form registry AND backend/utils/boltTextContentConfig
 * (BOLT_TEXT_CONTENT_TYPES, ≤800-word text). They are two different products
 * that share a name:
 *
 *   • BOLT "article"  → short text item, ≤800 words, scheduled by orchestration
 *                        (classifyContentType → bolt_text).
 *   • Long-form "article" → full editorial piece produced by the long-form
 *                        engine / content-creator (this registry).
 *
 * The disambiguator is the ENGINE, not the type string: only callers that
 * enter the long-form engine (guarded by isLongFormContentType in
 * unifiedLongFormEngine) treat `article` as long-form. Any code that routes
 * by content type alone MUST call this guard so a long-form article is never
 * silently downgraded to the BOLT ≤800-word path (or vice-versa). This is an
 * explicit assertion point — keep it; do not "simplify" it away.
 */
export const DUAL_REGISTRY_CONTENT_TYPES: readonly LongFormContentType[] = ['article'];

export function isDualRegistryContentType(value: string): boolean {
  return (DUAL_REGISTRY_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Explicit routing guard. Given a content type and the engine context the
 * caller is in, returns whether it should be handled as long-form. For the
 * ambiguous `article`, long-form is decided by `inLongFormEngineContext`
 * (e.g. the content-creator / long-form engine sets this true). Non-ambiguous
 * types fall back to registry membership.
 */
export function resolveIsLongForm(
  value: string,
  inLongFormEngineContext: boolean,
): boolean {
  if (isDualRegistryContentType(value)) return inLongFormEngineContext;
  return isLongFormContentType(value);
}

export function toManagedLongFormContentType(value: LongFormContentType): ManagedContentType {
  return value === 'case-study' ? 'case-study' : value;
}
