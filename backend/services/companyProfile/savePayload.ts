import type { CompanyProfile } from './types';
import { mergeStringArrays, splitToList } from './normalization';
import { withRecommendationContextDefaults } from '../../../utils/safeJson';

function serializeRecommendationContext(
  value: CompanyProfile['recommendation_context'] | undefined,
  fallback: CompanyProfile['recommendation_context'] | undefined,
): string | null {
  const context = value !== undefined ? value : fallback;
  if (!context || typeof context !== 'object') return null;
  return JSON.stringify(withRecommendationContextDefaults(context));
}

export function buildSavePayload(
  input: Partial<CompanyProfile>,
  existing: CompanyProfile | null,
  companyId: string,
  source: 'user' | 'ai_refined',
  lastRefinedAt: string | null,
  nowIso: string,
  confidenceScore: number
) {
  const logoUrl =
    input.logo_url !== undefined ? String(input.logo_url || '').trim() || null : existing?.logo_url ?? null;
  const faviconUrl =
    input.favicon_url !== undefined
      ? String(input.favicon_url || '').trim() || null
      : existing?.favicon_url ?? null;

  return {
    company_id: companyId,
    name: input.name ?? existing?.name ?? null,
    industry: input.industry ?? existing?.industry ?? null,
    category: input.category ?? existing?.category ?? null,
    business_classification: input.business_classification ?? existing?.business_classification ?? null,
    website_url: input.website_url ?? existing?.website_url ?? null,
    logo_url: logoUrl,
    favicon_url: faviconUrl,
    industry_list: mergeStringArrays(existing?.industry_list ?? splitToList(existing?.industry), input.industry_list ?? splitToList(input.industry)),
    category_list: mergeStringArrays(existing?.category_list ?? splitToList(existing?.category), input.category_list ?? splitToList(input.category)),
    geography_list: mergeStringArrays(existing?.geography_list ?? splitToList(existing?.geography), input.geography_list ?? splitToList(input.geography)),
    competitors_list: [],
    content_themes_list: mergeStringArrays(existing?.content_themes_list ?? splitToList(existing?.content_themes), input.content_themes_list ?? splitToList(input.content_themes)),
    products_services_list: mergeStringArrays(existing?.products_services_list ?? splitToList(existing?.products_services), input.products_services_list ?? splitToList(input.products_services)),
    target_audience_list: mergeStringArrays(existing?.target_audience_list ?? splitToList(existing?.target_audience), input.target_audience_list ?? splitToList(input.target_audience)),
    goals_list: mergeStringArrays(existing?.goals_list ?? splitToList(existing?.goals), input.goals_list ?? splitToList(input.goals)),
    brand_voice_list: mergeStringArrays(existing?.brand_voice_list ?? splitToList(existing?.brand_voice), input.brand_voice_list ?? splitToList(input.brand_voice)),
    social_profiles: input.social_profiles ?? existing?.social_profiles ?? null,
    field_confidence: input.field_confidence ?? existing?.field_confidence ?? null,
    overall_confidence: input.overall_confidence ?? existing?.overall_confidence ?? 0,
    source_urls: input.source_urls ?? existing?.source_urls ?? null,
    linkedin_url: input.linkedin_url ?? existing?.linkedin_url ?? null,
    facebook_url: input.facebook_url ?? existing?.facebook_url ?? null,
    instagram_url: input.instagram_url ?? existing?.instagram_url ?? null,
    x_url: input.x_url ?? existing?.x_url ?? null,
    youtube_url: input.youtube_url ?? existing?.youtube_url ?? null,
    tiktok_url: input.tiktok_url ?? existing?.tiktok_url ?? null,
    reddit_url: input.reddit_url ?? existing?.reddit_url ?? null,
    pinterest_url: input.pinterest_url ?? existing?.pinterest_url ?? null,
    whatsapp_url: input.whatsapp_url ?? existing?.whatsapp_url ?? null,
    blog_url: input.blog_url ?? existing?.blog_url ?? null,
    other_social_links: input.other_social_links ?? existing?.other_social_links ?? null,
    products_services: input.products_services ?? existing?.products_services ?? null,
    target_audience: input.target_audience ?? existing?.target_audience ?? null,
    geography: input.geography ?? existing?.geography ?? null,
    brand_voice: input.brand_voice ?? existing?.brand_voice ?? null,
    goals: input.goals ?? existing?.goals ?? null,
    competitors: null,
    unique_value: input.unique_value ?? existing?.unique_value ?? null,
    content_themes: input.content_themes ?? existing?.content_themes ?? null,
    confidence_score: confidenceScore,
    source,
    last_refined_at: lastRefinedAt,
    updated_at: nowIso,
    target_customer_segment: input.target_customer_segment ?? existing?.target_customer_segment ?? null,
    ideal_customer_profile: input.ideal_customer_profile ?? existing?.ideal_customer_profile ?? null,
    pricing_model: input.pricing_model ?? existing?.pricing_model ?? null,
    sales_motion: input.sales_motion ?? existing?.sales_motion ?? null,
    avg_deal_size: input.avg_deal_size ?? existing?.avg_deal_size ?? null,
    sales_cycle: input.sales_cycle ?? existing?.sales_cycle ?? null,
    key_metrics: input.key_metrics ?? existing?.key_metrics ?? null,
    user_locked_fields: input.user_locked_fields ?? existing?.user_locked_fields ?? [],
    last_edited_by: input.last_edited_by ?? existing?.last_edited_by ?? null,
    marketing_channels: input.marketing_channels ?? existing?.marketing_channels ?? null,
    content_strategy: input.content_strategy ?? existing?.content_strategy ?? null,
    campaign_focus: input.campaign_focus ?? existing?.campaign_focus ?? null,
    key_messages: input.key_messages ?? existing?.key_messages ?? null,
    brand_positioning: input.brand_positioning ?? existing?.brand_positioning ?? null,
    competitive_advantages: input.competitive_advantages ?? existing?.competitive_advantages ?? null,
    growth_priorities: input.growth_priorities ?? existing?.growth_priorities ?? null,
    campaign_purpose_intent: input.campaign_purpose_intent ?? existing?.campaign_purpose_intent ?? null,
    core_problem_statement: input.core_problem_statement ?? existing?.core_problem_statement ?? null,
    pain_symptoms: input.pain_symptoms ?? existing?.pain_symptoms ?? null,
    awareness_gap: input.awareness_gap ?? existing?.awareness_gap ?? null,
    problem_impact: input.problem_impact ?? existing?.problem_impact ?? null,
    life_with_problem: input.life_with_problem ?? existing?.life_with_problem ?? null,
    life_after_solution: input.life_after_solution ?? existing?.life_after_solution ?? null,
    desired_transformation: input.desired_transformation ?? existing?.desired_transformation ?? null,
    transformation_mechanism: input.transformation_mechanism ?? existing?.transformation_mechanism ?? null,
    authority_domains: input.authority_domains ?? existing?.authority_domains ?? null,
    forced_context_fields: input.forced_context_fields ?? existing?.forced_context_fields ?? null,
    recommendation_context: serializeRecommendationContext(
      input.recommendation_context,
      existing?.recommendation_context,
    ),
    strategic_inputs: input.strategic_inputs !== undefined ? input.strategic_inputs : existing?.strategic_inputs ?? null,
    report_settings: input.report_settings !== undefined ? input.report_settings : existing?.report_settings ?? null,
  };
}
