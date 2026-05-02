/**
 * Shared types, constants, and utilities for CompanyProfilePage.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompanyProfile = {
  company_id?: string;
  name?: string;
  industry?: string;
  category?: string;
  business_classification?: {
    level_1:
      | 'product_company'
      | 'services_company'
      | 'marketplace'
      | 'retailer'
      | 'distributor'
      | 'manufacturer'
      | 'hybrid';
    level_2: string;
    level_3: string[];
  } | null;
  website_url?: string;
  logo_url?: string;
  favicon_url?: string;
  industry_list?: string[];
  category_list?: string[];
  geography_list?: string[];
  competitors_list?: string[];
  content_themes_list?: string[];
  products_services_list?: string[];
  target_audience_list?: string[];
  goals_list?: string[];
  brand_voice_list?: string[];
  social_profiles?: Array<{ platform: string; url: string; source?: string; confidence?: string }>;
  field_confidence?: Record<string, string>;
  overall_confidence?: number;
  source_urls?: string[];
  linkedin_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  x_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
  reddit_url?: string;
  pinterest_url?: string;
  whatsapp_url?: string;
  blog_url?: string;
  other_social_links?: Array<{ label?: string; url?: string }>;
  products_services?: string;
  target_audience?: string;
  geography?: string;
  brand_voice?: string;
  goals?: string;
  competitors?: string;
  unique_value?: string;
  content_themes?: string;
  confidence_score?: number;
  source?: string;
  last_refined_at?: string | null;
  target_customer_segment?: string | null;
  ideal_customer_profile?: string | null;
  pricing_model?: string | null;
  sales_motion?: string | null;
  avg_deal_size?: string | null;
  sales_cycle?: string | null;
  key_metrics?: string | null;
  user_locked_fields?: string[] | null;
  last_edited_by?: string | null;
  marketing_channels?: string | null;
  content_strategy?: string | null;
  campaign_focus?: string | null;
  key_messages?: string | null;
  brand_positioning?: string | null;
  competitive_advantages?: string | null;
  growth_priorities?: string | null;
  campaign_purpose_intent?: {
    primary_objective?: string | null;
    campaign_intent?: string | null;
    monetization_intent?: string | null;
    dominant_problem_domains?: string[];
    brand_positioning_angle?: string | null;
  } | null;
  core_problem_statement?: string | null;
  pain_symptoms?: string[] | null;
  awareness_gap?: string | null;
  problem_impact?: string | null;
  life_with_problem?: string | null;
  life_after_solution?: string | null;
  desired_transformation?: string | null;
  transformation_mechanism?: string | null;
  authority_domains?: string[] | null;
  recommendation_context?: Record<string, any> | null;
  report_settings?: {
    company_facts?: {
      team_size?: string | null;
      founded_year?: string | null;
      revenue_range?: string | null;
      updated_at?: string | null;
    } | null;
    profile_review?: {
      last_confirmed_at?: string | null;
      next_confirmation_due_at?: string | null;
      confirmation_interval_days?: number | null;
      pending_confirmation?: boolean | null;
      last_confirmed_by_role?: string | null;
      updated_at?: string | null;
    } | null;
    market_pulse?: {
      primary_operating_markets?: string[] | null;
      target_expansion_markets?: string[] | null;
      named_competitors?: string[] | null;
      business_model?: string | null;
      provider_type?: string | null;
      domain_role?: string | null;
      operating_model?: string | null;
      solution_domains?: string[] | null;
      competitor_details?: Array<{
        name: string;
        category?: string | null;
        tier?: string | null;
        score?: number | null;
        confidence?: number | null;
        rationale?: string | null;
      }> | null;
      competitor_quality?: {
        highest_score?: number | null;
        threshold?: number | null;
        threshold_met?: boolean | null;
        detail_mode?: 'high_confidence' | 'expanded_context' | null;
      } | null;
      market_alternatives?: Array<{
        name: string;
        category?: string | null;
        tier?: string | null;
        score?: number | null;
        confidence?: number | null;
        rationale?: string | null;
        use_case?: string | null;
        business_model?: string | null;
      }> | null;
      core_offerings?: string[] | null;
      growth_priorities?: string[] | null;
      partnership_priorities?: string[] | null;
      critical_hiring_functions?: string[] | null;
      regulatory_policy_sensitivity?: string[] | null;
      default_categories?: string[] | null;
      exclusions?: string[] | null;
      preferred_regions?: string[] | null;
      updated_at?: string | null;
    } | null;
    intelligence?: {
      primary_objective?: string | null;
      primary_target_metric?: string | null;
      target_value?: string | null;
      time_horizon?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
      target_note?: string | null;
      updated_at?: string | null;
    } | null;
  } | null;
};

export type CompanyProfileRefinement = {
  id?: string;
  company_id?: string;
  before_profile?: any;
  after_profile?: any;
  source_urls?: Array<{ label: string; url: string }>;
  source_summaries?: Array<{ label: string; url: string; summary: string }>;
  changed_fields?: Array<{ field: string; before: any; after: any }>;
  extraction_output?: any;
  missing_fields_questions?: Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>;
  created_at?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const emptyProfile: CompanyProfile = {
  name: '',
  industry: '',
  category: '',
  business_classification: null,
  website_url: '',
  logo_url: '',
  favicon_url: '',
  linkedin_url: '',
  facebook_url: '',
  instagram_url: '',
  x_url: '',
  youtube_url: '',
  tiktok_url: '',
  reddit_url: '',
  pinterest_url: '',
  whatsapp_url: '',
  blog_url: '',
  other_social_links: [],
  products_services: '',
  target_audience: '',
  geography: '',
  brand_voice: '',
  goals: '',
  competitors: '',
  unique_value: '',
  content_themes: '',
  target_customer_segment: '',
  ideal_customer_profile: '',
  pricing_model: '',
  sales_motion: '',
  avg_deal_size: '',
  sales_cycle: '',
  key_metrics: '',
  marketing_channels: '',
  content_strategy: '',
  campaign_focus: '',
  key_messages: '',
  brand_positioning: '',
  competitive_advantages: '',
  growth_priorities: '',
  core_problem_statement: '',
  pain_symptoms: [],
  awareness_gap: '',
  problem_impact: '',
  life_with_problem: '',
  life_after_solution: '',
  desired_transformation: '',
  transformation_mechanism: '',
  authority_domains: [],
  report_settings: {
    company_facts: {
      team_size: '',
      founded_year: '',
      revenue_range: '',
      updated_at: null,
    },
    profile_review: {
      last_confirmed_at: null,
      next_confirmation_due_at: null,
      confirmation_interval_days: 183,
      pending_confirmation: false,
      last_confirmed_by_role: null,
      updated_at: null,
    },
    market_pulse: {
      primary_operating_markets: [],
      target_expansion_markets: [],
      named_competitors: [],
      business_model: '',
      provider_type: '',
      domain_role: '',
      operating_model: '',
      solution_domains: [],
      competitor_details: [],
      competitor_quality: null,
      market_alternatives: [],
      core_offerings: [],
      growth_priorities: [],
      partnership_priorities: [],
      critical_hiring_functions: [],
      regulatory_policy_sensitivity: [],
      default_categories: [],
      exclusions: [],
      preferred_regions: [],
      updated_at: null,
    },
    intelligence: {
      primary_objective: '',
      primary_target_metric: '',
      target_value: '',
      time_horizon: 'monthly',
      target_note: '',
      updated_at: null,
    },
  },
};

// ── Utility functions ─────────────────────────────────────────────────────────

export const splitToList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const joinList = (value?: string[] | null, fallback?: string | null): string => {
  if (Array.isArray(value) && value.length > 0) {
    return value.join(', ');
  }
  return fallback || '';
};

export const normalizeProfileSocialUrl = (value?: string | null): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parse = (input: string): string | null => {
    try {
      const parsed = new URL(input);
      parsed.hash = '';
      parsed.search = '';
      parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const path = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = path || '/';
      const normalized = parsed.toString().replace(/\/$/, '');
      return normalized.replace(/^https:\/\/twitter\.com/i, 'https://x.com').toLowerCase();
    } catch {
      return null;
    }
  };
  return parse(raw) ?? parse(`https://${raw}`);
};

export const dedupeSocialProfiles = (
  profiles?: Array<{ platform: string; url: string; source?: string; confidence?: string }> | null,
): Array<{ platform: string; url: string; source?: string; confidence?: string }> => {
  const deduped = new Map<string, { platform: string; url: string; source?: string; confidence?: string }>();
  (profiles || []).forEach((entry) => {
    const normalized = normalizeProfileSocialUrl(entry.url);
    if (!normalized) return;
    const platform = String(entry.platform || 'social').trim().toLowerCase();
    const key = `${platform}:${normalized}`;
    if (!deduped.has(key)) {
      deduped.set(key, { ...entry, platform, url: normalized });
    }
  });
  return Array.from(deduped.values());
};

export const buildSocialProfilesFromScalars = (
  profile: CompanyProfile
): Array<{ platform: string; url: string; source?: string; confidence?: string }> => {
  const candidates = [
    { platform: 'linkedin', url: profile.linkedin_url },
    { platform: 'facebook', url: profile.facebook_url },
    { platform: 'instagram', url: profile.instagram_url },
    { platform: 'x', url: profile.x_url },
    { platform: 'youtube', url: profile.youtube_url },
    { platform: 'tiktok', url: profile.tiktok_url },
    { platform: 'reddit', url: profile.reddit_url },
    { platform: 'pinterest', url: profile.pinterest_url },
    { platform: 'whatsapp', url: profile.whatsapp_url },
    { platform: 'blog', url: profile.blog_url },
  ].filter((entry) => entry.url);

  return dedupeSocialProfiles([...(profile.social_profiles || []), ...candidates]);
};
export default function CompanyProfileTypesPage() {
  return null;
}
