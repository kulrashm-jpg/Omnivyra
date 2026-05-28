/**
 * Phase 1 — Claim extraction engine.
 *
 * Splits a generated section into sentences and classifies each into one of
 * 10 claim categories. Each claim becomes the unit of evidence governance
 * (Phase 2), hallucination suppression (Phase 3), and recovery (Phase 10).
 *
 * Deterministic; regex-driven; no LLM.
 */

import type {
  ClaimType,
  EvidenceRequirementLevel,
  ExtractedClaim,
} from './longFormRecommendationTypes';

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitSentences(text: string): Array<{ text: string; index: number }> {
  // Conservative splitter — splits on .!? followed by whitespace + capital letter.
  // Keeps short fragments as their own sentences.
  const out: Array<{ text: string; index: number }> = [];
  const re = /[^.!?]+[.!?]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const piece = m[0].trim();
    if (piece.length >= 8) out.push({ text: piece, index: m.index });
  }
  // Tail (no terminator).
  const lastEnd = out.length === 0 ? 0 : out[out.length - 1].index + out[out.length - 1].text.length;
  const tail = text.slice(lastEnd).trim();
  if (tail.length >= 8) out.push({ text: tail, index: lastEnd });
  return out;
}

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// ────────────────────────────────────────────────────────────────────────────
// Pattern detectors
// ────────────────────────────────────────────────────────────────────────────

const STATISTIC_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%/,
  /\b\d+x\b/i,
  /\$\d+(?:[.,]\d+)?(?:[bmk]| billion| million| thousand)?/i,
  /\b\d+\s+(?:percent|times|x faster|x more|x less|x higher|x lower)\b/i,
  /\b(?:up to|over|more than|fewer than|nearly|approximately)\s+\d+/i,
];

const BENCHMARK_PATTERNS = [
  /\b(compared to|versus|vs\.?|outperforms|beats|better than|faster than|cheaper than|more (?:efficient|effective|reliable) than)\b/i,
  /\b(market leader|industry leader|the (?:best|fastest|cheapest))\b/i,
];

const OPERATIONAL_VERBS = new Set([
  'instrument','deploy','route','sequence','enforce','orchestrate','validate','observe',
  'monitor','detect','escalate','audit','measure','batch','throttle','prioritize','triage',
  'reconcile','dispatch','classify','remediate','sanitize','redact','encrypt',
]);

function hasOperationalVerb(text: string): boolean {
  const lower = text.toLowerCase();
  for (const v of OPERATIONAL_VERBS) {
    if (new RegExp(`\\b${v}(?:s|ed|ing)?\\b`, 'i').test(lower)) return true;
  }
  return false;
}

const MARKET_PATTERNS = [
  /\b(the (?:market|industry|category|sector|landscape)|market size|enterprise (?:market|segment)|SaaS market|TAM|addressable market)\b/i,
];

const HISTORICAL_PATTERNS = [
  /\b(in 20\d\d|since 20\d\d|over the (?:past|last) \d+ (?:years?|months?|decades?)|in the (?:early|late|mid)[- ]?\d{4}s|historically|years ago)\b/i,
];

const PRODUCT_CAPABILITY_PATTERNS = [
  /\b(enables you to|empowers (?:teams|users)|automates|delivers|provides (?:visibility|control|integration|automation)|allows you to|gives (?:teams|users))\b/i,
];

