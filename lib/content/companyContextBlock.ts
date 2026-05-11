/**
 * Company Context Block — Centralized Enforcement Infrastructure
 *
 * Single source of truth for:
 * 1. Building canonical company context blocks for prompts
 * 2. Anti-generic enforcement rules (system prompt injection)
 * 3. Section-level enforcement rules
 * 4. Internal validation loop (prompt-level self-check)
 * 5. Company context scoring (post-generation quality check)
 *
 * Used by ALL content generation paths:
 * - Blog generators (Classic, Editorial, Comparison, Tutorial, Template)
 * - Unified engine (Post, Thread, Carousel, Video Script)
 * - BOLT pipeline (blueprintGenerator, platformVariantGenerator)
 * - Newsletter generators
 * - Content improvement engine
 */

import type { CompanyProfile, EntityArchetypeIntelligence, UserGuidedIntelligence } from '../../backend/services/companyProfile/types';
import { buildArchetypePromptContext, isBusinessFirstOnlyArchetype } from '../../backend/services/companyProfile/entityArchetype';
import {
  buildStructuredCompetitorDimensionBlock,
  shouldUseAudienceLedSynthesis,
} from '../../backend/services/companyProfile/competitorSynthesis';
import { getContentValidationMode, validateContentVariation } from './contentVariationValidator';
import {
  type StrategyProfile,
  buildStrategyInstructions,
  extractStrategyProfile,
  validateStrategicPerspective,
} from './companyStrategyPerspective';

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal company context for prompt injection. Subset of CompanyProfile. */
export interface CompanyIdentity {
  companyName?: string;
  industry?: string;
  targetAudience?: string;
  idealCustomerProfile?: string;
  coreProblem?: string;
  painPoints?: string[];
  uniqueValue?: string;
  productsServices?: string;
  desiredTransformation?: string;
  competitiveAdvantages?: string;
  authorityDomains?: string[];
  keyMessages?: string;
  brandVoice?: string;
  strategyProfile?: StrategyProfile;
  entityArchetype?: EntityArchetypeIntelligence | null;
  competitorIntelligence?: NonNullable<CompanyProfile['report_settings']>['competitor_intelligence'];
  userGuidance?: UserGuidedIntelligence | null;
}

export interface CompanyContextScoreResult {
  score: number;          // 0–100
  companyMentions: number;
  painPointHits: number;
  icpReferences: number;
  genericPhraseCount: number;
  duplicateContentDetected: boolean;
  lowVariationDetected: boolean;
  scenarioPresent: boolean;
  perspectiveMismatch: boolean;
  issues: string[];
}

// ── Extract CompanyIdentity from CompanyProfile ──────────────────────────────

export function extractCompanyIdentity(profile: CompanyProfile | null | undefined): CompanyIdentity {
  if (!profile) return {};
  return {
    companyName: profile.name || undefined,
    industry: profile.industry || undefined,
    targetAudience: profile.target_audience || undefined,
    idealCustomerProfile: profile.ideal_customer_profile || undefined,
    coreProblem: profile.core_problem_statement || undefined,
    painPoints: profile.pain_symptoms?.filter(Boolean) || undefined,
    uniqueValue: profile.unique_value || undefined,
    productsServices: profile.products_services || undefined,
    desiredTransformation: profile.desired_transformation || undefined,
    competitiveAdvantages: profile.competitive_advantages || undefined,
    authorityDomains: profile.authority_domains?.filter(Boolean) || undefined,
    keyMessages: profile.key_messages || undefined,
    brandVoice: profile.brand_voice || undefined,
    strategyProfile: extractStrategyProfile(profile),
    entityArchetype: profile.report_settings?.entity_archetype ?? null,
    competitorIntelligence: profile.report_settings?.competitor_intelligence ?? null,
    userGuidance: profile.report_settings?.user_guidance ?? null,
  };
}

function buildCompetitorIdentityContext(identity: CompanyIdentity): string {
  if (!shouldUseAudienceLedSynthesis(identity.entityArchetype, identity.competitorIntelligence ?? null)) return '';
  return buildStructuredCompetitorDimensionBlock(identity.competitorIntelligence ?? null);
}

function buildUserGuidedIdentityContext(identity: CompanyIdentity): string {
  const guidance = identity.userGuidance;
  if (!guidance) return '';
  const lines: string[] = [];
  for (const [section, field] of Object.entries(guidance.messaging ?? {})) {
    const value = field?.edited_value ?? field?.approved_value ?? field?.guidance;
    if (value) lines.push(`${section.replace(/_/g, ' ')}: ${value}`);
  }
  for (const note of guidance.guidance_notes ?? []) {
    if (note.status === 'archived' || !note.text) continue;
    lines.push(`guidance: ${note.text}`);
  }
  return lines.slice(0, 6).join('\n');
}

// ── 1. Canonical Company Context Block ───────────────────────────────────────
// Used in EVERY prompt (system or user) across all content types.

