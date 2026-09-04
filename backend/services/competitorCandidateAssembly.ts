/**
 * Canonical competitor candidate assembly.
 *
 * THE single, repository-wide entry point for turning evidence into competitor candidates.
 * Every pipeline (Company Profile refine, Report intelligence sync/active) MUST assemble its
 * candidate pool through `assembleEvidenceCompetitorCandidates` and rank the result with the
 * canonical engine (`getFinalCompetitors` / `getFinalCompetitorsSync`).
 *
 * Evidence-only by construction: stored/user/AI-extracted names, SERP-live domains, and
 * pre-built evidence candidates (manual / stored / provider / user-guided / feedback). There is
 * NO hardcoded roster, NO keyword→company map, and NO count-based padding. When evidence is thin
 * the pool is intentionally small or empty — callers surface `competitor_evidence_status` rather
 * than fabricating competitors. The knowledge base participates only through enrichment, never here.
 */
import type { CompanyProfile } from './companyProfileService';
import {
  buildCandidatesFromNames,
  dedupeCompetitorCandidates,
  domainToName,
  type CompetitorCandidate,
  type CompetitorClassification,
  type CompetitorSource,
} from './competitorEngineService';
import { applyUserGuidedCompetitorSteering } from './companyProfile/userGuidance';

/** Context used to describe SERP-discovered domains before the engine enriches them. */
export type SerpCandidateContext = {
  marketFocus?: string | null;
  businessType?: string | null;
  geography?: string | null;
  primaryService?: string | null;
  rationale?: string | null;
};

export type CompetitorEvidenceInputs = {
  /** Stored/AI-extracted competitor names grounded in the company's own profile. */
  storedNames?: string[] | null;
  /** Source tag applied to name-derived candidates (defaults to profile_ai). */
  storedNamesSource?: CompetitorSource;
  /** SERP-live discovered domains. */
  serpDomains?: string[] | null;
  serpContext?: SerpCandidateContext;
  /** Already-built evidence candidates (manual / stored / provider / feedback). */
  evidenceCandidates?: CompetitorCandidate[] | null;
  /** When provided, applies user-guided steering (pins + rejections) to the assembled pool. */
  userGuidedProfile?: CompanyProfile | null;
};

// Phase 2: `positionalClassification(index)` was removed. It assigned a competitive
// category from a candidate's position in the SERP results array — the first domain was
// a "direct competitor", the second an "seo_competitor", the rest "authority_leader" —
// with no reference to any evidence about those companies. Candidates now carry no
// classification; the ranking engine derives one from the scored tier, and
// `competitorRelationModel` derives the product/market relations from the dimensions.

/** Map SERP-discovered domains to evidence candidates. Shared by every pipeline. */
export function serpDomainsToCompetitorCandidates(
  domains: string[],
  context?: SerpCandidateContext,
): CompetitorCandidate[] {
  return domains
    .map((domain) => ({ domain, name: domainToName(domain) }))
    .filter((entry): entry is { domain: string; name: string } => Boolean(entry.name))
    .map((entry) => ({
      name: entry.name,
      domain: entry.domain,
      category: context?.marketFocus ?? context?.businessType ?? 'Search competitor',
      classification: null,
      source: 'serp_live' as const,
      rationale: context?.rationale ?? 'Discovered through SERP competitor discovery.',
      geography: context?.geography ?? null,
      productSignals: context?.primaryService ? [context.primaryService] : null,
      discoverySources: ['serp'],
    } satisfies CompetitorCandidate));
}

/**
 * Assemble the canonical evidence-only candidate pool. Pre-built evidence (manual/stored/provider)
 * and profile-name candidates lead, followed by SERP discoveries; on a name/domain collision the
 * engine's `dedupeCompetitorCandidates` keeps the higher-quality entry (not merely the first).
 */
export function assembleEvidenceCompetitorCandidates(
  inputs: CompetitorEvidenceInputs,
): CompetitorCandidate[] {
  const nameCandidates = inputs.storedNames && inputs.storedNames.length > 0
    ? buildCandidatesFromNames(inputs.storedNames, inputs.storedNamesSource ?? 'profile_ai')
    : [];
  const serpCandidates = serpDomainsToCompetitorCandidates(inputs.serpDomains ?? [], inputs.serpContext);

  const merged = dedupeCompetitorCandidates([
    ...(inputs.evidenceCandidates ?? []),
    ...nameCandidates,
    ...serpCandidates,
  ]);

  // `userGuidedProfile: undefined` = do not apply steering; `null` = apply (no guidance present).
  return 'userGuidedProfile' in inputs
    ? applyUserGuidedCompetitorSteering(inputs.userGuidedProfile ?? null, merged)
    : merged;
}

export type CompetitorEvidenceStatus = 'sufficient' | 'partial_public_data' | 'insufficient_public_data';

/**
 * Canonical evidence-status derivation. Competitors are never fabricated to hit a count, so a
 * thin/empty result is a real signal about available public data that consumers surface honestly.
 */
export function deriveCompetitorEvidenceStatus(competitorCount: number): CompetitorEvidenceStatus {
  if (competitorCount >= 3) return 'sufficient';
  if (competitorCount > 0) return 'partial_public_data';
  return 'insufficient_public_data';
}
