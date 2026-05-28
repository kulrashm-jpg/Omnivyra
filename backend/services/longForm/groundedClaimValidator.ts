/**
 * groundedClaimValidator.ts
 *
 * Phase 4.4 — Grounded claim enforcement.
 *
 * The factual layer already detects authority inflation, operational
 * fabrication, hallucination patterns, and speculative-language drift.
 * What it does NOT do well: enforce that specific high-risk claim types
 * (statistics, comparisons, named frameworks, named customer examples,
 * "evidence" appeals) actually trace to an approved grounding source.
 *
 * This module is the gate that closes that loop. It works in two modes:
 *   - WITHOUT a grounding profile → treat any unsupported high-risk
 *     claim as `unsupported` and recommend softening or removal.
 *   - WITH a grounding profile  → check the claim text against
 *     approved-source fragments (deterministic keyword overlap) and
 *     mark `grounded` when match score clears threshold.
 *
 * No LLM calls. No embeddings.
 */

import type {
  ExtractedClaim,
  RetrievalGroundingProfile,
  KnowledgeSourceFragment,
} from './longFormRecommendationTypes';
// Phase 5.2 — Semantic fallback for paraphrased / concept-level evidence.
import {
  encodeGroundingProfile,
  matchClaimToGroundingFragments,
  type EncodedFragment,
} from './semanticGroundingEngine';

// ── Public types ─────────────────────────────────────────────────────────────

export type GroundedClaimAction =
  | 'accept'           // grounded or low-risk — keep as-is
  | 'soften_hedge'     // add hedging language ("in our experience", "typically")
  | 'soften_to_opinion'// convert to opinion-framed sentence
  | 'remove'           // strike the claim from the section
  | 'regenerate_section'; // section needs structural rewrite

export type ClaimGroundingStatus =
  | 'grounded'
  | 'partial_match'
  | 'unsupported'
  | 'fabricated_specificity'
  | 'fake_metric'
  | 'unsupported_comparison'
  | 'invented_framework'
  | 'invented_evidence_appeal'
  | 'invented_customer_example';

export interface ClaimVerdict {
  claimId: string;
  text: string;
  status: ClaimGroundingStatus;
  supportingSourceIds: string[];
  matchScore: number;
  action: GroundedClaimAction;
  reason: string;
}

export interface GroundedClaimValidationResult {
  groundedClaims: ClaimVerdict[];
  unsupportedClaims: ClaimVerdict[];
  hallucinationRisk: number;            // 0-100 — section-level aggregate
  fabricatedSpecificityRisk: number;    // 0-100
  evidenceCoverage: number;             // 0-100 — share of high-risk claims that are grounded
  verdict: 'pass' | 'soften' | 'retry' | 'fail';
  selectiveRetryNeeded: boolean;
  softeningTargets: Array<{ claimId: string; from: string; action: GroundedClaimAction }>;
}

export interface ValidateGroundedClaimsInput {
  sectionText: string;
  sectionContractId: string;
  claims: ExtractedClaim[];
  groundingProfile?: RetrievalGroundingProfile | null;
  /** When true, treat ANY unsupported high-risk claim as fail rather than soften. */
  strictMode?: boolean;
}

// ── Fabrication pattern markers ──────────────────────────────────────────────

// "Fabricated specificity" — text presents itself with high specificity
// (numbers, named entities, comparative percentages) without any grounding.
const FAKE_METRIC_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\.\d+)?\s*%\s+(?:faster|cheaper|more|less|of (?:teams|companies|organizations|users))\b/i,
  /\b\d+x\s+(?:faster|better|higher|lower)\b/i,
  /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:k|m|million|billion)?\s+(?:in|per|of)\s+/i,
  /\b(?:save|saved|saving)\s+(?:up to\s+)?\d+%?\b/i,
];

