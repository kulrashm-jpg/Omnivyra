/**
 * Phase 1 — Recommendation family clustering.
 *
 * Derives a strategic family identity for each recommendation so the engine
 * can suppress near-duplicates that differ only by phrasing.
 *
 * Family signal axes:
 *   • narrativeArchetype  — operational_efficiency, observability, governance, …
 *   • operationalTheme    — workflow group (workflow, evaluation, telemetry, …)
 *   • icpProblemFamily    — normalized ICP pain bucket
 *   • capabilityFamily    — normalized capability bucket
 *   • editorialIntentFamily — how-to, comparison, framework, opinion, …
 *
 * Two recommendations sharing 4 of 5 axes are treated as the same family —
 * the highest-overall-strength member survives, others are demoted/dropped.
 */

import type {
  ClusterDiversityReport,
  LongFormRecommendation,
  NarrativeArchetype,
  RecommendationFamilyCluster,
} from './longFormRecommendationTypes';

// ────────────────────────────────────────────────────────────────────────────
// Archetype detection
// ────────────────────────────────────────────────────────────────────────────

/** Keyword sets per archetype. Order matters: first hit wins. */
const ARCHETYPE_KEYWORDS: Array<{ archetype: NarrativeArchetype; words: string[] }> = [
  { archetype: 'observability', words: ['observability', 'telemetry', 'visibility', 'monitoring', 'tracing', 'instrumentation', 'logs ', 'audit trail'] },
  { archetype: 'workflow_fragmentation', words: ['fragmented', 'silo', 'scattered', 'disconnected', 'fragmentation', 'handoff', 'context switch'] },
  { archetype: 'evaluation_maturity', words: ['evaluation', 'evals', 'eval suite', 'model maturity', 'benchmark', 'regression test'] },
  { archetype: 'orchestration', words: ['orchestrate', 'orchestration', 'coordinate', 'coordination', 'pipeline', 'sequencing', 'conductor'] },
  { archetype: 'governance', words: ['governance', 'compliance', 'policy', 'guardrail', 'audit', 'control plane'] },
  { archetype: 'ai_adoption_risk', words: ['risk', 'hallucination', 'safety', 'adoption risk', 'trust gap', 'failure mode', 'liability'] },
  { archetype: 'scaling_bottleneck', words: ['scale', 'scaling', 'bottleneck', 'throughput', 'capacity', 'growth pain'] },
  { archetype: 'operational_efficiency', words: ['efficiency', 'speed', 'productivity', 'cycle time', 'cost reduction', 'wasted'] },
  { archetype: 'transformation_path', words: ['transformation', 'journey', 'migration', 'shift', 'evolve', 'next-generation'] },
  { archetype: 'authority_positioning', words: ['authority', 'leadership', 'definitive', 'industry standard', 'expert view'] },
  { archetype: 'comparative_decision', words: ['vs ', 'vs.', 'versus', 'choose between', 'comparison', 'which is better', 'trade-off'] },
  { archetype: 'category_definition', words: ['what is', 'category', 'new model', 'introducing', 'defining', 'new way to'] },
];

export function detectNarrativeArchetype(recommendation: Pick<LongFormRecommendation, 'recommendationTitle' | 'editorialAngle' | 'strategicNarrative' | 'recommendedContentDirection'>): NarrativeArchetype {
  const blob = [
    recommendation.recommendationTitle,
    recommendation.editorialAngle,
    recommendation.strategicNarrative,
    recommendation.recommendedContentDirection?.primaryAngle ?? '',
  ].join(' ').toLowerCase();
  for (const { archetype, words } of ARCHETYPE_KEYWORDS) {
    if (words.some((w) => blob.includes(w))) return archetype;
  }
  return 'uncategorized';
}

// ────────────────────────────────────────────────────────────────────────────
// Family axis derivation
// ────────────────────────────────────────────────────────────────────────────

