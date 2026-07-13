/**
 * knowledgeConsumerProfiles.ts — declarative consumer requirements (CKC-001 §2/§3).
 *
 * ONE place that says which knowledge domains and default mode each AI capability
 * needs. This is what makes the assembler send ONLY the required knowledge instead
 * of the whole object. Pure frozen registry — no logic, no duplication. New AI
 * modules extend this table; they do not write their own assembler.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import type { KnowledgeConsumerId, KnowledgeContextMode } from './knowledgeContextContracts';

export interface ConsumerProfile {
  consumer: KnowledgeConsumerId;
  /** Domains this consumer needs by default (minimization baseline). */
  domains: KnowledgeDomainId[];
  /** Default optimization mode. */
  mode: KnowledgeContextMode;
  /** Default minimum per-domain confidence (0 = no floor). */
  minConfidence: number;
  description: string;
}

const P = (
  consumer: KnowledgeConsumerId, domains: KnowledgeDomainId[], mode: KnowledgeContextMode, minConfidence: number, description: string,
): ConsumerProfile => ({ consumer, domains, mode, minConfidence, description });

const PROFILES_INTERNAL: Record<string, ConsumerProfile> = {
  CONTENT_WRITER:          P('CONTENT_WRITER', ['IDENTITY', 'BRAND', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'PRODUCTS', 'SERVICES'], 'summary', 0, 'Long/short-form copy — voice, audience, positioning, offerings.'),
  CONTENT_CREATOR:         P('CONTENT_CREATOR', ['IDENTITY', 'BRAND', 'AUDIENCE', 'PRODUCTS', 'SERVICES', 'SOCIAL'], 'summary', 0, 'Visual/creator assets — brand, audience, offerings, social.'),
  CAMPAIGN_PLANNER:        P('CAMPAIGN_PLANNER', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'INDUSTRY', 'COMPETITORS', 'PRODUCTS', 'SERVICES'], 'summary', 0, 'Campaign strategy — audience, positioning, market, offerings.'),
  STRATEGIC_MIX:           P('STRATEGIC_MIX', ['MARKETING', 'AUDIENCE', 'POSITIONING', 'INDUSTRY', 'SOCIAL'], 'summary', 0, 'Channel/format mix — marketing, audience, positioning, social.'),
  SEO:                     P('SEO', ['IDENTITY', 'WEBSITE', 'SEO', 'INDUSTRY', 'PRODUCTS', 'SERVICES'], 'summary', 0, 'SEO intelligence — website, keywords, industry, offerings.'),
  GROWTH_INTELLIGENCE:     P('GROWTH_INTELLIGENCE', ['IDENTITY', 'AUDIENCE', 'MARKETING', 'INDUSTRY', 'COMPANY_INTELLIGENCE', 'COMPETITORS'], 'summary', 0, 'Growth signals — audience, market, company intelligence.'),
  RECOMMENDATION_ENGINE:   P('RECOMMENDATION_ENGINE', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'PRODUCTS', 'SERVICES', 'COMPANY_INTELLIGENCE'], 'summary', 0, 'Recommendations — audience, positioning, offerings, intel.'),
  COMPETITOR_INTELLIGENCE: P('COMPETITOR_INTELLIGENCE', ['IDENTITY', 'INDUSTRY', 'POSITIONING', 'COMPETITORS', 'PRODUCTS', 'SERVICES'], 'summary', 0, 'Competitor analysis — industry, positioning, competitors.'),
  WEBSITE_INTELLIGENCE:    P('WEBSITE_INTELLIGENCE', ['IDENTITY', 'WEBSITE', 'BRAND', 'SEO', 'METADATA'], 'full', 0, 'Website intelligence — website, brand, SEO, metadata.'),
};

export const CONSUMER_PROFILES: Readonly<Record<string, ConsumerProfile>> = PROFILES_INTERNAL;
export const KNOWN_CONSUMERS: ReadonlyArray<string> = Object.keys(PROFILES_INTERNAL);

/**
 * Resolve a consumer's profile. Unknown consumers get a safe default (all-domains,
 * summary) so the framework never fails to serve — extensibility without breakage.
 */
export function resolveConsumerProfile(consumer: KnowledgeConsumerId): ConsumerProfile {
  return PROFILES_INTERNAL[consumer] ?? P(consumer, [
    'IDENTITY', 'BRAND', 'WEBSITE', 'PRODUCTS', 'SERVICES', 'AUDIENCE', 'INDUSTRY',
    'POSITIONING', 'MARKETING', 'SEO', 'SOCIAL', 'COMPETITORS', 'COMPANY_INTELLIGENCE', 'METADATA',
  ], 'summary', 0, 'Default profile (unknown consumer).');
}
