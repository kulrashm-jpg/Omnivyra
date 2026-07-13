/**
 * companyKnowledgeModel.ts — the canonical Company Knowledge Model (CKRE-003 §1).
 *
 * ONE deterministic organization of the company's knowledge into domains. It
 * COMPOSES the existing company_profiles row (+ report_settings) — it stores no
 * new fields and duplicates nothing. Pure: given a profile row it always yields
 * the same domain projection.
 *
 * Domains map to existing columns/JSONB; nothing here writes or re-derives
 * intelligence. This is the read-model the Knowledge Entity + Diff engine speak.
 */

export type KnowledgeDomainId =
  | 'IDENTITY'
  | 'BRAND'
  | 'WEBSITE'
  | 'PRODUCTS'
  | 'SERVICES'
  | 'AUDIENCE'
  | 'INDUSTRY'
  | 'POSITIONING'
  | 'MARKETING'
  | 'SEO'
  | 'SOCIAL'
  | 'COMPETITORS'
  | 'COMPANY_INTELLIGENCE'
  | 'METADATA';

export const KNOWLEDGE_DOMAINS: ReadonlyArray<KnowledgeDomainId> = [
  'IDENTITY', 'BRAND', 'WEBSITE', 'PRODUCTS', 'SERVICES', 'AUDIENCE', 'INDUSTRY',
  'POSITIONING', 'MARKETING', 'SEO', 'SOCIAL', 'COMPETITORS', 'COMPANY_INTELLIGENCE', 'METADATA',
];

/** One domain's composed knowledge: field values (from existing columns) + provenance. */
export interface KnowledgeDomain {
  domain: KnowledgeDomainId;
  fields: Record<string, unknown>;
  /** Source columns/keys composed into this domain (documentation / diff attribution). */
  sourceFields: string[];
}

export interface CompanyKnowledgeDomains {
  companyId: string;
  domains: Record<KnowledgeDomainId, KnowledgeDomain>;
}

/** Profile row shape (subset we read). Loosely typed — additive tolerant. */
export type ProfileRow = Record<string, unknown>;

const val = (row: ProfileRow, key: string): unknown => {
  const v = row[key];
  return v === undefined ? null : v;
};

function discovered(row: ProfileRow): Record<string, unknown> {
  const rs = row.report_settings;
  const dm = (rs && typeof rs === 'object' ? (rs as Record<string, unknown>).discovered_metadata : null);
  return dm && typeof dm === 'object' ? (dm as Record<string, unknown>) : {};
}

/** Deterministic domain → source-column mapping. */
const DOMAIN_FIELDS: Record<KnowledgeDomainId, string[]> = {
  IDENTITY:      ['name', 'website_url', 'geography'],
  BRAND:         ['logo_url', 'favicon_url', 'brand_voice', 'brand_voice_list'],
  WEBSITE:       ['website_url'],
  PRODUCTS:      ['products_services', 'products_services_list'],
  SERVICES:      ['products_services', 'products_services_list'],
  AUDIENCE:      ['target_audience', 'target_audience_list', 'target_customer_segment', 'ideal_customer_profile'],
  INDUSTRY:      ['industry', 'category', 'industry_list', 'category_list'],
  POSITIONING:   ['unique_value', 'brand_positioning', 'competitive_advantages'],
  MARKETING:     ['marketing_channels', 'content_strategy', 'campaign_focus', 'key_messages', 'content_themes', 'content_themes_list', 'growth_priorities'],
  SEO:           [], // sourced from discovered_metadata below
  SOCIAL:        ['social_profiles', 'linkedin_url', 'facebook_url', 'instagram_url', 'x_url', 'youtube_url', 'tiktok_url', 'reddit_url', 'pinterest_url', 'whatsapp_url', 'blog_url', 'other_social_links'],
  COMPETITORS:   ['competitors', 'competitors_list'],
  COMPANY_INTELLIGENCE: ['business_classification', 'pricing_model', 'sales_motion', 'avg_deal_size', 'sales_cycle', 'key_metrics', 'overall_confidence'],
  METADATA:      ['field_confidence', 'source_urls', 'last_refined_at', 'source', 'user_locked_fields'],
};

/**
 * Compose the canonical knowledge domains from a company_profiles row. Pure —
 * no I/O, no AI. Missing columns compose as null (additive tolerant).
 */
export function composeKnowledgeDomains(companyId: string, row: ProfileRow): CompanyKnowledgeDomains {
  const dm = discovered(row);
  const domains = {} as Record<KnowledgeDomainId, KnowledgeDomain>;

  for (const domain of KNOWLEDGE_DOMAINS) {
    const sourceFields = DOMAIN_FIELDS[domain];
    const fields: Record<string, unknown> = {};
    for (const f of sourceFields) fields[f] = val(row, f);

    // Domains that draw from discovered_metadata (composed, not duplicated).
    if (domain === 'IDENTITY') { fields.language = dm.language ?? null; fields.site_name = dm.site_name ?? null; }
    if (domain === 'BRAND')    { fields.brand_color = dm.brand_color ?? null; }
    if (domain === 'WEBSITE')  { fields.title = dm.title ?? null; fields.description = dm.description ?? null; fields.open_graph = dm.open_graph ?? null; }
    if (domain === 'SEO')      { fields.seo_keywords = dm.seo_keywords ?? null; fields.open_graph = dm.open_graph ?? null; }

    domains[domain] = { domain, fields, sourceFields };
  }

  return { companyId, domains };
}

/** Deterministic per-domain confidence (0–100) from field_confidence / overall_confidence. */
export function domainConfidence(row: ProfileRow, domain: KnowledgeDomainId): number {
  const overall = Number(val(row, 'overall_confidence') ?? 0);
  const fc = row.field_confidence;
  if (fc && typeof fc === 'object') {
    const entries = DOMAIN_FIELDS[domain]
      .map((f) => (fc as Record<string, unknown>)[f])
      .filter((e) => e && typeof e === 'object') as Array<{ confidence?: unknown }>;
    if (entries.length) {
      const scoreOf = (c: unknown): number =>
        c === 'high' ? 90 : c === 'medium' ? 60 : c === 'low' ? 30 : typeof c === 'number' ? Math.round(c * 100) : 50;
      const avg = Math.round(entries.reduce((s, e) => s + scoreOf(e.confidence), 0) / entries.length);
      return Math.max(0, Math.min(100, avg));
    }
  }
  return Math.max(0, Math.min(100, Number.isFinite(overall) ? overall : 0));
}
