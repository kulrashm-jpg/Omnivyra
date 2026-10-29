/**
 * Publication opportunities — the cited domains where a company could legitimately appear, derived
 * only from what the AI answers in this report cited. Deterministic: thresholds, ranking and text
 * templates; no model call, no page fetch, no generic fallback list.
 *
 * Bar (defaults, exported for tests): weighted citations >= 2, where role 'cited' counts 1 and role
 * 'unknown' (a merged legacy list) counts UNKNOWN_ROLE_WEIGHT, and role 'retrieved' never counts;
 * AND at least 2 distinct buyer questions OR 2 distinct AI tools; AND a category that is a real
 * placement target. 'unknown', 'subject_owned' and 'ai_vendor_or_search' domains are never targets;
 * a validated competitor's own domain is listed as context only (`none_competitor_owned`), after
 * every placement target. At most MAX_OPPORTUNITIES.
 *
 * Every opportunity is `verification_status: 'not_verified'` (the target page is not opened), its
 * confidence is never 'high' (one run of non-deterministic answers), and the set always carries an
 * evidence-gap statement. Action types come from an allow-list; each text template is the only
 * wording an action can have, and none describes a manipulative practice.
 */
import { CLASSIFIER_LIST_VERSION } from './sourceDomainClassifier';
import { aggregateSourceDomains, type AggregateContext } from './sourceDomainAggregate';
import type { AllowedActionType, CitationIntelligence, CitationSource, PublicationOpportunity, PublicationOpportunitySet, SourceCategory, SourceDomainAggregate } from './citationTypes';

export const OPPORTUNITY_THRESHOLDS = Object.freeze({ min_citations: 2, min_questions_or_providers: 2, max_opportunities: 10, unknown_role_weight: 0.5 });

export const ALLOWED_ACTION_TYPES: readonly AllowedActionType[] = Object.freeze([
  'claim_or_complete_profile', 'request_reviews_from_real_customers', 'publish_factual_content_on_owned_channel',
  'contribute_disclosed_expertise', 'pitch_factual_inclusion_to_editor', 'correct_or_update_reference_entry',
  'publish_video_or_demo_on_own_channel', 'none_competitor_owned',
]);

const NEVER_TARGET: ReadonlySet<SourceCategory> = new Set<SourceCategory>(['unknown', 'subject_owned', 'ai_vendor_or_search']);

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt_search: 'ChatGPT search', perplexity: 'Perplexity', claude_search: 'Claude (web search)', gemini_search: 'Gemini',
  google_ai_mode: 'Google AI Mode', bing_copilot: 'Bing Copilot', 'scoring_run:perplexity': 'Perplexity (scoring run)',
};
export const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

/** One action per source type. `{domain}` and `{brand}` are the only substitutions. */
export const ACTION_FOR_CATEGORY: Record<Exclude<SourceCategory, 'unknown' | 'subject_owned' | 'ai_vendor_or_search'>, { type: AllowedActionType; text: string }> = {
  review_directory: { type: 'claim_or_complete_profile', text: 'Claim or complete {brand}\'s own listing on {domain} with accurate product, pricing and category details; ask real customers for reviews only through {domain}\'s own invitation flow and within its review policy.' },
  business_database: { type: 'claim_or_complete_profile', text: 'Claim or complete {brand}\'s own company profile on {domain} through its official claim process, using facts the company already publishes.' },
  forum_community: { type: 'contribute_disclosed_expertise', text: 'Where {domain} discussions ask these questions, answer as {brand} with the affiliation disclosed, following the community\'s own rules on self-promotion.' },
  knowledge_reference: { type: 'correct_or_update_reference_entry', text: 'If a {domain} entry about {brand} or its category is missing or wrong, request the change through the site\'s conflict-of-interest process (for example a talk-page request with independent sources), not by editing it directly.' },
  video: { type: 'publish_video_or_demo_on_own_channel', text: 'Publish a factual demo or explainer that answers these questions on {brand}\'s own {domain} channel.' },
  social: { type: 'publish_factual_content_on_owned_channel', text: 'Publish factual posts that answer these questions on {brand}\'s own official profile on {domain}.' },
  publishing_platform: { type: 'publish_factual_content_on_owned_channel', text: 'Publish a factual article that answers these questions on a {domain} publication {brand} owns, under the company\'s own name.' },
  editorial: { type: 'pitch_factual_inclusion_to_editor', text: 'Ask the editors of the cited {domain} articles to evaluate {brand} for inclusion, with factual material; disclose any commercial relationship, and mark any paid placement as sponsored.' },
  competitor_owned: { type: 'none_competitor_owned', text: 'Context only: {domain} is a validated competitor\'s own site. AI answers to these questions cite it; it is not a placement target.' },
};

