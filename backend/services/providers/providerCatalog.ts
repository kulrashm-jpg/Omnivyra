/**
 * Canonical External-Provider Catalog (operational metadata)
 * ----------------------------------------------------------
 * ONE declaration of every external provider's OPERATIONAL contract — the single
 * source of truth the cost governor and health service read. Each provider
 * declares the required nine fields:
 *   id, category, authType, quota, pricingModel, enabled, health, timeout, retry
 *
 * This is the operational layer. It does NOT replace the functional adapters
 * (backend/services/intelligence/adapters/*) or the test-only Evidence-Platform
 * descriptors — those remain the implementation surfaces. This catalog is what
 * governance/health consult so provider metadata is declared in exactly one place.
 *
 * `enabled`/`health` here are the DEFAULTS; live enabled/health are computed by
 * providerHealthService from credentials + kill-switch + governor state.
 */

import type { CostCategory } from '../../types/costGovernance';

export type ProviderCategory =
  | 'llm'
  | 'backlink'
  | 'entity'
  | 'search'
  | 'analytics'
  | 'reputation'
  | 'competitor'
  | 'commercial'
  | 'social';

export type ProviderAuthType = 'api_key' | 'oauth' | 'none';

export type ProviderPricingModel = 'free' | 'freemium' | 'pay_per_request' | 'subscription';

export type ProviderHealthDefault = 'unknown';

/** Where cost enforcement happens for this provider's outbound calls. */
export type GovernedVia = 'governor' | 'ai_gateway' | 'none';

export interface ProviderQuota {
  /** Provider-side rate ceiling, if known. */
  requestsPerWindow?: number;
  windowSeconds?: number;
  /** Optional monthly unit budget default (governor may override via env). */
  monthlyUnits?: number | null;
}

export interface ProviderRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface ProviderDescriptor {
  id: string;
  category: ProviderCategory;
  authType: ProviderAuthType;
  quota: ProviderQuota | null;
  pricingModel: ProviderPricingModel;
  /** Default operational enablement (live value computed by the health service). */
  enabled: boolean;
  /** Default health (live value computed by the health service). */
  health: ProviderHealthDefault;
  timeoutMs: number;
  retryPolicy: ProviderRetryPolicy;
  /** Env keys whose presence authenticates the provider. */
  envKeys: string[];
  /** A paid provider MUST pass through the cost governor. */
  paid: boolean;
  /** Enforcement point for this provider's spend. */
  governedVia: GovernedVia;
  /** Whether an adapter/ingestion path is actually built today. */
  integrated: boolean;
  /** Cost-governance category this provider's spend maps to. */
  costCategory: CostCategory;
}

const DEFAULT_RETRY: ProviderRetryPolicy = { maxAttempts: 2, backoffMs: 500 };

function d(p: ProviderDescriptor): ProviderDescriptor {
  return p;
}

/**
 * THE canonical provider catalog. Adding a provider = one entry here.
 * ids are the same identifiers used by the intelligence adapters (fetchProduction
 * providerId) so the governor keys line up with real call sites.
 */
