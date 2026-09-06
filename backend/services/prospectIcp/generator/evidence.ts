/**
 * A1 — the evidence layer of the AI ICP Generator.
 *
 * Reads the tenant's Company Profile and reduces it to the NAMED fields that
 * may legitimately inform an ICP. This module is PURE: no database, no network,
 * no clock, no model. It decides WHAT the model is allowed to see and, just as
 * importantly, what it is not.
 *
 * ─── WHY A CLOSED FIELD LIST ──────────────────────────────────────────────
 * `company_profiles` carries ~70 columns, many of them publishing configuration
 * (`platform_content_type_prefs`, `report_settings`, social URLs). Publishing
 * configuration says nothing about who buys, and feeding it to the model would
 * invite exactly the kind of confident irrelevance the ICP contract exists to
 * prevent. The list below is the buyer-relevant subset, and every field a
 * criterion later cites must appear in it — that is what makes
 * `evidenceFields` verifiable rather than decorative.
 *
 * ─── WHAT IS DELIBERATELY EXCLUDED ────────────────────────────────────────
 * `competitors` / `competitors_list` — `field_confidence.competitors` is
 * routinely "Low" and a competitor set is not a statement about the buyer.
 * `company_geographic_exposures` — that is the TENANT's own revenue exposure;
 * the standing WS-7 rule is that a tenant's regions never become a prospect's
 * geography.
 *
 * The tenant id is never part of the evidence. The model is given business
 * context and nothing that identifies whose context it is.
 */

/** The buyer-relevant Company Profile surface. Nothing outside this is read. */
export const PROFILE_EVIDENCE_FIELDS = [
  'industry',
  'category',
  'unique_value',
  'products_services_list',
  'target_audience_list',
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
  'geography_list',
  'goals_list',
  'growth_priorities',
  'brand_positioning',
  'competitive_advantages',
  'key_messages',
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
  'campaign_purpose_intent',
] as const;

export type ProfileEvidenceField = typeof PROFILE_EVIDENCE_FIELDS[number];

/** Trust signals. Read separately because they qualify the evidence, not are it. */
export const PROFILE_TRUST_FIELDS = [
  'field_confidence', 'overall_confidence', 'user_locked_fields', 'source', 'last_refined_at',
] as const;

export interface ProfileEvidence {
  /** Only fields that carried a non-empty value. */
  readonly present: Readonly<Record<string, string>>;
  /** Named fields that exist on the profile but were empty. */
  readonly absent: readonly string[];
  /** `field_confidence` as stored, lower-cased keys, or null. */
  readonly fieldConfidence: Readonly<Record<string, string>> | null;
  /** 0-100 as stored, or null. */
  readonly overallConfidence: number | null;
  /** Fields the user has locked — treated as higher trust than AI-refined. */
  readonly userLocked: readonly string[];
  /** How many buyer-relevant fields carried a value. The sparsity signal. */
  readonly presentCount: number;
}

/** A value rendered for the prompt. Arrays become bullet text; objects JSON. */
function render(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.replace(/\s+/g, ' ').trim();
    return t.length ? t : null;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
      .filter((v) => v && v.length);
    return items.length ? items.join(' · ') : null;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json === '{}' || json === '[]' ? null : json;
  }
  return String(value);
}

const lowerKeys = (v: unknown): Record<string, string> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k.toLowerCase()] = val.toLowerCase();
  }
  return Object.keys(out).length ? out : null;
};

/**
 * Reduce a raw `company_profiles` row to its buyer-relevant evidence.
 *
 * A field that is present but empty is reported as ABSENT rather than omitted:
 * the difference between "this tenant has no stated sales motion" and "nobody
 * asked" is the difference between an assumption and a gap, and the generator
 * has to be able to tell them apart.
 */
export function extractProfileEvidence(row: Record<string, unknown> | null | undefined): ProfileEvidence {
  const present: Record<string, string> = {};
  const absent: string[] = [];

  for (const field of PROFILE_EVIDENCE_FIELDS) {
    const rendered = render(row?.[field]);
    if (rendered === null) absent.push(field);
    else present[field] = rendered;
  }

  const rawLocked = row?.user_locked_fields;
  const userLocked = Array.isArray(rawLocked)
    ? rawLocked.filter((v): v is string => typeof v === 'string')
    : [];

  const rawOverall = row?.overall_confidence;
  const overallConfidence = typeof rawOverall === 'number' && Number.isFinite(rawOverall)
    ? rawOverall
    : null;

  return {
    present,
    absent,
    fieldConfidence: lowerKeys(row?.field_confidence),
    overallConfidence,
    userLocked,
    presentCount: Object.keys(present).length,
  };
}

/**
 * Whether there is enough to reason over at all.
 *
 * The threshold is deliberately about the fields that carry BUYER meaning, not
 * a raw count: a profile with only an industry and a category describes what a
 * company sells, not who buys it. Below this the generator abstains rather than
 * inventing a plausible ICP, because a confident ICP built on two fields is
 * indistinguishable downstream from one built on twenty.
 */
export const BUYER_SIGNAL_FIELDS: readonly ProfileEvidenceField[] = [
  'target_audience_list', 'target_customer_segment', 'ideal_customer_profile',
  'products_services_list', 'core_problem_statement', 'pain_symptoms',
];

export function hasSufficientEvidence(evidence: ProfileEvidence): boolean {
  const buyerSignals = BUYER_SIGNAL_FIELDS.filter((f) => f in evidence.present).length;
  return buyerSignals >= 2;
}