export function buildCompanyContextBlock(identity: CompanyIdentity): string {
  const archetypeContext = isBusinessFirstOnlyArchetype(identity.entityArchetype)
    ? ''
    : buildArchetypePromptContext(identity.entityArchetype);
  const competitorIdentityContext = buildCompetitorIdentityContext(identity);
  const userGuidanceContext = buildUserGuidedIdentityContext(identity);
  const lines = [
    identity.companyName ? `COMPANY: ${identity.companyName}` : null,
    archetypeContext ? `ENTITY ARCHETYPE: ${archetypeContext}` : null,
    competitorIdentityContext ? `PEER INTELLIGENCE: ${competitorIdentityContext}` : null,
    userGuidanceContext ? `USER-APPROVED IDENTITY GUIDANCE: ${userGuidanceContext}` : null,
    identity.industry ? `INDUSTRY: ${identity.industry}` : null,
    identity.targetAudience ? `TARGET AUDIENCE: ${identity.targetAudience}` : null,
    identity.idealCustomerProfile ? `IDEAL CUSTOMER (ICP): ${identity.idealCustomerProfile}` : null,
    identity.coreProblem ? `CORE PROBLEM: ${identity.coreProblem}` : null,
    identity.painPoints?.length ? `PAIN POINTS: ${identity.painPoints.slice(0, 5).join('; ')}` : null,
    identity.uniqueValue ? `UNIQUE VALUE: ${identity.uniqueValue}` : null,
    identity.productsServices ? `PRODUCTS/SERVICES: ${identity.productsServices}` : null,
    identity.desiredTransformation ? `TRANSFORMATION: ${identity.desiredTransformation}` : null,
    identity.competitiveAdvantages ? `DIFFERENTIATORS: ${identity.competitiveAdvantages}` : null,
    identity.authorityDomains?.length ? `AUTHORITY DOMAINS: ${identity.authorityDomains.slice(0, 5).join(', ')}` : null,
    identity.keyMessages ? `KEY MESSAGES: ${identity.keyMessages}` : null,
    identity.strategyProfile ? buildStrategyInstructions(identity.strategyProfile) : null,
  ].filter(Boolean);

  if (lines.length === 0) return '';
  return lines.join('\n');
}

/** Short version for short-form content (posts, threads). Max 4 lines. */
export function buildCompanyContextBlockShort(identity: CompanyIdentity): string {
  const archetypeContext = isBusinessFirstOnlyArchetype(identity.entityArchetype)
    ? ''
    : buildArchetypePromptContext(identity.entityArchetype);
  const lines = [
    identity.companyName ? `COMPANY: ${identity.companyName}` : null,
    archetypeContext ? `ARCHETYPE: ${archetypeContext}` : null,
    identity.industry && identity.targetAudience
      ? `CONTEXT: ${identity.industry} | Audience: ${identity.targetAudience}`
      : identity.industry ? `INDUSTRY: ${identity.industry}` : null,
    identity.coreProblem ? `PROBLEM: ${identity.coreProblem}` : null,
    identity.uniqueValue ? `VALUE: ${identity.uniqueValue}` : null,
    identity.strategyProfile?.worldview ? `PERSPECTIVE: ${identity.strategyProfile.worldview}` : null,
  ].filter(Boolean);

  if (lines.length === 0) return '';
  return lines.join('\n');
}

// ── 2. Identity Lock (System Prompt Block) ───────────────────────────────────
// Injected at the TOP of every system prompt so the model treats company
// context as identity, not optional guidance.

export function buildIdentityLock(identity: CompanyIdentity, contentType: string): string {
  const name = identity.companyName || 'the company';
  const audience = identity.idealCustomerProfile || identity.targetAudience || 'the target audience';
  const audienceLed = shouldUseAudienceLedSynthesis(identity.entityArchetype, identity.competitorIntelligence ?? null);
  const entityLabel = audienceLed ? 'entity' : 'company';
  const valueSurface = identity.entityArchetype?.primary_value_surface || 'expertise, positioning, and audience';
  const competitorIdentityContext = buildCompetitorIdentityContext(identity);
  const userGuidanceContext = buildUserGuidedIdentityContext(identity);

  return (
    `You are the in-house content strategist for ${name}. ` +
    `You write AS ${name}, not as an outside observer. ` +
    `Every piece of content must reflect ${name}'s ${audienceLed ? valueSurface : 'expertise, positioning, and audience'}.\n\n` +
    `YOUR AUDIENCE: ${audience}\n` +
    (identity.industry ? `YOUR INDUSTRY: ${identity.industry}\n` : '') +
    (identity.coreProblem ? `THE PROBLEM YOU SOLVE: ${identity.coreProblem}\n` : '') +
    (identity.uniqueValue ? `YOUR UNIQUE VALUE: ${identity.uniqueValue}\n` : '') +
    (competitorIdentityContext ? `PEER-AWARE IDENTITY CUES: ${competitorIdentityContext}\n` : '') +
    (userGuidanceContext ? `USER-APPROVED IDENTITY GUIDANCE: ${userGuidanceContext}\n` : '') +
    (identity.strategyProfile ? `${buildStrategyInstructions(identity.strategyProfile)}\n` : '') +
    `\nYou are creating ${contentType} content. Every output must be unmistakably from ${name}'s ${entityLabel} perspective.`
  );
}

