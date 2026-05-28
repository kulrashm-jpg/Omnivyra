/**
 * Phase 4 — Speculative language enforcer.
 *
 * For claims whose evidence classification suggests uncertainty (or whose
 * underlying type is inherently uncertain), check that the surrounding
 * language carries calibrated hedges. Overconfident phrasing on these
 * claims is a recoverable issue (soften_certainty action).
 *
 * Three policy modes:
 *   permissive — only flag when high-confidence markers paired with critical claims.
 *   balanced   — default; flag overconfidence on any high-risk-or-uncertain claim.
 *   strict     — also flag medium-confidence claims that should be qualified.
 */

import type {
  ClaimEvidenceProfile,
  ExtractedClaim,
  SpeculativeLanguagePolicy,
  SpeculativeLanguageResult,
} from './longFormRecommendationTypes';

const HEDGE_VOCAB = [
  'may', 'might', 'could', 'often', 'in many cases', 'typically',
  'depending on', 'organizations may find', 'in our experience',
  'in some cases', 'tends to', 'appears to', 'is likely', 'frequently',
  'usually', 'generally', 'commonly', 'in most cases',
];

const OVERCONFIDENT_MARKERS = [
  /\b(definitely|certainly|absolutely|always|guaranteed|undoubtedly|without question|every single|100%|never fails|will (?:never|always))\b/i,
  /\bproven to (?:always|never)\b/i,
];

function containsHedge(text: string): boolean {
  const lower = text.toLowerCase();
  return HEDGE_VOCAB.some((h) => lower.includes(h));
}

function containsOverconfidence(text: string): boolean {
  return OVERCONFIDENT_MARKERS.some((re) => re.test(text));
}

function suggestedHedgeFor(text: string): string {
  const lower = text.toLowerCase();
  if (/\bwill\b/.test(lower)) return 'replace "will" with "may" or "often will"';
  if (/\balways\b/.test(lower)) return 'replace "always" with "typically" or "in most cases"';
  if (/\bnever\b/.test(lower)) return 'replace "never" with "rarely" or "in our experience, rarely"';
  if (/\bguaranteed\b/.test(lower)) return 'replace "guaranteed" with "consistently" or "in our deployments"';
  if (/\b100%\b/.test(lower)) return 'replace "100%" with "the overwhelming majority" or "in nearly all cases"';
  return 'add a hedge such as "may", "often", or "in many cases"';
}

export interface EnforceSpeculativeLanguageInput {
  claims: ExtractedClaim[];
  profiles: ClaimEvidenceProfile[];
  policy?: SpeculativeLanguagePolicy;
}

export function enforceSpeculativeLanguage(input: EnforceSpeculativeLanguageInput): SpeculativeLanguageResult {
  const policy = input.policy ?? 'balanced';
  const profileById = new Map(input.profiles.map((p) => [p.claimId, p]));

  const overconfidentClaims: SpeculativeLanguageResult['overconfidentClaims'] = [];

  for (const claim of input.claims) {
    const profile = profileById.get(claim.claimId);
    if (!profile) continue;

    const inherentlyUncertain =
      claim.claimType === 'speculative_statement'
      || claim.claimType === 'opinionated_interpretation'
      || claim.claimType === 'strategic_recommendation';
    const shouldQualify =
      profile.classification === 'should_be_qualified'
      || profile.classification === 'requires_verification'
      || profile.classification === 'unverifiable_assertion_risk'
      || inherentlyUncertain;

    // Permissive: only flag when overconfidence + high evidence risk.
    if (policy === 'permissive' && profile.evidenceRiskScore < 75) continue;
    if (!shouldQualify && policy !== 'strict') continue;

    if (containsOverconfidence(claim.claimText) && !containsHedge(claim.claimText)) {
      overconfidentClaims.push({
        claimId: claim.claimId,
        claimText: claim.claimText,
        detectedIssue: 'overconfident phrasing on an uncertain or unverifiable claim',
        suggestedHedge: suggestedHedgeFor(claim.claimText),
      });
      continue;
    }

    // Strict mode also flags high-confidence factual claims without hedges OR attribution.
    if (policy === 'strict'
      && claim.confidenceHint === 'high'
      && !containsHedge(claim.claimText)
      && (claim.claimType === 'factual_claim' || claim.claimType === 'product_capability_claim')) {
      overconfidentClaims.push({
        claimId: claim.claimId,
        claimText: claim.claimText,
        detectedIssue: 'high-confidence claim lacks hedge in strict policy mode',
        suggestedHedge: suggestedHedgeFor(claim.claimText),
      });
    }
  }

  // Compliance score: 100 - normalized overconfidence rate.
  const evaluatedClaimCount = input.claims.length || 1;
  const overconfidenceRate = overconfidentClaims.length / evaluatedClaimCount;
  const speculativeComplianceScore = Math.max(0, Math.min(100, Math.round((1 - overconfidenceRate * 2) * 100)));

  return { overconfidentClaims, speculativeComplianceScore, policyApplied: policy };
}
