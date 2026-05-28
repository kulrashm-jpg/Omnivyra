/**
 * Phase 2 — Section continuity governor.
 *
 * Given a SectionGenerationContract and the section's generated text (HTML
 * or plain), compute seven preservation signals + three composite scores and
 * surface targeted detections. Deterministic; no LLM.
 *
 * Signals (0–100 each):
 *   strategicSequencing    — does the section advance the staged arc (intro→framework→apply→prove→insight)?
 *   operationalSpecificity — does it surface concrete steps / decisions / named entities?
 *   editorialIntent        — does the prose echo the editorial angle?
 *   terminologyIntegrity   — are domain + strategic terms present?
 *   capabilityContinuity   — is the primary capability named and used in the section's reasoning?
 *   icpContinuity          — does the section reference the ICP pain in concrete terms?
 *   narrativeContinuity    — does the tone match the strategic narrative (assertive/instructional/comparative)?
 *
 * Composite scores:
 *   sectionContinuityScore             — weighted blend
 *   sectionStrategicIntegrityScore     — sequencing/editorial/narrative
 *   sectionOperationalIntegrityScore   — operational + capability + ICP
 */

import type {
  SectionContinuityResult,
  SectionContinuityDetectionType,
  SectionGenerationContract,
} from './longFormRecommendationTypes';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function tokenOverlapRatio(source: string, target: string): number {
  if (!source.trim()) return 1;
  const a = new Set(tokens(source));
  if (a.size === 0) return 1;
  const t = new Set(tokens(target));
  let hits = 0;
  a.forEach((tok) => { if (t.has(tok)) hits += 1; });
  return hits / a.size;
}

