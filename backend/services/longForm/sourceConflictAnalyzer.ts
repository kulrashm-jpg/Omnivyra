/**
 * Phase 6 — Source conflict analyzer.
 *
 * Five conflict types:
 *
 *   CONFLICTING_STATISTICS   — two sources cite different numeric values for
 *                              the same metric.
 *   CONTRADICTORY_EVIDENCE   — fragments share a topic but assert opposing
 *                              positions (heuristic: presence of negation).
 *   STALE_REFERENCE          — source is past its staleAfter window AND another
 *                              fresh source covers the same topic.
 *   CONFLICTING_STRATEGIC_RECOMMENDATIONS
 *                            — fragments tagged strategy that contain
 *                              conflicting directives.
 *   INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS
 *                            — operational fragments that imply mutually
 *                              exclusive workflows.
 */

import type {
  ConflictResolutionAction,
  KnowledgeSource,
  KnowledgeSourceFragment,
  RetrievalGroundingProfile,
  SourceConflict,
  SourceConflictResult,
  SourceConflictType,
  SourceReliabilityBand,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

interface FragmentWithSource {
  source: KnowledgeSource;
  fragment: KnowledgeSourceFragment;
}

const NEGATION_MARKERS = [
  /\bnot\b/i, /\bnever\b/i, /\bavoid(?:ing|s|ed)?\b/i, /\bopposite\b/i,
  /\binstead of\b/i, /\bcontradict(?:s|ed|ing)?\b/i, /\bcontrary to\b/i,
];

function hasNegation(text: string): boolean {
  return NEGATION_MARKERS.some((re) => re.test(text));
}

function topicGroup(fragments: FragmentWithSource[], topicTagFilter?: (hint: string) => boolean): Map<string, FragmentWithSource[]> {
  const out = new Map<string, FragmentWithSource[]>();
  for (const { source, fragment } of fragments) {
    const hint = (fragment.topicHint ?? '').toLowerCase().trim();
    if (!hint) continue;
    if (topicTagFilter && !topicTagFilter(hint)) continue;
    const arr = out.get(hint) ?? [];
    arr.push({ source, fragment });
    out.set(hint, arr);
  }
  return out;
}

function bandRank(b: SourceReliabilityBand): number {
  return ['unreliable', 'low', 'moderate', 'high', 'exceptional'].indexOf(b);
}

export interface AnalyzeSourceConflictsInput {
  profile: RetrievalGroundingProfile;
}

export function analyzeSourceConflicts(input: AnalyzeSourceConflictsInput): SourceConflictResult {
  const profile = input.profile;
  const trustBySource = calibrateManySources(profile.approvedSources);
  const allFragments: FragmentWithSource[] = [];
  for (const s of profile.approvedSources) {
    for (const f of s.contentFragments) {
      allFragments.push({ source: s, fragment: f });
    }
  }

  const conflicts: SourceConflict[] = [];

  // 1. CONFLICTING_STATISTICS — group fragments with numericClaim by metric key.
  const numericByMetric = new Map<string, FragmentWithSource[]>();
  for (const fs of allFragments) {
    const nc = fs.fragment.numericClaim;
    if (!nc) continue;
    const key = `${nc.metric.toLowerCase()}::${nc.unit.toLowerCase()}`;
    const arr = numericByMetric.get(key) ?? [];
    arr.push(fs);
    numericByMetric.set(key, arr);
  }
  for (const [key, group] of numericByMetric) {
    if (group.length < 2) continue;
    const values = group.map((g) => g.fragment.numericClaim!.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    // Disagreement threshold: > 20% spread relative to max.
    if (max === 0) continue;
    const spread = (max - min) / max;
    if (spread > 0.20) {
      conflicts.push({
        conflictType: 'CONFLICTING_STATISTICS',
        involvedSourceIds: Array.from(new Set(group.map((g) => g.source.sourceId))),
        detail: `Metric "${key}": values disagree by ${Math.round(spread * 100)}% (min=${min}, max=${max}).`,
        severity: spread > 0.50 ? 'high' : 'medium',
      });
    }
  }

  // 2. STALE_REFERENCE — flag stale sources whose topic is also covered by a fresh source.
  const topicToFreshSources = new Map<string, Set<string>>();
  for (const fs of allFragments) {
    if (fs.source.freshnessMetadata.isStale) continue;
    const hint = (fs.fragment.topicHint ?? '').toLowerCase().trim();
    if (!hint) continue;
    const set = topicToFreshSources.get(hint) ?? new Set();
    set.add(fs.source.sourceId);
    topicToFreshSources.set(hint, set);
  }
  for (const fs of allFragments) {
    if (!fs.source.freshnessMetadata.isStale) continue;
    const hint = (fs.fragment.topicHint ?? '').toLowerCase().trim();
    if (!hint) continue;
    const freshAlternatives = topicToFreshSources.get(hint);
    if (freshAlternatives && freshAlternatives.size > 0 && !freshAlternatives.has(fs.source.sourceId)) {
      conflicts.push({
        conflictType: 'STALE_REFERENCE',
        involvedSourceIds: [fs.source.sourceId, ...Array.from(freshAlternatives)],
        detail: `Source ${fs.source.sourceId} is stale (age ${fs.source.freshnessMetadata.ageInDays}d) but ${freshAlternatives.size} fresh source(s) cover topic "${hint}".`,
        severity: 'medium',
      });
    }
  }

  // 3. CONTRADICTORY_EVIDENCE — same topic, opposing positions.
  for (const [hint, group] of topicGroup(allFragments)) {
    if (group.length < 2) continue;
    const negatedCount = group.filter((g) => hasNegation(g.fragment.text)).length;
    const affirmingCount = group.length - negatedCount;
    if (negatedCount > 0 && affirmingCount > 0) {
      conflicts.push({
        conflictType: 'CONTRADICTORY_EVIDENCE',
        involvedSourceIds: Array.from(new Set(group.map((g) => g.source.sourceId))),
        detail: `Topic "${hint}" has ${affirmingCount} affirming + ${negatedCount} negating fragment(s).`,
        severity: 'medium',
      });
    }
  }

  // 4. CONFLICTING_STRATEGIC_RECOMMENDATIONS — strategy-hinted fragments with negation across sources.
  const strategicGroup = topicGroup(allFragments, (h) => h.includes('strategy') || h.includes('positioning') || h.includes('narrative'));
  for (const [hint, group] of strategicGroup) {
    if (group.length < 2) continue;
    const sourceSet = new Set(group.map((g) => g.source.sourceId));
    if (sourceSet.size < 2) continue;
    const negatedCount = group.filter((g) => hasNegation(g.fragment.text)).length;
    if (negatedCount > 0 && negatedCount < group.length) {
      conflicts.push({
        conflictType: 'CONFLICTING_STRATEGIC_RECOMMENDATIONS',
        involvedSourceIds: Array.from(sourceSet),
        detail: `Strategic topic "${hint}" carries conflicting directives across ${sourceSet.size} source(s).`,
        severity: 'high',
      });
    }
  }

  // 5. INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS — operational-hinted fragments with contradictions.
  const operationalGroup = topicGroup(allFragments, (h) => h.includes('operational') || h.includes('workflow') || h.includes('execution'));
  for (const [hint, group] of operationalGroup) {
    if (group.length < 2) continue;
    const sourceSet = new Set(group.map((g) => g.source.sourceId));
    if (sourceSet.size < 2) continue;
    // Heuristic: presence of "fully automated" + "manual" in different fragments → incompatible.
    const hasFullyAutomated = group.some((g) => /\bfully automat(?:ed|es)?\b/i.test(g.fragment.text));
    const hasManual = group.some((g) => /\bmanual\b/i.test(g.fragment.text));
    if (hasFullyAutomated && hasManual) {
      conflicts.push({
        conflictType: 'INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS',
        involvedSourceIds: Array.from(sourceSet),
        detail: `Operational topic "${hint}": some sources assume full automation; others require manual steps.`,
        severity: 'high',
      });
    }
  }

  // Resolution recommendations.
  const conflictResolutionRecommendations = conflicts.map((conflict, index) => {
    const action = ((): ConflictResolutionAction => {
      switch (conflict.conflictType) {
        case 'STALE_REFERENCE': return 'prefer_newer';
        case 'CONFLICTING_STATISTICS': {
          // Prefer higher trust if disparity is wide.
          const trusts = conflict.involvedSourceIds.map((sid) => trustBySource.get(sid)?.sourceReliabilityBand ?? 'unreliable' as const);
          const allSameBand = trusts.every((t) => t === trusts[0]);
          return allSameBand ? 'flag_for_human_review' : 'prefer_higher_trust';
        }
        case 'CONFLICTING_STRATEGIC_RECOMMENDATIONS': return 'flag_for_human_review';
        case 'INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS': return 'merge_with_caveat';
        case 'CONTRADICTORY_EVIDENCE': {
          // If trust bands differ significantly, drop the lower one.
          const ranked = conflict.involvedSourceIds
            .map((sid) => ({ sid, rank: bandRank(trustBySource.get(sid)?.sourceReliabilityBand ?? 'unreliable') }))
            .sort((a, b) => b.rank - a.rank);
          if (ranked.length >= 2 && ranked[0].rank - ranked[ranked.length - 1].rank >= 2) {
            return 'remove_lower_trust';
          }
          return 'merge_with_caveat';
        }
      }
    })();
    return {
      conflictIndex: index,
      action,
      reason: `Conflict type ${conflict.conflictType} — recommended action: ${action}.`,
    };
  });

  const severityRank: Record<SourceConflictType, 'low' | 'medium' | 'high'> = {
    CONFLICTING_STATISTICS: 'medium',
    CONTRADICTORY_EVIDENCE: 'medium',
    STALE_REFERENCE: 'low',
    CONFLICTING_STRATEGIC_RECOMMENDATIONS: 'high',
    INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS: 'high',
  };
  let aggregate: 'none' | 'low' | 'medium' | 'high' = 'none';
  for (const c of conflicts) {
    const sev = c.severity;
    if (sev === 'high') { aggregate = 'high'; break; }
    if (sev === 'medium' && (aggregate as string) !== 'high') aggregate = 'medium';
    if (sev === 'low' && aggregate === 'none') aggregate = 'low';
  }
  void severityRank;

  return {
    conflicts,
    sourceConflictSeverity: aggregate,
    conflictResolutionRecommendations,
  };
}