const FAKE_RESEARCH_PATTERNS: RegExp[] = [
  /\b(?:gartner|forrester|mckinsey|deloitte|pwc|kpmg)\s+(?:reports?|study|analysis|estimates)\b/i,
  /\b(?:a recent|recent)\s+(?:study|survey|report|analysis)\s+(?:found|shows?|revealed?|indicates?)\b/i,
  /\baccording to\s+(?:research|industry data|recent reports)\b(?!.{0,80}(?:we|our|the company))/i,
];

const FAKE_CUSTOMER_PATTERNS: RegExp[] = [
  /\b(?:[A-Z][a-z]+ )?(?:Corp|Inc|Industries|Labs|Tech|Systems|Solutions|Group|Partners|Holdings)\s+(?:saved|increased|reduced|grew|achieved)\s+/,
  /\bone of our customers\b/i,
  /\ba leading\s+(?:bank|retailer|insurer|enterprise|hospital|airline)\s+(?:reduced|achieved|saved)\b/i,
];

const INVENTED_FRAMEWORK_PATTERNS: RegExp[] = [
  /\bthe\s+(?:\d+)\s*(?:-step|-phase|-pillar)?\s*(?:framework|method|model|system)\s+(?:of|for|to)\b/i,
  /\bour proprietary\s+(?:framework|method|model)\b/i,
];

const UNSUPPORTED_COMPARISON_PATTERNS: RegExp[] = [
  /\bcompared (?:with|to)\s+(?:competitors|alternatives|industry average|the market)\b/i,
  /\boutperforms?\s+(?:competitors|alternatives|industry|market)\s+by\s+\d+%/i,
];

const INVENTED_EVIDENCE_APPEAL_PATTERNS: RegExp[] = [
  /\b(?:studies|research|experts)\s+(?:show|agree|confirm|prove)\b(?!.{0,60}(?:we|our|the company))/i,
  /\bit is well[-\s]?(?:known|documented|established)\b/i,
  /\bevidence (?:shows?|suggests?|indicates?)\b(?!.{0,80}from)/i,
];