// ── 3. Anti-Generic Enforcement Rules ────────────────────────────────────────
// Appended to EVERY system prompt. Non-negotiable.

export function buildAntiGenericRules(identity: CompanyIdentity): string {
  const name = identity.companyName || 'the company';
  const painRef = identity.painPoints?.[0] || 'the audience\'s core challenge';
  const audienceLed = shouldUseAudienceLedSynthesis(identity.entityArchetype, identity.competitorIntelligence ?? null);
  const anchorLabel = audienceLed
    ? 'offer, media, community, expertise, worldview, trust mechanics, ecosystem role, or audience situation'
    : 'product/service, or the target audience\'s situation';
  const competitorIdentityContext = buildCompetitorIdentityContext(identity);
  const userGuidanceContext = buildUserGuidedIdentityContext(identity);

  return (
    `\nCONTENT ENFORCEMENT RULES (NON-NEGOTIABLE):\n` +
    `1. You are writing AS ${name}. Every section must reflect this company's perspective, not generic industry advice.\n` +
    `1a. The output is invalid if it could be published by another company without changes.\n` +
    `2. Each major section MUST reference at least one of: a specific pain point, the ${anchorLabel}.\n` +
    `3. Replace abstract claims with concrete scenarios. Instead of "companies can optimize efficiency", describe a specific workflow ${name}'s audience faces.\n` +
    `4. Include at least one non-obvious insight or contrarian observation per major section.\n` +
    `5. If a sentence could appear unchanged on any competitor's site, rewrite it with ${name}-specific framing.\n` +
    `6. Ground every recommendation in ${name}'s domain: reference "${painRef}" or similar real audience challenges.\n` +
    (competitorIdentityContext ? `6b. Preserve peer-aware identity cues where relevant: ${competitorIdentityContext}\n` : '') +
    (userGuidanceContext ? `6c. Preserve user-approved identity guidance where relevant: ${userGuidanceContext}\n` : '') +
    (identity.strategyProfile ? `6a. ${buildStrategyInstructions(identity.strategyProfile)}\n` : '') +
    `7. FORBIDDEN PHRASES (never use without a concrete example following): "leverage", "optimize", "streamline", "cutting-edge", "game-changing", "revolutionary", "synergy", "paradigm shift", "unlock potential", "drive growth", "empower", "elevate", "holistic", "robust", "scalable", "actionable insights", "digital transformation", "future-proof", "best practices".\n` +
    `8. FORBIDDEN SENTENCE PATTERNS: Any sentence matching "Companies/Organizations/Teams that [generic verb] their [generic noun] see/achieve [generic benefit]" MUST be rewritten with a specific actor, named system, or concrete scenario. Every sentence must name WHO is doing WHAT in WHICH situation.\n`
  );
}

// ── 4. Section-Level Enforcement Prompt ──────────────────────────────────────
// Injected into section repair / per-section generation prompts.
// When sectionIndex is provided, rotates the WHAT anchor across pain points,
// product, and transformation — preventing the model from repeating the same
// pain point in every section.

export function buildSectionEnforcementPrompt(identity: CompanyIdentity, sectionIndex?: number): string {
  const name = identity.companyName || 'the company';
  const icp = identity.idealCustomerProfile || identity.targetAudience || 'the reader';
  const audienceLed = shouldUseAudienceLedSynthesis(identity.entityArchetype, identity.competitorIntelligence ?? null);
  const competitorIdentityContext = buildCompetitorIdentityContext(identity);
  const userGuidanceContext = buildUserGuidedIdentityContext(identity);

  // Build rotation pool: pain points, then product, then transformation
  const contextAnchors: string[] = [];
  if (identity.painPoints?.length) {
    for (const p of identity.painPoints.slice(0, 4)) {
      contextAnchors.push(`the pain point: "${p}"`);
    }
  }
  if (identity.productsServices) {
    contextAnchors.push(`${audienceLed ? 'the offer/media/community surface' : 'the product/service'}: "${identity.productsServices}"`);
  }
  if (identity.desiredTransformation) {
    contextAnchors.push(`the transformation outcome: "${identity.desiredTransformation}"`);
  }
  if (identity.coreProblem && contextAnchors.length < 2) {
    contextAnchors.push(`the core problem: "${identity.coreProblem}"`);
  }

  // Select anchor by rotating through the pool
  let whatLine: string;
  if (contextAnchors.length > 0 && sectionIndex != null) {
    const anchor = contextAnchors[sectionIndex % contextAnchors.length];
    whatLine = `- WHAT: This section must specifically reference ${anchor}. Connect it to ${name}'s domain.\n`;
  } else {
    whatLine = audienceLed
      ? `- WHAT: Connect to ${name}'s domain — mention a pain point, audience situation, worldview, trust mechanic, ecosystem role, authority signal, or transformation outcome.${competitorIdentityContext ? ` Preserve these peer-aware identity cues when relevant: ${competitorIdentityContext}` : ''}\n`
      : `- WHAT: Connect to ${name}'s domain — mention a pain point, product capability, or transformation outcome.\n`;
  }
  if (userGuidanceContext) {
    whatLine = whatLine.replace(/\n$/, ` Preserve user-approved identity guidance when relevant: ${userGuidanceContext}\n`);
  }

  return (
    `\nSECTION ENFORCEMENT (apply to this section):\n` +
    `- WHO: Write for ${icp}. Reference their role, situation, or daily reality.\n` +
    whatLine +
    `- HOW: Include a concrete scenario, workflow example, or before/after comparison. No abstract advice.\n` +
    `- TEST: If this section could be copy-pasted into a competitor's content unchanged, it fails. Rewrite.\n`
  );
}