export const PROVIDER_CATALOG: Record<string, ProviderDescriptor> = {
  // ── LLMs (visibility probes go through the governor via fetchProduction;
  //    chat completions are governed separately by aiGateway) ──────────────────
  chatgpt:    d({ id: 'chatgpt', category: 'llm', authType: 'api_key', quota: { requestsPerWindow: 8, windowSeconds: 1 }, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 30_000, retryPolicy: DEFAULT_RETRY, envKeys: ['OPENAI_API_KEY'], paid: true, governedVia: 'ai_gateway', integrated: true, costCategory: 'connector' }),
  claude:     d({ id: 'claude', category: 'llm', authType: 'api_key', quota: { requestsPerWindow: 4, windowSeconds: 1 }, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 30_000, retryPolicy: DEFAULT_RETRY, envKeys: ['ANTHROPIC_API_KEY'], paid: true, governedVia: 'ai_gateway', integrated: true, costCategory: 'connector' }),
  gemini:     d({ id: 'gemini', category: 'llm', authType: 'api_key', quota: null, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 30_000, retryPolicy: DEFAULT_RETRY, envKeys: ['GEMINI_API_KEY'], paid: true, governedVia: 'governor', integrated: true, costCategory: 'connector' }),
  perplexity: d({ id: 'perplexity', category: 'llm', authType: 'api_key', quota: null, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 30_000, retryPolicy: DEFAULT_RETRY, envKeys: ['PERPLEXITY_API_KEY'], paid: true, governedVia: 'governor', integrated: true, costCategory: 'connector' }),
  copilot:    d({ id: 'copilot', category: 'llm', authType: 'api_key', quota: null, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 30_000, retryPolicy: DEFAULT_RETRY, envKeys: ['AZURE_COPILOT_API_KEY'], paid: true, governedVia: 'governor', integrated: true, costCategory: 'connector' }),

  // ── Backlink / authority ────────────────────────────────────────────────────
  ahrefs:     d({ id: 'ahrefs', category: 'backlink', authType: 'api_key', quota: { requestsPerWindow: 30, windowSeconds: 60 }, pricingModel: 'subscription', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['AHREFS_API_KEY'], paid: true, governedVia: 'governor', integrated: true, costCategory: 'connector' }),

  // ── Entity / knowledge graph (free, keyless) ────────────────────────────────
  wikidata:   d({ id: 'wikidata', category: 'entity', authType: 'none', quota: null, pricingModel: 'free', enabled: true, health: 'unknown', timeoutMs: 15_000, retryPolicy: DEFAULT_RETRY, envKeys: [], paid: false, governedVia: 'governor', integrated: true, costCategory: 'connector' }),

  // ── Competitor / SERP ───────────────────────────────────────────────────────
  serpapi:    d({ id: 'serpapi', category: 'competitor', authType: 'api_key', quota: null, pricingModel: 'subscription', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['SERPAPI_API_KEY'], paid: true, governedVia: 'governor', integrated: true, costCategory: 'connector' }),
  dataforseo: d({ id: 'dataforseo', category: 'competitor', authType: 'api_key', quota: null, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'], paid: true, governedVia: 'governor', integrated: false, costCategory: 'connector' }),
  similarweb: d({ id: 'similarweb', category: 'analytics', authType: 'api_key', quota: null, pricingModel: 'subscription', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['SIMILARWEB_API_KEY'], paid: true, governedVia: 'governor', integrated: false, costCategory: 'connector' }),

  // ── First-party Google (OAuth, free tier) ───────────────────────────────────
  search_console: d({ id: 'search_console', category: 'search', authType: 'oauth', quota: null, pricingModel: 'free', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET'], paid: false, governedVia: 'governor', integrated: true, costCategory: 'connector' }),
  ga4:            d({ id: 'ga4', category: 'analytics', authType: 'oauth', quota: null, pricingModel: 'free', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['GA4_PROPERTY_ID', 'GA4_OAUTH'], paid: false, governedVia: 'governor', integrated: true, costCategory: 'connector' }),
  bing_webmaster: d({ id: 'bing_webmaster', category: 'search', authType: 'api_key', quota: null, pricingModel: 'free', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['BING_WEBMASTER_API_KEY'], paid: false, governedVia: 'governor', integrated: false, costCategory: 'connector' }),

  // ── Reputation (paid; ingestion unbuilt) ────────────────────────────────────
  reviews:    d({ id: 'reviews', category: 'reputation', authType: 'api_key', quota: null, pricingModel: 'pay_per_request', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['REVIEWS_API_KEY'], paid: true, governedVia: 'governor', integrated: false, costCategory: 'connector' }),

  // ── Commercial (CRM/GA4/Stripe consolidation; no direct paid HTTP) ──────────
  commercial: d({ id: 'commercial', category: 'commercial', authType: 'none', quota: null, pricingModel: 'free', enabled: false, health: 'unknown', timeoutMs: 20_000, retryPolicy: DEFAULT_RETRY, envKeys: ['CRM_ENABLED'], paid: false, governedVia: 'none', integrated: true, costCategory: 'connector' }),
};

export type ProviderId = keyof typeof PROVIDER_CATALOG;

export const ALL_PROVIDER_IDS: string[] = Object.keys(PROVIDER_CATALOG);

export function getProviderDescriptor(id: string): ProviderDescriptor | null {
  return PROVIDER_CATALOG[id] ?? null;
}

/** Paid providers that must pass through the cost governor. */
export function paidProviderIds(): string[] {
  return ALL_PROVIDER_IDS.filter((id) => PROVIDER_CATALOG[id].paid);
}
