export type StrategyProfile = {
  worldview?: string | null;
  contrarianBeliefs?: string[] | null;
  primaryFocus?: string[] | null;
  differentiation?: string[] | null;
  typicalAngles?: string[] | null;
};

export type RecommendationContext = {
  version: number;
  key_threat: string;
  biggest_advantage: string;
  strategic_focus: string;
  contrarian_beliefs: string[];
  typical_angles: string[];
  insights: Array<Record<string, unknown>>;
};

export type CompanyProfile = {
  id?: string;
  company_id: string;
  name?: string;
  industry?: string;
  category?: string;
  website_url?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
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
  source?: 'user' | 'ai_refined';
  last_refined_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // Commercial Strategy
  target_customer_segment?: string | null;
  ideal_customer_profile?: string | null;
  pricing_model?: string | null;
  sales_motion?: string | null;
  avg_deal_size?: string | null;
  sales_cycle?: string | null;
  key_metrics?: string | null;
  user_locked_fields?: string[] | null;
  last_edited_by?: string | null;
  // Marketing Intelligence
  marketing_channels?: string | null;
  content_strategy?: string | null;
  campaign_focus?: string | null;
  key_messages?: string | null;
  brand_positioning?: string | null;
  competitive_advantages?: string | null;
  growth_priorities?: string | null;
  // Campaign Purpose & Strategic Intent (from Define Target Customer / Define Strategic Purpose)
  campaign_purpose_intent?: {
    primary_objective?: string | null;
    campaign_intent?: string | null;
    monetization_intent?: string | null;
    dominant_problem_domains?: string[];
    brand_positioning_angle?: string | null;
    /** Target emotional state we want the reader to feel (e.g. "confident", "curious", "urgent"). */
    reader_emotion_target?: string | null;
    /**
     * Narrative progression seed for weekly planning.
     * Can be a string (legacy/freeform) or a structured object.
     */
    narrative_flow_seed?:
      | string
      | {
          pattern?: string | null;
          steps?: string[] | null;
        }
      | null;
    /** Recommended CTA style aligned to campaign type (e.g. "Soft", "Direct", "Engagement", "Light"). */
    recommended_cta_style?: string | null;
  } | null;
  // Problem & Transformation Intelligence
  core_problem_statement?: string | null;
  pain_symptoms?: string[] | null;
  awareness_gap?: string | null;
  problem_impact?: string | null;
  life_with_problem?: string | null;
  life_after_solution?: string | null;
  desired_transformation?: string | null;
  transformation_mechanism?: string | null;
  authority_domains?: string[] | null;
  /** User-selected signals that MUST be injected into AI context. */
  forced_context_fields?: Record<string, boolean> | null;
  /** Company-only context for recommendations; used when generating Trend/Lead recommendations for this company. */
  recommendation_context?: RecommendationContext | null;
  /** Content Architect–editable strategic inputs for Trend Campaigns (aspects, offerings by aspect, objectives). */
  strategic_inputs?: {
    strategic_aspects?: string[];
    offerings_by_aspect?: Record<string, string[]>;
    strategic_objectives?: string[];
  } | null;
  /** User-configured content types per social platform: { linkedin: ['post', 'article'], ... }. Empty = use system defaults. */
  platform_content_type_prefs?: Record<string, string[]> | null;
  /** Persisted report defaults and integration-derived report setup state. */
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
    default_inputs?: {
      company_name?: string | null;
      website_domain?: string | null;
      business_type?: string | null;
      geography?: string | null;
      social_links?: string[] | null;
      competitors?: string[] | null;
    } | null;
    market_pulse?: {
      primary_operating_markets?: string[] | null;
      target_expansion_markets?: string[] | null;
      named_competitors?: string[] | null;
      business_model?: string | null;
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
    integrations?: Record<string, boolean> | null;
    last_report_source?: string | null;
    last_uploaded_file_name?: string | null;
    updated_at?: string | null;
  } | null;
};

export type NormalizedCompanyProfile = {
  base: CompanyProfile | null;
  categories: string[];
  target_audience: {
    age_range?: string;
    gender?: string;
    personas?: string[];
  } | null;
  geo_focus: string[];
  brand_type: string | null;
};

export type CompanyProfileRefinementDetails = {
  company_id: string;
  before_profile: CompanyProfile;
  after_profile: CompanyProfile;
  source_urls: Array<{ label: string; url: string }>;
  source_summaries: Array<{ label: string; url: string; summary: string }>;
  changed_fields: Array<{ field: string; before: any; after: any }>;
  created_at: string;
  extraction_output?: CompanyProfileExtractionOutput;
  missing_fields_questions?: Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>;
};

export type ProfileCompletenessResult = {
  score: number;
  section_scores: {
    identity: number;
    brand_strategy: number;
    customer_icp: number;
    problem_transformation: number;
    campaign_guidance: number;
    commercial: number;
  };
  missing_sections: string[];
};

export type ProblemTransformationQuestionsResult = {
  section: 'problem_transformation_intelligence';
  questions: string[];
};

export type ProblemTransformationRefinedOutput = {
  core_problem_statement: string | null;
  pain_symptoms: string[];
  awareness_gap: string | null;
  problem_impact: string | null;
  life_with_problem: string | null;
  life_after_solution: string | null;
  desired_transformation: string | null;
  transformation_mechanism: string | null;
  authority_domains: string[];
};

export type ProblemTransformationExistingFields = Partial<{
  core_problem_statement: string | null;
  pain_symptoms: string[];
  awareness_gap: string | null;
  problem_impact: string | null;
  life_with_problem: string | null;
  life_after_solution: string | null;
  desired_transformation: string | null;
  transformation_mechanism: string | null;
  authority_domains: string[];
}>;

export type ProblemTransformationPromptResult = {
  systemPrompt: string;
  userPrompt: string;
};

export type SaveProfileOptions = {
  source?: 'user' | 'ai_refined';
};

// Inferred from zod schema; kept as a named type for internal use across sub-modules.
export type CompanyProfileExtractionOutput = {
  company_name?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  industry?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  category?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  website_url?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  social_profiles?: {
    linkedin?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    facebook?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    instagram?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    x?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    youtube?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    tiktok?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    reddit?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
    blog?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  };
  geography?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  products_services?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  target_audience?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  brand_voice?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  goals?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  competitors?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  unique_value_proposition?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  content_themes?: { value?: string | string[] | null; values?: string | string[] | null; source: 'website' | 'social' | 'inferred' | 'user' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
  missing_fields?: string[];
};

export type EnrichmentField = {
  value: string | string[] | null;
  source: 'website' | 'social' | 'inferred' | 'missing';
  confidence: 'High' | 'Medium' | 'Low';
};

export type EnrichmentOutput = {
  competitors?: EnrichmentField;
  social_profiles?: {
    linkedin?: EnrichmentField;
    facebook?: EnrichmentField;
    instagram?: EnrichmentField;
    x?: EnrichmentField;
    youtube?: EnrichmentField;
    tiktok?: EnrichmentField;
    reddit?: EnrichmentField;
    blog?: EnrichmentField;
  };
  geography?: EnrichmentField;
  content_themes?: EnrichmentField;
  target_audience?: EnrichmentField;
};

export type ExtractedEvidence = {
  title?: string | null;
  meta_description?: string | null;
  og_description?: string | null;
  headings?: string[];
  highlights?: string[];
};
