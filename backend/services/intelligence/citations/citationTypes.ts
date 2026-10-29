/**
 * Citation intelligence — data contracts (Phase B, Agent 3).
 *
 * A citation is a source URL an AI answer engine returned with a grounded answer. These types keep
 * every citation traceable to the answer (observation) it came from, keep "cited" (the engine
 * attached the source to its answer) apart from "retrieved" (the engine searched it but did not
 * cite it), and never fabricate a URL, title or domain: every field is copied from the provider's
 * response or derived from it deterministically, and is null when the provider did not supply it.
 *
 * Nothing here feeds a score. All persisted fields are optional additions on existing shapes.
 */

/** Pipeline B surface ids (publicResearch/aiAnswers.ts) and the pipeline A Perplexity probe, prefixed so the two never merge. */
export type CitationProvider =
  | 'chatgpt_search' | 'perplexity' | 'claude_search' | 'gemini_search' | 'google_ai_mode' | 'bing_copilot'
  | 'scoring_run:perplexity';

/** Pipeline B question intents (aiQuestions.ts) and pipeline A query classes, prefixed. */
export type CitationQueryClass =
  | 'commercial' | 'category' | 'problem' | 'use_case' | 'comparison' | 'definitional' | 'branded'
  | 'scoring:branded' | 'scoring:category' | 'scoring:competitive' | 'scoring:expertise';

/** cited: attached to the answer; retrieved: searched but not cited; unknown: a merged legacy list. */
export type CitationRole = 'cited' | 'retrieved' | 'unknown';

export type CitationRejectReason = 'malformed' | 'private_host' | 'search_engine_host' | 'duplicate_in_answer' | 'over_per_answer_cap';

/** One source detail as a provider parser returned it. Optional fields are additive to the contract shape `{url; title|null; role}`. */
export type CitationDetailInput = {
  url: string;
  title: string | null;
  role: CitationRole;
  /** 'host_only' when the provider gave only the source's domain (Gemini grounding chunks). */
  precision?: 'page' | 'host_only';
  /** The domain the provider stated for a host-only source (Gemini `web.title`), used instead of the redirect URL's host. */
  domain?: string | null;
};

/**
 * STRUCTURAL input to `toCitationSources` (Phase B contract). Any producer — a public-research
 * answer or a scoring-run observation — can be adapted to it without importing the producer's types.
 */
export type CitationObservationInput = {
  provider: CitationProvider | string;
  query: string;
  query_class: CitationQueryClass | string;
  grounded_sources: string[];
  observation_id?: string | null;
  citations?: CitationDetailInput[];
};

/** Context that is not part of the observation shape; every field is optional. */
export type CitationContext = {
  observed_at?: string | null;
  model?: string | null;
  is_brand_question?: boolean;
  pipeline?: 'public_research' | 'scoring_run';
  method?: string;
};

export type CitationSource = {
  /** Deterministic: sha256(observation_id | dedup key | citation_role), first 16 hex chars, prefixed 'C-'. */
  citation_id: string;
  /** Exactly as the provider returned it. */
  url: string;
  /** canonicalizeUrl().canonical for page precision; null for host-only sources and for rejected ones. */
  normalized_url: string | null;
  url_precision: 'page' | 'host_only';
  host: string | null;
  registrable_domain: string | null;
  /** Only when the provider returned a title; never synthesised. */
  title: string | null;
  citation_role: CitationRole;
  provider: CitationProvider | string;
  /** Only when the provider response states it; never the configured default. */
  model: string | null;
  query: string;
  query_class: CitationQueryClass | string;
  is_brand_question: boolean;
  observation_id: string;
  /** True when the input carried no observation_id and one was derived from (provider, query, query_class, observed_at). */
  observation_id_derived: boolean;
  observed_at: string | null;
  provenance: {
    pipeline: 'public_research' | 'scoring_run';
    method: string;
    rejected_reason: CitationRejectReason | null;
  };
};

export type SourceCategory =
  | 'subject_owned'
  | 'competitor_owned'
  | 'review_directory'
  | 'forum_community'
  | 'knowledge_reference'
  | 'video'
  | 'social'
  | 'business_database'
  | 'publishing_platform'
  | 'editorial'
  | 'ai_vendor_or_search'
  | 'unknown';

export type SourceClassification = { category: SourceCategory; rule: string; list_version: string };

export type AssociatedBrand = {
  name: string;
  kind: 'subject' | 'validated_competitor' | 'other_named_brand';
  /** Answers that cited this domain AND named this brand. */
  co_occurrences: number;
  observation_ids: string[];
};

export type SourceDomainAggregate = {
  registrable_domain: string;
  category: SourceCategory;
  classification_rule: string;
  /** Distinct (observation_id, source) pairs with role 'cited'. */
  citation_count: number;
  /** Distinct pairs with role 'unknown' (merged legacy lists); never summed into citation_count. */
  unknown_role_count: number;
  /** Distinct pairs with role 'retrieved' only; never summed into citation_count. */
  retrieved_only_count: number;
  /** Distinct buyer questions whose answers cited (or, role unknown, listed) this domain. */
  distinct_questions: number;
  distinct_providers: string[];
  /** Up to 3 normalized page URLs (page precision only). */
  example_urls: string[];
  citation_ids: string[];
  observation_ids: string[];
  /** True when any contribution is host-only precision. */
  has_host_only: boolean;
  associated_brands: AssociatedBrand[];
  /** Of the answers citing this domain, how many named the subject; null when no answer text/brand data was available. */
  subject_named_in_citing_answers: number | null;
  /** Answers citing this domain for which brand data existed (the denominator of the line above). */
  citing_answers_with_brand_data: number;
};

export type AllowedActionType =
  | 'claim_or_complete_profile'
  | 'request_reviews_from_real_customers'
  | 'publish_factual_content_on_owned_channel'
  | 'contribute_disclosed_expertise'
  | 'pitch_factual_inclusion_to_editor'
  | 'correct_or_update_reference_entry'
  | 'publish_video_or_demo_on_own_channel'
  | 'none_competitor_owned';

export type PublicationOpportunity = {
  /** 'PO-' + domain slug; stable across re-renders. */
  opportunity_id: string;
  target: { registrable_domain: string; example_urls: string[]; label: string };
  source_type: SourceCategory;
  supporting_evidence_ids: string[];
  relevant_questions: Array<{ query: string; query_class: string }>;
  providers: string[];
  why_it_may_matter: string;
  suggested_action: AllowedActionType;
  suggested_action_text: string;
  confidence: 'medium' | 'low';
  confidence_basis: string;
  limitations: string[];
  verification_status: 'not_verified';
  verification_step: string;
  /** The counts the text was templated from, so they can be recomputed from the evidence ids. */
  counts: { citations: number; unknown_role: number; questions: number; providers: number };
};

export type PublicationOpportunitySet = {
  opportunities: PublicationOpportunity[];
  /** Mandatory: what the evidence could and could not support in this run. */
  evidence_gap: string;
  thresholds: { min_citations: number; min_questions_or_providers: number; max_opportunities: number; unknown_role_weight: number };
  inputs: {
    grounded_buyer_answers: number;
    providers_observed: string[];
    citations_considered: number;
    citations_rejected: number;
    retrieved_only_excluded: number;
  };
  classifier_list_version: string;
};

export type CitationIntelligence = {
  generated_at: string | null;
  domains: SourceDomainAggregate[];
  opportunities: PublicationOpportunitySet;
};
