/**
 * COMPETITOR-TAXONOMY-P2 — Shadow scoring, run alongside the live model.
 *
 * When (and ONLY when) COMPETITOR_MULTISIGNAL_SHADOW is enabled, this observer computes the
 * multi-signal qualification for the same candidate pool the live filter just decided on,
 * and logs a comparison (live-kept vs shadow-decision) for calibration. It NEVER mutates the
 * live output and returns nothing consumed by the pipeline — the flag defaults OFF, so the
 * live decision path is byte-identical until the shadow is deliberately promoted.
 *
 * The comparison itself (`buildShadowComparison`) is pure & deterministic and is reused by
 * the calibration/validation harness.
 */

import type {
  CompanyCompetitiveContext,
  CompetitorCandidate,
  RankedCompetitor,
} from '../../competitorEngineServiceModel';
import {
  evaluateMultiSignalQualification,
  type MultiSignalQualification,
  type QualificationDecision,
  type QualificationWeightProfile,
} from './competitorQualificationModel';

/**
 * Reversible kill-switch — default OFF. When unset/`'0'`/`'false'` the observer is inert and
 * never touches the request. Set COMPETITOR_MULTISIGNAL_SHADOW=1 (or 'true'/'on') to emit
 * shadow telemetry alongside the live filter.
 */
export function competitorMultiSignalShadowEnabled(): boolean {
  const raw = (process.env.COMPETITOR_MULTISIGNAL_SHADOW ?? '').toLowerCase().trim();
  return raw === '1' || raw === 'true' || raw === 'on';
}

export interface ShadowCandidateComparison {
  name: string;
  domain: string | null;
  source: string;
  liveKept: boolean;
  shadow: MultiSignalQualification;
  /** true iff live-kept ⇔ (shadow decision is qualified/borderline). */
  agrees: boolean;
  disagreementKind: 'none' | 'shadow_adds' | 'shadow_drops';
}

export interface ShadowComparisonReport {
  total: number;
  agreements: number;
  disagreements: number;
  shadowAdds: number; // live dropped, shadow would surface
  shadowDrops: number; // live kept, shadow would suppress
  outOfCoverage: number; // candidates whose company category is out of taxonomy coverage
  comparisons: ShadowCandidateComparison[];
}

function keyOf(name: string | null | undefined, domain: string | null | undefined): string {
  return `${(domain ?? name ?? '').toString().trim().toLowerCase()}`;
}

const shadowSurfaces = (decision: QualificationDecision): boolean => decision !== 'unqualified';

/**
 * Pure comparison of the multi-signal shadow against the live decision. `liveKept` is the set
 * of candidates the current model surfaced; every candidate the pipeline considered is scored
 * by the shadow and classified as agreement / shadow-adds / shadow-drops.
 */
export function buildShadowComparison(params: {
  consideredCandidates: CompetitorCandidate[];
  liveKept: Array<Pick<RankedCompetitor, 'name' | 'domain'>>;
  context: CompanyCompetitiveContext;
  profile?: QualificationWeightProfile;
}): ShadowComparisonReport {
  const liveKeptKeys = new Set(params.liveKept.map((c) => keyOf(c.name, c.domain)));
  const comparisons: ShadowCandidateComparison[] = [];
  let agreements = 0;
  let shadowAdds = 0;
  let shadowDrops = 0;
  let outOfCoverage = 0;

  for (const candidate of params.consideredCandidates) {
    const shadow = evaluateMultiSignalQualification(candidate, params.context, params.profile);
    const liveKept = liveKeptKeys.has(keyOf(candidate.name, candidate.domain));
    const shadowKeeps = shadowSurfaces(shadow.decision);
    const agrees = liveKept === shadowKeeps;
    const disagreementKind: ShadowCandidateComparison['disagreementKind'] = agrees
      ? 'none'
      : shadowKeeps
        ? 'shadow_adds'
        : 'shadow_drops';
    if (agrees) agreements += 1;
    else if (disagreementKind === 'shadow_adds') shadowAdds += 1;
    else shadowDrops += 1;
    if (shadow.taxonomyCoverage === 'out_of_coverage') outOfCoverage += 1;
    comparisons.push({
      name: candidate.name,
      domain: candidate.domain ?? null,
      source: candidate.source,
      liveKept,
      shadow,
      agrees,
      disagreementKind,
    });
  }

  return {
    total: comparisons.length,
    agreements,
    disagreements: shadowAdds + shadowDrops,
    shadowAdds,
    shadowDrops,
    outOfCoverage,
    comparisons,
  };
}

/**
 * Flag-guarded side-effecting observer wired into the live final filter. No-op unless the
 * shadow flag is on; only reads + logs. Guarded twice (caller + here) and wrapped so a shadow
 * fault can never affect the live response.
 */
export function observeShadowQualification(params: {
  consideredCandidates: CompetitorCandidate[];
  liveKept: Array<Pick<RankedCompetitor, 'name' | 'domain'>>;
  context: CompanyCompetitiveContext;
}): void {
  if (!competitorMultiSignalShadowEnabled()) return;
  try {
    const report = buildShadowComparison(params);
    console.info('[competitor-multisignal-shadow][report]', {
      total: report.total,
      agreements: report.agreements,
      disagreements: report.disagreements,
      shadow_adds: report.shadowAdds,
      shadow_drops: report.shadowDrops,
      out_of_coverage: report.outOfCoverage,
      profile: report.comparisons[0]?.shadow.weightProfile ?? 'multisignal-v1',
      details: report.comparisons.map((c) => ({
        name: c.name,
        source: c.source,
        live_kept: c.liveKept,
        shadow_decision: c.shadow.decision,
        shadow_score: c.shadow.score,
        taxonomy_coverage: c.shadow.taxonomyCoverage,
        disagreement: c.disagreementKind,
      })),
    });
  } catch (error) {
    console.warn('[competitor-multisignal-shadow][error]', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
