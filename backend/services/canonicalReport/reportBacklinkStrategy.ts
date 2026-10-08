/**
 * BACKLINK AUTHORITY + CONTEXTUAL LINK STRATEGY — Report 1
 *
 * TWO JOBS, DELIBERATELY SEPARATE MODULES OF THOUGHT IN ONE FILE:
 *
 *   A. OBSERVATION      `summarizeBacklinkObservation` — what external authority EXISTS.
 *   B. RECOMMENDATION   `buildBacklinkStrategy`        — what external authority would be
 *                                                        strategically VALUABLE to build.
 *
 * They are separate functions with separate inputs and separate states because conflating them is
 * the defect this slice exists to prevent. The two directions of that conflation are both live
 * failure modes elsewhere in this codebase:
 *
 *   • an UNAVAILABLE provider becoming evidence that the company's backlinks are WEAK. There is no
 *     branch here that reads an absent measurement as a finding about the company. When no provider
 *     answered, the observation says so and the recommendation proceeds from CONTEXT alone.
 *   • an ABSENT measurement becoming evidence that a particular backlink TYPE is NEEDED. A
 *     recommendation's `evidenceBasis` is assembled only from inputs that are PRESENT; the
 *     observation's `unavailable` state is never pushed onto it. "We cannot see your backlinks"
 *     is not a reason to prioritise editorial coverage.
 *
 * WHAT THIS IS NOT
 *   • NOT prospect generation. It recommends backlink TYPES, never targets. There is no field on
 *     `BacklinkStrategyRecommendation` that can hold a publisher, domain, outlet or person, and the
 *     prose fields are assembled from controlled per-type phrase maps plus the caller's own context
 *     values — so a publisher name cannot be synthesised even by a later careless edit. Producing
 *     "contact these 50 sites" is Prospect Intelligence's job and is out of this report entirely.
 *   • NOT a Company Profile or ICP mutation. Like `reportMarketRecommendation`, the input is a
 *     plain value bundle rather than a service handle: a function that holds no client, no
 *     repository and no writer cannot mutate a profile, ratify an ICP or create a prospect,
 *     whatever a later edit might attempt. It performs no I/O and returns a value.
 *   • NOT a score. The nine relevance dimensions are exposed INDIVIDUALLY and are never collapsed
 *     into a numeric "backlink opportunity score" — no such scoring contract has been established.
 *     `priority` is a documented ORDINAL over those verdicts (§PRIORITY), not a number, and the
 *     verdicts that produced it always travel with it so a reader can audit the ordering.
 *
 * EVIDENCE STATES — six, and `declared` is not a weaker spelling of `observed`
 * A company telling us its positioning is not the market exhibiting demand for it. The precedent is
 * `CanonicalSocialPresenceEntry`, where a profile-supplied URL is `declared` and only a resolved
 * public result is `observed`. The same rule holds here: declared context may legitimately MOTIVATE
 * a recommendation, and is reported as `declared` forever. No branch upgrades it.
 *
 * Because declared context is first-party, this surface is a PROPOSAL and never feeds an
 * aggregation — `kind: 'proposal'` is a literal at the type level, exactly as in
 * `reportMarketRecommendation`, so no consumer can read it as a measurement or a decision.
 *
 * RELEVANCE OVER VOLUME
 * For an emerging company, relevance and credibility matter more than link count, so the taxonomy
 * contains no volume tactic: there is no directory-submission, guest-post-network, paid-link or
 * high-DR-regardless-of-fit type to recommend, because a controlled taxonomy with no such member
 * cannot emit one. A highly authoritative but irrelevant source is not treated as valuable: domain
 * authority is not an input to relevance at all.
 */
import type { EvidenceProvenanceClass } from '../evidenceProvenance';
import { isReport1Source, provenanceForSource } from '../evidenceProvenance';
import type { ConfidenceBand, EvidenceSourceKind, ScoreState } from './canonicalReportTypes';

// ── Vocabulary ────────────────────────────────────────────────────────────────

/**
 * The controlled taxonomy of backlink OPPORTUNITY TYPES. Closed on purpose: a recommendation can
 * only ever name a member of this union, which is what makes "no fabricated publisher" a
 * type-level guarantee rather than a review convention.
 */
export type BacklinkType =
  | 'topical_editorial'
  | 'industry_publication'
  | 'authoritative_reference'
  | 'research_data_citation'
  | 'expert_contribution'
  | 'partner_reference'
  | 'customer_reference'
  | 'case_study'
  | 'education_resource'
  | 'community_reference'
  | 'regional_authority'
  | 'pr_media_coverage'
  | 'product_tool_reference'
  | 'institutional_association';

/** The nine relevance dimensions. Evaluated and reported separately — never summed. */
export type RelevanceDimensionKey =
  | 'topical'
  | 'audience'
  | 'market'
  | 'geographic'
  | 'entity_brand'
  | 'discoverability'
  | 'trust_authority'
  | 'earnability'
  | 'evidence_confidence';

/**
 * A dimension's verdict. `unknown` is distinct from `neutral`: the first means we could not
 * establish it, the second means we could and it neither helps nor hurts. Collapsing them would
 * let missing evidence read as a considered judgement.
 */
