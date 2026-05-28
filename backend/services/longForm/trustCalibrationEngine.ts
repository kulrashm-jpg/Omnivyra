/**
 * Phase 7 — Trust calibration engine.
 *
 * Reads upstream results (claims, evidence profiles, authority inflation,
 * operational proof realism, hallucination pressure) and produces three
 * scores:
 *
 *   trustworthinessScore       — composite read on whether a reader would
 *                                trust this section.
 *   confidenceCalibrationScore — how well language confidence MATCHES claim
 *                                certainty (100 = well-calibrated).
 *   realismScore               — passthrough/blend of operational realism.
 *
 * Plus signal breakdown (authority/confidence/humility/uncertainty/operational).
 *
 * Calibration intuition: a section with many high-risk claims should
 * proportionally have more hedge language. If it doesn't, the calibration
 * score drops even if individual checks pass.
 */

import type {
  AuthorityInflationResult,
  ClaimEvidenceProfile,
  ExtractedClaim,
  HallucinationSuppressionResult,
  OperationalProofValidationResult,
  TrustCalibrationResult,
} from './longFormRecommendationTypes';

const HEDGE_WORDS = [
  'may','might','could','often','typically','usually','generally',
  'in most cases','in many cases','depending on','tends to','appears to',
  'in our experience','in our deployments','frequently','commonly',
];

const HUMILITY_MARKERS = [
  'in our experience','your mileage may vary','this depends on','context matters',
  'one approach','one possibility','if your team','for many teams','this won\'t fit every team',
];

const UNCERTAINTY_MARKERS = [
  'uncertain','it is unclear','not always','not guaranteed','no silver bullet',
  'trade-off','depending on','there is no single right answer',
];

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function countMatches(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const t of terms) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lower.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

export interface CalibrateTrustInput {
  sectionText: string;
  claims: ExtractedClaim[];
  profiles: ClaimEvidenceProfile[];
  hallucination: HallucinationSuppressionResult;
  authority: AuthorityInflationResult;
  operational: OperationalProofValidationResult;
}

export function calibrateTrust(input: CalibrateTrustInput): TrustCalibrationResult {
  const plain = stripHtml(input.sectionText);
  const textLength = Math.max(plain.length, 1);

  const hedgeCount = countMatches(plain, HEDGE_WORDS);
  const humilityCount = countMatches(plain, HUMILITY_MARKERS);
  const uncertaintyCount = countMatches(plain, UNCERTAINTY_MARKERS);

  // Per-1000-character normalization so longer sections aren't unfairly rewarded.
  const per1000 = (count: number) => count / Math.max(textLength / 1000, 1);

  // Signals (0–100):
  // authority = 100 - authorityInflationScore (lower inflation → higher authority)
  const authority = clamp100(100 - input.authority.authorityInflationScore);

  // confidence = blend of high-confidence claim ratio (capped) — too low or too high is bad.
  const highConfidenceClaims = input.claims.filter((c) => c.confidenceHint === 'high').length;
  const claimCount = input.claims.length || 1;
  const highConfidenceRatio = highConfidenceClaims / claimCount;
  // Healthy band: 0.30 – 0.65. Outside that → penalty.
  const confidenceBandFit = (() => {
    if (highConfidenceRatio < 0.15) return 55; // too tentative
    if (highConfidenceRatio < 0.30) return 75;
    if (highConfidenceRatio <= 0.65) return 95;
    if (highConfidenceRatio <= 0.80) return 70;
    return 45; // overconfident
  })();
  const confidence = clamp100(confidenceBandFit);

  // humility = density of humility markers (capped at 1 per 1000 chars = full marks).
  const humility = clamp100(Math.min(100, per1000(humilityCount) * 100));

  // uncertainty = density of uncertainty markers; some uncertainty is good.
  const uncertainty = clamp100(Math.min(100, per1000(uncertaintyCount) * 120));

  // operationalRealism = passthrough.
  const operationalRealism = input.operational.realismScore;

  // Calibration score: hedge frequency vs. count of high-risk claims.
  const highRiskClaimCount = input.profiles.filter((p) =>
    p.classification === 'high_risk_factual_claim'
    || p.classification === 'requires_verification'
    || p.classification === 'unverifiable_assertion_risk',
  ).length;
  const hedgeDensity = per1000(hedgeCount);
  const requiredHedgeDensity = Math.max(0.5, highRiskClaimCount * 0.4);
  // If we have lots of high-risk claims but no hedges, calibration tanks.
  const hedgeShortfall = Math.max(0, requiredHedgeDensity - hedgeDensity);
  const confidenceCalibrationScore = clamp100(
    100 - hedgeShortfall * 15 - input.hallucination.hallucinationPressureScore * 0.3,
  );

  // Trustworthiness: weighted blend.
  const trustworthinessScore = clamp100(
    authority * 0.20
    + confidence * 0.18
    + humility * 0.15
    + uncertainty * 0.10
    + operationalRealism * 0.22
    + (100 - input.hallucination.hallucinationPressureScore) * 0.15,
  );

  const warnings: string[] = [];
  if (hedgeShortfall > 1) warnings.push(`Hedge shortfall: ${hedgeShortfall.toFixed(1)} per 1000 chars. Section asserts high-risk claims without proportional hedging.`);
  if (authority < 60) warnings.push('Authority inflation reduces trust (see authorityInflationDetector output).');
  if (confidenceBandFit < 60) warnings.push(`Confidence band is ${highConfidenceRatio < 0.30 ? 'too tentative' : 'too overconfident'} (${(highConfidenceRatio * 100).toFixed(0)}% high-confidence claims).`);
  if (humility === 0) warnings.push('Section has zero humility markers — consider adding "in our experience" or "depending on" language.');
  if (input.hallucination.hardBlocked) warnings.push('Hallucination governor hard-blocked this section — trust score should be treated as floor.');

  return {
    trustworthinessScore,
    confidenceCalibrationScore,
    realismScore: clamp100(operationalRealism),
    signals: { authority, confidence, humility, uncertainty, operationalRealism: clamp100(operationalRealism) },
    warnings,
  };
}
