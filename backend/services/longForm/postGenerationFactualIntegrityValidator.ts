/**
 * Phase 9 — Post-generation factual integrity validator.
 *
 * Runs across the ASSEMBLED article using per-section results aggregated
 * from upstream factual modules. Produces a 7-dimension score + integrity
 * band + structured unsupported-claims list.
 *
 * Bands:
 *   < 35  → critical
 *   35–54 → high
 *   55–74 → moderate
 *   75–89 → low
 *   ≥ 90  → minimal
 *
 * The hallucinationRiskBand is computed from the inverse of the
 * hallucination-related dimensions.
 */

import type {
  AuthorityInflationResult,
  ClaimEvidenceProfile,
  ExtractedClaim,
  HallucinationRiskBand,
  HallucinationSuppressionResult,
  OperationalProofValidationResult,
  PostGenerationFactualResult,
  SpeculativeLanguageResult,
  TrustCalibrationResult,
  UnsupportedClaim,
  UnsupportedClaimAction,
} from './longFormRecommendationTypes';

const WEIGHTS = {
  unsupportedFactualDensity: 0.18,
  hallucinationDensity: 0.20,
  evidenceCoverage: 0.12,
  speculativeLanguageCompliance: 0.10,
  authorityCalibration: 0.12,
  operationalRealism: 0.16,
  unverifiableAssertionPressure: 0.12,
} as const;

const FLOORS = {
  unsupportedFactualDensity: 60,
  hallucinationDensity: 65,
  evidenceCoverage: 55,
  speculativeLanguageCompliance: 60,
  authorityCalibration: 55,
  operationalRealism: 60,
  unverifiableAssertionPressure: 60,
} as const;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function hallucinationBand(hallucinationDensity: number, criticalCount: number): HallucinationRiskBand {
  if (criticalCount >= 1) return 'critical';
  if (hallucinationDensity < 35) return 'critical';
  if (hallucinationDensity < 55) return 'high';
  if (hallucinationDensity < 75) return 'moderate';
  if (hallucinationDensity < 90) return 'low';
  return 'minimal';
}

function recommendedActionForProfile(profile: ClaimEvidenceProfile): UnsupportedClaimAction {
  if (profile.classification === 'high_risk_factual_claim') return 'cite';
  if (profile.classification === 'unverifiable_assertion_risk') return 'remove';
  if (profile.classification === 'requires_verification') return 'rewrite';
  if (profile.classification === 'should_be_qualified') return 'soften';
  return 'soften';
}

export interface SectionFactualSnapshot {
  sourceSectionId: string;
  claims: ExtractedClaim[];
  profiles: ClaimEvidenceProfile[];
  hallucination: HallucinationSuppressionResult;
  authority: AuthorityInflationResult;
  operational: OperationalProofValidationResult;
  speculative: SpeculativeLanguageResult;
  trust: TrustCalibrationResult;
}

export interface ValidateFactualIntegrityInput {
  sectionSnapshots: SectionFactualSnapshot[];
  /** Optional: per-recommendation context for richer reasoning (currently unused). */
}