const STRATEGIC_RECOMMENDATION_PATTERNS = [
  /\b(should|must|need to|the right approach is|we recommend|consider|the best approach|it'?s time to)\b/i,
];

const SPECULATIVE_PATTERNS = [
  /\b(may|might|could|potentially|likely|appears? to|suggests?|tends? to|in many cases|often|typically)\b/i,
];

const OPINIONATED_PATTERNS = [
  /\b(we believe|in our (?:view|opinion|experience)|arguably|the truth is|our take|the way we see it|to us,)\b/i,
];

const HIGH_CONFIDENCE_MARKERS = [
  /\b(definitely|certainly|absolutely|always|guaranteed|undoubtedly|without question|every single|100%|never fails)\b/i,
];

const LOW_CONFIDENCE_MARKERS = [
  /\b(may|might|could|potentially|sometimes|in some cases|occasionally|appears? to|it'?s possible|tends? to)\b/i,
];

const MEDIUM_CONFIDENCE_MARKERS = [
  /\b(typically|often|usually|generally|in most cases|frequently|commonly)\b/i,
];

function detectConfidence(text: string): ExtractedClaim['confidenceHint'] {
  if (HIGH_CONFIDENCE_MARKERS.some((re) => re.test(text))) return 'high';
  if (LOW_CONFIDENCE_MARKERS.some((re) => re.test(text))) return 'low';
  if (MEDIUM_CONFIDENCE_MARKERS.some((re) => re.test(text))) return 'medium';
  // Bare declarative without hedges defaults to high confidence.
  return 'high';
}

function classify(text: string): ClaimType {
  if (STATISTIC_PATTERNS.some((re) => re.test(text))) return 'statistic';
  if (BENCHMARK_PATTERNS.some((re) => re.test(text))) return 'benchmark_comparison';
  if (OPINIONATED_PATTERNS.some((re) => re.test(text))) return 'opinionated_interpretation';
  if (SPECULATIVE_PATTERNS.some((re) => re.test(text))) return 'speculative_statement';
  if (HISTORICAL_PATTERNS.some((re) => re.test(text))) return 'historical_statement';
  if (MARKET_PATTERNS.some((re) => re.test(text))) return 'market_statement';
  if (PRODUCT_CAPABILITY_PATTERNS.some((re) => re.test(text))) return 'product_capability_claim';
  if (STRATEGIC_RECOMMENDATION_PATTERNS.some((re) => re.test(text))) return 'strategic_recommendation';
  if (hasOperationalVerb(text)) return 'operational_assertion';
  return 'factual_claim';
}

function evidenceRequirementFor(type: ClaimType, confidence: ExtractedClaim['confidenceHint']): EvidenceRequirementLevel {
  switch (type) {
    case 'statistic': return 'critical';
    case 'benchmark_comparison': return 'critical';
    case 'market_statement': return 'required';
    case 'historical_statement': return 'required';
    case 'factual_claim': return confidence === 'high' ? 'required' : 'recommended';
    case 'product_capability_claim': return confidence === 'high' ? 'recommended' : 'none';
    case 'operational_assertion': return 'recommended';
    case 'strategic_recommendation': return 'recommended';
    case 'speculative_statement': return 'none';
    case 'opinionated_interpretation': return 'none';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface ExtractClaimsInput {
  sourceSectionId: string;
  sectionText: string;
}

export function extractClaims(input: ExtractClaimsInput): ExtractedClaim[] {
  const plain = stripHtml(input.sectionText);
  const sentences = splitSentences(plain);
  const claims: ExtractedClaim[] = [];
  let claimSeq = 0;
  for (const s of sentences) {
    // Allow a sentence to surface multiple types only when statistic+something coexist.
    const primary = classify(s.text);
    const confidence = detectConfidence(s.text);
    claims.push({
      claimId: `clm_${input.sourceSectionId.slice(-8)}_${claimSeq.toString(36)}_${stableHash(s.text).slice(0, 6)}`,
      claimType: primary,
      sourceSectionId: input.sourceSectionId,
      claimText: s.text,
      positionInSection: s.index,
      confidenceHint: confidence,
      evidenceRequirementLevel: evidenceRequirementFor(primary, confidence),
    });
    claimSeq += 1;

    // Secondary statistic emission: a sentence that already classified as
    // operational_assertion / product_capability / market may also contain a
    // statistic — emit it as a co-claim so evidence layer sees both.
    if (primary !== 'statistic' && STATISTIC_PATTERNS.some((re) => re.test(s.text))) {
      claims.push({
        claimId: `clm_${input.sourceSectionId.slice(-8)}_${claimSeq.toString(36)}_${stableHash(s.text + '_stat').slice(0, 6)}`,
        claimType: 'statistic',
        sourceSectionId: input.sourceSectionId,
        claimText: s.text,
        positionInSection: s.index,
        confidenceHint: confidence,
        evidenceRequirementLevel: 'critical',
      });
      claimSeq += 1;
    }
  }
  return claims;
}
