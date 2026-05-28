/**
 * sectionCompanyAlignmentValidator.ts
 *
 * Phase 3.1 — Per-section company alignment governance.
 *
 * The planned-sectionwise engine already validates continuity, genericity,
 * and factual integrity per section, but it has NO check that the section
 * actually reads like it was written for THIS company:
 *
 *   - company positioning referenced?
 *   - ICP relevance present?
 *   - strategic POV surfaced?
 *   - differentiation visible?
 *   - product/context anchored?
 *   - generic educational drift?
 *   - tone neutralized into vanilla third-person?
 *
 * This validator gives the orchestrator a fourth gate that drives retries.
 * It is keyword-and-density based — no LLM calls, no embeddings — so it
 * runs cheaply in the section loop.
 */

import type { CompanyIdentity } from '../../../lib/content/companyContextBlock';
import type { SectionGenerationContract } from './longFormRecommendationTypes';

export type AlignmentVerdict = 'pass' | 'retry' | 'fail';

export interface SectionCompanyAlignmentResult {
  alignmentScore: number;            // 0-100 composite
  missingSignals: string[];          // which anchors never appeared
  genericityRisk: number;            // 0-100 (higher = more generic educational drift)
  differentiationStrength: number;   // 0-100
  strategicPresence: number;         // 0-100
  verdict: AlignmentVerdict;
  /**
   * Suggested SectionRecoveryAction string to drive the next attempt's
   * hint. The orchestrator already understands these action names.
   */
  suggestedRecoveryAction:
    | 'restore_icp_specificity'
    | 'restore_capability_emphasis'
    | 'restore_strategic_narrative'
    | 'regenerate_section'
    | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function lower(s: string | undefined | null): string {
  return (s ?? '').toLowerCase();
}

function countOccurrences(haystack: string, needles: string[]): number {
  let total = 0;
  const lc = haystack.toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    const phrase = n.toLowerCase().trim();
    if (phrase.length < 3) continue;
    // Word-boundary-ish: ensure we don't catch substrings of unrelated words.
    let from = 0;
    while (true) {
      const idx = lc.indexOf(phrase, from);
      if (idx === -1) break;
      total += 1;
      from = idx + phrase.length;
    }
  }
  return total;
}

function uniqueLowered(items: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (t.length >= 3) set.add(t.toLowerCase());
  }
  return Array.from(set);
}

// Pattern markers for "generic educational drift" — third-person abstract
// best-practice prose that could appear unchanged on any competitor's blog.
const GENERIC_DRIFT_MARKERS = [
  /\bin today'?s (rapidly|fast-paced|ever-evolving|modern)\b/i,
  /\borganizations of all sizes\b/i,
  /\bbusinesses today\b/i,
  /\bleverage (ai|technology|data|automation|machine learning)\b/i,
  /\bbest practices\b(?!\s+for\s+\w+)/i,
  /\bbest-in-class\b/i,
  /\bcutting[- ]edge\b/i,
  /\bnext[- ]level\b/i,
  /\bunlock(s|ing)? (the )?potential\b/i,
  /\bdrive(s|n)? (growth|results|innovation)\b/i,
  /\bone size fits all\b/i,
  /\bdigital transformation\b/i,
  /\bgame[- ]ch?anger\b/i,
  /\bmove the needle\b/i,
  /\blow[- ]hanging fruit\b/i,
];

// Pattern markers for "neutralized tone" — passive, hedge-everywhere prose
// with no voice or perspective.
const NEUTRALIZED_TONE_MARKERS = [
  /\bit (is|may be|might be) (important|critical|essential|advisable) to\b/i,
  /\bone (might|could|may) consider\b/i,
  /\bit can be argued\b/i,
  /\bgenerally speaking\b/i,
  /\bin many cases\b/i,
  /\bsome (organizations|companies|teams|businesses) (may|might|could)\b/i,
];

// Pattern markers for strategic POV — first-person company voice or
// contrarian framing.
const STRATEGIC_POV_MARKERS = [
  /\bour (approach|view|stance|position|experience|customers|users)\b/i,
  /\b(we|we'?ve|we'?re) (built|believe|found|see|observe|argue|reject|disagree)\b/i,
  /\bmost (teams|companies|organizations|operators) (assume|think|believe|miss)\b/i,
  /\bconventional wisdom\b/i,
  /\bcontrar(y|ian)\b/i,
  /\bnon[- ]obvious\b/i,
  /\bunlike (most|other|typical)\b/i,
  /\binstead of\b/i,
  /\bthe (real|actual|underlying) (problem|issue|driver|reason)\b/i,
  /\bwhat (most|teams|operators|companies) miss\b/i,
];

// ── Main validator ──────────────────────────────────────────────────────────