const OPERATIONAL_THEME_BUCKETS: Array<{ theme: string; words: string[] }> = [
  { theme: 'evaluation_and_quality', words: ['eval', 'evaluation', 'quality', 'benchmark', 'regression', 'measure'] },
  { theme: 'telemetry_and_visibility', words: ['telemetry', 'observability', 'visibility', 'monitoring', 'tracing'] },
  { theme: 'governance_and_compliance', words: ['governance', 'compliance', 'policy', 'audit', 'control'] },
  { theme: 'pipeline_and_orchestration', words: ['pipeline', 'orchestration', 'workflow', 'coordination', 'sequence'] },
  { theme: 'cost_and_efficiency', words: ['cost', 'efficiency', 'spend', 'budget', 'cycle time'] },
  { theme: 'adoption_and_change', words: ['adoption', 'change', 'rollout', 'migration', 'enablement'] },
  { theme: 'platform_and_infrastructure', words: ['platform', 'infrastructure', 'runtime', 'deployment', 'cluster'] },
  { theme: 'product_and_capability', words: ['product', 'feature', 'capability', 'integration'] },
  { theme: 'people_and_ops', words: ['team', 'org', 'hiring', 'process', 'standard operating'] },
];

function bucketize(text: string, buckets: Array<{ theme: string; words: string[] }>, fallback: string): string {
  const lower = (text ?? '').toLowerCase();
  if (!lower) return fallback;
  for (const { theme, words } of buckets) {
    if (words.some((w) => lower.includes(w))) return theme;
  }
  return fallback;
}

function normalizePainBucket(icpMapping: string): string {
  return bucketize(icpMapping, OPERATIONAL_THEME_BUCKETS, 'general_pain');
}

function normalizeCapabilityBucket(capabilityConnection: string): string {
  return bucketize(capabilityConnection, OPERATIONAL_THEME_BUCKETS, 'general_capability');
}

const EDITORIAL_INTENT_PATTERNS: Array<{ family: string; test: (lower: string) => boolean }> = [
  { family: 'how_to_application', test: (s) => /^how to\b/.test(s) || /\bplaybook\b/.test(s) || /\bchecklist\b/.test(s) },
  { family: 'comparison_decision', test: (s) => /\bvs\.?\b/.test(s) || /\bversus\b/.test(s) || /\bcompar/.test(s) },
  { family: 'framework_introduction', test: (s) => /\bframework\b/.test(s) || /\bmodel\b/.test(s) || /\bsystem\b/.test(s) },
  { family: 'opinionated_take', test: (s) => /^why\b/.test(s) || /\bcommon assumption\b/.test(s) || /\bmost teams\b/.test(s) },
  { family: 'category_explainer', test: (s) => /^what is\b/.test(s) || /\bintro to\b/.test(s) || /\bguide to\b/.test(s) },
  { family: 'case_proof', test: (s) => /\bcase study\b/.test(s) || /\bresults\b/.test(s) || /\bproof\b/.test(s) },
];

function deriveEditorialIntentFamily(recommendation: Pick<LongFormRecommendation, 'recommendationTitle' | 'editorialAngle'>): string {
  const lower = `${recommendation.recommendationTitle} ${recommendation.editorialAngle}`.toLowerCase();
  for (const { family, test } of EDITORIAL_INTENT_PATTERNS) {
    if (test(lower)) return family;
  }
  return 'editorial_general';
}

// ────────────────────────────────────────────────────────────────────────────
// Cluster identity
// ────────────────────────────────────────────────────────────────────────────

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export interface DerivedFamily {
  familyClusterId: string;
  familyClusterLabel: string;
  narrativeArchetype: NarrativeArchetype;
  operationalTheme: string;
  icpProblemFamily: string;
  capabilityFamily: string;
  editorialIntentFamily: string;
}

