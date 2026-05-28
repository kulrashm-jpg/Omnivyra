/**
 * Phase 5 — Revision-aware integrity validator.
 *
 * Given a revision (and its diff analyses), determines which governance
 * zones were affected and re-runs ONLY those zones on the affected
 * sections. Avoids full-article revalidation for small edits.
 *
 * Zones map:
 *   continuity_drift / capability_suppression / icp_erosion / strategic_drift
 *     → continuity zone
 *   factual_degradation / unsupported_addition
 *     → factual zone + hallucination zone
 *   citation_removal
 *     → citation zone + grounded zone
 *   operational_simplification
 *     → operational_realism zone + continuity zone
 *   terminology_removal
 *     → continuity zone + grounded zone (terminology drift affects both)
 *
 * Each zone runs its specific governor on the AFTER section text and
 * compares to a pre-edit baseline score (computed once on first
 * encounter via the BEFORE text).
 */

import type {
  AffectedGovernanceZone,
  EditorialDiffAnalysis,
  Revision,
  RevisionAwareValidationResult,
  SectionGenerationContract,
  SelectiveRevalidationOutcome,
} from './longFormRecommendationTypes';
import { governSectionContinuity } from './sectionContinuityGovernor';
import { suppressHallucinations } from './hallucinationSuppressionGovernor';
import { extractClaims } from './claimExtractionEngine';
import { validateOperationalProof } from './operationalProofValidator';

const RISK_TO_ZONES: Record<string, AffectedGovernanceZone[]> = {
  strategic_narrative_drift: ['continuity'],
  factual_degradation: ['factual', 'hallucination'],
  terminology_removal: ['continuity', 'grounded'],
  citation_removal: ['citation', 'grounded'],
  operational_simplification: ['operational_realism', 'continuity'],
  icp_erosion: ['continuity'],
  capability_suppression: ['continuity'],
  tone_mutation: ['continuity'],
  unsupported_addition: ['factual', 'hallucination', 'grounded'],
};

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface RunRevisionAwareValidationInput {
  revision: Revision;
  contract: SectionGenerationContract;
  diffAnalyses: EditorialDiffAnalysis[];
}

function uniqueZones(diffs: EditorialDiffAnalysis[]): Set<AffectedGovernanceZone> {
  const set = new Set<AffectedGovernanceZone>();
  for (const diff of diffs) {
    for (const risk of diff.detectedRisks) {
      const zones = RISK_TO_ZONES[risk.type] ?? [];
      for (const z of zones) set.add(z);
    }
  }
  return set;
}

export function runRevisionAwareValidation(input: RunRevisionAwareValidationInput): RevisionAwareValidationResult {
  const affectedSectionIds = Array.from(new Set(input.revision.affectedSections.map((e) => e.sectionId)));
  const zonesSet = uniqueZones(input.diffAnalyses);
  const affectedGovernanceZones = Array.from(zonesSet);
  const outcomes: SelectiveRevalidationOutcome[] = [];

  for (const edit of input.revision.affectedSections) {
    for (const zone of affectedGovernanceZones) {
      const outcome = revalidateZone(input.contract, zone, edit);
      outcomes.push(outcome);
    }
  }

  // Article-level integrity score after this revision: average of after-zone scores.
  // Score baseline = before-edit zone score; outcome.delta carries the difference.
  const totalScore = outcomes.length === 0
    ? 100
    : outcomes.reduce((sum, o) => sum + Math.max(0, 100 - Math.abs(o.delta)), 0) / outcomes.length;
  const overallRevisionIntegrityScore = clamp100(totalScore);

  return {
    revisionId: input.revision.revisionId,
    affectedSectionIds,
    affectedGovernanceZones,
    selectiveRevalidationOutcomes: outcomes,
    overallRevisionIntegrityScore,
  };
}

function revalidateZone(
  contract: SectionGenerationContract,
  zone: AffectedGovernanceZone,
  edit: { sectionId: string; beforeHtml: string; afterHtml: string },
): SelectiveRevalidationOutcome {
  switch (zone) {
    case 'continuity': {
      const before = governSectionContinuity({ contract, sectionText: edit.beforeHtml });
      const after = governSectionContinuity({ contract, sectionText: edit.afterHtml });
      const delta = after.sectionContinuityScore - before.sectionContinuityScore;
      return {
        zone, sectionId: edit.sectionId, delta,
        passed: after.sectionContinuityScore >= contract.continuityThresholds.sectionContinuityFloor,
        detail: `continuity ${before.sectionContinuityScore} → ${after.sectionContinuityScore} (Δ${delta >= 0 ? '+' : ''}${delta}).`,
      };
    }
    case 'factual':
    case 'hallucination': {
      const before = suppressHallucinations({ sectionText: edit.beforeHtml });
      const after = suppressHallucinations({ sectionText: edit.afterHtml });
      // Hallucination pressure: lower = better. Delta inverted in `passed` check.
      const delta = before.hallucinationPressureScore - after.hallucinationPressureScore;
      const passed = !after.hardBlocked && after.hallucinationPressureScore <= 50;
      return {
        zone, sectionId: edit.sectionId, delta,
        passed,
        detail: `hallucination pressure ${before.hallucinationPressureScore} → ${after.hallucinationPressureScore} (Δ${delta >= 0 ? '+' : ''}${delta}; ${passed ? 'within ceiling' : 'over ceiling'}).`,
      };
    }
    case 'citation': {
      // Re-extract claims and check citation marker count proxy.
      const beforeMarkerCount = countCitationMarkers(edit.beforeHtml);
      const afterMarkerCount = countCitationMarkers(edit.afterHtml);
      const delta = afterMarkerCount - beforeMarkerCount;
      return {
        zone, sectionId: edit.sectionId, delta,
        passed: afterMarkerCount >= Math.floor(beforeMarkerCount * 0.7),
        detail: `citation markers ${beforeMarkerCount} → ${afterMarkerCount} (Δ${delta >= 0 ? '+' : ''}${delta}).`,
      };
    }
    case 'grounded': {
      // Approximation: claim count + citation markers serve as a grounding proxy here.
      // (Full grounded re-run requires the RetrievalGroundingProfile and lives in the orchestrator.)
      const beforeClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.beforeHtml }).length;
      const afterClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.afterHtml }).length;
      const delta = afterClaims - beforeClaims;
      return {
        zone, sectionId: edit.sectionId, delta,
        passed: Math.abs(delta) <= Math.max(2, Math.floor(beforeClaims * 0.25)),
        detail: `claim count ${beforeClaims} → ${afterClaims} (Δ${delta >= 0 ? '+' : ''}${delta}; ±25% drift tolerated).`,
      };
    }
    case 'operational_realism': {
      const beforeClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.beforeHtml });
      const afterClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.afterHtml });
      const before = validateOperationalProof({ sectionText: edit.beforeHtml, contract, claims: beforeClaims });
      const after = validateOperationalProof({ sectionText: edit.afterHtml, contract, claims: afterClaims });
      const delta = after.realismScore - before.realismScore;
      return {
        zone, sectionId: edit.sectionId, delta,
        passed: after.realismScore >= 50,
        detail: `operational realism ${before.realismScore} → ${after.realismScore} (Δ${delta >= 0 ? '+' : ''}${delta}).`,
      };
    }
  }
}

function countCitationMarkers(html: string): number {
  const re = /\b(according to|as reported by|cited by|in our (?:experience|deployments?|practice))\b|\[\d+\]/gi;
  return (html.match(re) ?? []).length;
}