export interface ValidateSectionCompanyAlignmentInput {
  sectionText: string;
  contract: SectionGenerationContract;
  companyIdentity?: CompanyIdentity | null;
}

export function validateSectionCompanyAlignment(
  input: ValidateSectionCompanyAlignmentInput,
): SectionCompanyAlignmentResult {
  const plain = stripHtml(input.sectionText);
  const wordCount = Math.max(1, plain.split(/\s+/).length);
  const missingSignals: string[] = [];

  // ── (1) Company positioning referenced ──────────────────────────────────
  const positioningPhrases: string[] = [];
  if (input.companyIdentity?.companyName) positioningPhrases.push(input.companyIdentity.companyName);
  if (input.companyIdentity?.uniqueValue) {
    const tokens = input.companyIdentity.uniqueValue.split(/[,;.]/).map((t) => t.trim()).filter((t) => t.length >= 6);
    positioningPhrases.push(...tokens.slice(0, 3));
  }
  if (input.companyIdentity?.keyMessages) {
    const tokens = input.companyIdentity.keyMessages.split(/[,;.]/).map((t) => t.trim()).filter((t) => t.length >= 6);
    positioningPhrases.push(...tokens.slice(0, 3));
  }
  const positioningHits = countOccurrences(plain, positioningPhrases);
  if (positioningHits === 0 && positioningPhrases.length > 0) {
    missingSignals.push('company_positioning');
  }

  // ── (2) ICP relevance ─────────────────────────────────────────────────────
  const icpPhrases: string[] = [];
  if (input.companyIdentity?.idealCustomerProfile) icpPhrases.push(input.companyIdentity.idealCustomerProfile);
  if (input.companyIdentity?.targetAudience) icpPhrases.push(input.companyIdentity.targetAudience);
  icpPhrases.push(...(input.contract.icpFraming.icps ?? []));
  const icpHits = countOccurrences(plain, uniqueLowered(icpPhrases));
  if (icpHits === 0 && uniqueLowered(icpPhrases).length > 0) {
    missingSignals.push('icp_relevance');
  }

  // ── (3) Differentiation presence ────────────────────────────────────────
  const differentiatorPhrases = uniqueLowered([
    input.companyIdentity?.competitiveAdvantages ?? null,
    ...(input.contract.terminologyEmphasis?.strategicTerminology ?? []),
  ]);
  const differentiatorHits = countOccurrences(plain, differentiatorPhrases);
  if (differentiatorHits === 0 && differentiatorPhrases.length > 0) {
    missingSignals.push('differentiation');
  }

  // ── (4) Product / context relevance ─────────────────────────────────────
  const productPhrases = uniqueLowered([
    input.companyIdentity?.productsServices ?? null,
    input.contract.capabilityEmphasis?.primaryCapability ?? null,
    input.contract.capabilityEmphasis?.workflowCategory ?? null,
    ...(input.contract.terminologyEmphasis?.domainVocabulary ?? []),
  ]);
  const productHits = countOccurrences(plain, productPhrases);
  if (productHits === 0 && productPhrases.length > 0) {
    missingSignals.push('product_or_capability');
  }

  // ── (5) Strategic POV presence ──────────────────────────────────────────
  let strategicPovHits = 0;
  for (const marker of STRATEGIC_POV_MARKERS) {
    if (marker.test(plain)) strategicPovHits += 1;
  }
  if (strategicPovHits === 0) missingSignals.push('strategic_pov');

  // ── (6) Generic educational drift ───────────────────────────────────────
  let genericDriftHits = 0;
  for (const marker of GENERIC_DRIFT_MARKERS) {
    if (marker.test(plain)) genericDriftHits += 1;
  }

  // ── (7) Neutralized tone ────────────────────────────────────────────────
  let neutralizedHits = 0;
  for (const marker of NEUTRALIZED_TONE_MARKERS) {
    if (marker.test(plain)) neutralizedHits += 1;
  }

  // ── Composite scoring ───────────────────────────────────────────────────
  // Density factor — sections with very short text should not be unfairly
  // penalized for sparse hits. Normalize per 1000 words.
  const densityNorm = wordCount / 1000;

  const differentiationStrength = Math.min(100, Math.round(
    35 * Math.min(1, differentiatorHits / Math.max(1, Math.ceil(densityNorm))) +
    35 * Math.min(1, productHits / Math.max(1, Math.ceil(densityNorm * 2))) +
    30 * Math.min(1, positioningHits / Math.max(1, Math.ceil(densityNorm))),
  ));

  const strategicPresence = Math.min(100, Math.round(
    60 * Math.min(1, strategicPovHits / 2) +                // ≥ 2 POV markers = full credit
    40 * Math.min(1, Math.max(0, 1 - neutralizedHits / 3)), // 0 neutralized = 40, 3+ neutralized = 0
  ));

  const genericityRisk = Math.min(100, Math.round(
    35 * Math.min(1, genericDriftHits / Math.max(1, Math.ceil(densityNorm * 2))) +
    25 * Math.min(1, neutralizedHits / Math.max(1, Math.ceil(densityNorm * 2))) +
    20 * (missingSignals.includes('company_positioning') ? 1 : 0) +
    20 * (missingSignals.includes('strategic_pov') ? 1 : 0),
  ));

  const alignmentScore = Math.min(100, Math.round(
    // 30 pts: positioning + ICP coverage
    30 * Math.min(1, (positioningHits + icpHits) / Math.max(2, Math.ceil(densityNorm * 2))) +
    // 30 pts: differentiation + product
    30 * Math.min(1, (differentiatorHits + productHits) / Math.max(2, Math.ceil(densityNorm * 3))) +
    // 25 pts: strategic POV presence
    25 * Math.min(1, strategicPovHits / 2) +
    // 15 pts: low genericity (inverse)
    15 * Math.max(0, 1 - genericityRisk / 100),
  ));

  // ── Verdict + recovery action ──────────────────────────────────────────
  const ALIGNMENT_PASS_THRESHOLD = 60;
  const ALIGNMENT_FAIL_THRESHOLD = 30;
  const DIFFERENTIATION_FLOOR = 35;
  const STRATEGIC_FLOOR = 30;

  let verdict: AlignmentVerdict;
  if (alignmentScore >= ALIGNMENT_PASS_THRESHOLD
      && differentiationStrength >= DIFFERENTIATION_FLOOR
      && strategicPresence >= STRATEGIC_FLOOR) {
    verdict = 'pass';
  } else if (alignmentScore < ALIGNMENT_FAIL_THRESHOLD
             || (differentiationStrength < 20 && strategicPresence < 20)) {
    verdict = 'fail';
  } else {
    verdict = 'retry';
  }

  // Recovery action prioritization:
  //   - If ICP-relevance is missing → restore_icp_specificity
  //   - Else if differentiation/product is missing → restore_capability_emphasis
  //   - Else if strategic POV is missing or genericity is high → restore_strategic_narrative
  //   - Else (most signals missing) → regenerate_section
  let suggestedRecoveryAction: SectionCompanyAlignmentResult['suggestedRecoveryAction'] = null;
  if (verdict !== 'pass') {
    if (missingSignals.includes('icp_relevance')) {
      suggestedRecoveryAction = 'restore_icp_specificity';
    } else if (missingSignals.includes('differentiation') || missingSignals.includes('product_or_capability')) {
      suggestedRecoveryAction = 'restore_capability_emphasis';
    } else if (missingSignals.includes('strategic_pov') || genericityRisk >= 55) {
      suggestedRecoveryAction = 'restore_strategic_narrative';
    } else if (missingSignals.length >= 3) {
      suggestedRecoveryAction = 'regenerate_section';
    } else {
      suggestedRecoveryAction = 'restore_strategic_narrative';
    }
  }

  return {
    alignmentScore,
    missingSignals,
    genericityRisk,
    differentiationStrength,
    strategicPresence,
    verdict,
    suggestedRecoveryAction,
  };
}