// ── 5. Internal Validation Loop (Prompt-Level Self-Check) ────────────────────
// Appended to user prompts. Forces the model to self-validate before returning.

export function buildValidationChecklist(identity: CompanyIdentity, contentType: string): string {
  const name = identity.companyName || 'the company';
  const isShortForm = ['post', 'thread', 'carousel', 'video_script', 'engagement_response'].includes(contentType);

  if (isShortForm) {
    return (
      `\nBEFORE RETURNING, verify:\n` +
      `□ Does the output reference ${name} or its domain at least once?\n` +
      `□ Is there a specific scenario or example (not abstract motivation)?\n` +
      `□ Would this content make sense if the company name were replaced with a competitor? If yes → rewrite the hook.\n` +
      `□ Does the CTA connect to ${name}'s actual offering or expertise?\n`
    );
  }

  return (
    `\nBEFORE RETURNING, self-validate against this checklist:\n` +
    `□ Does the content mention ${name} by name at least twice?\n` +
    `□ Does each major section reference a specific pain point, product, or audience scenario from the company context?\n` +
    `□ Are there concrete examples (workflows, before/after, specific situations) instead of abstract claims?\n` +
    `□ Could a competitor publish this exact content unchanged? If yes → rewrite the generic sections.\n` +
    `□ Does the opening hook connect to ${name}'s unique perspective, not a generic industry observation?\n` +
    `□ Does the CTA tie to ${name}'s specific offering or expertise?\n` +
    `If any check fails, revise the content before returning.\n`
  );
}

// ── 6. Retry/Repair Context Anchor ──────────────────────────────────────────
// Appended to every retry/repair prompt to prevent context drift.

export function buildRepairContextAnchor(identity: CompanyIdentity): string {
  const name = identity.companyName || 'the company';
  const audience = identity.idealCustomerProfile || identity.targetAudience || 'the target audience';
  const pain = identity.painPoints?.[0] || identity.coreProblem || 'their core challenge';

  return (
    `\nCONTEXT ANCHOR (do not lose during repair):\n` +
    `- Company: ${name}\n` +
    `- Audience: ${audience}\n` +
    `- Core challenge: ${pain}\n` +
    (identity.uniqueValue ? `- Unique value: ${identity.uniqueValue}\n` : '') +
    `- Every repaired section must still reference this company context. Do not let structural compliance override company specificity.\n`
  );
}

// ── 7. Company Context Scoring ───────────────────────────────────────────────
// Post-generation quality check. Scores how well content references the company.

const GENERIC_PHRASES = [
  'leverage', 'optimize', 'streamline', 'cutting-edge', 'game-changing',
  'revolutionary', 'synergy', 'paradigm shift', 'unlock potential',
  'drive growth', 'best-in-class', 'next-level', 'take it to the next level',
  'in today\'s rapidly', 'in the ever-evolving', 'in today\'s fast-paced',
  'it\'s no secret that', 'as we all know', 'needless to say',
  // Expanded: synonyms and patterns models use to bypass the original list
  'empower', 'elevate', 'holistic', 'robust', 'scalable',
  'actionable insights', 'digital transformation', 'future-proof',
  'best practices', 'thought leadership', 'move the needle',
  'at the end of the day', 'low-hanging fruit', 'deep dive',
];

function hasScenarioSignals(contentText: string): boolean {
  return /(for example|for instance|imagine|consider|scenario|workflow|before|after|customer|buyer|team|operator|during|while using|when\s+\w+|if\s+\w+)/i.test(contentText);
}

