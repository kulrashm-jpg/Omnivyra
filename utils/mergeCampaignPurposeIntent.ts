/**
 * Merge AI chat results into stored company-profile data without losing data.
 *
 * ONE rule, used everywhere an AI result is merged into the profile form:
 * an incoming NON-EMPTY value wins; an incoming empty value (null, undefined,
 * blank string, empty array) keeps what is stored.
 *
 * Why (D3 + scalar audit, 2026-11-13):
 * - "Define target customer" returned 5 of the 8 campaign_purpose_intent keys and the
 *   client REPLACED the stored object, erasing reader_emotion_target,
 *   narrative_flow_seed and recommended_cta_style.
 * - "Generate marketing intelligence" returns '' for any field the model leaves
 *   empty, and the client spread it over the profile, wiping stored values the user
 *   never cleared.
 * - AI chats also return null for undetermined keys, and may add keys nobody asked for.
 */
export type CampaignPurposeIntentLike = Record<string, unknown>;

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Field-level merge for AI results.
 * - Only `allowedKeys` are taken from `incoming`; unexpected keys are dropped.
 * - For each allowed key: an incoming non-empty value wins, an empty one keeps `existing`.
 * Returns only the changed fields, to be spread over the profile.
 */
export function mergeNonEmptyFields<T extends object, K extends string = string>(
  existing: T | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
  allowedKeys: readonly K[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!incoming) return out as Partial<T>;
  const current = (existing ?? {}) as Record<string, unknown>;
  for (const key of allowedKeys) {
    if (!(key in incoming)) continue;
    const value = incoming[key];
    if (!isEmptyValue(value)) out[key] = value;
    else if (key in current) out[key] = current[key];
  }
  return out as Partial<T>;
}

/**
 * Object-level merge for campaign_purpose_intent: keys present on either side are kept
 * (including keys the client type doesn't declare), with the same non-empty-wins rule.
 */
export function mergeCampaignPurposeIntent<T extends CampaignPurposeIntentLike>(
  existing: T | null | undefined,
  incoming: T | null | undefined,
): T | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  const merged: CampaignPurposeIntentLike = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (!isEmptyValue(value) || !(key in merged)) merged[key] = value;
  }
  return merged as T;
}

/** Output fields of /api/company-profile/define-target-customer (COMMERCIAL_FIELDS). */
export const TARGET_CUSTOMER_FIELDS = [
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
] as const;

/** Output fields of define-/generate-marketing-intelligence (OUTPUT_FIELDS / FIELD_ORDER). */
export const MARKETING_INTELLIGENCE_FIELDS = [
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;