export type RelevanceVerdict = 'supports' | 'neutral' | 'against' | 'unknown';

/** Where a recommendation input stands. `declared` never becomes `observed`. */
export type BacklinkEvidenceState =
  | 'observed'
  | 'declared'
  | 'inferred'
  | 'estimated'
  | 'unavailable'
  | 'insufficient_evidence';

/** An ordinal, not a score. See §PRIORITY. */
export type BacklinkPriority = 'now' | 'next' | 'later';

export type BacklinkHorizon = 'immediate' | 'near_term' | 'sustained';

// ── Input: a plain value bundle, never a service handle ───────────────────────

export type BacklinkContextSignal = {
  value: string;
  /** Public source kinds only reach the evidence basis; private ones are excluded, not dropped. */
  source: EvidenceSourceKind;
  observed_at?: string | null;
};

/**
 * Company-DECLARED context. The same shape Report 1 already consumes at the acquisition seam
 * (`DeclaredProfileContext`), restated structurally so this module imports no cross-workstream type.
 * Every field here is `declared` and is reported as such.
 */
export type BacklinkDeclaredContext = {
  industry?: string | null;
  category?: string | null;
  offering?: string | null;
  positioning?: string | null;
  differentiation?: string | null;
  geography?: string | null;
  target_market?: string | null;
  business_priorities?: string | null;
};

/**
 * Content and business assets already evidenced on the site. These drive EARNABILITY: a link has to
 * have a reason to exist, and the reason is usually an asset. Each is optional and absent means
 * "not established", never "absent from the business".
 */
export type BacklinkAssetEvidence = {
  topicsCovered?: readonly string[];
  hasOriginalResearch?: boolean | null;
  hasCaseStudies?: boolean | null;
  hasEducationalResources?: boolean | null;
  hasToolsOrCalculators?: boolean | null;
  hasExpertContent?: boolean | null;
  hasOriginalFrameworks?: boolean | null;
  hasDecisionPages?: boolean | null;
};

/** Measured backlink evidence, when a supported provider actually answered. */
export type BacklinkMeasurement = {
  state: ScoreState;
  referring_domains: number | null;
  backlinks: number | null;
  /** Provider authority/quality reading. Never used as a relevance input — see the docblock. */
  authority: number | null;
  observed_at: string | null;
  source: EvidenceSourceKind;
  reason_unavailable?: string | null;
};

/**
 * A prior comparable observation, for growth. Carries its own comparability identity so growth can
 * only be computed across snapshots the existing contract calls comparable.
 */
export type BacklinkHistoricalSnapshot = {
  referring_domains: number | null;
  observed_at: string | null;
  /** From `buildComparabilityIdentity`. A snapshot with no identity is never comparable. */
  comparability_key: string | null;
};

export type BacklinkStrategyInput = {
  declared?: BacklinkDeclaredContext | null;
  /** Publicly observed category language, search themes, audience signals. */
  observedMarketSignals?: readonly BacklinkContextSignal[];
  /** Publicly observed geography (locale/hreflang/Organization country), not a declared intent. */
  observedGeographies?: readonly BacklinkContextSignal[];
  assets?: BacklinkAssetEvidence | null;
  measurement?: BacklinkMeasurement | null;
  history?: readonly BacklinkHistoricalSnapshot[];
  /** The CURRENT run's comparability key. Growth needs this and a matching prior snapshot. */
  comparabilityKey?: string | null;
  observedAt?: string | null;
};

// ── Output ────────────────────────────────────────────────────────────────────

export type RelevanceAssessment = {
  dimension: RelevanceDimensionKey;
  label: string;
  verdict: RelevanceVerdict;
  /** Why, in the reader's terms. Present for `unknown` too — "what we could not establish". */
  rationale: string;
  state: BacklinkEvidenceState;
};

export type BacklinkStrategyRecommendation = {
  backlinkType: BacklinkType;
  label: string;
  strategicRole: string;
  whyItMatters: string;
  /** Echoes the caller's own declared context. Never a target, never a publisher. */
  companyContext: string;
  /** Echoes publicly observed market signals. Null when none were observed. */
  marketContext: string | null;
  recommendedAsset: string;
  suggestedAcquisitionMotion: string;
  priority: BacklinkPriority;
  horizon: BacklinkHorizon;
  /** The weakest honest state across the inputs that justified this recommendation. */
  evidenceState: BacklinkEvidenceState;
  /** What was actually read. Assembled ONLY from inputs that were present. */
  evidenceBasis: string[];
  confidence: ConfidenceBand;
  /** How this would later be proven to have worked. Never a causal claim. */
  measurementMethod: string;
  dependencies: string[];
  caveats: string[];
  /** All nine dimensions, always. The ordering above is auditable from these. */
  relevance: RelevanceAssessment[];
  provenance: EvidenceProvenanceClass;
};

export type BacklinkGrowth = {
  /** `measured` only with two or more COMPARABLE observations. One snapshot is never momentum. */
  state: 'measured' | 'insufficient_history' | 'not_comparable' | 'unavailable';
  referring_domain_delta: number | null;
  comparable_observations: number;
  reason: string;
};