// "High-risk" claim types — these MUST be grounded if they are to ship.
const HIGH_RISK_EVIDENCE_LEVELS = new Set<string>(['critical', 'required']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function stableId(prefix: string, basis: string): string {
  let h = 5381;
  for (let i = 0; i < basis.length; i += 1) h = ((h << 5) + h) ^ basis.charCodeAt(i);
  return `${prefix}_${(h >>> 0).toString(16)}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

function patternMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ── Source matching (no embeddings) ──────────────────────────────────────────

interface FragmentMatch {
  fragment: KnowledgeSourceFragment;
  sourceId: string;
  matchScore: number;
}

function findBestSourceMatches(
  claimText: string,
  profile: RetrievalGroundingProfile,
  threshold: number,
): FragmentMatch[] {
  const claimTokens = tokenize(claimText);
  const matches: FragmentMatch[] = [];
  for (const source of profile.approvedSources) {
    for (const frag of source.contentFragments) {
      const score = jaccardTokens(claimTokens, tokenize(frag.text));
      if (score >= threshold) {
        matches.push({ fragment: frag, sourceId: source.sourceId, matchScore: Number(score.toFixed(3)) });
      }
    }
  }
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches.slice(0, 5);
}

// ── Pattern → fabrication classifier ─────────────────────────────────────────

function classifyFabricationPattern(text: string): ClaimGroundingStatus | null {
  if (patternMatch(text, FAKE_METRIC_PATTERNS)) return 'fake_metric';
  if (patternMatch(text, FAKE_RESEARCH_PATTERNS)) return 'invented_evidence_appeal';
  if (patternMatch(text, FAKE_CUSTOMER_PATTERNS)) return 'invented_customer_example';
  if (patternMatch(text, INVENTED_FRAMEWORK_PATTERNS)) return 'invented_framework';
  if (patternMatch(text, UNSUPPORTED_COMPARISON_PATTERNS)) return 'unsupported_comparison';
  if (patternMatch(text, INVENTED_EVIDENCE_APPEAL_PATTERNS)) return 'invented_evidence_appeal';
  return null;
}

function statusToAction(status: ClaimGroundingStatus, strict: boolean): GroundedClaimAction {
  switch (status) {
    case 'grounded': return 'accept';
    case 'partial_match': return strict ? 'soften_hedge' : 'accept';
    case 'unsupported': return strict ? 'remove' : 'soften_hedge';
    case 'fabricated_specificity':
    case 'fake_metric':
    case 'unsupported_comparison':
    case 'invented_customer_example':
      return strict ? 'remove' : 'soften_to_opinion';
    case 'invented_framework':
      return 'soften_to_opinion';
    case 'invented_evidence_appeal':
      return strict ? 'remove' : 'soften_hedge';
  }
}

// ── Main validator ──────────────────────────────────────────────────────────

const STRONG_MATCH_THRESHOLD = 0.22;
const PARTIAL_MATCH_THRESHOLD = 0.10;

export function validateGroundedClaims(
  input: ValidateGroundedClaimsInput,
): GroundedClaimValidationResult {
  const strictMode = Boolean(input.strictMode);
  const groundedClaims: ClaimVerdict[] = [];
  const unsupportedClaims: ClaimVerdict[] = [];
  const softeningTargets: GroundedClaimValidationResult['softeningTargets'] = [];

  let highRiskCount = 0;
  let highRiskGroundedCount = 0;
  let fabricationFlags = 0;
  let hallucinationFlags = 0;

  for (const claim of input.claims) {
    const text = claim.claimText ?? '';
    if (!text || text.length < 12) continue;

    const isHighRisk = HIGH_RISK_EVIDENCE_LEVELS.has(claim.evidenceRequirementLevel ?? '');
    if (isHighRisk) highRiskCount += 1;

    // Step 1: pattern-based fabrication detection runs FIRST. A claim that
    // matches a fabrication pattern is dispatched immediately without
    // bothering with grounding lookup.
    const fabricationStatus = classifyFabricationPattern(text);
    if (fabricationStatus) {
      fabricationFlags += 1;
      if (fabricationStatus === 'invented_evidence_appeal' || fabricationStatus === 'invented_customer_example' || fabricationStatus === 'fake_metric') {
        hallucinationFlags += 1;
      }
      const action = statusToAction(fabricationStatus, strictMode);
      const verdict: ClaimVerdict = {
        claimId: claim.claimId ?? stableId('clm', text),
        text,
        status: fabricationStatus,
        supportingSourceIds: [],
        matchScore: 0,
        action,
        reason: `Fabrication pattern matched (${fabricationStatus}).`,
      };
      unsupportedClaims.push(verdict);
      if (action !== 'accept') {
        softeningTargets.push({ claimId: verdict.claimId, from: text.slice(0, 80), action });
      }
      continue;
    }

    // Step 2: try to ground the claim against approved sources.
    //
    // Phase 5.2 fallback hierarchy:
    //   (a) SEMANTIC grounding (pseudo-embedding cosine) — catches
    //       paraphrased evidence
    //   (b) TOKEN OVERLAP grounding (original Jaccard) — fallback for
    //       short claims where the semantic vector is sparse
    //   (c) PATTERN-ONLY fallback — when no profile is supplied or both
    //       above produce no match
    let status: ClaimGroundingStatus = 'unsupported';
    let supportingSourceIds: string[] = [];
    let matchScore = 0;

    if (input.groundingProfile && input.groundingProfile.approvedSources.length > 0) {
      // (a) Semantic first.
      const encodedFragments: EncodedFragment[] = encodeGroundingProfile(input.groundingProfile);
      const semantic = matchClaimToGroundingFragments({
        claimText: text,
        fragments: encodedFragments,
        topK: 5,
      });
      const supportingSemantic = semantic.filter((m) => !m.numericDivergence && !m.polarityConflict);
      if (supportingSemantic.length > 0) {
        const top = supportingSemantic[0];
        matchScore = top.similarity;
        supportingSourceIds = Array.from(new Set(supportingSemantic.map((m) => m.fragment.sourceId).filter((id): id is string => !!id)));
        if (top.matchKind === 'strong') {
          status = 'grounded';
          if (isHighRisk) highRiskGroundedCount += 1;
        } else if (top.matchKind === 'moderate') {
          status = 'grounded';
          if (isHighRisk) highRiskGroundedCount += 1;
        } else {
          status = 'partial_match';
        }
      } else {
        // (b) Token overlap fallback.
        const matches = findBestSourceMatches(text, input.groundingProfile, PARTIAL_MATCH_THRESHOLD);
        if (matches.length > 0) {
          matchScore = matches[0].matchScore;
          supportingSourceIds = Array.from(new Set(matches.map((m) => m.sourceId)));
          if (matchScore >= STRONG_MATCH_THRESHOLD) {
            status = 'grounded';
            if (isHighRisk) highRiskGroundedCount += 1;
          } else {
            status = 'partial_match';
          }
        }
      }
    }
    // (c) PATTERN-ONLY fallback — status remains 'unsupported' when no
    // profile / no semantic / no token match; downstream action computation
    // takes over.

    // For low-risk claims (e.g. opinionated, speculative) we don't gate on
    // grounding — accept silently.
    if (!isHighRisk && status === 'unsupported') {
      status = 'partial_match'; // treat as not-failing
    }

    const action = statusToAction(status, strictMode);
    const verdict: ClaimVerdict = {
      claimId: claim.claimId ?? stableId('clm', text),
      text,
      status,
      supportingSourceIds,
      matchScore,
      action,
      reason: status === 'grounded'
        ? `Grounded with score ${matchScore} against source(s) ${supportingSourceIds.join(', ')}.`
        : status === 'partial_match'
          ? `Partial match (score ${matchScore}); ${strictMode ? 'soften required.' : 'acceptable.'}`
          : 'No matching approved source found.',
    };

    if (status === 'grounded') {
      groundedClaims.push(verdict);
    } else {
      if (status === 'unsupported' && isHighRisk) hallucinationFlags += 1;
      unsupportedClaims.push(verdict);
      if (action !== 'accept') {
        softeningTargets.push({ claimId: verdict.claimId, from: text.slice(0, 80), action });
      }
    }
  }

  const totalClaims = groundedClaims.length + unsupportedClaims.length;
  const hallucinationRisk = totalClaims === 0
    ? 0
    : Math.min(100, Math.round((hallucinationFlags / Math.max(1, totalClaims)) * 100));
  const fabricatedSpecificityRisk = totalClaims === 0
    ? 0
    : Math.min(100, Math.round((fabricationFlags / Math.max(1, totalClaims)) * 100));
  const evidenceCoverage = highRiskCount === 0
    ? 100
    : Math.round((highRiskGroundedCount / highRiskCount) * 100);

  // Verdict math:
  //   - pass: no fabrication, no high-risk unsupported claims
  //   - soften: only mild unsupported claims (action = soften_*)
  //   - retry: fabrication-pattern flags ≥ 2 OR evidenceCoverage < 40
  //   - fail: fabrication-pattern flags ≥ 5 OR action = regenerate_section
  let verdict: GroundedClaimValidationResult['verdict'];
  const regenerateCount = softeningTargets.filter((t) => t.action === 'regenerate_section').length;
  if (regenerateCount > 0 || fabricationFlags >= 5) {
    verdict = 'fail';
  } else if (fabricationFlags >= 2 || (highRiskCount > 0 && evidenceCoverage < 40)) {
    verdict = 'retry';
  } else if (softeningTargets.length > 0) {
    verdict = 'soften';
  } else {
    verdict = 'pass';
  }

  return {
    groundedClaims,
    unsupportedClaims,
    hallucinationRisk,
    fabricatedSpecificityRisk,
    evidenceCoverage,
    verdict,
    selectiveRetryNeeded: verdict === 'retry' || verdict === 'fail',
    softeningTargets,
  };
}