function pct(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

// ────────────────────────────────────────────────────────────────────────────
// Per-signal scoring
// ────────────────────────────────────────────────────────────────────────────

function scoreStrategicSequencing(contract: SectionGenerationContract, text: string): number {
  const lower = text.toLowerCase();
  let score = 30;
  // Section should advance the role it was assigned.
  if (contract.frameworkRole === 'introduce' && contract.frameworkName) {
    if (lower.includes(contract.frameworkName.toLowerCase())) score += 30;
    if (contract.frameworkComponents.some((c) => lower.includes(c.toLowerCase()))) score += 20;
  } else if (contract.frameworkRole === 'apply') {
    if (/\b(step|stage|phase|sequence|first|then|next|finally|before|after)\b/.test(lower)) score += 25;
    if (contract.frameworkComponents.some((c) => lower.includes(c.toLowerCase()))) score += 15;
  }
  // Direct-answer / opinionated requirements.
  if (contract.requiresDirectAnswer && /\b(direct answer|in short|the short answer|what this means)\b/.test(lower)) {
    score += 15;
  } else if (contract.requiresDirectAnswer) {
    score -= 5;
  }
  if (contract.requiresOpinionatedInsight && /\b(most teams|common assumption|counterintuitive|non-obvious|instead of|the mistake|what most teams miss)\b/.test(lower)) {
    score += 15;
  } else if (contract.requiresOpinionatedInsight) {
    score -= 5;
  }
  // Reasonable section length suggests progression.
  const wordCount = stripHtml(text).split(/\s+/).filter(Boolean).length;
  if (wordCount >= contract.wordTarget * 0.5) score += 10;
  if (wordCount >= contract.wordTarget * 0.85 && wordCount <= contract.wordTarget * 1.5) score += 10;
  return pct(score / 100);
}

function scoreOperationalSpecificity(contract: SectionGenerationContract, text: string): number {
  const lower = text.toLowerCase();
  let score = 25;
  // Named operational tokens.
  const operationalTokens = ['step', 'decision', 'sequence', 'checkpoint', 'workflow', 'pipeline',
    'measure', 'metric', 'observable', 'audit', 'trace', 'incident'];
  const opHits = operationalTokens.filter((t) => lower.includes(t)).length;
  score += Math.min(25, opHits * 5);
  // Numbered or lettered structure.
  if (/<ol[\s>]/i.test(text) || /\b1\.\s|step\s*\d/i.test(text)) score += 15;
  // Specific examples / named scenarios.
  if (/<table[\s>]/i.test(text) || /\b(example|scenario|case)\b/.test(lower)) score += 10;
  // Target entities present.
  const entityHits = contract.targetEntities.filter((e) => lower.includes(e.toLowerCase())).length;
  score += Math.min(15, entityHits * 7);
  // Penalize HTML-stripped text shorter than half target.
  const wordCount = stripHtml(text).split(/\s+/).filter(Boolean).length;
  if (wordCount < contract.wordTarget * 0.5) score -= 15;
  return pct(score / 100);
}

function scoreEditorialIntent(contract: SectionGenerationContract, text: string): number {
  const target = stripHtml(text);
  const angleOverlap = tokenOverlapRatio(contract.editorialAngle, target);
  const goalOverlap = tokenOverlapRatio(contract.sectionGoal, target);
  return pct(Math.max(angleOverlap, goalOverlap * 0.85));
}

function scoreTerminologyIntegrity(contract: SectionGenerationContract, text: string): number {
  const all = [...contract.terminologyEmphasis.domainVocabulary, ...contract.terminologyEmphasis.strategicTerminology];
  if (all.length === 0) return 100;
  const lower = stripHtml(text).toLowerCase();
  let preserved = 0;
  for (const term of all) {
    if (term.trim().length === 0) { preserved += 1; continue; }
    if (lower.includes(term.toLowerCase())) preserved += 1;
  }
  return pct(preserved / all.length);
}

function scoreCapabilityContinuity(contract: SectionGenerationContract, text: string): number {
  const capability = contract.capabilityEmphasis.primaryCapability;
  if (capability.trim().length < 10) return 100;
  const lower = stripHtml(text).toLowerCase();
  // Tokens covering > 40% AND at least one capability noun-phrase appearing as a phrase.
  const tokenCoverage = tokenOverlapRatio(capability, text);
  // Substring presence of the most discriminative bigram from the capability text.
  const capTokens = tokens(capability);
  const bigrams: string[] = [];
  for (let i = 0; i < capTokens.length - 1; i += 1) bigrams.push(`${capTokens[i]} ${capTokens[i + 1]}`);
  const bigramPresent = bigrams.some((b) => lower.includes(b));
  const workflowPresent = contract.capabilityEmphasis.workflowCategory
    && lower.includes(contract.capabilityEmphasis.workflowCategory.toLowerCase());
  let score = tokenCoverage * 100 * 0.6;
  if (bigramPresent) score += 25;
  if (workflowPresent) score += 15;
  return pct(score / 100);
}

function scoreIcpContinuity(contract: SectionGenerationContract, text: string): number {
  const icp = contract.icpFraming.icpProblemMapping;
  if (icp.length < 15) return 100;
  const lower = stripHtml(text).toLowerCase();
  const icpTokenCoverage = tokenOverlapRatio(icp, text);
  // Concrete pain-point mentions.
  const painHits = contract.icpFraming.painPoints.filter((p) => p && lower.includes(p.toLowerCase().slice(0, 60))).length;
  const marketPresent = contract.icpFraming.market && lower.includes(contract.icpFraming.market.toLowerCase());
  let score = icpTokenCoverage * 100 * 0.55;
  if (marketPresent) score += 25;
  score += Math.min(20, painHits * 12);
  return pct(score / 100);
}

function scoreNarrativeContinuity(contract: SectionGenerationContract, text: string): number {
  const lower = stripHtml(text).toLowerCase();
  // Detect tone consistency with strategic narrative.
  const narrativeLower = contract.strategicNarrative.toLowerCase();
  const isAssertive = /(must|only|requires|never|always|critical)/.test(narrativeLower);
  const isComparative = /\b(vs\.?|versus|compared|instead of)\b/.test(narrativeLower);
  const isInstructional = /\b(how to|step|sequence|how-to)\b/.test(narrativeLower);
  // Match section tone to narrative tone.
  let score = 50;
  if (isAssertive && /(must|only|requires|never|always|critical)/.test(lower)) score += 25;
  if (isComparative && /\b(vs\.?|versus|compared|instead of)\b/.test(lower)) score += 25;
  if (isInstructional && /\b(step|stage|sequence|first|then|next)\b/.test(lower)) score += 25;
  // Bonus for non-zero overlap with strategic narrative.
  const overlap = tokenOverlapRatio(contract.strategicNarrative, text);
  score += Math.min(25, overlap * 100 * 0.5);
  return pct(score / 100);
}

// ────────────────────────────────────────────────────────────────────────────
// Detections
// ────────────────────────────────────────────────────────────────────────────

function detect(signals: SectionContinuityResult['signals'], contract: SectionGenerationContract, text: string): SectionContinuityResult['detections'] {
  const out: SectionContinuityResult['detections'] = [];
  const lower = stripHtml(text).toLowerCase();
  const push = (type: SectionContinuityDetectionType, detail: string, severity: 'low' | 'medium' | 'high') => {
    out.push({ type, detail, severity });
  };

  if (signals.editorialIntent < 35 && signals.operationalSpecificity < 45) {
    push('SECTION_GENERIC_COLLAPSE', `Editorial intent ${signals.editorialIntent} and operational specificity ${signals.operationalSpecificity} both low — section read as generic filler.`, 'high');
  }
  if (signals.operationalSpecificity < 50) {
    push('OPERATIONAL_FLATTENING', `Operational specificity ${signals.operationalSpecificity}% — section lacks concrete steps, examples, or named entities.`, signals.operationalSpecificity < 30 ? 'high' : 'medium');
  }
  // SEO overfitting: lots of generic discovery language, but low capability/narrative continuity.
  if (/\b(beginner guide|complete guide|step-by-step guide|how to monitor|best practices)\b/.test(lower)
    && (signals.capabilityContinuity < 50 || signals.narrativeContinuity < 50)) {
    push('SEO_OVERFITTING', 'Section uses SEO-discovery phrasing while capability/narrative continuity sit below 50.', 'medium');
  }
  if (signals.terminologyIntegrity < 50) {
    push('TERMINOLOGY_DRIFT', `Terminology integrity ${signals.terminologyIntegrity}% — domain/strategic terms missing from section text.`, signals.terminologyIntegrity < 30 ? 'high' : 'medium');
  }
  if (signals.icpContinuity < 45 && contract.icpFraming.icpProblemMapping.length >= 15) {
    push('ICP_EROSION_SECTION', `ICP continuity ${signals.icpContinuity}% — the section drifted away from the ICP pain mapping.`, signals.icpContinuity < 25 ? 'high' : 'medium');
  }
  if (signals.capabilityContinuity < 45 && contract.capabilityEmphasis.primaryCapability.length >= 10) {
    push('CAPABILITY_DISAPPEARANCE', `Capability continuity ${signals.capabilityContinuity}% — the recommendation's primary capability is not surfaced.`, signals.capabilityContinuity < 25 ? 'high' : 'medium');
  }
  if (signals.narrativeContinuity < 45) {
    push('NARRATIVE_SIMPLIFICATION', `Narrative continuity ${signals.narrativeContinuity}% — section tone drifted from the strategic narrative.`, signals.narrativeContinuity < 25 ? 'high' : 'medium');
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function governSectionContinuity(input: {
  contract: SectionGenerationContract;
  sectionText: string;
}): SectionContinuityResult {
  const { contract, sectionText } = input;
  const signals = {
    strategicSequencing: scoreStrategicSequencing(contract, sectionText),
    operationalSpecificity: scoreOperationalSpecificity(contract, sectionText),
    editorialIntent: scoreEditorialIntent(contract, sectionText),
    terminologyIntegrity: scoreTerminologyIntegrity(contract, sectionText),
    capabilityContinuity: scoreCapabilityContinuity(contract, sectionText),
    icpContinuity: scoreIcpContinuity(contract, sectionText),
    narrativeContinuity: scoreNarrativeContinuity(contract, sectionText),
  };

  const sectionContinuityScore = Math.round(
    signals.strategicSequencing * 0.14
    + signals.operationalSpecificity * 0.18
    + signals.editorialIntent * 0.14
    + signals.terminologyIntegrity * 0.12
    + signals.capabilityContinuity * 0.16
    + signals.icpContinuity * 0.14
    + signals.narrativeContinuity * 0.12,
  );
  const sectionStrategicIntegrityScore = Math.round(
    signals.strategicSequencing * 0.40 + signals.editorialIntent * 0.30 + signals.narrativeContinuity * 0.30,
  );
  const sectionOperationalIntegrityScore = Math.round(
    signals.operationalSpecificity * 0.45 + signals.capabilityContinuity * 0.30 + signals.icpContinuity * 0.25,
  );

  return {
    sectionContinuityScore,
    sectionStrategicIntegrityScore,
    sectionOperationalIntegrityScore,
    signals,
    detections: detect(signals, contract, sectionText),
  };
}