export function scoreCompanyContext(
  contentText: string,
  identity: CompanyIdentity,
  options: { contentType?: string } = {},
): CompanyContextScoreResult {
  const text = contentText.toLowerCase();
  const issues: string[] = [];
  const validationMode = getContentValidationMode(options.contentType);
  const nameLower = identity.companyName?.toLowerCase() || '';
  const nameEscaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Split text into sentences for structural analysis
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

  // 1. Company name mentions (0–30 points)
  const companyMentions = nameLower
    ? (text.match(new RegExp(nameEscaped, 'g')) || []).length
    : 0;

  let nameScore = 0;
  if (!nameLower) {
    nameScore = 15; // No company name available — don't penalize
  } else if (companyMentions >= 3) {
    nameScore = 30;
  } else if (companyMentions >= 2) {
    nameScore = 22;
  } else if (companyMentions >= 1) {
    nameScore = 14;
  } else {
    nameScore = 0;
    issues.push(`Company name "${identity.companyName}" not mentioned in content`);
  }

  // Structural penalty: single mention only → subtract 8
  if (nameLower && companyMentions === 1) {
    nameScore = Math.max(0, nameScore - 8);
    issues.push('Company name appears only once — likely name-dropping, not integration');
  }

  // Structural penalty: all mentions in first 20% → subtract 6
  if (nameLower && companyMentions >= 1) {
    const firstFifth = text.slice(0, Math.floor(text.length * 0.2));
    const mentionsInIntro = (firstFifth.match(new RegExp(nameEscaped, 'g')) || []).length;
    if (mentionsInIntro === companyMentions) {
      nameScore = Math.max(0, nameScore - 6);
      issues.push('All company name mentions are in the intro only — body is generic');
    }
  }

  // 2. Pain point coverage (0–30 points)
  let painPointHits = 0;
  if (identity.painPoints?.length) {
    for (const pain of identity.painPoints.slice(0, 5)) {
      const keywords = pain.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const hits = keywords.filter(kw => text.includes(kw)).length;
      if (hits >= Math.ceil(keywords.length * 0.3)) painPointHits++;
    }
  }

  let painScore = 0;
  if (!identity.painPoints?.length) {
    painScore = 15; // No pain points defined — don't penalize
  } else if (painPointHits >= 3) {
    painScore = 30;
  } else if (painPointHits >= 2) {
    painScore = 22;
  } else if (painPointHits >= 1) {
    painScore = 15;
  } else {
    painScore = 0;
    issues.push('No pain points from company profile referenced in content');
  }

  // 3. ICP/audience references (0–20 points)
  let icpReferences = 0;
  const icpText = (identity.idealCustomerProfile || identity.targetAudience || '').toLowerCase();
  if (icpText) {
    const icpKeywords = icpText.split(/\s+/).filter(w => w.length > 4);
    icpReferences = icpKeywords.filter(kw => text.includes(kw)).length;
  }

  let icpScore = 0;
  if (!icpText) {
    icpScore = 10; // No ICP defined — don't penalize
  } else if (icpReferences >= 3) {
    icpScore = 20;
  } else if (icpReferences >= 1) {
    icpScore = 12;
  } else {
    icpScore = 0;
    issues.push('ICP/target audience not referenced in content');
  }

  // 4. Generic phrase penalty (0–20 points, inverse)
  const genericPhraseCount = GENERIC_PHRASES.reduce(
    (count, phrase) => count + (text.includes(phrase) ? 1 : 0),
    0,
  );

  let genericScore = 20;
  if (genericPhraseCount >= 5) {
    genericScore = 0;
    issues.push(`${genericPhraseCount} generic/buzzword phrases detected`);
  } else if (genericPhraseCount >= 3) {
    genericScore = 8;
    issues.push(`${genericPhraseCount} generic/buzzword phrases detected`);
  } else if (genericPhraseCount >= 1) {
    genericScore = 14;
  }

  // 5. Sentence-level co-occurrence check (bonus/penalty)
  // At least ONE sentence must contain the company name PLUS a pain point, product, or ICP keyword
  let coOccurrenceBonus = 0;
  if (nameLower && sentences.length > 0) {
    const contextKeywords: string[] = [];
    if (identity.painPoints?.length) {
      for (const pain of identity.painPoints.slice(0, 3)) {
        contextKeywords.push(...pain.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      }
    }
    if (identity.productsServices) {
      contextKeywords.push(...identity.productsServices.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    }
    if (icpText) {
      contextKeywords.push(...icpText.split(/\s+/).filter(w => w.length > 4));
    }

    const hasCoOccurrence = sentences.some(sentence =>
      sentence.includes(nameLower) &&
      contextKeywords.some(kw => sentence.includes(kw))
    );

    if (hasCoOccurrence) {
      coOccurrenceBonus = 5; // Reward: company name + context in same sentence
    } else if (companyMentions > 0) {
      coOccurrenceBonus = -10; // Penalty: name-dropping without context integration
      issues.push('Company name never appears in the same sentence as a pain point, product, or ICP reference');
    }
  }

  const scenarioPresent = hasScenarioSignals(contentText);
  if ((validationMode === 'long_form' || validationMode === 'mid_form') && !scenarioPresent) {
    issues.push('No concrete scenario, workflow, or example detected');
  }

  const variationValidation = validateContentVariation(contentText, { contentType: options.contentType });
  const perspectiveValidation = validateStrategicPerspective(contentText, {
    strategyProfile: identity.strategyProfile,
    uniqueValue: identity.uniqueValue,
    competitiveAdvantages: identity.competitiveAdvantages,
    industry: identity.industry,
    targetAudience: identity.targetAudience,
    idealCustomerProfile: identity.idealCustomerProfile,
    coreProblem: identity.coreProblem,
    painPoints: identity.painPoints,
    productsServices: identity.productsServices,
    authorityDomains: identity.authorityDomains,
  });
  let validationPenalty = 0;
  if (variationValidation.duplicateContentDetected) {
    validationPenalty += 20;
    issues.push(
      `Duplicate sections detected (${variationValidation.duplicateSectionPairs.length} pair(s), max similarity ${(variationValidation.maxSectionSimilarity * 100).toFixed(0)}%)`,
    );
  }
  if (variationValidation.lowVariationDetected) {
    validationPenalty += 15;
    issues.push(`${variationValidation.lowVariationSections.length} section(s) add little or no new information`);
  }
  if ((validationMode === 'long_form' || validationMode === 'mid_form') && !scenarioPresent) {
    validationPenalty += 10;
  }
  if (perspectiveValidation.perspectiveMismatch) {
    validationPenalty += 15;
    issues.push(...perspectiveValidation.issues);
  }

  const score = Math.max(
    0,
    Math.min(100, nameScore + painScore + icpScore + genericScore + coOccurrenceBonus - validationPenalty),
  );

  return {
    score,
    companyMentions,
    painPointHits,
    icpReferences,
    genericPhraseCount,
    duplicateContentDetected: variationValidation.duplicateContentDetected,
    lowVariationDetected: variationValidation.lowVariationDetected,
    scenarioPresent,
    perspectiveMismatch: perspectiveValidation.perspectiveMismatch,
    issues,
  };
}

// ── 7a. Blocking Helpers (Validation Enforcement) ───────────────────────────
// Convert scoring into hard gates. Callers either retry on failure or abort.

/**
 * Fallback threshold for scoreCompanyContext (0–100).
 * Prefer getDynamicContextThreshold(contentType, wordCount) at new call sites
 * — this constant is kept only for callers that cannot supply a content type.
 */
export const DEFAULT_CONTEXT_SCORE_THRESHOLD = 60;

/**
 * Dynamic, content-type- and length-aware threshold for scoreCompanyContext.
 * Banding:
 *   - Long-form (>= 1500 words OR contentType in {blog, article, guide, whitepaper}): 65–70
 *   - Mid-form  (800–1499 words OR contentType in {newsletter, story, case-study}):  60–65
 *   - Short-form (<800 words OR contentType in {post, thread, carousel, ...}):       55–60
 *
 * The word count takes precedence when provided — a 2000-word newsletter is
 * held to long-form standards even though its type is mid-form.
 */
export function getDynamicContextThreshold(
  contentType: string,
  wordCount?: number,
): number {
  const t = String(contentType || '').trim().toLowerCase();
  const isLongType = ['blog', 'article', 'guide', 'whitepaper'].includes(t);
  const isMidType  = ['newsletter', 'story', 'case_study', 'case-study'].includes(t);

  if (wordCount != null && Number.isFinite(wordCount)) {
    if (wordCount >= 1500) return isLongType ? 68 : 65;
    if (wordCount >= 800)  return isLongType ? 63 : isMidType ? 62 : 60;
    // < 800 words falls through to type-based
  }
  if (isLongType) return 62;
  if (isMidType)  return 58;
  return 55;
}

/**
 * Retry cap applied to the company-context retry loop. Hard ceiling on
 * generation calls per request to bound latency and cost.
 */
export const MAX_CONTEXT_RETRIES = 2;

/**
 * Minimum score improvement between consecutive retry attempts. If a retry
 * lifts the score by fewer than this many points, the loop exits early — the
 * model has plateaued and further retries won't help.
 */
export const MIN_RETRY_IMPROVEMENT_POINTS = 5;

// ── 7a.i Section Splitting ──────────────────────────────────────────────────
// Shared section parser used by long-form and template validation paths.
// Goal: one consistent, testable segmentation that under-segments on purpose.

const SECTION_MIN_WORDS = 40;

function countWordsInText(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isHeadingOnly(text: string): boolean {
  // A chunk that has < 6 words and no sentence-ending punctuation is treated
  // as a heading/label, not a section with substance.
  const words = countWordsInText(text);
  if (words < 6) return true;
  if (!/[.!?]/.test(text)) return true;
  return false;
}

/**
 * Normalize content into sections for per-section validation.
 *
 * Inputs:
 *   - string + content type → HTML (long-form) or plain template text
 *   - string[]              → pre-split sections (array input)
 *
 * Algorithm for HTML/long-form string input:
 *   1. Primary: split on <h2> boundaries, keep content after each.
 *   2. Fallback: if fewer than 3 usable H2 chunks, group paragraphs into
 *      chunks of ~150–300 words (2-paragraph groups) so we don't end up
 *      with one giant section or dozens of tiny ones.
 *
 * Filters:
 *   - Drop sections < 40 words.
 *   - Drop chunks that look like heading-only markers.
 */
export function splitIntoSections(
  content: string | string[],
  contentType: string = 'blog',
): string[] {
  // Array input: caller already segmented (e.g. template paragraph blocks).
  if (Array.isArray(content)) {
    return content
      .map((s) => stripHtmlTags(String(s || '')))
      .filter((s) => countWordsInText(s) >= SECTION_MIN_WORDS)
      .filter((s) => !isHeadingOnly(s));
  }

  const html = String(content || '');
  if (!html.trim()) return [];

  // Primary split: on <h2> boundaries.
  const h2Chunks = html.split(/<h2[^>]*>/i).slice(1); // drop pre-H2 preamble

  let chunks: string[];
  if (h2Chunks.length >= 3) {
    chunks = h2Chunks;
  } else {
    // Fallback: paragraph groups. Group 2 paragraphs per section to land
    // roughly in the 150–300 word range for typical long-form prose.
    const paragraphs = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    if (paragraphs.length === 0) {
      // Nothing structured — treat the whole thing as one chunk.
      chunks = [html];
    } else {
      const groupSize = 2;
      chunks = [];
      for (let i = 0; i < paragraphs.length; i += groupSize) {
        chunks.push(paragraphs.slice(i, i + groupSize).join(' '));
      }
    }
  }

  const normalized = chunks
    .map(stripHtmlTags)
    .filter((s) => countWordsInText(s) >= SECTION_MIN_WORDS)
    .filter((s) => !isHeadingOnly(s));

  return normalized;
}

/**
 * Error thrown when content fails company-context validation after retries.
 * Callers (API routes) can distinguish this from generic errors to return
 * a 422 "content failed quality gate" response instead of 500.
 */
export class CompanyContextEnforcementError extends Error {
  constructor(
    public readonly score: number,
    public readonly threshold: number,
    public readonly issues: string[],
  ) {
    super(`Content failed company context validation (score ${score}/100, threshold ${threshold}). Issues: ${issues.slice(0, 3).join('; ')}`);
    this.name = 'CompanyContextEnforcementError';
  }
}

/**
 * C1 blocking gate. Call at the end of a generation pipeline after all
 * retries have been exhausted. Throws CompanyContextEnforcementError if
 * the final score is below threshold. Callers catch and return 422.
 */
export function assertCompanyContextAcceptable(
  score: CompanyContextScoreResult,
  threshold: number = DEFAULT_CONTEXT_SCORE_THRESHOLD,
): void {
  if (score.score < threshold) {
    throw new CompanyContextEnforcementError(score.score, threshold, score.issues);
  }
}

// ── C5. Section-Level Company Context Validator ─────────────────────────────
// Lightweight per-section check: each section must reference at least one of
// the company name, product/service, ICP, or a pain point. If >20% of
// sections fail, the caller should retry.

export interface SectionCompanyContextResult {
  totalSections: number;
  failingSections: number;
  failingRatio: number;
  failingIndices: number[];
  shouldRetry: boolean;
}

export function validateSectionCompanyContext(
  sections: string[],
  identity: CompanyIdentity,
  options: { maxFailingRatio?: number } = {},
): SectionCompanyContextResult {
  const maxFailingRatio = options.maxFailingRatio ?? 0.2;
  const name = (identity.companyName || '').toLowerCase();
  const productTokens = (identity.productsServices || '')
    .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const icpTokens = ((identity.idealCustomerProfile || '') + ' ' + (identity.targetAudience || ''))
    .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const painTokens: string[] = [];
  for (const p of identity.painPoints?.slice(0, 5) || []) {
    painTokens.push(...p.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  }

  const failingIndices: number[] = [];
  sections.forEach((raw, idx) => {
    const text = (raw || '').toLowerCase();
    if (text.length < 20) return; // skip empty/placeholder sections
    const hasName = name && text.includes(name);
    const hasProduct = productTokens.some((t) => text.includes(t));
    const hasIcp = icpTokens.some((t) => text.includes(t));
    const hasPain = painTokens.some((t) => text.includes(t));
    if (!hasName && !hasProduct && !hasIcp && !hasPain) {
      failingIndices.push(idx);
    }
  });

  const totalSections = sections.filter((s) => (s || '').trim().length >= 20).length;
  const failingSections = failingIndices.length;
  const failingRatio = totalSections > 0 ? failingSections / totalSections : 0;
  return {
    totalSections,
    failingSections,
    failingRatio,
    failingIndices,
    shouldRetry: failingRatio > maxFailingRatio,
  };
}

// ── C6. Section-Level Strategy Presence Validator ───────────────────────────
// Each major section should contain at least one marker of contrarian insight,
// company POV, or strategic angle. If any major section misses all three, the
// caller should retry.

const CONTRARIAN_MARKERS = [
  'however', 'but ', 'unlike', 'contrary', 'instead', 'despite',
  'most companies', 'most teams', 'conventional wisdom', 'common mistake',
  'the reality is', 'in practice', 'what actually', 'the truth is',
  'not just', 'rather than',
];
const POV_MARKERS = [
  'we believe', 'our view', 'our approach', 'our perspective', 'we\'ve found',
  'we see', 'we think', 'our experience',
];
const STRATEGIC_MARKERS = [
  'strategy', 'strategic', 'decision', 'leverage', 'competitive advantage',
  'trade-off', 'tradeoff', 'positioning', 'operating model', 'outcome',
  'lever', 'mechanism', 'second-order',
];

export interface StrategyPresenceResult {
  totalSections: number;
  failingSections: number;
  failingIndices: number[];
  shouldRetry: boolean;
}

export function validateStrategyPresence(
  sections: string[],
  options: { maxFailingRatio?: number } = {},
): StrategyPresenceResult {
  const maxFailingRatio = options.maxFailingRatio ?? 0.2;
  const failingIndices: number[] = [];
  sections.forEach((raw, idx) => {
    const text = (raw || '').toLowerCase();
    if (text.length < 80) return; // skip tiny sections (intros, CTAs)
    const hasContrarian = CONTRARIAN_MARKERS.some((m) => text.includes(m));
    const hasPov = POV_MARKERS.some((m) => text.includes(m));
    const hasStrategic = STRATEGIC_MARKERS.some((m) => text.includes(m));
    if (!hasContrarian && !hasPov && !hasStrategic) {
      failingIndices.push(idx);
    }
  });
  const totalSections = sections.filter((s) => (s || '').trim().length >= 80).length;
  const failingSections = failingIndices.length;
  const failingRatio = totalSections > 0 ? failingSections / totalSections : 0;
  return {
    totalSections,
    failingSections,
    failingIndices,
    shouldRetry: failingRatio > maxFailingRatio,
  };
}

// ── 7b. Diagnostic Retry Message ────────────────────────────────────────────
// Explicit, model-facing failure reasons for retry prompts. Appends to any
// existing retry message so the model knows WHICH enforcement rule failed —
// not just "the draft is too short / too thin".

export function buildDiagnosticRetryReasons(
  score: CompanyContextScoreResult,
  identity: CompanyIdentity,
): string {
  const name = identity.companyName || 'the company';
  const reasons: string[] = [];

  // Company-context failures
  if (score.companyMentions === 0 && identity.companyName) {
    reasons.push(`- Sections lack company-specific context: ${name} is never named in the body.`);
  } else if (score.companyMentions === 1 && identity.companyName) {
    reasons.push(`- Company name appears only once — ${name} is name-dropped, not integrated.`);
  }
  if (score.painPointHits === 0 && identity.painPoints?.length) {
    reasons.push(`- Content is generic: none of ${name}'s known pain points are referenced.`);
  }
  if (score.icpReferences === 0 && (identity.idealCustomerProfile || identity.targetAudience)) {
    reasons.push(`- Audience detail missing: the draft does not reference ${name}'s ICP or target audience.`);
  }

  // Generic-language failures
  if (score.genericPhraseCount >= 3) {
    reasons.push(`- Content is generic or repetitive: ${score.genericPhraseCount} banned buzzwords/filler phrases detected.`);
  }
  if (score.duplicateContentDetected) {
    reasons.push('- Sections are repetitive: duplicate or near-duplicate sections detected.');
  }
  if (score.lowVariationDetected) {
    reasons.push('- Some sections add no new information over earlier sections.');
  }

  // Strategy-perspective failures
  if (score.perspectiveMismatch) {
    reasons.push('- Strategy perspective is missing: the draft reads as generic industry commentary, not this company\'s worldview.');
  }

  // Scenario / concreteness
  if (!score.scenarioPresent) {
    reasons.push('- Content lacks a concrete scenario, workflow, or example — only abstract claims.');
  }

  if (reasons.length === 0) return '';

  return (
    `\nThe draft failed company-context enforcement because:\n${reasons.join('\n')}\n\n` +
    `Rewrite so EVERY major section references ${name}'s specific domain, pain points, audience, and strategic perspective. ` +
    `Generic industry advice is rejected.`
  );
}

// ── 8. Angle Generation Enforcement ──────────────────────────────────────────
// Strict angle generation prompt that forces company-specific angles.

export function buildEnforcedAnglesSystemPrompt(identity: CompanyIdentity): string {
  const name = identity.companyName || 'the company';
  const icp = identity.idealCustomerProfile || identity.targetAudience || 'the target audience';

  return (
    `You are generating editorial angles for ${name}.\n\n` +
    `Each angle MUST be specific to ${name}'s domain. Generic angles that could apply to any company are rejected.\n\n` +
    `ANGLE REQUIREMENTS:\n` +
    `1. Each angle title must reference ${name}'s specific industry, audience, or problem space.\n` +
    `2. Each angle_summary must describe a situation ${icp} actually faces.\n` +
    `3. Each hook must open with a tension or insight specific to ${name}'s domain — not a generic observation.\n` +
    `4. At least one angle must challenge conventional thinking in ${name}'s industry.\n` +
    `5. No angle may use these patterns: "The Ultimate Guide to...", "X Things You Need to Know About...", "Why X Matters".\n\n` +
    `Return JSON: { "angles": [{ "type": "analytical"|"contrarian"|"strategic", "label": string, "title": string, "angle_summary": string, "hook": string }] }\n` +
    `Return exactly 3 angles.`
  );
}

export function buildEnforcedAnglesUserPrompt(
  topic: string,
  identity: CompanyIdentity,
  intent?: string,
): string {
  const lines: string[] = [
    `TOPIC: ${topic}`,
    `CURRENT YEAR: ${new Date().getFullYear()}`,
  ];

  if (intent) lines.push(`INTENT: ${intent}`);

  const contextBlock = buildCompanyContextBlock(identity);
  if (contextBlock) {
    lines.push(`\nCOMPANY CONTEXT:\n${contextBlock}`);
  }

  lines.push(
    `\nGenerate 3 angles that are unmistakably from ${identity.companyName || 'this company'}'s perspective.`,
    `Each angle must address a specific challenge ${identity.idealCustomerProfile || identity.targetAudience || 'the audience'} faces.`,
  );

  return lines.join('\n');
}
