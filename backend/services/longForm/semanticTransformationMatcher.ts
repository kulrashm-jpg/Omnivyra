/**
 * Phase 12.2 — Semantic transformation matcher.
 *
 * Replaces the strict token-equality similarity used by the original
 * cannibalization analyzer / continuity governor with a synonym-aware
 * matcher.
 *
 * Two assets that say "decision-trace observability" and "runtime trace
 * monitoring" used to hash to different theme signatures. This matcher
 * normalizes both into the canonical equivalence class
 * "observability+telemetry+tracing" so cannibalization detection,
 * continuity governance, and editorial memory can all see them as the same
 * topic.
 *
 * Pure / deterministic. No LLM.
 *
 * Mechanism:
 *   1. Built-in synonym groups (extensible by caller).
 *   2. tokenize → fold to canonical class → produce class-set per asset.
 *   3. semantic similarity = Jaccard on canonical-class sets, blended with
 *      narrative-similarity and icp-overlap (also class-aware).
 */

import type {
  CrossModalAsset,
  EquivalenceAmbiguityWarning,
  SemanticClassWeightOverride,
  SemanticConfidenceResult,
  SemanticSimilarityResult,
} from './longFormRecommendationTypes';

// Built-in synonym groups. Caller can extend via SemanticMatcherOptions.
const DEFAULT_SYNONYM_GROUPS: Record<string, string[]> = {
  observability: ['observability', 'monitoring', 'telemetry', 'tracing', 'trace', 'traces', 'visibility'],
  governance:    ['governance', 'compliance', 'policy', 'guardrails', 'auditing', 'audit'],
  orchestration: ['orchestration', 'coordination', 'choreography', 'workflow', 'workflows'],
  evaluation:    ['evaluation', 'evals', 'evaluations', 'benchmark', 'benchmarks', 'testing'],
  ai_agents:     ['agent', 'agents', 'ai', 'llm', 'llms', 'model', 'models'],
  authority:     ['authority', 'expertise', 'thought-leadership', 'category', 'positioning'],
  funnel:        ['funnel', 'pipeline', 'journey', 'sequence', 'path'],
  attribution:   ['attribution', 'measurement', 'tracking'],
};