/**
 * Map an alignment failure to a recovery target list the section generator
 * can consume. The orchestrator already passes recoveryTargets[] into the
 * section hint.
 */
export function buildAlignmentRecoveryTargets(
  result: SectionCompanyAlignmentResult,
  identity: CompanyIdentity | null | undefined,
): string[] {
  const targets: string[] = [];
  if (result.missingSignals.includes('icp_relevance')) {
    if (identity?.idealCustomerProfile) targets.push(`Reference the ICP explicitly: "${identity.idealCustomerProfile}"`);
    if (identity?.targetAudience) targets.push(`Anchor every example to: "${identity.targetAudience}"`);
    if (identity?.painPoints?.length) targets.push(`Surface this pain point: "${identity.painPoints[0]}"`);
  }
  if (result.missingSignals.includes('differentiation')) {
    if (identity?.competitiveAdvantages) targets.push(`Name a concrete differentiator: "${identity.competitiveAdvantages}"`);
  }
  if (result.missingSignals.includes('product_or_capability')) {
    if (identity?.productsServices) targets.push(`Connect to capability: "${identity.productsServices}"`);
  }
  if (result.missingSignals.includes('strategic_pov')) {
    targets.push('Speak in the company\'s voice — use "we" or "our approach" at least once; reject one common assumption.');
  }
  if (result.missingSignals.includes('company_positioning')) {
    if (identity?.companyName) targets.push(`Mention "${identity.companyName}" or its unique value at least once.`);
  }
  if (result.genericityRisk >= 55) {
    targets.push('Remove generic best-practice framing — every claim must reference the company\'s context.');
  }
  return targets;
}