/** Weighted citations: cited counts 1, role unknown counts UNKNOWN_ROLE_WEIGHT, retrieved never counts. */
export const weightedCitations = (d: Pick<SourceDomainAggregate, 'citation_count' | 'unknown_role_count'>) =>
  d.citation_count + OPPORTUNITY_THRESHOLDS.unknown_role_weight * d.unknown_role_count;

export function meetsBar(d: SourceDomainAggregate): boolean {
  return weightedCitations(d) >= OPPORTUNITY_THRESHOLDS.min_citations
    && (d.distinct_questions >= OPPORTUNITY_THRESHOLDS.min_questions_or_providers || d.distinct_providers.length >= OPPORTUNITY_THRESHOLDS.min_questions_or_providers);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sortStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fill = (t: string, domain: string, brand: string) => t.split('{domain}').join(domain).split('{brand}').join(brand || 'the company');

export type OpportunityContext = {
  brand: string;
  /** The citation sources the aggregates were built from (for questions and evidence ids). */
  sources: CitationSource[];
  /** Observed grounded answers to buyer questions (the denominator). */
  groundedBuyerAnswers: number;
  /** Providers with at least one grounded buyer answer. */
  providersObserved: string[];
  /** Providers that were not asked or did not answer (labels or ids), for the evidence-gap statement. */
  providersNotObserved?: string[];
};

function opportunityFor(d: SourceDomainAggregate, ctx: OpportunityContext): PublicationOpportunity {
  const action = ACTION_FOR_CATEGORY[d.category as keyof typeof ACTION_FOR_CATEGORY];
  const ids = new Set(d.citation_ids);
  const counting = ctx.sources.filter((s) => ids.has(s.citation_id) && s.citation_role !== 'retrieved');
  const questions = new Map<string, { query: string; query_class: string }>();
  for (const s of counting) {
    const k = s.query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!questions.has(k)) questions.set(k, { query: s.query, query_class: String(s.query_class) });
  }
  const providers = d.distinct_providers;
  const others = d.associated_brands.filter((b) => b.kind !== 'subject').slice(0, 3).map((b) => b.name);
  const subjectLine = d.subject_named_in_citing_answers === null
    ? 'The answers kept no text, so which brands they named is not known.'
    : `${ctx.brand || 'The company'} was named in ${d.subject_named_in_citing_answers} of ${plural(d.citing_answers_with_brand_data, 'answer')} that cited it${others.length ? `; brands named in those answers: ${others.join(', ')}` : ''}.`;
  const unknownPart = d.unknown_role_count ? ` plus ${plural(d.unknown_role_count, 'listing')} where the tool did not separate cited from searched sources` : '';
  const why = `${d.registrable_domain} was cited ${plural(d.citation_count, 'time')}${unknownPart} in answers to ${plural(d.distinct_questions, 'buyer question')} across ${plural(providers.length, 'AI tool')} (${providers.map(providerLabel).join(', ')}). ${subjectLine}`;

  const limitations = ['One run at one point in time: AI answers vary between runs, so a source cited here may not be cited on the next run.'];
  if (d.has_host_only) limitations.push('Some sources were reported by domain only (Gemini), not by page.');
  if (d.unknown_role_count) limitations.push('Some sources came from a list that mixes cited and merely searched pages; they count at half weight.');
  if (d.retrieved_only_count) limitations.push(`${plural(d.retrieved_only_count, 'further source')} on this domain were searched but not cited; they are not counted.`);
  if (d.subject_named_in_citing_answers === null || d.citing_answers_with_brand_data < d.observation_ids.length) limitations.push('Brand association is unavailable for answers that kept no text (scoring-run probes).');
  if (d.associated_brands.length) limitations.push('Brands are associated by appearing in the same answer that cited this domain; that is not evidence the domain recommends them.');
  if (!d.example_urls.length) limitations.push('No page-level URL was returned for this domain.');

  const strong = d.citation_count >= 3 && d.distinct_questions >= 2 && providers.length >= 2;
  const evidence = [...d.observation_ids, ...counting.map((s) => s.citation_id).sort(sortStr)];
  return {
    opportunity_id: `PO-${d.registrable_domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    target: { registrable_domain: d.registrable_domain, example_urls: d.example_urls, label: d.registrable_domain },
    source_type: d.category,
    supporting_evidence_ids: [...new Set(evidence)],
    relevant_questions: [...questions.values()].sort((a, b) => sortStr(a.query, b.query)),
    providers,
    why_it_may_matter: why,
    suggested_action: action.type,
    suggested_action_text: fill(action.text, d.registrable_domain, ctx.brand),
    confidence: strong ? 'medium' : 'low',
    confidence_basis: strong
      ? `Cited ${d.citation_count} times across at least 2 questions and 2 tools in one run; never high, because the answers come from a single run.`
      : 'Meets the minimum bar only; a single run of non-deterministic answers.',
    limitations,
    verification_status: 'not_verified',
    verification_step: `Re-run the same buyer questions in the same tools; check whether ${d.registrable_domain} is still cited and whether ${ctx.brand || 'the company'} is named.`,
    counts: { citations: d.citation_count, unknown_role: d.unknown_role_count, questions: d.distinct_questions, providers: providers.length },
  };
}

export function buildPublicationOpportunities(domains: SourceDomainAggregate[], ctx: OpportunityContext): PublicationOpportunitySet {
  const T = OPPORTUNITY_THRESHOLDS;
  const qualifying = domains.filter((d) => meetsBar(d));
  const rank = (a: SourceDomainAggregate, b: SourceDomainAggregate) =>
    weightedCitations(b) - weightedCitations(a) || b.distinct_questions - a.distinct_questions || b.distinct_providers.length - a.distinct_providers.length
    || (a.subject_named_in_citing_answers ?? Number.MAX_SAFE_INTEGER) - (b.subject_named_in_citing_answers ?? Number.MAX_SAFE_INTEGER)
    || sortStr(a.registrable_domain, b.registrable_domain);
  const targets = qualifying.filter((d) => !NEVER_TARGET.has(d.category) && d.category !== 'competitor_owned').sort(rank);
  const context = qualifying.filter((d) => d.category === 'competitor_owned').sort(rank);
  const chosen = [...targets, ...context].slice(0, T.max_opportunities);
  const opportunities = chosen.map((d) => opportunityFor(d, ctx));

  const accepted = ctx.sources.filter((s) => s.provenance.rejected_reason === null && !s.is_brand_question);
  const rejected = ctx.sources.filter((s) => s.provenance.rejected_reason !== null && !s.is_brand_question).length;
  const retrievedOnly = accepted.filter((s) => s.citation_role === 'retrieved').length;
  const excludedUnknown = qualifying.filter((d) => d.category === 'unknown').length;
  const excludedOther = qualifying.filter((d) => d.category === 'subject_owned' || d.category === 'ai_vendor_or_search').length;
  const placement = opportunities.filter((o) => o.suggested_action !== 'none_competitor_owned').length;
  const notObserved = (ctx.providersNotObserved ?? []).length ? ` Not observed: ${(ctx.providersNotObserved ?? []).join(', ')}.` : '';

  let gap: string;
  if (!ctx.groundedBuyerAnswers) {
    gap = `No grounded AI answers to buyer questions were observed, so no publication opportunity can be evidenced.${notObserved}`;
  } else {
    gap = `${plural(placement, 'site')} met the bar (cited at least ${T.min_citations} times across at least ${T.min_questions_or_providers} buyer questions or ${T.min_questions_or_providers} AI tools) from ${plural(ctx.groundedBuyerAnswers, 'grounded buyer answer')} by ${plural(ctx.providersObserved.length, 'AI tool')} (${ctx.providersObserved.map(providerLabel).join(', ') || 'none'}).`
      + (opportunities.length > placement ? ` ${plural(opportunities.length - placement, 'validated competitor site')} listed as context only.` : '')
      + (excludedUnknown ? ` ${plural(excludedUnknown, 'further domain')} met the citation bar but ${excludedUnknown === 1 ? 'its' : 'their'} category is not established from evidence, so no action is suggested.` : '')
      + (excludedOther ? ` ${plural(excludedOther, 'domain')} owned by the company or belonging to an AI or search engine ${excludedOther === 1 ? 'was' : 'were'} excluded.` : '')
      + (retrievedOnly ? ` ${plural(retrievedOnly, 'source')} the tools searched but did not cite ${retrievedOnly === 1 ? 'is' : 'are'} not counted.` : '')
      + (opportunities.length < T.max_opportunities ? ` The evidence does not support more than ${opportunities.length}; nothing is added without an observed citation.` : '')
      + notObserved;
  }
  return {
    opportunities,
    evidence_gap: gap,
    thresholds: { ...T },
    inputs: {
      grounded_buyer_answers: ctx.groundedBuyerAnswers,
      providers_observed: [...ctx.providersObserved].sort(sortStr),
      citations_considered: accepted.filter((s) => s.citation_role !== 'retrieved').length,
      citations_rejected: rejected,
      retrieved_only_excluded: retrievedOnly,
    },
    classifier_list_version: CLASSIFIER_LIST_VERSION,
  };
}

/** Aggregate + opportunities in one call: the single producer for a pack's `citationIntelligence`. */
export function buildCitationIntelligence(sources: CitationSource[], ctx: AggregateContext & Omit<OpportunityContext, 'brand' | 'sources'> & { generatedAt?: string | null }): CitationIntelligence {
  const domains = aggregateSourceDomains(sources, ctx);
  return {
    generated_at: ctx.generatedAt ?? null,
    domains,
    opportunities: buildPublicationOpportunities(domains, {
      brand: ctx.subject.brand, sources, groundedBuyerAnswers: ctx.groundedBuyerAnswers, providersObserved: ctx.providersObserved, providersNotObserved: ctx.providersNotObserved,
    }),
  };
}
