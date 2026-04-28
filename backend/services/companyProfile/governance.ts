import { CompanyProfile } from './types';

const COMPANY_PROFILE_REVIEW_INTERVAL_DAYS = 183;

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mergeCompanyFacts(
  existing: CompanyProfile['report_settings'] extends { company_facts?: infer T } ? T : never,
  incoming: CompanyProfile['report_settings'] extends { company_facts?: infer T } ? T : never,
  nowIso: string,
) {
  const team_size = normalizeNullableString(incoming?.team_size) ?? normalizeNullableString(existing?.team_size);
  const founded_year = normalizeNullableString(incoming?.founded_year) ?? normalizeNullableString(existing?.founded_year);
  const revenue_range = normalizeNullableString(incoming?.revenue_range) ?? normalizeNullableString(existing?.revenue_range);

  const hasAnyFacts = Boolean(team_size || founded_year || revenue_range);
  if (!hasAnyFacts) {
    return existing ?? null;
  }

  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
    team_size,
    founded_year,
    revenue_range,
    updated_at: nowIso,
  };
}

export function upsertCompanyProfileGovernanceSettings(params: {
  existingReportSettings?: CompanyProfile['report_settings'] | null;
  incomingReportSettings?: CompanyProfile['report_settings'] | null;
  confirmedByRole?: string | null;
  now?: Date;
}): CompanyProfile['report_settings'] {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const mergedFacts = mergeCompanyFacts(
    params.existingReportSettings?.company_facts ?? null,
    params.incomingReportSettings?.company_facts ?? null,
    nowIso,
  );

  const existingReview = params.existingReportSettings?.profile_review ?? null;
  const incomingReview = params.incomingReportSettings?.profile_review ?? null;
  const intervalDays = Number(
    incomingReview?.confirmation_interval_days ??
      existingReview?.confirmation_interval_days ??
      COMPANY_PROFILE_REVIEW_INTERVAL_DAYS,
  );
  const nextDueExisting = normalizeNullableString(existingReview?.next_confirmation_due_at);
  const isDue =
    !nextDueExisting ||
    Number.isNaN(new Date(nextDueExisting).getTime()) ||
    new Date(nextDueExisting).getTime() <= now.getTime();

  const shouldConfirm = Boolean(params.confirmedByRole && mergedFacts);
  const profile_review = shouldConfirm
    ? {
        ...(existingReview ?? {}),
        ...(incomingReview ?? {}),
        last_confirmed_at: nowIso,
        next_confirmation_due_at: addDays(now, intervalDays).toISOString(),
        confirmation_interval_days: intervalDays,
        pending_confirmation: false,
        last_confirmed_by_role: params.confirmedByRole ?? null,
        updated_at: nowIso,
      }
    : {
        ...(existingReview ?? {}),
        ...(incomingReview ?? {}),
        confirmation_interval_days: intervalDays,
        pending_confirmation: Boolean((incomingReview?.pending_confirmation ?? existingReview?.pending_confirmation) || (mergedFacts && isDue)),
        updated_at: nowIso,
      };

  return {
    ...(params.existingReportSettings ?? {}),
    ...(params.incomingReportSettings ?? {}),
    company_facts: mergedFacts,
    profile_review,
  };
}

export function getCompanyProfileReviewStatus(profile: CompanyProfile | null): {
  due: boolean;
  pending_confirmation: boolean;
  last_confirmed_at: string | null;
  next_confirmation_due_at: string | null;
  confirmation_interval_days: number;
  facts_present: boolean;
} {
  const facts = profile?.report_settings?.company_facts ?? null;
  const review = profile?.report_settings?.profile_review ?? null;
  const nextDue = normalizeNullableString(review?.next_confirmation_due_at);
  const intervalDays = Number(review?.confirmation_interval_days ?? COMPANY_PROFILE_REVIEW_INTERVAL_DAYS);
  const factsPresent = Boolean(
    normalizeNullableString(facts?.team_size) ||
      normalizeNullableString(facts?.founded_year) ||
      normalizeNullableString(facts?.revenue_range),
  );
  const due =
    factsPresent &&
    (!nextDue || Number.isNaN(new Date(nextDue).getTime()) || new Date(nextDue).getTime() <= Date.now());

  return {
    due,
    pending_confirmation: Boolean(review?.pending_confirmation || due),
    last_confirmed_at: normalizeNullableString(review?.last_confirmed_at),
    next_confirmation_due_at: nextDue,
    confirmation_interval_days: intervalDays,
    facts_present: factsPresent,
  };
}

/** Profile fields COMPANY_ADMIN is allowed to see (same set for all companies when company admin views). */
const COMPANY_ADMIN_VISIBLE_PROFILE_KEYS: (keyof CompanyProfile)[] = [
  'company_id',
  'name',
  'industry',
  'website_url',
  'category',
  'logo_url',
  'favicon_url',
  'created_at',
  'updated_at',
  // Social & links
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'tiktok_url',
  'reddit_url',
  'blog_url',
  'other_social_links',
  'social_profiles',
  // Geography & lists (identity/brand)
  'geography',
  'industry_list',
  'category_list',
  'geography_list',
  'competitors_list',
  'content_themes_list',
  'products_services_list',
  'target_audience_list',
  'goals_list',
  'brand_voice_list',
  // Scalars (identity/brand)
  'competitors',
  'content_themes',
  'products_services',
  'target_audience',
  'goals',
  'brand_voice',
  'unique_value',
  // Optional metadata
  'field_confidence',
  'overall_confidence',
  'source_urls',
  'confidence_score',
  'source',
  'last_refined_at',
  // Commercial strategy (Define Target Customer)
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
  // Campaign purpose & strategic intent
  'campaign_purpose_intent',
  // Marketing intelligence
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
  // Lock/edit metadata (read-only)
  'user_locked_fields',
  'last_edited_by',
  // Problem & Transformation Intelligence
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'life_with_problem',
  'life_after_solution',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
  'forced_context_fields',
  'report_settings',
];

/**
 * Returns a limited view of the company profile for COMPANY_ADMIN.
 * Keeps strategic/company-context fields while avoiding broader admin-only internals.
 */
export function toLimitedCompanyProfile(profile: CompanyProfile | null): CompanyProfile | null {
  if (!profile) return null;
  const out: Record<string, unknown> = { company_id: profile.company_id };
  for (const key of COMPANY_ADMIN_VISIBLE_PROFILE_KEYS) {
    if (key !== 'company_id' && profile[key] !== undefined) {
      out[key] = profile[key];
    }
  }
  return out as CompanyProfile;
}
