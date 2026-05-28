/**
 * Phase 2 — Evidence classification layer.
 *
 * For each ExtractedClaim, decide its evidence classification + how badly it
 * needs verification + how likely it is to be hallucinated. The result is
 * the per-claim risk profile the hallucination governor + recovery planner
 * read from.
 *
 * Deterministic; no LLM.
 */

import type {
  ClaimEvidenceProfile,
  ClaimType,
  EvidenceClassification,
  ExtractedClaim,
  SectionGenerationContract,
  VerificationNecessity,
} from './longFormRecommendationTypes';

const EVIDENCE_ATTRIBUTION_MARKERS = [
  /\b(according to|per\b|as reported by|cited by|from a study by|in a (?:study|report|paper) by)\b/i,
  /\b(in our (?:experience|deployment|practice|customer base))\b/i,
];

const NAMED_ENTITY_HINT = /\b[A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+)*\b/;
const CONTAINS_QUOTE = /["“][^"”]{8,}["”]/;

function hasAttribution(text: string): boolean {
  return EVIDENCE_ATTRIBUTION_MARKERS.some((re) => re.test(text));
}

function mentionsCompanyContext(text: string, contract: SectionGenerationContract): boolean {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const cap = contract.capabilityEmphasis.primaryCapability.toLowerCase();
  if (cap) tokens.push(cap.slice(0, 40));
  for (const t of contract.terminologyEmphasis.domainVocabulary) tokens.push(t.toLowerCase());
  if (contract.icpFraming.market) tokens.push(contract.icpFraming.market.toLowerCase());
  for (const icp of contract.icpFraming.icps) tokens.push(icp.toLowerCase());
  return tokens.some((t) => t && lower.includes(t));
}

interface ClassificationRule {
  classification: EvidenceClassification;
  verificationNecessity: VerificationNecessity;
  baseEvidenceRisk: number;
  baseHallucinationRisk: number;
  reasonFlag: string;
}

const RULES: Record<ClaimType, ClassificationRule> = {
  statistic: {
    classification: 'high_risk_factual_claim',
    verificationNecessity: 'critical',
    baseEvidenceRisk: 90,
    baseHallucinationRisk: 88,
    reasonFlag: 'numeric statistic requires verifiable source',
  },
  benchmark_comparison: {
    classification: 'high_risk_factual_claim',
    verificationNecessity: 'critical',
    baseEvidenceRisk: 85,
    baseHallucinationRisk: 82,
    reasonFlag: 'comparison/benchmark requires verifiable basis',
  },
  market_statement: {
    classification: 'requires_verification',
    verificationNecessity: 'required',
    baseEvidenceRisk: 60,
    baseHallucinationRisk: 55,
    reasonFlag: 'market-scope statement requires attribution',
  },
  historical_statement: {
    classification: 'requires_verification',
    verificationNecessity: 'required',
    baseEvidenceRisk: 55,
    baseHallucinationRisk: 50,
    reasonFlag: 'historical statement requires attribution',
  },
  factual_claim: {
    classification: 'requires_verification',
    verificationNecessity: 'required',
    baseEvidenceRisk: 55,
    baseHallucinationRisk: 50,
    reasonFlag: 'declarative factual claim needs evidence',
  },
  product_capability_claim: {
    classification: 'should_be_qualified',
    verificationNecessity: 'recommended',
    baseEvidenceRisk: 40,
    baseHallucinationRisk: 30,
    reasonFlag: 'capability assertion should be qualified',
  },
  operational_assertion: {
    classification: 'operational_inference',
    verificationNecessity: 'recommended',
    baseEvidenceRisk: 35,
    baseHallucinationRisk: 25,
    reasonFlag: 'operational claim must remain plausible',
  },
  strategic_recommendation: {
    classification: 'safe_opinion',
    verificationNecessity: 'optional',
    baseEvidenceRisk: 20,
    baseHallucinationRisk: 15,
    reasonFlag: 'strategic recommendation is opinion territory',
  },
  speculative_statement: {
    classification: 'safe_opinion',
    verificationNecessity: 'optional',
    baseEvidenceRisk: 10,
    baseHallucinationRisk: 8,
    reasonFlag: 'speculative phrasing inherently calibrated',
  },
  opinionated_interpretation: {
    classification: 'safe_opinion',
    verificationNecessity: 'optional',
    baseEvidenceRisk: 12,
    baseHallucinationRisk: 10,
    reasonFlag: 'opinion explicitly framed as opinion',
  },
};

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface ClassifyClaimsInput {
  claims: ExtractedClaim[];
  contract: SectionGenerationContract;
}

export function classifyClaimEvidence(input: ClassifyClaimsInput): ClaimEvidenceProfile[] {
  return input.claims.map((claim) => {
    const rule = RULES[claim.claimType];
    let evidenceRisk = rule.baseEvidenceRisk;
    let hallucinationRisk = rule.baseHallucinationRisk;
    const reasons: string[] = [rule.reasonFlag];

    // Attribution lowers both risks substantially.
    if (hasAttribution(claim.claimText)) {
      evidenceRisk -= 30;
      hallucinationRisk -= 35;
      reasons.push('has attribution marker');
    }

    // Direct quote suggests attribution to a real speaker (still risky if fabricated).
    if (CONTAINS_QUOTE.test(claim.claimText)) {
      evidenceRisk -= 10;
      hallucinationRisk += 10; // quotes are higher hallucination risk when not attributed
      reasons.push('contains quoted material');
    }

    // Company-context anchoring lowers operational/product hallucination risk.
    if ((claim.claimType === 'operational_assertion' || claim.claimType === 'product_capability_claim')
        && mentionsCompanyContext(claim.claimText, input.contract)) {
      hallucinationRisk -= 15;
      reasons.push('anchored to company-context terminology');
    }

    // High confidence on a factual claim without attribution increases risk.
    if (claim.confidenceHint === 'high'
        && (claim.claimType === 'factual_claim' || claim.claimType === 'statistic' || claim.claimType === 'benchmark_comparison')
        && !hasAttribution(claim.claimText)) {
      evidenceRisk += 10;
      hallucinationRisk += 15;
      reasons.push('high-confidence factual claim without attribution');
    }

    // Low confidence (already-hedged) lowers risk.
    if (claim.confidenceHint === 'low') {
      evidenceRisk -= 10;
      hallucinationRisk -= 10;
      reasons.push('hedged language present');
    }

    // Capability-anchored named-entity claims are slightly safer.
    if (NAMED_ENTITY_HINT.test(claim.claimText) && claim.claimType === 'operational_assertion') {
      hallucinationRisk -= 5;
    }

    // Re-classify into unverifiable_assertion_risk when high risk + factual + no attribution.
    let classification = rule.classification;
    if (rule.classification === 'requires_verification'
        && hallucinationRisk >= 70
        && !hasAttribution(claim.claimText)) {
      classification = 'unverifiable_assertion_risk';
      reasons.push('promoted to unverifiable_assertion_risk');
    }

    return {
      claimId: claim.claimId,
      classification,
      evidenceRiskScore: clamp100(evidenceRisk),
      verificationNecessity: rule.verificationNecessity,
      hallucinationRiskScore: clamp100(hallucinationRisk),
      reasonFlags: reasons,
    };
  });
}

export function profileByClaimId(profiles: ClaimEvidenceProfile[]): Map<string, ClaimEvidenceProfile> {
  const map = new Map<string, ClaimEvidenceProfile>();
  for (const p of profiles) map.set(p.claimId, p);
  return map;
}
