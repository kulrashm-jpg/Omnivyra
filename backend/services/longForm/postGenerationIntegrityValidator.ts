/**
 * Phase 7 — Post-generation integrity validator.
 *
 * Runs on the ASSEMBLED article (concat of all section HTML/text) against
 * the upstream contracts. Ten dimensions; weighted blend; integrity band.
 *
 * Bands:
 *   < 35  → failed
 *   35–54 → weak
 *   55–74 → acceptable
 *   75–89 → strong
 *   ≥ 90  → exceptional
 */

import type {
  GenerationOrchestrationContract,
  IntegrityBand,
  LongFormRecommendation,
  PostGenerationIntegrityResult,
  SectionContinuityResult,
} from './longFormRecommendationTypes';

const WEIGHTS = {
  strategicContinuity: 0.12,
  operationalContinuity: 0.14,
  icpPreservation: 0.10,
  capabilityPreservation: 0.12,
  terminologyPreservation: 0.10,
  narrativeContinuity: 0.10,
  editorialSequencing: 0.10,
  genericityPressure: 0.08,    // inverted: lower pressure → higher dimension score
  sectionCoherence: 0.08,
  authorityPreservation: 0.06,
} as const;

const FLOORS = {
  strategicContinuity: 55,
  operationalContinuity: 55,
  icpPreservation: 50,
  capabilityPreservation: 50,
  terminologyPreservation: 50,
  narrativeContinuity: 50,
  editorialSequencing: 60,
  genericityPressure: 60,       // dimension is inverse — minimum required = 60
  sectionCoherence: 55,
  authorityPreservation: 50,
} as const;

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function bandFor(score: number): IntegrityBand {
  if (score < 35) return 'failed';
  if (score < 55) return 'weak';
  if (score < 75) return 'acceptable';
  if (score < 90) return 'strong';
  return 'exceptional';
}

function severityFor(score: number, floor: number): 'critical' | 'major' | 'minor' {
  if (score < floor - 25) return 'critical';
  if (score < floor - 10) return 'major';
  return 'minor';
}

// ────────────────────────────────────────────────────────────────────────────
// Per-dimension scoring
// ────────────────────────────────────────────────────────────────────────────

function scoreStrategicContinuity(sectionScores: SectionContinuityResult[]): number {
  return clamp100(average(sectionScores.map((s) => s.sectionStrategicIntegrityScore)));
}

function scoreOperationalContinuity(sectionScores: SectionContinuityResult[]): number {
  return clamp100(average(sectionScores.map((s) => s.sectionOperationalIntegrityScore)));
}

function scoreIcpPreservation(sectionScores: SectionContinuityResult[]): number {
  return clamp100(average(sectionScores.map((s) => s.signals.icpContinuity)));
}

function scoreCapabilityPreservation(sectionScores: SectionContinuityResult[]): number {
  return clamp100(average(sectionScores.map((s) => s.signals.capabilityContinuity)));
}

function scoreTerminologyPreservation(article: string, contract: GenerationOrchestrationContract): number {
  const all = [...contract.terminologyEmphasis.domainVocabulary, ...contract.terminologyEmphasis.strategicTerminology];
  if (all.length === 0) return 100;
  const lower = stripHtml(article).toLowerCase();
  let preserved = 0;
  for (const term of all) {
    if (term.trim().length === 0) { preserved += 1; continue; }
    if (lower.includes(term.toLowerCase())) preserved += 1;
  }
  return clamp100((preserved / all.length) * 100);
}

function scoreNarrativeContinuity(sectionScores: SectionContinuityResult[]): number {
  return clamp100(average(sectionScores.map((s) => s.signals.narrativeContinuity)));
}

function scoreEditorialSequencing(sectionScores: SectionContinuityResult[]): number {
  // Editorial sequencing combines per-section strategicSequencing AND the
  // pairwise variance penalty (sections shouldn't all collapse to one shape).
  const seqAvg = average(sectionScores.map((s) => s.signals.strategicSequencing));
  const variance = (() => {
    const vals = sectionScores.map((s) => s.signals.strategicSequencing);
    if (vals.length < 2) return 0;
    const mean = average(vals);
    return average(vals.map((v) => (v - mean) ** 2));
  })();
  // High variance is fine; very low variance means sections all collapsed identically.
  const variancePenalty = sectionScores.length >= 3 && variance < 25 ? 10 : 0;
  return clamp100(seqAvg - variancePenalty);
}

function scoreGenericityPressureInverted(sectionGenericityScores: number[]): number {
  // genericityPressure (0 perfect → 100 saturated). Invert: dimension score = 100 - avg pressure.
  if (sectionGenericityScores.length === 0) return 100;
  const avgPressure = average(sectionGenericityScores);
  return clamp100(100 - avgPressure);
}

function scoreSectionCoherence(sections: Array<{ titleTokens: Set<string>; bodyTokens: Set<string> }>): number {
  if (sections.length < 2) return 90;
  // Adjacency-pair Jaccard — each adjacent pair should share SOME but not too much vocabulary.
  let total = 0;
  let pairCount = 0;
  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = sections[i].bodyTokens;
    const b = sections[i + 1].bodyTokens;
    if (a.size === 0 || b.size === 0) continue;
    let inter = 0;
    a.forEach((t) => { if (b.has(t)) inter += 1; });
    const jacc = inter / (a.size + b.size - inter);
    // Reward 0.10–0.40 (some shared vocabulary), penalize > 0.70 (near-duplicate) or < 0.05 (disjoint).
    let pair = 60;
    if (jacc >= 0.10 && jacc <= 0.40) pair = 95;
    else if (jacc > 0.40 && jacc <= 0.55) pair = 75;
    else if (jacc > 0.55 && jacc <= 0.70) pair = 55;
    else if (jacc > 0.70) pair = 30;
    else pair = 50;
    total += pair;
    pairCount += 1;
  }
  return clamp100(pairCount === 0 ? 60 : total / pairCount);
}

