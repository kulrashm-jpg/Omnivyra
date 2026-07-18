/** Part of companyContextBlock (Agent-B split — barrel keeps the original path). */
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
// Wave 1 item 6 — ONE canonical content-context resolver. The company/identity
// resolution + the canonical context block live there now; these thin bindings
// keep the SAME exported names/signatures/output for every existing importer.
import {
  extractCompanyIdentity as __extractCompanyIdentity,
  buildCompetitorIdentityContext as __buildCompetitorIdentityContext,
  buildUserGuidedIdentityContext as __buildUserGuidedIdentityContext,
  buildContextBlock as __buildContextBlock,
} from '../../backend/services/context/canonicalContentContextResolver';

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

// ── Extract CompanyIdentity + identity enrichment ────────────────────────────
// DELEGATED to the canonical resolver (Wave 1 item 6). Re-exported here with the
// SAME names/signatures so every existing importer (barrel + direct) is unchanged.
// Local bindings are also used by the enforcement builders below.

export const extractCompanyIdentity = __extractCompanyIdentity;
export const buildCompetitorIdentityContext = __buildCompetitorIdentityContext;
export const buildUserGuidedIdentityContext = __buildUserGuidedIdentityContext;

// ── 1. Canonical Company Context Block ───────────────────────────────────────
// Used in EVERY prompt (system or user) across all content types.
// DELEGATES to the canonical resolver's buildContextBlock — identical output.

export function buildCompanyContextBlock(identity: CompanyIdentity): string {
  return __buildContextBlock(identity);
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
    identity.brandVoice ? `VOICE: ${identity.brandVoice}` : null,
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
    (identity.brandVoice ? `YOUR BRAND VOICE: ${identity.brandVoice} — every sentence must sound like this.\n` : '') +
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

