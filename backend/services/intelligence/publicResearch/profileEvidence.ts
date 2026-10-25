/**
 * Public research — the company profile as an OPTIONAL enrichment source.
 *
 * The profile is the company's own statement about itself. When it exists, its fields become
 * company-declared facts with provenance (profile record, capture time, who wrote it). When it does
 * not — or cannot be read — the report runs exactly as before on the website and public sources.
 *
 * Status is told apart, never collapsed:
 *   profile_available   the profile carries the core fields (offering and buyer)
 *   profile_partial     some useful fields, not all core ones
 *   profile_empty       a record exists but carries nothing usable
 *   profile_not_found   the lookup succeeded and there is no record
 *   profile_access_error the lookup failed (authorization, service, malformed data) — NOT "no profile"
 *   profile_identity_mismatch the record belongs to another company: never used
 */
export type ProfileStatus = 'profile_available' | 'profile_partial' | 'profile_empty' | 'profile_not_found' | 'profile_access_error' | 'profile_identity_mismatch';

export type ProfileField =
  | 'offering' | 'product_line' | 'buyer' | 'industry' | 'geography' | 'business_model' | 'differentiator'
  | 'revenue' | 'team_size' | 'founded' | 'customer_problem';

export type ProfileFact = {
  field: ProfileField;
  value: string;
  /** Always company_declared on import; reconciliation may later mark it verified or conflicting. */
  status: 'company_declared';
  provenance: { source: 'company_profile'; recordId: string | null; profileField: string; capturedAt: string | null; attribution: 'company user' | 'AI-refined profile' | 'unknown' };
  /** Older than STALE_DAYS when captured: shown, but it never outranks newer evidence. */
  stale: boolean;
};

export type ProfileLookup = { status: ProfileStatus; detail: string | null; checkedAt: string };
export type ProfileEvidence = ProfileLookup & { facts: ProfileFact[]; fieldsPresent: ProfileField[] };

const STALE_DAYS = 365;
const CORE: ProfileField[] = ['offering', 'buyer'];

type Raw = Record<string, unknown>;
/** A usable string: placeholders ("N/A", "Other", "TBD") are not facts; long text is cut on a word boundary. */
const text = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim() || /^(n\/a|na|none|null|undefined|-|tbd|unknown|other|others|not sure)$/i.test(v.trim())) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length <= 300 ? t : `${t.slice(0, 300).replace(/\s+\S*$/, '')}…`;
};
/** A comma-joined string whose every part is already in the list adds nothing. */
const coveredBy = (s: string | null, items: string[]): boolean => Boolean(s) && items.length > 0
  && s!.split(/,|;/).map((x) => x.trim().toLowerCase()).filter(Boolean).every((x) => items.some((i) => i.toLowerCase() === x));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((x): x is string => Boolean(x)) : []);
/** A free-text list: one item per line / bullet / semicolon — or per comma when it is plainly a comma list. */
const lines = (v: unknown): string[] => {
  if (typeof v !== 'string' || !v.trim()) return [];
  const sep = /\n|;|•/.test(v) ? /\n|;|•/ : (v.match(/,/g) ?? []).length >= 2 ? /,/ : /\n/;
  return v.split(sep).map((x) => text(x)).filter((x): x is string => Boolean(x && x.length > 1));
};

