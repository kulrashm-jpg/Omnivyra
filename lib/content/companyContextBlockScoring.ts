/** Part of companyContextBlock (Agent-B split — barrel keeps the original path). */
import type { CompanyIdentity, CompanyContextScoreResult } from './companyContextBlockBuilders';
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

// ── 7. Company Context Scoring ───────────────────────────────────────────────
// Post-generation quality check. Scores how well content references the company.

export const GENERIC_PHRASES = [
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

export function hasScenarioSignals(contentText: string): boolean {
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

