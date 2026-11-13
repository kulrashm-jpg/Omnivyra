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

/**
 * D2 (e1 2026-11-13): profile lists used to be UNION-merged on every save, so a user could never delete an item.
 * A USER save may now name lists to REPLACE (`replace_lists: ['goals_list', ...]`, with the new list in the same
 * body). AI refine / enrich (source 'ai_refined', or any caller that does not name a list) keeps the union.
 * The route refuses a bulk removal without explicit confirmation (assessListReplace).
 */
export const REPLACEABLE_LISTS = {
  industry_list: 'industry',
  category_list: 'category',
  geography_list: 'geography',
  content_themes_list: 'content_themes',
  products_services_list: 'products_services',
  target_audience_list: 'target_audience',
  goals_list: 'goals',
  brand_voice_list: 'brand_voice',
} as const;
export type ReplaceableList = keyof typeof REPLACEABLE_LISTS;

/** The requested replacements: known list names whose new list is present as an array. */
export function readReplaceLists(input: Record<string, unknown>): { valid: ReplaceableList[]; invalid: string[] } {
  const raw = input.replace_lists;
  const names = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const valid: ReplaceableList[] = [];
  const invalid: string[] = [];
  for (const n of names) {
    const name = String(n);
    if (Object.prototype.hasOwnProperty.call(REPLACEABLE_LISTS, name) && Array.isArray(input[name])) valid.push(name as ReplaceableList);
    else invalid.push(name);
  }
  return { valid, invalid };
}

/** The stored list exactly as the union merge reads it (the list column, else the split text column). */
export function storedList(existing: Partial<CompanyProfile> | null | undefined, field: ReplaceableList): string[] {
  const e = (existing ?? {}) as Record<string, unknown>;
  const list = e[field];
  return mergeStringArrays([], Array.isArray(list) ? (list as string[]) : splitToList(e[REPLACEABLE_LISTS[field]] as string | null));
}

/**
 * Bulk-removal guard (05): more than 5 items, or more than half of the list (and more than one item).
 * Deliberate choices (05 review): harm is the NUMBER of items lost, not the fraction - a single removal never
 * prompts (removing a 1-item list's only item is routine and visible); "more than half" is strict, so exactly 2 of 4
 * does not prompt (modest loss, modest proportion). Competitors are NOT a replaceable list: the server re-ranks and
 * caps them and a guidance overlay owns pinned / rejected / user-added names - removal already works through the
 * REJECT path (rejected names are never re-added), and a generic replace would fight that overlay.
 */
export const BULK_REMOVAL_ABSOLUTE = 5;
export function isBulkRemoval(stored: number, removed: number): boolean {
  return removed > BULK_REMOVAL_ABSOLUTE || (removed > 1 && removed * 2 > stored);
}
export function assessListReplace(
  existing: Partial<CompanyProfile> | null | undefined,
  input: Record<string, unknown>,
): Array<{ field: ReplaceableList; stored: number; removed: string[]; bulk: boolean }> {
  return readReplaceLists(input).valid.map((field) => {
    const before = storedList(existing, field);
    const after = new Set(mergeStringArrays([], input[field] as string[]).map((x) => x.toLowerCase()));
    const removed = before.filter((x) => !after.has(x.toLowerCase()));
    return { field, stored: before.length, removed, bulk: isBulkRemoval(before.length, removed.length) };
  });
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
  // D2: a USER save that names a list REPLACES it; everything else is the union (never shrinks).
  const replacing = source === 'user' ? new Set(readReplaceLists(input as Record<string, unknown>).valid) : new Set<ReplaceableList>();
  const listFor = (field: ReplaceableList): string[] => {
    const textKey = REPLACEABLE_LISTS[field];
    const inputList = (input as Record<string, unknown>)[field] as string[] | null | undefined;
    if (replacing.has(field)) return mergeStringArrays([], inputList ?? []);
    const existingList = (existing as Record<string, unknown> | null)?.[field] as string[] | null | undefined;
    return mergeStringArrays(
      existingList ?? splitToList((existing as Record<string, unknown> | null)?.[textKey] as string | null | undefined),
      inputList ?? splitToList((input as Record<string, unknown>)[textKey] as string | null | undefined),
    );
  };
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
    industry_list: listFor('industry_list'),
    category_list: listFor('category_list'),
    geography_list: listFor('geography_list'),
    competitors_list: [],
    content_themes_list: listFor('content_themes_list'),
    products_services_list: listFor('products_services_list'),
    target_audience_list: listFor('target_audience_list'),
    goals_list: listFor('goals_list'),
    brand_voice_list: listFor('brand_voice_list'),
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