function scoreAuthorityPreservation(article: string, recommendation: LongFormRecommendation): number {
  const lower = stripHtml(article).toLowerCase();
  let score = 30;
  // Mentions of competitive advantage / differentiation surfaces.
  const angle = recommendation.editorialAngle.toLowerCase();
  if (angle && lower.includes(angle.slice(0, 40))) score += 20;
  // Opinionated language.
  if (/\b(most teams|common assumption|counterintuitive|the mistake|what most teams miss|instead of)\b/.test(lower)) score += 20;
  // Framework presence.
  if (/\b(framework|playbook|operating model|approach|methodology)\b/.test(lower)) score += 15;
  // No hedge-heavy language.
  const hedgeCount = (lower.match(/\b(might|could|may|perhaps|possibly|sometimes)\b/g) ?? []).length;
  if (hedgeCount >= 6) score -= 20;
  // Recommendation's strategicNarrative tokens.
  const narrTokens = recommendation.strategicNarrative.toLowerCase().split(/\s+/).filter((t) => t.length > 4);
  const narrHits = narrTokens.filter((t) => lower.includes(t)).length;
  score += Math.min(20, narrHits * 2);
  return clamp100(score);
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface ValidatePostGenerationInput {
  generationContract: GenerationOrchestrationContract;
  recommendation: LongFormRecommendation;
  assembledArticle: string;
  sectionContinuityResults: SectionContinuityResult[];
  sectionGenericityScores: number[];
  /** Token sets per section for adjacency coherence — optional, computed if absent. */
  sectionTokenSets?: Array<{ titleTokens: Set<string>; bodyTokens: Set<string> }>;
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function tokensForCoherence(article: string): Array<{ titleTokens: Set<string>; bodyTokens: Set<string> }> {
  const parts = article.split(/<h2[^>]*>|^##\s+/i).filter((p) => p.trim().length > 0);
  return parts.map((p) => {
    const headerSplit = p.split(/<\/h2>|\n/);
    const title = headerSplit[0] ?? '';
    const body = headerSplit.slice(1).join(' ');
    return { titleTokens: tokenize(stripHtml(title)), bodyTokens: tokenize(stripHtml(body)) };
  });
}

export function validatePostGenerationIntegrity(input: ValidatePostGenerationInput): PostGenerationIntegrityResult {
  const sectionTokenSets = input.sectionTokenSets ?? tokensForCoherence(input.assembledArticle);

  const dimensionScores: PostGenerationIntegrityResult['dimensionScores'] = {
    strategicContinuity: scoreStrategicContinuity(input.sectionContinuityResults),
    operationalContinuity: scoreOperationalContinuity(input.sectionContinuityResults),
    icpPreservation: scoreIcpPreservation(input.sectionContinuityResults),
    capabilityPreservation: scoreCapabilityPreservation(input.sectionContinuityResults),
    terminologyPreservation: scoreTerminologyPreservation(input.assembledArticle, input.generationContract),
    narrativeContinuity: scoreNarrativeContinuity(input.sectionContinuityResults),
    editorialSequencing: scoreEditorialSequencing(input.sectionContinuityResults),
    genericityPressure: scoreGenericityPressureInverted(input.sectionGenericityScores),
    sectionCoherence: scoreSectionCoherence(sectionTokenSets),
    authorityPreservation: scoreAuthorityPreservation(input.assembledArticle, input.recommendation),
  };

  let weighted = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    weighted += dimensionScores[k] * WEIGHTS[k];
  });
  const postGenerationIntegrityScore = clamp100(weighted);

  const integrityFailures: PostGenerationIntegrityResult['integrityFailures'] = [];
  (Object.keys(FLOORS) as Array<keyof typeof FLOORS>).forEach((k) => {
    if (dimensionScores[k] < FLOORS[k]) {
      integrityFailures.push({
        dimension: k,
        score: dimensionScores[k],
        minimumRequired: FLOORS[k],
        severity: severityFor(dimensionScores[k], FLOORS[k]),
      });
    }
  });

  const integrityWarnings: string[] = [];
  if (dimensionScores.genericityPressure < 75 && dimensionScores.genericityPressure >= FLOORS.genericityPressure) {
    integrityWarnings.push(`Genericity-pressure margin is thin (${dimensionScores.genericityPressure}/${FLOORS.genericityPressure}). Spot-check final article.`);
  }
  if (dimensionScores.sectionCoherence < 70) {
    integrityWarnings.push(`Section coherence ${dimensionScores.sectionCoherence}/100 — adjacent sections may share too little or too much vocabulary.`);
  }
  if (integrityFailures.length === 0 && postGenerationIntegrityScore < 80) {
    integrityWarnings.push('Integrity passes floors but overall score is below 80 — consider one more pass.');
  }

  return {
    postGenerationIntegrityScore,
    integrityBand: bandFor(postGenerationIntegrityScore),
    dimensionScores,
    integrityFailures,
    integrityWarnings,
  };
}

export { FLOORS as POST_GENERATION_FLOORS };
