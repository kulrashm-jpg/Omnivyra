/**
 * Phase 3 — Recommendation memory.
 *
 * Tracks fingerprints of accepted recommendations so future generations can
 * penalize repetitive structure. Pluggable provider: the default is an
 * in-process volatile adapter; a persistence adapter can replace it later
 * without code changes elsewhere.
 *
 * Goal: avoid recommendation fatigue. A second generation for the same
 * company should not return the same 6 strategic shapes.
 *
 * Public API:
 *   - buildFingerprintFromRecommendation()
 *   - scoreRecommendationNovelty()        — 0–100
 *   - getDefaultRecommendationMemory()    — volatile singleton
 *   - createVolatileRecommendationMemory()
 *   - setDefaultRecommendationMemory()    — for tests / future swap-in
 */

import type {
  HistoricalRecommendationFingerprint,
  LongFormRecommendation,
  NarrativeArchetype,
  RecommendationMemoryProvider,
} from './longFormRecommendationTypes';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const FP_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for',
  'with', 'by', 'at', 'is', 'are', 'was', 'were', 'as', 'from', 'how',
  'why', 'what', 'when', 'where', 'who', 'this', 'that', 'these', 'those',
]);

function fingerprintTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !FP_STOPWORDS.has(t))
    .slice(0, 24);
}

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/**
 * Reduces a strategic narrative to a structural shape: order of clause types
 * (declarative vs. conditional vs. comparative) collapsed to a small string.
 * Two narratives with the same structural shape get the same hash even if
 * wording differs.
 */
function deriveNarrativeShape(narrative: string): string {
  const lower = narrative.toLowerCase();
  const flags: string[] = [];
  if (/\b(if|when|unless|until)\b/.test(lower)) flags.push('CND');
  if (/\b(vs\.?|versus|compared|instead of|rather than)\b/.test(lower)) flags.push('CMP');
  if (/\b(only works|only when|requires|must|needs)\b/.test(lower)) flags.push('PRC');
  if (/\b(ends in|leads to|results in|so that)\b/.test(lower)) flags.push('END');
  if (/\b(before|after|sequenced|prior to)\b/.test(lower)) flags.push('SEQ');
  if (flags.length === 0) flags.push('DCL');
  return flags.sort().join('-');
}