export type BacklinkObservation = {
  state: ScoreState;
  referring_domains: number | null;
  backlinks: number | null;
  authority: number | null;
  observed_at: string | null;
  growth: BacklinkGrowth;
  reason_unavailable: string | null;
  /** What this observation does NOT establish. Always populated when anything is unmeasured. */
  limitations: string[];
  provenance: EvidenceProvenanceClass;
};

export type BacklinkStrategy = {
  /** Literal, not a union: no consumer can read this as a measurement or a decision. */
  kind: 'proposal';
  state: ScoreState;
  recommendations: BacklinkStrategyRecommendation[];
  /** Set when there was not enough context to recommend anything. */
  abstained: boolean;
  abstention_reason: string | null;
  headline: string;
  disclaimer: string;
  limitations: string[];
  provenance_classes: EvidenceProvenanceClass[];
  report1_clean: boolean;
};

export const BACKLINK_STRATEGY_DISCLAIMER =
  'These are recommended TYPES of external authority, drawn from this company\'s own declared context and '
  + 'publicly observed market signals. They are not a list of websites to contact, not a measurement of your '
  + 'current backlinks, and not a change to your company profile. Where a recommendation rests on something you '
  + 'told us rather than something we observed, it is labelled declared.';

const TYPE_LABELS: Record<BacklinkType, string> = {
  topical_editorial: 'Topical editorial coverage',
  industry_publication: 'Industry / specialist publications',
  authoritative_reference: 'Authoritative reference and citation links',
  research_data_citation: 'Research and data citations',
  expert_contribution: 'Expert interviews and contributions',
  partner_reference: 'Partner references',
  customer_reference: 'Customer references',
  case_study: 'Case-study links',
  education_resource: 'Education and resource links',
  community_reference: 'Community and forum references',
  regional_authority: 'Local / regional authority',
  pr_media_coverage: 'PR and media coverage',
  product_tool_reference: 'Product, tool and resource references',
  institutional_association: 'Institutional and association references',
};

const DIMENSION_LABELS: Record<RelevanceDimensionKey, string> = {
  topical: 'Topical relevance',
  audience: 'Audience relevance',
  market: 'Market relevance',
  geographic: 'Geographic relevance',
  entity_brand: 'Entity / brand relevance',
  discoverability: 'Search / discoverability relevance',
  trust_authority: 'Trust and authority relevance',
  earnability: 'Earnability',
  evidence_confidence: 'Evidence confidence',
};

export const BACKLINK_TYPE_KEYS: readonly BacklinkType[] = Object.keys(TYPE_LABELS) as BacklinkType[];
export const RELEVANCE_DIMENSION_KEYS: readonly RelevanceDimensionKey[] =
  Object.keys(DIMENSION_LABELS) as RelevanceDimensionKey[];

/**
 * Per-type strategy language and the asset that earns it. Controlled text: the only interpolated
 * values are the caller's own context strings, so no outlet, domain or person can appear here.
 */
type TypeProfile = {
  strategicRole: string;
  /** The asset class that gives this link a reason to exist. */
  asset: string;
  motion: string;
  measurement: string;
  /** The asset flag that makes this type earnable now, when one applies. */
  earnedBy?: keyof BacklinkAssetEvidence;
  /** True when this type's value depends on the company's subject matter overlapping the source. */
  topicDriven: boolean;
  /** True when this type exists to strengthen a specific geography. */
  geographyDriven: boolean;
  horizon: BacklinkHorizon;
};

