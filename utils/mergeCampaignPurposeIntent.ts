/**
 * Merge a chat result into the stored `campaign_purpose_intent` without losing data.
 *
 * Why: the "Define target customer" chat returns only 5 of the 8 keys, and the client
 * used to REPLACE the whole object. That silently erased `reader_emotion_target`,
 * `narrative_flow_seed` and `recommended_cta_style`, which feed the writing-style and
 * CTA context. Either chat also returns `null` for keys it didn't determine, so even a
 * plain spread would have overwritten stored values with null.
 *
 * Rule: an incoming NON-EMPTY value wins; an incoming empty value (null, undefined,
 * blank string, empty array) keeps what is stored. Keys present on either side are kept,
 * including keys the client type doesn't declare.
 */
export type CampaignPurposeIntentLike = Record<string, unknown>;

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

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