export function validatePostGenerationFactualIntegrity(
  input: ValidateFactualIntegrityInput,
): PostGenerationFactualResult {
  const snapshots = input.sectionSnapshots;

  // Collect aggregates.
  const allClaims = snapshots.flatMap((s) => s.claims);
  const allProfiles = snapshots.flatMap((s) => s.profiles);
  const profileById = new Map(allProfiles.map((p) => [p.claimId, p]));
  const hallucinationPressures = snapshots.map((s) => s.hallucination.hallucinationPressureScore);
  const authorityInflations = snapshots.map((s) => s.authority.authorityInflationScore);
  const realismScores = snapshots.map((s) => s.operational.realismScore);
  const speculativeCompliance = snapshots.map((s) => s.speculative.speculativeComplianceScore);
  const criticalHallucinationCount = snapshots.reduce(
    (sum, s) => sum + s.hallucination.hallucinationDetections.filter((d) => d.severity === 'critical').length,
    0,
  );

  // unsupportedFactualDensity (inverted) — claim mix in high-risk classifications.
  const highRiskClaimRatio = allClaims.length === 0
    ? 0
    : allProfiles.filter((p) =>
        p.classification === 'high_risk_factual_claim'
        || p.classification === 'unverifiable_assertion_risk'
        || p.classification === 'requires_verification',
      ).length / allClaims.length;
  // Adjust for attribution coverage — attributed high-risk claims don't count.
  const attributedShare = allProfiles.length === 0
    ? 0
    : allProfiles.filter((p) => p.reasonFlags.includes('has attribution marker')).length / allProfiles.length;
  const unsupportedFactualDensity = clamp100(100 - (highRiskClaimRatio * 100) + attributedShare * 20);

  // hallucinationDensity (inverted) — average hallucination pressure across sections.
  const avgHallucinationPressure = average(hallucinationPressures);
  const hallucinationDensity = clamp100(100 - avgHallucinationPressure - criticalHallucinationCount * 12);

  // evidenceCoverage — how well claims that NEED attribution actually have it.
  const claimsNeedingAttribution = allProfiles.filter(
    (p) => p.verificationNecessity === 'required' || p.verificationNecessity === 'critical',
  );
  const claimsWithAttribution = claimsNeedingAttribution.filter((p) => p.reasonFlags.includes('has attribution marker'));
  const evidenceCoverage = clamp100(
    claimsNeedingAttribution.length === 0
      ? 90
      : (claimsWithAttribution.length / claimsNeedingAttribution.length) * 100,
  );

  // speculativeLanguageCompliance — average across sections.
  const speculativeLanguageCompliance = clamp100(average(speculativeCompliance));

  // authorityCalibration (inverted authority inflation, capped).
  const authorityCalibration = clamp100(100 - average(authorityInflations));

  // operationalRealism — average.
  const operationalRealism = clamp100(average(realismScores));

  // unverifiableAssertionPressure (inverted) — share of unverifiable_assertion_risk claims.
  const unverifiableShare = allProfiles.length === 0
    ? 0
    : allProfiles.filter((p) => p.classification === 'unverifiable_assertion_risk').length / allProfiles.length;
  const unverifiableAssertionPressure = clamp100(100 - unverifiableShare * 100);

  const dimensionScores = {
    unsupportedFactualDensity,
    hallucinationDensity,
    evidenceCoverage,
    speculativeLanguageCompliance,
    authorityCalibration,
    operationalRealism,
    unverifiableAssertionPressure,
  };

  let weighted = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    weighted += dimensionScores[k] * WEIGHTS[k];
  });
  const factualIntegrityScore = clamp100(weighted);

  // Unsupported claims list — emit anything classified as high-risk / unverifiable
  // that lacks attribution.
  const unsupportedClaims: UnsupportedClaim[] = [];
  for (const claim of allClaims) {
    const profile = profileById.get(claim.claimId);
    if (!profile) continue;
    if (
      (profile.classification === 'high_risk_factual_claim'
        || profile.classification === 'unverifiable_assertion_risk')
      && !profile.reasonFlags.includes('has attribution marker')
    ) {
      unsupportedClaims.push({
        claimId: claim.claimId,
        claimText: claim.claimText.slice(0, 200),
        reason: profile.reasonFlags.join('; '),
        recommendedAction: recommendedActionForProfile(profile),
      });
    }
  }

  const evidenceWarnings: string[] = [];
  if (evidenceCoverage < FLOORS.evidenceCoverage) {
    evidenceWarnings.push(`Evidence coverage ${evidenceCoverage}/${FLOORS.evidenceCoverage} — too many required-attribution claims lack a citation marker.`);
  }
  if (unsupportedClaims.length > 0) {
    evidenceWarnings.push(`${unsupportedClaims.length} unsupported claim(s) require remediation (soften / remove / rewrite / cite).`);
  }
  if (criticalHallucinationCount > 0) {
    evidenceWarnings.push(`${criticalHallucinationCount} critical hallucination detection(s) present.`);
  }

  const trustCalibrationWarnings = snapshots.flatMap((s) => s.trust.warnings).slice(0, 8);

  return {
    factualIntegrityScore,
    hallucinationRiskBand: hallucinationBand(hallucinationDensity, criticalHallucinationCount),
    dimensionScores,
    unsupportedClaims,
    evidenceWarnings,
    trustCalibrationWarnings,
  };
}

export { FLOORS as POST_GENERATION_FACTUAL_FLOORS };