export function deriveRecommendationFamily(recommendation: LongFormRecommendation): DerivedFamily {
  const archetype = recommendation.narrativeArchetype ?? detectNarrativeArchetype(recommendation);
  const icpFamily = normalizePainBucket(recommendation.whyThisFitsCompany.icpProblemMapping);
  const capabilityFamily = normalizeCapabilityBucket(recommendation.whyThisFitsCompany.capabilityConnection);
  const editorialFamily = deriveEditorialIntentFamily(recommendation);

  // Operational theme = whichever bucket the primaryAngle falls into (or capability fallback).
  const operationalTheme = bucketize(
    recommendation.recommendedContentDirection.primaryAngle,
    OPERATIONAL_THEME_BUCKETS,
    capabilityFamily,
  );

  // Cluster id collapses the strategic family. Editorial intent is intentionally
  // EXCLUDED so two recommendations with the same strategic core but different
  // editorial framings (how-to vs. opinion) still collapse — that prevents
  // title-only differentiation per Phase 1 spec.
  const familyClusterId = `cl_${stableHash(`${archetype}|${operationalTheme}|${icpFamily}|${capabilityFamily}`)}`;
  const familyClusterLabel = `${archetype.replace(/_/g, ' ')} · ${operationalTheme.replace(/_/g, ' ')}`;

  return {
    familyClusterId,
    familyClusterLabel,
    narrativeArchetype: archetype,
    operationalTheme,
    icpProblemFamily: icpFamily,
    capabilityFamily,
    editorialIntentFamily: editorialFamily,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Cluster grouping + diversity report
// ────────────────────────────────────────────────────────────────────────────

export interface ClusterGroupResult {
  /** Recommendations enriched with familyClusterId / Label / archetype. */
  enriched: LongFormRecommendation[];
  /** Suppressed near-duplicates (kept only top member per cluster). */
  suppressed: LongFormRecommendation[];
  report: ClusterDiversityReport;
}

/**
 * Suppresses near-duplicate cluster members. The strongest member by
 * overallRecommendationStrength survives with clusterRank=1; others are
 * removed from the active set and returned as `suppressed`.
 *
 * If `keepSecondarySimilarity` is > 0, allow secondary members whose score
 * is within that fraction of the cluster leader (used by the balancer when
 * we genuinely need more candidates to fill the limit).
 */
export function groupRecommendationsByFamily(
  recommendations: LongFormRecommendation[],
  options?: { keepSecondarySimilarity?: number },
): ClusterGroupResult {
  const enriched: LongFormRecommendation[] = recommendations.map((rec) => {
    const family = deriveRecommendationFamily(rec);
    return {
      ...rec,
      familyClusterId: family.familyClusterId,
      familyClusterLabel: family.familyClusterLabel,
      narrativeArchetype: family.narrativeArchetype,
    };
  });

  const byCluster = new Map<string, LongFormRecommendation[]>();
  for (const rec of enriched) {
    const id = rec.familyClusterId ?? 'cl_unknown';
    const arr = byCluster.get(id) ?? [];
    arr.push(rec);
    byCluster.set(id, arr);
  }

  const keepSecondary = options?.keepSecondarySimilarity ?? 0;
  const surviving: LongFormRecommendation[] = [];
  const suppressed: LongFormRecommendation[] = [];
  const clusters: RecommendationFamilyCluster[] = [];

  byCluster.forEach((members, clusterId) => {
    members.sort((a, b) => b.overallRecommendationStrength - a.overallRecommendationStrength);
    const leader = members[0];
    const family = deriveRecommendationFamily(leader);
    members.forEach((m, idx) => {
      const ranked = { ...m, clusterRank: idx + 1 };
      if (idx === 0) {
        surviving.push(ranked);
        return;
      }
      // Allow a secondary member only if its score is within keepSecondary of leader.
      if (keepSecondary > 0
        && leader.overallRecommendationStrength > 0
        && (leader.overallRecommendationStrength - m.overallRecommendationStrength) / leader.overallRecommendationStrength <= keepSecondary
        && idx < 2) {
        surviving.push(ranked);
      } else {
        suppressed.push(ranked);
      }
    });
    clusters.push({
      familyClusterId: clusterId,
      familyClusterLabel: family.familyClusterLabel,
      narrativeArchetype: family.narrativeArchetype,
      operationalTheme: family.operationalTheme,
      icpProblemFamily: family.icpProblemFamily,
      capabilityFamily: family.capabilityFamily,
      editorialIntentFamily: family.editorialIntentFamily,
      memberRecommendationIds: members.map((m) => m.recommendationId),
      suppressedDuplicateCount: members.length - 1,
    });
  });

  const totalCandidates = recommendations.length;
  const clusterCount = clusters.length;
  const clusterDiversityScore = totalCandidates === 0
    ? 0
    : Math.round((clusterCount / totalCandidates) * 100);

  return {
    enriched: surviving,
    suppressed,
    report: {
      clusterCount,
      totalCandidates,
      clusterDiversityScore,
      suppressedDuplicateCount: suppressed.length,
      clusters,
    },
  };
}
