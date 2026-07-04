/**
 * Anticipated Provider Registrations  (BETA-ENGINE-004, Phase 1 inventory + Phase 6 adoption)
 *
 * Registers every external-evidence provider the platform ANTICIPATES, each in the default
 * `unavailable` / `unauthenticated` / `disconnected` state. This is PURE METADATA — no provider is
 * implemented, no external API is called, and registering changes no engine, score, report, or API.
 * It makes the platform's external-evidence gaps first-class + queryable, and lets a future phase wire
 * a real provider by flipping its descriptor + supplying an adapter — with NO engine modification.
 *
 * Priorities follow the BETA-AUDIT-004 trust roadmap (backlink authority is the #1 gap).
 */
import { registerProvider } from './providerRegistry';
import { PROVIDER_FAILURE } from './providerFailure';
import type { EvidenceProviderDescriptor } from './providerContract';

const unavailable = (
  d: Omit<EvidenceProviderDescriptor, 'authStatus' | 'connectionStatus' | 'health' | 'failureState'>,
): EvidenceProviderDescriptor => ({
  ...d,
  authStatus: 'unauthenticated',
  connectionStatus: 'disconnected',
  health: 'unknown',
  failureState: PROVIDER_FAILURE.UNAVAILABLE,
});

export const ANTICIPATED_PROVIDERS: EvidenceProviderDescriptor[] = [
  unavailable({
    providerId: 'backlink.authority', providerName: 'Backlink / Domain Authority (Ahrefs · Moz · Majestic)', version: '0.1.0',
    capabilities: ['backlinks', 'domain_authority', 'referring_domains', 'anchor_diversity', 'spam_score'],
    supportedEvidence: ['backlink_authority', 'referring_domains', 'domain_authority', 'dofollow_ratio'],
    rateLimits: { requestsPerWindow: 500, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 7, maxAgeHours: 24 * 30 },
    evidenceQuality: 'high', providerReliability: 0.9,
    consumerEngines: ['authority', 'authority.backlink', 'website.brand'],
    requiredEvidence: ['real referring domains + domain authority (currently inferred/null)'],
    currentWorkaround: 'authority is INFERRED from on-site/crawl signals; domain_authority is nullable/manual (BETA-AUDIT-004)',
    priority: 'critical', envKeys: ['AHREFS_API_KEY', 'MOZ_API_KEY', 'MAJESTIC_API_KEY'],
  }),
  unavailable({
    providerId: 'search_console', providerName: 'Google Search Console', version: '0.1.0',
    capabilities: ['keyword_metrics', 'impressions', 'clicks', 'position', 'ctr'],
    supportedEvidence: ['impressions', 'clicks', 'avg_position', 'ctr'],
    rateLimits: { requestsPerWindow: 1200, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 48, maxAgeHours: 24 * 16 },
    evidenceQuality: 'high', providerReliability: 0.95,
    consumerEngines: ['seo', 'geo.strategy', 'intent'],
    requiredEvidence: ['live keyword impressions/clicks/position'],
    currentWorkaround: 'consumed via ingested keyword_metrics table (already partially wired); provider slot canonicalises the source',
    priority: 'high', envKeys: ['GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET'],
  }),
  unavailable({
    providerId: 'analytics.ga4', providerName: 'Google Analytics 4', version: '0.1.0',
    capabilities: ['sessions', 'engagement', 'conversions', 'geo_sessions'],
    supportedEvidence: ['sessions', 'engagement_rate', 'conversions'],
    rateLimits: { requestsPerWindow: 600, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24, maxAgeHours: 24 * 7 },
    evidenceQuality: 'high', providerReliability: 0.92,
    consumerEngines: ['geo', 'geo.strategy', 'traffic', 'funnel', 'distribution', 'intent'],
    requiredEvidence: ['live session + conversion analytics'],
    currentWorkaround: 'consumed via ingested canonical_sessions table',
    priority: 'high', envKeys: ['GA4_PROPERTY_ID', 'GA4_OAUTH'],
  }),
  unavailable({
    providerId: 'bing_webmaster', providerName: 'Bing Webmaster Tools', version: '0.1.0',
    capabilities: ['keyword_metrics', 'crawl_stats'],
    supportedEvidence: ['bing_impressions', 'bing_clicks'],
    rateLimits: { requestsPerWindow: 300, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 72, maxAgeHours: 24 * 21 },
    evidenceQuality: 'medium', providerReliability: 0.8,
    consumerEngines: ['seo'],
    requiredEvidence: ['Bing search performance (currently none)'],
    currentWorkaround: 'not measured — Google-only SEO signal today',
    priority: 'low', envKeys: ['BING_WEBMASTER_API_KEY'],
  }),
  unavailable({
    providerId: 'reviews', providerName: 'Review Aggregator (G2 · Trustpilot · Google)', version: '0.1.0',
    capabilities: ['review_parity', 'review_volume', 'sentiment', 'rating'],
    supportedEvidence: ['review_source_count', 'review_parity', 'avg_rating'],
    rateLimits: { requestsPerWindow: 120, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 3, maxAgeHours: 24 * 30 },
    evidenceQuality: 'high', providerReliability: 0.85,
    consumerEngines: ['website.brand', 'trust', 'brandTrust'],
    requiredEvidence: ['real cross-platform review/reputation data'],
    currentWorkaround: 'brand trust from sparse community_ai_actions sentiment (INFERRED, often unavailable) — BETA-AUDIT-004',
    priority: 'medium', envKeys: ['REVIEWS_API_KEY'],
  }),
  unavailable({
    providerId: 'business_profiles', providerName: 'Google Business Profile', version: '0.1.0',
    capabilities: ['nap_consistency', 'local_presence', 'profile_completeness'],
    supportedEvidence: ['nap_consistency', 'profile_completeness'],
    rateLimits: { requestsPerWindow: 300, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 7, maxAgeHours: 24 * 30 },
    evidenceQuality: 'medium', providerReliability: 0.82,
    consumerEngines: ['website.brand', 'trust'],
    requiredEvidence: ['NAP consistency + local business presence'],
    currentWorkaround: 'not measured',
    priority: 'medium', envKeys: ['GBP_OAUTH'],
  }),
  unavailable({
    providerId: 'social_metrics', providerName: 'Social Metrics (LinkedIn · X · Meta)', version: '0.1.0',
    capabilities: ['follower_count', 'engagement_rate', 'posting_cadence'],
    supportedEvidence: ['social_reach', 'social_engagement'],
    rateLimits: { requestsPerWindow: 200, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24, maxAgeHours: 24 * 14 },
    evidenceQuality: 'medium', providerReliability: 0.75,
    consumerEngines: ['website.brand', 'distribution'],
    requiredEvidence: ['real social distribution + engagement'],
    currentWorkaround: 'social presence inferred from crawl social links only',
    priority: 'low', envKeys: ['SOCIAL_METRICS_API_KEY'],
  }),
  unavailable({
    providerId: 'entity_graph', providerName: 'Entity / Knowledge Graph (Wikidata · Google KG)', version: '0.1.0',
    capabilities: ['entity_resolution', 'sameas_links', 'schema_completeness'],
    supportedEvidence: ['entity_graph_strength', 'sameas_count', 'schema_completeness'],
    rateLimits: { requestsPerWindow: 300, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 14, maxAgeHours: 24 * 60 },
    evidenceQuality: 'high', providerReliability: 0.88,
    consumerEngines: ['crawl.public_domain_audit'],
    requiredEvidence: ['knowledge-graph entity presence (entity_graph_strength dimension has no engine)'],
    currentWorkaround: 'entity strength is a categorical rationale with no backing engine (BETA-AUDIT-003/004)',
    priority: 'medium', envKeys: ['WIKIDATA_ENABLED', 'GOOGLE_KG_API_KEY'],
  }),
  unavailable({
    providerId: 'llm_visibility', providerName: 'AI Visibility (ChatGPT · Gemini · Claude · Perplexity · Copilot)', version: '0.1.0',
    capabilities: ['citation_rate', 'answer_presence', 'mention_prominence'],
    supportedEvidence: ['ai_citation_rate', 'ai_answer_presence'],
    rateLimits: { requestsPerWindow: 60, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24, maxAgeHours: 24 * 7 },
    evidenceQuality: 'medium', providerReliability: 0.7,
    consumerEngines: ['crawl.public_domain_audit'],
    requiredEvidence: ['measured answer-engine citation presence'],
    currentWorkaround: 'GEO/AEO scores are structural proxies — no live answer-engine querying (BETA-AUDIT-004)',
    priority: 'medium', envKeys: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY'],
  }),
  unavailable({
    providerId: 'seo_provider', providerName: 'SEO Provider (Semrush)', version: '0.1.0',
    capabilities: ['keyword_difficulty', 'search_volume', 'serp_features'],
    supportedEvidence: ['keyword_difficulty', 'search_volume'],
    rateLimits: { requestsPerWindow: 300, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 3, maxAgeHours: 24 * 30 },
    evidenceQuality: 'high', providerReliability: 0.88,
    consumerEngines: ['seo', 'keyword'],
    requiredEvidence: ['keyword difficulty + external search volume'],
    currentWorkaround: 'demand inferred from GSC impressions only; no difficulty/volume',
    priority: 'medium', envKeys: ['SEMRUSH_API_KEY'],
  }),
  unavailable({
    providerId: 'competitor_provider', providerName: 'Competitor Intelligence (SERP · market data)', version: '0.1.0',
    capabilities: ['serp_discovery', 'competitor_authority', 'market_share'],
    supportedEvidence: ['competitor_authority', 'serp_overlap'],
    rateLimits: { requestsPerWindow: 200, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 2, maxAgeHours: 24 * 14 },
    evidenceQuality: 'medium', providerReliability: 0.75,
    consumerEngines: ['competitor.engine', 'competitor.discovery', 'competitor.unified'],
    requiredEvidence: ['real competitive authority + market data'],
    currentWorkaround: 'competitor authority inferred from text patterns; fallback fabricates market substitutes (BETA-AUDIT-004)',
    priority: 'high', envKeys: ['SERP_API_KEY'],
  }),
  unavailable({
    providerId: 'trust_signals', providerName: 'Trust Signals (NAP · expertise · credentials)', version: '0.1.0',
    capabilities: ['nap_consistency', 'expertise_signals', 'credential_verification'],
    supportedEvidence: ['nap_consistency', 'expertise_score'],
    rateLimits: { requestsPerWindow: 120, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24 * 7, maxAgeHours: 24 * 30 },
    evidenceQuality: 'medium', providerReliability: 0.78,
    consumerEngines: ['website.brand', 'trust'],
    requiredEvidence: ['cross-source trust + expertise verification'],
    currentWorkaround: 'trust coherence inferred from on-site consistency only',
    priority: 'medium', envKeys: ['TRUST_COHERENCE_ENABLED'],
  }),
  unavailable({
    providerId: 'commercial', providerName: 'Commercial Outcomes & Revenue (CRM · GA4 conversions · Stripe · leads)', version: '0.1.0',
    capabilities: ['revenue', 'conversions', 'conversion_value', 'pipeline', 'ltv', 'lead_conversion'],
    supportedEvidence: ['revenue', 'conversions', 'conversion_value', 'revenue_per_conversion', 'avg_order_value', 'lead_to_customer_rate', 'pipeline_value'],
    rateLimits: { requestsPerWindow: 300, windowSeconds: 60, remaining: null },
    freshness: { typicalAgeHours: 24, maxAgeHours: 24 * 30 },
    evidenceQuality: 'high', providerReliability: 0.9,
    consumerEngines: ['business.impact'],
    requiredEvidence: ['authenticated commercial outcomes — revenue / conversion value (closes the ROI Not-Determinable gap, BETA-ENGINE-012)'],
    currentWorkaround: 'ROI is Not-Determinable; opportunity is native-unit (clicks/reviews) only — no measured revenue',
    priority: 'high', envKeys: ['CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED'],
  }),
];

/**
 * Register every anticipated provider (all unavailable). Idempotent by providerId (registerProvider
 * overwrites), so it is safe to call repeatedly. Pure metadata — no I/O, no external API.
 */
export function registerAnticipatedProviders(): EvidenceProviderDescriptor[] {
  for (const p of ANTICIPATED_PROVIDERS) registerProvider(p);
  return ANTICIPATED_PROVIDERS;
}