const TYPE_PROFILES: Record<BacklinkType, TypeProfile> = {
  topical_editorial: {
    strategicRole: 'Establishes that independent editors covering this subject treat the company as part of the conversation.',
    asset: 'a distinctive point of view on the category, published as original commentary or analysis',
    motion: 'offer editors a substantive angle grounded in your own work, not a product announcement',
    measurement: 'growth in referring domains whose subject matter overlaps your category, across comparable snapshots',
    topicDriven: true, geographyDriven: false, horizon: 'sustained',
  },
  industry_publication: {
    strategicRole: 'Places the company inside the specialist press its market already reads.',
    asset: 'a practitioner-level explanation of a problem the category argues about',
    motion: 'contribute to specialist outlets that already cover this category',
    measurement: 'presence in specialist referring domains, and search visibility for category themes',
    topicDriven: true, geographyDriven: false, horizon: 'near_term',
  },
  authoritative_reference: {
    strategicRole: 'Turns the company into something other sources cite when they need a definition or a figure.',
    asset: 'a clearly scoped reference page that answers one question definitively',
    motion: 'make the reference materially better than what currently gets cited',
    measurement: 'citation links from reference and encyclopaedic sources; entity presence where measured',
    earnedBy: 'hasEducationalResources', topicDriven: true, geographyDriven: false, horizon: 'sustained',
  },
  research_data_citation: {
    strategicRole: 'Earns durable authority: original data is cited for years and rarely needs asking.',
    asset: 'original research or a dataset nobody else in the category has published',
    motion: 'publish the method and the data openly so it can be cited without permission',
    measurement: 'citations of the research asset, and referring-domain growth attributable to it across snapshots',
    earnedBy: 'hasOriginalResearch', topicDriven: true, geographyDriven: false, horizon: 'sustained',
  },
  expert_contribution: {
    strategicRole: 'Attaches authority to named human expertise rather than to the brand alone.',
    asset: 'a person with demonstrable depth and something specific to say',
    motion: 'make that expertise available for interviews, panels and expert commentary',
    measurement: 'coverage naming the expert, and branded/entity mentions',
    earnedBy: 'hasExpertContent', topicDriven: true, geographyDriven: false, horizon: 'near_term',
  },
  partner_reference: {
    strategicRole: 'Converts existing commercial relationships into external corroboration.',
    asset: 'a genuine integration, partnership or joint piece of work',
    motion: 'ask existing partners to describe the work, reciprocally where appropriate',
    measurement: 'referring domains from partner organisations',
    topicDriven: false, geographyDriven: false, horizon: 'immediate',
  },
  customer_reference: {
    strategicRole: 'Independent corroboration from the people who actually used the product.',
    asset: 'customers willing to be named and to describe the outcome',
    motion: 'invite customers to publish their own account; never script it',
    measurement: 'referring domains from customer organisations, and branded mentions',
    topicDriven: false, geographyDriven: false, horizon: 'near_term',
  },
  case_study: {
    strategicRole: 'Gives both press and buyers a concrete, checkable account of the work.',
    asset: 'a case study with a real problem, a real method and a real result',
    motion: 'publish it so others can reference the specifics',
    measurement: 'links to the case study, and search visibility for problem-shaped queries',
    earnedBy: 'hasCaseStudies', topicDriven: false, geographyDriven: false, horizon: 'near_term',
  },
  education_resource: {
    strategicRole: 'Earns links from people teaching the subject, who cite rather than promote.',
    asset: 'a genuinely useful explainer, course or curriculum-grade resource',
    motion: 'make it freely usable and easy to cite',
    measurement: 'referring domains from educational and resource pages',
    earnedBy: 'hasEducationalResources', topicDriven: true, geographyDriven: false, horizon: 'sustained',
  },
  community_reference: {
    strategicRole: 'Credible presence where the category\'s practitioners actually discuss the problem.',
    asset: 'sustained, substantive participation rather than placement',
    motion: 'answer real questions in communities you already belong to',
    measurement: 'referral and mention presence in community sources, where observable',
    topicDriven: true, geographyDriven: false, horizon: 'sustained',
  },
  regional_authority: {
    strategicRole: 'Builds authority in the specific geography the company is pursuing, which global authority does not supply.',
    asset: 'work, data or commentary specific to that region\'s context',
    motion: 'engage credible publications and institutions within that geography',
    measurement: 'referring domains attributable to the target geography, and region-scoped search visibility',
    topicDriven: false, geographyDriven: true, horizon: 'near_term',
  },
  pr_media_coverage: {
    strategicRole: 'Broad recognition, useful once there is something genuinely newsworthy to carry it.',
    asset: 'an event, milestone or finding that is news outside the company',
    motion: 'approach media only with something that is actually new',
    measurement: 'media referring domains and branded mention volume',
    topicDriven: false, geographyDriven: false, horizon: 'immediate',
  },
  product_tool_reference: {
    strategicRole: 'Tools get linked as utilities, independently of any content programme.',
    asset: 'a free tool, calculator or template that solves one task completely',
    motion: 'make it usable without signup so it can be recommended',
    measurement: 'referring domains to the tool, and its own search visibility',
    earnedBy: 'hasToolsOrCalculators', topicDriven: false, geographyDriven: false, horizon: 'near_term',
  },
  institutional_association: {
    strategicRole: 'Institutional affiliation signals legitimacy that editorial coverage cannot.',
    asset: 'genuine membership, accreditation or institutional collaboration',
    motion: 'pursue affiliations that carry real obligations, not listings',
    measurement: 'referring domains from institutional and association sources',
    topicDriven: false, geographyDriven: false, horizon: 'sustained',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const text = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Public signals only. A private source is excluded from the basis, never silently relabelled. */
const publicSignals = (
  signals: readonly BacklinkContextSignal[] | undefined,
): readonly BacklinkContextSignal[] => (signals ?? []).filter((s) => isReport1Source(s.source));

const WEAKEST_ORDER: readonly BacklinkEvidenceState[] = [
  'insufficient_evidence', 'unavailable', 'estimated', 'inferred', 'declared', 'observed',
];

/** The weakest state present. A recommendation may never claim the strongest of its inputs. */
const weakestState = (states: readonly BacklinkEvidenceState[]): BacklinkEvidenceState => {
  for (const candidate of WEAKEST_ORDER) if (states.includes(candidate)) return candidate;
  return 'insufficient_evidence';
};

const PROVENANCE_BY_STATE: Record<BacklinkEvidenceState, EvidenceProvenanceClass> = {
  // A company-declared input is first-party, so it is not a public observation. It is reported as
  // INFERRED at the provenance layer because the RECOMMENDATION is a derivation from it — and the
  // `declared` evidence state travels alongside so the first-party origin is never lost.
  observed: 'PUBLIC_OBSERVED',
  declared: 'INFERRED',
  inferred: 'INFERRED',
  estimated: 'ESTIMATED',
  unavailable: 'UNAVAILABLE',
  insufficient_evidence: 'UNAVAILABLE',
};

const CONFIDENCE_BY_STATE: Record<BacklinkEvidenceState, ConfidenceBand> = {
  observed: 'high',
  declared: 'medium',
  inferred: 'medium',
  estimated: 'low',
  unavailable: 'low',
  insufficient_evidence: 'low',
};

// ── A. OBSERVATION — what exists ──────────────────────────────────────────────

/**
 * Summarise the measured backlink profile.
 *
 * An absent provider yields `unavailable` with a reason and an explicit limitation. It never yields
 * a zero, and it never yields a statement about the company. A provider-reported zero is kept as a
 * genuine measured zero, because a provider answering zero is evidence.
 */
export function summarizeBacklinkObservation(input: BacklinkStrategyInput): BacklinkObservation {
  const measurement = input.measurement ?? null;
  const growth = assessBacklinkGrowth(input);

  if (!measurement || measurement.state === 'unavailable' || measurement.state === 'insufficient_signal') {
    return {
      state: measurement?.state ?? 'unavailable',
      referring_domains: null,
      backlinks: null,
      authority: null,
      observed_at: null,
      growth,
      reason_unavailable: text(measurement?.reason_unavailable)
        ?? 'No supported backlink provider answered, so external backlink authority was not measured.',
      limitations: [
        'External backlink strength is not measured. This is a missing provider prerequisite, not a finding about this company.',
        'No comparison against other companies\' backlink profiles is made, because none was measured.',
      ],
      provenance: 'UNAVAILABLE',
    };
  }

  const limitations: string[] = [];
  if (growth.state !== 'measured') limitations.push(growth.reason);

  return {
    state: measurement.state,
    referring_domains: measurement.referring_domains,
    backlinks: measurement.backlinks,
    authority: measurement.authority,
    observed_at: measurement.observed_at,
    growth,
    reason_unavailable: null,
    limitations,
    provenance: provenanceForSource(measurement.source),
  };
}

/**
 * Growth requires TWO OR MORE COMPARABLE observations.
 *
 * One snapshot is a current profile and is never called momentum. A prior snapshot with no
 * comparability key, or one whose key differs from the current run's, is `not_comparable` — the
 * existing comparability contract decides that, and a mismatch is reported rather than averaged
 * over.
 */
export function assessBacklinkGrowth(input: BacklinkStrategyInput): BacklinkGrowth {
  const currentKey = text(input.comparabilityKey);
  const current = input.measurement?.referring_domains ?? null;

  if (!currentKey) {
    return {
      state: 'not_comparable',
      referring_domain_delta: null,
      comparable_observations: 0,
      reason: 'This run carries no comparability identity, so no backlink change can be attributed to it. Current profile only.',
    };
  }

  const comparable = (input.history ?? []).filter(
    (snapshot) => text(snapshot.comparability_key) === currentKey && snapshot.referring_domains != null,
  );

  if (current == null) {
    return {
      state: 'unavailable',
      referring_domain_delta: null,
      comparable_observations: comparable.length,
      reason: 'No current referring-domain measurement, so no change can be computed.',
    };
  }

  if (comparable.length === 0) {
    return {
      state: 'insufficient_history',
      referring_domain_delta: null,
      comparable_observations: 0,
      reason: 'Only one comparable observation exists. This is the current backlink profile, not growth — a trend needs at least two comparable observations.',
    };
  }

  const previous = [...comparable].sort(
    (a, b) => String(b.observed_at ?? '').localeCompare(String(a.observed_at ?? '')),
  )[0];

  return {
    state: 'measured',
    referring_domain_delta: current - (previous.referring_domains as number),
    comparable_observations: comparable.length + 1,
    reason: 'Change measured across comparable observations.',
  };
}

// ── B. RECOMMENDATION — what would be valuable to build ───────────────────────

/** Collected, provenance-aware view of the context a recommendation may draw on. */
type ContextView = {
  declaredTopics: string | null;
  declaredPositioning: string | null;
  declaredMarket: string | null;
  declaredGeography: string | null;
  declaredPriorities: string | null;
  observedMarket: readonly BacklinkContextSignal[];
  observedGeography: readonly BacklinkContextSignal[];
  assets: BacklinkAssetEvidence;
  topicsCovered: readonly string[];
  hasAnyContext: boolean;
  hasPrivateInput: boolean;
};

function collectContext(input: BacklinkStrategyInput): ContextView {
  const declared = input.declared ?? null;
  const assets = input.assets ?? {};
  const observedMarket = publicSignals(input.observedMarketSignals);
  const observedGeography = publicSignals(input.observedGeographies);
  const topicsCovered = (assets.topicsCovered ?? []).filter((t) => text(t) !== null);

  const declaredTopics = text(declared?.category) ?? text(declared?.industry) ?? text(declared?.offering);
  const declaredPositioning = text(declared?.positioning) ?? text(declared?.differentiation);
  const declaredMarket = text(declared?.target_market);
  const declaredGeography = text(declared?.geography);
  const declaredPriorities = text(declared?.business_priorities);

  const allSignals = [...(input.observedMarketSignals ?? []), ...(input.observedGeographies ?? [])];

  return {
    declaredTopics,
    declaredPositioning,
    declaredMarket,
    declaredGeography,
    declaredPriorities,
    observedMarket,
    observedGeography,
    assets,
    topicsCovered,
    hasAnyContext: Boolean(
      declaredTopics || declaredPositioning || declaredMarket || declaredGeography || declaredPriorities
      || observedMarket.length > 0 || observedGeography.length > 0 || topicsCovered.length > 0,
    ),
    hasPrivateInput: allSignals.some((s) => !isReport1Source(s.source)),
  };
}

/**
 * Evaluate the nine dimensions for one type.
 *
 * Note what is NOT consulted: the measured backlink COUNT, and provider domain authority. Neither
 * tells you whether a KIND of authority is strategically relevant, and using the absence of a count
 * as a reason would be the exact defect this module guards.
 */
function assessRelevance(type: BacklinkType, ctx: ContextView): RelevanceAssessment[] {
  const profile = TYPE_PROFILES[type];
  const assess = (
    dimension: RelevanceDimensionKey,
    verdict: RelevanceVerdict,
    state: BacklinkEvidenceState,
    rationale: string,
  ): RelevanceAssessment => ({ dimension, label: DIMENSION_LABELS[dimension], verdict, state, rationale });

  const topicEvidence = ctx.topicsCovered.length > 0
    ? ('observed' as BacklinkEvidenceState)
    : ctx.declaredTopics ? ('declared' as BacklinkEvidenceState) : ('insufficient_evidence' as BacklinkEvidenceState);
  const topicKnown = topicEvidence !== 'insufficient_evidence';

  const marketObserved = ctx.observedMarket.length > 0;
  const marketKnown = marketObserved || Boolean(ctx.declaredMarket);
  const geographyKnown = ctx.observedGeography.length > 0 || Boolean(ctx.declaredGeography);

  const earnedByFlag = profile.earnedBy;
  const earnabilityFlag = earnedByFlag ? ctx.assets[earnedByFlag] : undefined;

  return [
    assess(
      'topical',
      profile.topicDriven ? (topicKnown ? 'supports' : 'unknown') : (topicKnown ? 'neutral' : 'unknown'),
      topicEvidence,
      profile.topicDriven
        ? topicKnown
          ? 'This type depends on subject-matter overlap, and the company\'s subject matter is established.'
          : 'This type depends on subject-matter overlap, and no subject matter has been established — so its relevance cannot be judged.'
        : topicKnown
          ? 'This type does not depend primarily on subject-matter overlap.'
          : 'Subject matter is not established, though this type does not depend primarily on it.',
    ),
    assess(
      'audience',
      marketKnown ? 'supports' : 'unknown',
      marketObserved ? 'observed' : ctx.declaredMarket ? 'declared' : 'insufficient_evidence',
      marketKnown
        ? 'A market/audience is established, so whether this type reaches relevant people can be judged.'
        : 'No audience is established, so audience relevance cannot be judged.',
    ),
    assess(
      'market',
      marketKnown ? 'supports' : 'unknown',
      marketObserved ? 'observed' : ctx.declaredMarket ? 'declared' : 'insufficient_evidence',
      marketKnown
        ? 'The market this company is pursuing is established.'
        : 'The market is not established.',
    ),
    assess(
      'geographic',
      profile.geographyDriven ? (geographyKnown ? 'supports' : 'unknown') : 'neutral',
      ctx.observedGeography.length > 0 ? 'observed' : ctx.declaredGeography ? 'declared' : 'insufficient_evidence',
      profile.geographyDriven
        ? geographyKnown
          ? 'A geography is part of this company\'s strategy, and this type strengthens authority within it.'
          : 'This type exists to strengthen a specific geography, and none is established.'
        : 'This type is not geography-specific.',
    ),
    assess(
      'entity_brand',
      ctx.declaredPositioning || topicKnown ? 'supports' : 'unknown',
      ctx.topicsCovered.length > 0 ? 'observed' : ctx.declaredPositioning ? 'declared' : 'insufficient_evidence',
      ctx.declaredPositioning || topicKnown
        ? 'There is an established sense of what the company is known for to reinforce.'
        : 'What the company is known for is not established.',
    ),
    assess(
      'discoverability',
      topicKnown ? 'supports' : 'unknown',
      topicEvidence,
      topicKnown
        ? 'External authority on established themes can support discoverability for those themes.'
        : 'No themes are established, so no discoverability effect can be argued.',
    ),
    assess(
      'trust_authority',
      'supports',
      'inferred',
      'This type strengthens credibility rather than link count. Credibility is why it is recommended; volume is not.',
    ),
    assess(
      'earnability',
      earnedByFlag
        ? earnabilityFlag === true ? 'supports' : earnabilityFlag === false ? 'against' : 'unknown'
        : 'neutral',
      earnedByFlag ? (earnabilityFlag == null ? 'insufficient_evidence' : 'observed') : 'inferred',
      earnedByFlag
        ? earnabilityFlag === true
          ? `The asset that earns this link is already evidenced: ${profile.asset}.`
          : earnabilityFlag === false
            ? `The asset that earns this link is absent: ${profile.asset}. It would have to be built first.`
            : `Whether the asset that earns this link exists was not established: ${profile.asset}.`
        : `No single site asset gates this type; it rests on ${profile.asset}.`,
    ),
    assess(
      'evidence_confidence',
      marketObserved || ctx.topicsCovered.length > 0 ? 'supports' : ctx.hasAnyContext ? 'neutral' : 'unknown',
      marketObserved || ctx.topicsCovered.length > 0
        ? 'observed'
        : ctx.hasAnyContext ? 'declared' : 'insufficient_evidence',
      marketObserved || ctx.topicsCovered.length > 0
        ? 'At least one input is a public observation rather than a declaration.'
        : ctx.hasAnyContext
          ? 'Every input is company-declared. The recommendation stands, labelled declared.'
          : 'No context at all.',
    ),
  ];
}

/**
 * §PRIORITY — an ORDINAL over the dimension verdicts, not a score.
 *
 * No number is produced and no weighting is applied, because no scoring contract exists for this
 * surface. The rule is stated here so a reader can check the ordering against the verdicts that
 * travel with every recommendation:
 *
 *   now    the type's own driving dimension is supported AND the asset that earns it already
 *          exists AND the market is established — i.e. nothing has to be built first.
 *   next   the driving dimension is supported, but the earning asset is absent or unestablished.
 *   later  relevance is only partially established.
 *
 * `earnability: 'against'` can never produce `now`: a link with no reason to exist is not an
 * immediate opportunity, it is a prerequisite.
 */
function derivePriority(relevance: readonly RelevanceAssessment[], type: BacklinkType): BacklinkPriority {
  const verdict = (key: RelevanceDimensionKey): RelevanceVerdict =>
    relevance.find((r) => r.dimension === key)?.verdict ?? 'unknown';

  const profile = TYPE_PROFILES[type];
  const driving: RelevanceDimensionKey = profile.geographyDriven ? 'geographic' : profile.topicDriven ? 'topical' : 'market';
  const drivingSupported = verdict(driving) === 'supports';
  const earnability = verdict('earnability');
  const marketSupported = verdict('market') === 'supports';

  if (drivingSupported && marketSupported && (earnability === 'supports' || earnability === 'neutral')) return 'now';
  if (drivingSupported && marketSupported) return 'next';
  return 'later';
}

/**
 * Build the contextual backlink strategy.
 *
 * Abstains entirely when there is no admissible context: a recommendation set assembled from
 * nothing would be generic advice wearing this company's name, which is precisely what the
 * negative control for this module injects.
 */
export function buildBacklinkStrategy(input: BacklinkStrategyInput): BacklinkStrategy {
  const ctx = collectContext(input);

  if (!ctx.hasAnyContext) {
    return {
      kind: 'proposal',
      state: 'insufficient_signal',
      recommendations: [],
      abstained: true,
      abstention_reason:
        'No company context and no publicly observed market signal were available, so no contextual backlink '
        + 'recommendation can be made. Generic link-building advice would not be specific to this company.',
      headline: 'External authority strategy could not be derived from available context.',
      disclaimer: BACKLINK_STRATEGY_DISCLAIMER,
      limitations: ['No recommendation is offered. Absence of context is not evidence about this company.'],
      provenance_classes: ['UNAVAILABLE'],
      report1_clean: !ctx.hasPrivateInput,
    };
  }

  const companyContext = [
    ctx.declaredTopics ? `category: ${ctx.declaredTopics}` : null,
    ctx.declaredPositioning ? `positioning: ${ctx.declaredPositioning}` : null,
    ctx.declaredMarket ? `target market: ${ctx.declaredMarket}` : null,
    ctx.declaredGeography ? `geography: ${ctx.declaredGeography}` : null,
  ].filter((part): part is string => part !== null).join('; ');

  const marketContext = ctx.observedMarket.length > 0
    ? `Publicly observed market signals: ${ctx.observedMarket.map((s) => s.value).join('; ')}`
    : null;

  const recommendations: BacklinkStrategyRecommendation[] = [];

  for (const type of BACKLINK_TYPE_KEYS) {
    const profile = TYPE_PROFILES[type];
    const relevance = assessRelevance(type, ctx);

    // A type whose own driving dimension cannot be judged is not recommended at all. Emitting it
    // would be a recommendation with no basis, dressed in a priority.
    const driving = profile.geographyDriven ? 'geographic' : profile.topicDriven ? 'topical' : 'market';
    const drivingVerdict = relevance.find((r) => r.dimension === driving)?.verdict ?? 'unknown';
    if (drivingVerdict === 'unknown' || drivingVerdict === 'against') continue;

    // The basis is assembled ONLY from inputs that are PRESENT. There is deliberately no branch
    // that pushes "backlinks were not measured" onto it.
    const evidenceBasis: string[] = [];
    const states: BacklinkEvidenceState[] = [];

    if (ctx.topicsCovered.length > 0) {
      evidenceBasis.push(`Observed site topics: ${ctx.topicsCovered.join(', ')}`);
      states.push('observed');
    } else if (ctx.declaredTopics) {
      evidenceBasis.push(`Declared category/offering: ${ctx.declaredTopics}`);
      states.push('declared');
    }
    if (ctx.observedMarket.length > 0) {
      evidenceBasis.push(`Publicly observed market signals: ${ctx.observedMarket.map((s) => s.value).join(', ')}`);
      states.push('observed');
    } else if (ctx.declaredMarket) {
      evidenceBasis.push(`Declared target market: ${ctx.declaredMarket}`);
      states.push('declared');
    }
    if (profile.geographyDriven) {
      if (ctx.observedGeography.length > 0) {
        evidenceBasis.push(`Publicly observed geography: ${ctx.observedGeography.map((s) => s.value).join(', ')}`);
        states.push('observed');
      } else if (ctx.declaredGeography) {
        evidenceBasis.push(`Declared geography: ${ctx.declaredGeography}`);
        states.push('declared');
      }
    }
    if (ctx.declaredPositioning) {
      evidenceBasis.push(`Declared positioning/differentiation: ${ctx.declaredPositioning}`);
      states.push('declared');
    }
    const earnedByFlag = profile.earnedBy;
    if (earnedByFlag && ctx.assets[earnedByFlag] === true) {
      evidenceBasis.push(`Site evidence for the earning asset (${String(earnedByFlag)})`);
      states.push('observed');
    }

    if (evidenceBasis.length === 0) continue;

    const priority = derivePriority(relevance, type);
    const evidenceState = weakestState(states);

    const dependencies: string[] = [];
    if (earnedByFlag && ctx.assets[earnedByFlag] !== true) {
      dependencies.push(`Requires ${profile.asset}, which is not evidenced on the site today.`);
    }
    if (profile.geographyDriven && ctx.observedGeography.length === 0 && ctx.declaredGeography) {
      dependencies.push('Geography is declared rather than publicly observed; confirming it publicly would strengthen this.');
    }

    const caveats: string[] = [
      'This recommends a TYPE of external authority. It names no website, publication or person, and is not an outreach list.',
    ];
    if (evidenceState === 'declared') {
      caveats.push('Rests on company-declared context, not observed market demand. It is a strategic inference, not an observed opportunity.');
    }
    if (ctx.observedMarket.length === 0) {
      caveats.push('No public market signal was observed, so market relevance here is declared rather than corroborated.');
    }

    recommendations.push({
      backlinkType: type,
      label: TYPE_LABELS[type],
      strategicRole: profile.strategicRole,
      whyItMatters: `${profile.strategicRole} For this company that matters because ${companyContext || 'its declared context'} — relevance and credibility, not link volume, are what make this kind of authority worth pursuing.`,
      companyContext: companyContext || 'No declared company context was available.',
      marketContext,
      recommendedAsset: profile.asset,
      suggestedAcquisitionMotion: profile.motion,
      priority,
      horizon: profile.horizon,
      evidenceState,
      evidenceBasis,
      confidence: CONFIDENCE_BY_STATE[evidenceState],
      measurementMethod: profile.measurement,
      dependencies,
      caveats,
      relevance,
      provenance: PROVENANCE_BY_STATE[evidenceState],
    });
  }

  const PRIORITY_ORDER: Record<BacklinkPriority, number> = { now: 0, next: 1, later: 2 };
  recommendations.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const anyObserved = recommendations.some((r) => r.evidenceState === 'observed');
  const limitations: string[] = [];
  if (!anyObserved) {
    limitations.push('Every recommendation rests on declared context rather than observed market evidence.');
  }
  if (ctx.hasPrivateInput) {
    limitations.push('One or more supplied signals came from a private source and were excluded from the evidence basis.');
  }

  return {
    kind: 'proposal',
    // A proposal derived from context is `inferred` whether or not a public signal corroborated
    // it; what differs is the per-recommendation `evidenceState`, which is where that shows.
    state: recommendations.length === 0 ? 'insufficient_signal' : 'inferred',
    recommendations,
    abstained: recommendations.length === 0,
    abstention_reason: recommendations.length === 0
      ? 'Context was present but no backlink type had a judgeable driving relevance, so nothing is recommended.'
      : null,
    headline: recommendations.length === 0
      ? 'No backlink type could be recommended from the available context.'
      : `${recommendations.length} types of external authority would strategically strengthen this company's position.`,
    disclaimer: BACKLINK_STRATEGY_DISCLAIMER,
    limitations,
    provenance_classes: Array.from(new Set(recommendations.map((r) => r.provenance))),
    report1_clean: !ctx.hasPrivateInput,
  };
}