function buildClassIndex(groups: Record<string, string[]>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [cls, words] of Object.entries(groups)) {
    for (const w of words) {
      idx.set(w.toLowerCase(), cls);
    }
  }
  return idx;
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const t of (text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

function foldToClasses(words: string[], idx: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    const cls = idx.get(w);
    if (cls) out.add(cls);
    else out.add(w);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface SemanticMatcherOptions {
  /** Caller-supplied additional synonym groups. */
  extraSynonymGroups?: Record<string, string[]>;
  /** Per-class weight overrides (0..2). 1.0 is default; <1 dampens equivalence credit. */
  classWeights?: SemanticClassWeightOverride[];
  /** Ambiguous tokens that should NOT auto-fold — caller flags them via a warning instead. */
  ambiguousTokens?: string[];
  /** Optional domain-tagged groups; surfaced in confidence rationale + cross-domain leak warnings. */
  domainGroups?: Record<string, string[]>;
}

export interface SemanticMatcher {
  compareAssets(a: CrossModalAsset, b: CrossModalAsset): SemanticSimilarityResult;
  /** Build the canonical theme signature for cannibalization analyzers. */
  canonicalSignature(asset: CrossModalAsset): string;
  /** Tokenize-and-fold any text into class set. */
  canonicalTokens(text: string): Set<string>;
  /** Phase-13 hardening: confidence + ambiguity warnings on top of compareAssets. */
  compareWithConfidence(a: CrossModalAsset, b: CrossModalAsset): SemanticSimilarityResult & SemanticConfidenceResult;
}

export function createSemanticMatcher(options?: SemanticMatcherOptions): SemanticMatcher {
  const merged = { ...DEFAULT_SYNONYM_GROUPS, ...(options?.extraSynonymGroups ?? {}) };
  const idx = buildClassIndex(merged);
  const ambiguous = new Set((options?.ambiguousTokens ?? []).map((t) => t.toLowerCase()));
  // class weights default 1.0; clamp to 0..2
  const weights = new Map<string, number>();
  for (const o of options?.classWeights ?? []) {
    weights.set(o.className, Math.max(0, Math.min(2, o.weight)));
  }
  // domain index: token → domain
  const domainIdx = new Map<string, string>();
  for (const [domain, words] of Object.entries(options?.domainGroups ?? {})) {
    for (const w of words) domainIdx.set(w.toLowerCase(), domain);
  }

  function weightFor(cls: string): number { return weights.get(cls) ?? 1.0; }

  function canonicalTokens(text: string): Set<string> {
    return foldToClasses(tokenize(text), idx);
  }

  return {
    canonicalTokens,
    canonicalSignature(asset) {
      const themeTokens = asset.authorityThemes.flatMap(tokenize);
      const termTokens = asset.terminologyClusters.flatMap(tokenize);
      const cls = foldToClasses([...themeTokens, ...termTokens], idx);
      const sorted = Array.from(cls).sort();
      const archetype = (asset.narrativeArchetype ?? 'uncategorized').toString();
      return [archetype, ...sorted].join('|');
    },
    compareWithConfidence(a, b) {
      const base = this.compareAssets(a, b);

      // ── Weighted recompute when overrides present ────────────────────
      let weightedScore = base.semanticTransformationSimilarityScore;
      const equivWeights = base.themeEquivalences.map((cls) => weightFor(cls));
      const weightedEquivalenceCredit = equivWeights.length === 0
        ? 1.0
        : equivWeights.reduce((s, w) => s + w, 0) / equivWeights.length;
      weightedScore = Math.round(weightedScore * weightedEquivalenceCredit);

      // ── Contextual equivalence: +20 boost if same archetype, −15 if mismatched ──
      let contextualEquivalenceScore = base.semanticTransformationSimilarityScore;
      if (a.narrativeArchetype && b.narrativeArchetype) {
        contextualEquivalenceScore = Math.max(0, Math.min(100,
          contextualEquivalenceScore + (a.narrativeArchetype === b.narrativeArchetype ? 20 : -15),
        ));
      }

      // ── Equivalence ambiguity warnings ───────────────────────────────
      const equivalenceAmbiguityWarnings: EquivalenceAmbiguityWarning[] = [];
      const seenTokens = new Set<string>();
      const allTokens = [
        ...tokenize([a.strategicNarrative, ...a.authorityThemes, ...a.terminologyClusters, ...a.icpFocus].join(' ')),
        ...tokenize([b.strategicNarrative, ...b.authorityThemes, ...b.terminologyClusters, ...b.icpFocus].join(' ')),
      ];
      for (const t of allTokens) {
        if (seenTokens.has(t)) continue;
        seenTokens.add(t);
        if (ambiguous.has(t)) {
          equivalenceAmbiguityWarnings.push({
            token: t,
            candidateClasses: idx.get(t) ? [idx.get(t)!, '(ambiguous)'] : ['(unmapped)'],
            reason: `Token "${t}" is flagged ambiguous — auto-folding suppressed.`,
          });
        }
      }

      // ── Domain leak warnings ─────────────────────────────────────────
      const aDomains = new Set<string>();
      const bDomains = new Set<string>();
      const domainsTouched = new Set<string>();
      for (const t of tokenize([a.strategicNarrative, ...a.authorityThemes, ...a.terminologyClusters].join(' '))) {
        const d = domainIdx.get(t); if (d) { aDomains.add(d); domainsTouched.add(d); }
      }
      for (const t of tokenize([b.strategicNarrative, ...b.authorityThemes, ...b.terminologyClusters].join(' '))) {
        const d = domainIdx.get(t); if (d) { bDomains.add(d); domainsTouched.add(d); }
      }
      // If both assets touch domains AND domains don't overlap → potential leak.
      if (aDomains.size > 0 && bDomains.size > 0) {
        let overlap = 0;
        aDomains.forEach((d) => { if (bDomains.has(d)) overlap += 1; });
        if (overlap === 0) {
          equivalenceAmbiguityWarnings.push({
            token: '(cross-domain)',
            candidateClasses: [Array.from(aDomains).join(','), Array.from(bDomains).join(',')],
            reason: `Assets touch disjoint domains [${Array.from(aDomains).join(', ')}] vs [${Array.from(bDomains).join(', ')}] — equivalence credit dampened.`,
          });
          weightedScore = Math.round(weightedScore * 0.5);
        }
      }

      // ── Terminology confidence weight: more terminology overlap → higher confidence ──
      const terminologyConfidenceWeight = Math.max(0, Math.min(1, base.terminologyRelationshipsScore / 100));

      // ── semanticConfidenceScore = blend of:
      //     base similarity stability (50%) + theme equivalence count (20%)
      //     − ambiguity penalty (5pt each) − cross-domain penalty
      let semanticConfidenceScore =
        weightedScore * 0.5
        + Math.min(30, base.themeEquivalences.length * 10)
        + Math.min(20, base.matchedSynonymPairs.length * 2);
      semanticConfidenceScore -= equivalenceAmbiguityWarnings.length * 6;
      semanticConfidenceScore = Math.max(0, Math.min(100, Math.round(semanticConfidenceScore)));

      return {
        ...base,
        semanticTransformationSimilarityScore: weightedScore,
        semanticConfidenceScore,
        equivalenceAmbiguityWarnings,
        contextualEquivalenceScore,
        terminologyConfidenceWeight: Number(terminologyConfidenceWeight.toFixed(2)),
        domainsTouched: Array.from(domainsTouched),
      };
    },
    compareAssets(a, b) {
      const aTheme = foldToClasses([...a.authorityThemes.flatMap(tokenize), ...a.terminologyClusters.flatMap(tokenize)], idx);
      const bTheme = foldToClasses([...b.authorityThemes.flatMap(tokenize), ...b.terminologyClusters.flatMap(tokenize)], idx);
      const aNar = foldToClasses(tokenize(a.strategicNarrative), idx);
      const bNar = foldToClasses(tokenize(b.strategicNarrative), idx);
      const aIcp = foldToClasses(a.icpFocus.flatMap(tokenize), idx);
      const bIcp = foldToClasses(b.icpFocus.flatMap(tokenize), idx);
      const aTerms = foldToClasses(a.terminologyClusters.flatMap(tokenize), idx);
      const bTerms = foldToClasses(b.terminologyClusters.flatMap(tokenize), idx);

      const themeJ = jaccard(aTheme, bTheme);
      const narrJ = jaccard(aNar, bNar);
      const icpJ = jaccard(aIcp, bIcp);
      const termJ = jaccard(aTerms, bTerms);

      // Composite: themes dominate (40%), then narrative (30%), icp (15%), terminology (15%).
      const composite = themeJ * 0.40 + narrJ * 0.30 + icpJ * 0.15 + termJ * 0.15;

      // Matched synonym pairs: any token that mapped to the same class in both assets.
      const matchedSynonymPairs: SemanticSimilarityResult['matchedSynonymPairs'] = [];
      const aTokens = tokenize([a.strategicNarrative, ...a.authorityThemes, ...a.terminologyClusters, ...a.icpFocus].join(' '));
      const bTokens = tokenize([b.strategicNarrative, ...b.authorityThemes, ...b.terminologyClusters, ...b.icpFocus].join(' '));
      const seenPairs = new Set<string>();
      for (const ta of aTokens) {
        const cls = idx.get(ta);
        if (!cls) continue;
        for (const tb of bTokens) {
          if (idx.get(tb) !== cls) continue;
          if (ta === tb) continue;
          const key = `${ta}->${tb}`;
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          matchedSynonymPairs.push({ source: ta, target: tb, equivalenceClass: cls });
          if (matchedSynonymPairs.length >= 20) break;
        }
        if (matchedSynonymPairs.length >= 20) break;
      }

      // themeEquivalences: classes shared by both theme sets.
      const themeEquivalences: string[] = [];
      aTheme.forEach((t) => { if (bTheme.has(t)) themeEquivalences.push(t); });

      return {
        semanticTransformationSimilarityScore: clamp100(composite * 100),
        themeEquivalences,
        narrativeSimilarity: clamp100(narrJ * 100),
        icpSemanticOverlap: clamp100(icpJ * 100),
        terminologyRelationshipsScore: clamp100(termJ * 100),
        matchedSynonymPairs,
      };
    },
  };
}

let _defaultMatcher: SemanticMatcher | null = null;
export function getDefaultSemanticMatcher(): SemanticMatcher {
  if (!_defaultMatcher) _defaultMatcher = createSemanticMatcher();
  return _defaultMatcher;
}
export function setDefaultSemanticMatcher(m: SemanticMatcher): void { _defaultMatcher = m; }