/** Reads the profile defensively: a malformed record yields fewer facts, never an exception. */
export function profileEvidence(profile: unknown, lookup: Omit<ProfileLookup, 'checkedAt'> & { checkedAt?: string }, expectedCompanyId: string | null, now = new Date()): ProfileEvidence {
  const checkedAt = lookup.checkedAt ?? now.toISOString();
  if (lookup.status === 'profile_access_error' || lookup.status === 'profile_not_found') return { ...lookup, checkedAt, facts: [], fieldsPresent: [] };
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { status: 'profile_access_error', detail: 'The profile response was not a usable record.', checkedAt, facts: [], fieldsPresent: [] };
  }
  const p = profile as Raw;
  // Never borrow another company's profile.
  if (expectedCompanyId && text(p.company_id) && text(p.company_id) !== expectedCompanyId) {
    return { status: 'profile_identity_mismatch', detail: 'The profile record belongs to a different company and was not used.', checkedAt, facts: [], fieldsPresent: [] };
  }
  const captured = text(p.updated_at) ?? text(p.created_at);
  const age = captured && Number.isFinite(Date.parse(captured)) ? (now.getTime() - Date.parse(captured)) / 86_400_000 : null;
  const attribution: ProfileFact['provenance']['attribution'] = p.source === 'user' ? 'company user' : p.source === 'ai_refined' ? 'AI-refined profile' : 'unknown';
  const facts: ProfileFact[] = [];
  const add = (field: ProfileField, profileField: string, value: string | null) => {
    if (!value) return;
    const key = value.toLowerCase().replace(/\s+/g, ' ');
    if (facts.some((f) => f.field === field && f.value.toLowerCase().replace(/\s+/g, ' ') === key)) return; // one claim, one record
    facts.push({ field, value, status: 'company_declared', stale: age != null && age > STALE_DAYS,
      provenance: { source: 'company_profile', recordId: text(p.id), profileField, capturedAt: captured, attribution } });
  };
  const facts_ = (p.report_settings && typeof p.report_settings === 'object' ? (p.report_settings as Raw).company_facts : null) as Raw | null;
  const productList = [...list(p.products_services_list), ...lines(p.products_services)];
  add('offering', productList.length ? 'products_services' : 'unique_value', productList[0] ?? text(p.unique_value));
  for (const x of productList.slice(1, 8)) add('product_line', 'products_services', x);
  add('buyer', 'target_customer_segment', text(p.target_customer_segment));
  const audiences = list(p.target_audience_list);
  // The free-text field and its list often hold the same values: the list wins, the text only if it adds something.
  if (!audiences.length) add('buyer', 'target_audience', text(p.target_audience));
  for (const x of audiences.slice(0, 5)) add('buyer', 'target_audience_list', x);
  const industries = list(p.industry_list);
  if (!coveredBy(text(p.industry), industries)) add('industry', 'industry', text(p.industry));
  for (const x of industries.slice(0, 4)) add('industry', 'industry_list', x);
  const geos = list(p.geography_list);
  if (!coveredBy(text(p.geography), geos)) add('geography', 'geography', text(p.geography));
  for (const x of geos.slice(0, 5)) add('geography', 'geography_list', x);
  add('business_model', 'pricing_model', text(p.pricing_model));
  add('differentiator', 'competitive_advantages', text(p.competitive_advantages));
  add('differentiator', 'brand_positioning', text(p.brand_positioning));
  add('customer_problem', 'core_problem_statement', text(p.core_problem_statement));
  add('revenue', 'report_settings.company_facts.revenue_range', text(facts_?.revenue_range));
  add('team_size', 'report_settings.company_facts.team_size', text(facts_?.team_size));
  add('founded', 'report_settings.company_facts.founded_year', text(facts_?.founded_year));

  const fieldsPresent = [...new Set(facts.map((f) => f.field))];
  const status: ProfileStatus = !facts.length ? 'profile_empty' : CORE.every((f) => fieldsPresent.includes(f)) ? 'profile_available' : 'profile_partial';
  return { status, detail: null, checkedAt, facts, fieldsPresent };
}

/** The lookup outcome without throwing: an error is an access error, never "no profile". */
export async function lookupProfile<T>(load: () => Promise<T | null>): Promise<{ profile: T | null; lookup: ProfileLookup }> {
  const checkedAt = new Date().toISOString();
  try {
    const profile = await load();
    return { profile, lookup: { status: profile ? 'profile_available' : 'profile_not_found', detail: null, checkedAt } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Credential-shaped text never reaches the record.
    return { profile: null, lookup: { status: 'profile_access_error', detail: message.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 160), checkedAt } };
  }
}

export const PROFILE_STATUS_TEXT: Record<ProfileStatus, string> = {
  profile_available: 'Company profile available',
  profile_partial: 'Company profile partly filled',
  profile_empty: 'Company profile exists but is empty',
  profile_not_found: 'No company profile',
  profile_access_error: 'Company profile could not be read',
  profile_identity_mismatch: 'Company profile not used (identity mismatch)',
};