function deriveTitleStructure(title: string): string {
  const lower = title.toLowerCase();
  const tokens = lower.split(/\s+/);
  const head = tokens.slice(0, 2).join(' ');
  const hasQuestion = /\?$/.test(title);
  const hasColon = title.includes(':');
  const tags: string[] = [];
  if (/^how\b/.test(lower)) tags.push('HOW');
  if (/^why\b/.test(lower)) tags.push('WHY');
  if (/^what\b/.test(lower)) tags.push('WHAT');
  if (/\bvs\.?\b/.test(lower)) tags.push('VS');
  if (/\b(framework|playbook|model)\b/.test(lower)) tags.push('FW');
  if (/\b(ultimate|complete|everything)\b/.test(lower)) tags.push('UG');
  if (hasQuestion) tags.push('Q');
  if (hasColon) tags.push('COL');
  return `${head}::${tags.sort().join(',')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Fingerprint builder
// ────────────────────────────────────────────────────────────────────────────

export function buildFingerprintFromRecommendation(
  companyId: string,
  recommendation: LongFormRecommendation,
): HistoricalRecommendationFingerprint {
  const angleTokens = fingerprintTokenize(recommendation.editorialAngle).slice(0, 12);
  const titleTokens = fingerprintTokenize(recommendation.recommendationTitle);
  const capability = recommendation.whyThisFitsCompany.capabilityConnection.trim().toLowerCase().slice(0, 120);
  const icp = recommendation.whyThisFitsCompany.icpProblemMapping.trim().toLowerCase().slice(0, 160);
  const narrativeStructure = deriveTitleStructure(recommendation.recommendationTitle);
  const narrativeShape = deriveNarrativeShape(recommendation.strategicNarrative);
  const archetype: NarrativeArchetype = recommendation.narrativeArchetype ?? 'uncategorized';

  const fpInput = [
    narrativeStructure,
    angleTokens.join(','),
    capability,
    icp,
    narrativeShape,
    archetype,
  ].join('|');

  return {
    fingerprintId: `fp_${stableHash(`${companyId}|${fpInput}`)}_${Date.now().toString(36)}`,
    companyId,
    narrativeStructure,
    editorialAngleHash: stableHash(angleTokens.join(' ')),
    capabilityFocus: capability,
    icpProblem: icp,
    titleSemanticsTokens: titleTokens,
    strategicNarrativeShape: narrativeShape,
    narrativeArchetype: archetype,
    createdAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Novelty scoring
// ────────────────────────────────────────────────────────────────────────────

function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  setA.forEach((t) => { if (setB.has(t)) inter += 1; });
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 0 = identical to a recent recommendation, 100 = unseen.
 * Compares against the K most-recent fingerprints; returns the score against
 * the closest historical match (worst-case novelty).
 */
export function scoreRecommendationNovelty(
  candidateFingerprint: HistoricalRecommendationFingerprint,
  recent: HistoricalRecommendationFingerprint[],
): number {
  if (recent.length === 0) return 100;
  let worstSimilarity = 0;
  for (const past of recent) {
    let sim = 0;
    if (past.narrativeStructure === candidateFingerprint.narrativeStructure) sim += 0.20;
    if (past.editorialAngleHash === candidateFingerprint.editorialAngleHash) sim += 0.25;
    if (past.capabilityFocus === candidateFingerprint.capabilityFocus) sim += 0.15;
    if (past.icpProblem === candidateFingerprint.icpProblem) sim += 0.15;
    if (past.strategicNarrativeShape === candidateFingerprint.strategicNarrativeShape) sim += 0.10;
    if (past.narrativeArchetype === candidateFingerprint.narrativeArchetype) sim += 0.05;
    sim += jaccardTokens(past.titleSemanticsTokens, candidateFingerprint.titleSemanticsTokens) * 0.10;
    if (sim > worstSimilarity) worstSimilarity = sim;
  }
  return Math.round(Math.max(0, Math.min(100, (1 - worstSimilarity) * 100)));
}

// ────────────────────────────────────────────────────────────────────────────
// Providers
// ────────────────────────────────────────────────────────────────────────────

interface VolatileBucket {
  ring: HistoricalRecommendationFingerprint[];
  next: number;
}

export function createVolatileRecommendationMemory(options?: {
  capacityPerCompany?: number;
}): RecommendationMemoryProvider {
  const capacity = Math.max(6, options?.capacityPerCompany ?? 48);
  const buckets = new Map<string, VolatileBucket>();

  function ensureBucket(companyId: string): VolatileBucket {
    let b = buckets.get(companyId);
    if (!b) {
      b = { ring: new Array(capacity), next: 0 };
      buckets.set(companyId, b);
    }
    return b;
  }

  return {
    name: 'volatile',
    async recordBatch(companyId, fingerprints) {
      if (!companyId || fingerprints.length === 0) return;
      const b = ensureBucket(companyId);
      for (const fp of fingerprints) {
        b.ring[b.next] = fp;
        b.next = (b.next + 1) % capacity;
      }
    },
    async recentFingerprints(companyId, limit = 24) {
      const b = buckets.get(companyId);
      if (!b) return [];
      const flat = b.ring.filter((x): x is HistoricalRecommendationFingerprint => Boolean(x));
      flat.sort((a, c) => c.createdAt.localeCompare(a.createdAt));
      return flat.slice(0, Math.max(1, limit));
    },
    async clear(companyId) {
      if (!companyId) {
        buckets.clear();
        return;
      }
      buckets.delete(companyId);
    },
  };
}

// Module-level default singleton — swappable for tests / persistence adapter.
let _defaultMemory: RecommendationMemoryProvider | null = null;

export function getDefaultRecommendationMemory(): RecommendationMemoryProvider {
  if (!_defaultMemory) _defaultMemory = createVolatileRecommendationMemory();
  return _defaultMemory;
}

export function setDefaultRecommendationMemory(provider: RecommendationMemoryProvider): void {
  _defaultMemory = provider;
}
