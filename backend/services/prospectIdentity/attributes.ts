/**
 * LI-1 — canonical attribute contracts for the person and account spine.
 *
 * SCOPE: types, the two closed vocabularies the database enforces, and the
 * minimum deterministic normalisation those columns require. Nothing here
 * reads, writes, enriches, infers or contacts. It is the shape ingestion and
 * enrichment will later conform to, published now so that they cannot each
 * invent their own.
 *
 * ─── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 *
 * TITLE NORMALISATION. Mapping "VP of Enterprise Sales" to seniority='vp' and
 * department='Sales' is a CLASSIFIER, and a classifier is inference. LI-1
 * stores `job_title` exactly as a source asserted it and leaves `seniority` and
 * `department` NULL unless a provider states them separately. Deriving them
 * belongs to a later phase that can carry evidence for the derivation.
 *
 * ACCOUNT NAME NORMALISATION FOR MATCHING. Stripping "Ltd"/"Inc"/"GmbH" to
 * compare company names is the first step towards name-based identity, which
 * W4 established must never happen: `prospect_accounts` has no unique index on
 * `name` or `legal_name`, and account identity is (org, source, source_reference)
 * or (org, domain_normalized). `normalizeDisplayText` here cleans whitespace for
 * STORAGE only; it is not a matching key and must never be used as one.
 *
 * COUNTRY NAME → CODE MAPPING. `normalizeCountryCode` accepts an ISO-3166-1
 * alpha-2 code and nothing else. Translating "United Kingdom" to "GB" needs a
 * reference dataset; that mapping belongs in the per-provider ingestion adapter
 * (LI-7), where the provider's own country vocabulary is known. Storing a
 * wrong-but-plausible code is worse than storing NULL.
 *
 * Existing normalisers are reused, never re-implemented — see ./normalization
 * for email, phone, domain, external identity and claim values.
 */

/**
 * Seniority vocabulary. Mirrors `unified_persons_seniority_valid` exactly; the
 * database is the authority and this array must not drift from it.
 */
export const SENIORITY_VALUES = [
  'intern', 'entry', 'senior', 'manager', 'head', 'director',
  'vp', 'partner', 'c_suite', 'founder', 'owner', 'other',
] as const;
export type Seniority = typeof SENIORITY_VALUES[number];

/** Employee bands. Mirrors `prospect_accounts_employee_band_valid` exactly. */
export const EMPLOYEE_BANDS = [
  '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+',
] as const;
export type EmployeeBand = typeof EMPLOYEE_BANDS[number];

/**
 * Canonical person attributes. Every field is optional: a person is created
 * from identity evidence, and may legitimately carry no attributes at all.
 *
 * NOT here, and not by accident:
 *   email / phone     - already canonical on `unified_persons`
 *   LinkedIn and other profiles - identity EVIDENCE; they live in
 *                       `identity_claims` (claim_type='external_profile') and
 *                       `unified_persons.external_keys`, not in an attribute
 */
export interface PersonAttributes {
  /** The name as a source gave it. Never split into parts — that is inference. */
  fullName?: string | null;
  /** Populated only when a source states given/family names separately. */
  firstName?: string | null;
  lastName?: string | null;
  /** Title verbatim from the source. Not parsed, not classified. */
  jobTitle?: string | null;
  /** Provider-asserted only. */
  department?: string | null;
  seniority?: Seniority | null;
  /** ISO-3166-1 alpha-2, uppercase. */
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  /** IANA zone (e.g. 'Europe/London'). Contact governance will need it. */
  timezone?: string | null;
}

/**
 * Canonical prospect-account attributes — firmographics only.
 *
 * NOT here: name, legalName, websiteUrl, domain. Those already exist on
 * `prospect_accounts` and two of them are identity keys.
 */
export interface AccountAttributes {
  industry?: string | null;
  /** Exact headcount when asserted. Distinct claim from the band. */
  employeeCount?: number | null;
  employeeBand?: EmployeeBand | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;
}

/**
 * Block-level provenance: which source last wrote the attribute block. The
 * database requires the pair to move together.
 *
 * This is NOT field-level provenance. When two providers disagree about a
 * phone number, retaining both assertions and recording which one was chosen is
 * the LI-2 source-record layer's job. This single column says "these attributes
 * last came from X", which is enough to invalidate a block and not enough to
 * arbitrate a field.
 */
export interface AttributeProvenance {
  attributesSource: string;
  attributesUpdatedAt: string;
}

/** Collapse to a storable value: trimmed, internal whitespace collapsed, blank → null. */
export function normalizeDisplayText(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * ISO-3166-1 alpha-2 only. Anything else — a country name, a three-letter code,
 * a numeric code — returns null rather than a guess, because the column's CHECK
 * would reject it anyway and a silent wrong country is worse than an absent one.
 */
export function normalizeCountryCode(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cleaned) ? cleaned : null;
}

export function isSeniority(value: unknown): value is Seniority {
  return typeof value === 'string' && (SENIORITY_VALUES as readonly string[]).includes(value);
}

export function isEmployeeBand(value: unknown): value is EmployeeBand {
  return typeof value === 'string' && (EMPLOYEE_BANDS as readonly string[]).includes(value);
}

/**
 * Non-negative integer headcount, or null. Rejects fractions and negatives
 * rather than rounding, since a fractional headcount means the source sent
 * something this field does not model.
 */
export function normalizeEmployeeCount(value?: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Shape a person attribute payload for storage. Unknown seniority becomes null
 * rather than 'other': 'other' is a claim that a source made about a person,
 * and inventing it here would fabricate evidence.
 */
export function toPersonAttributes(input: PersonAttributes): PersonAttributes {
  return {
    fullName: normalizeDisplayText(input.fullName),
    firstName: normalizeDisplayText(input.firstName),
    lastName: normalizeDisplayText(input.lastName),
    jobTitle: normalizeDisplayText(input.jobTitle),
    department: normalizeDisplayText(input.department),
    seniority: isSeniority(input.seniority) ? input.seniority : null,
    countryCode: normalizeCountryCode(input.countryCode),
    region: normalizeDisplayText(input.region),
    city: normalizeDisplayText(input.city),
    timezone: normalizeDisplayText(input.timezone),
  };
}

export function toAccountAttributes(input: AccountAttributes): AccountAttributes {
  return {
    industry: normalizeDisplayText(input.industry),
    employeeCount: normalizeEmployeeCount(input.employeeCount),
    employeeBand: isEmployeeBand(input.employeeBand) ? input.employeeBand : null,
    countryCode: normalizeCountryCode(input.countryCode),
    region: normalizeDisplayText(input.region),
    city: normalizeDisplayText(input.city),
    description: normalizeDisplayText(input.description),
  };
}

/** Database column names, so callers do not hand-write them and drift. */
export const PERSON_ATTRIBUTE_COLUMNS = [
  'full_name', 'first_name', 'last_name', 'job_title', 'department', 'seniority',
  'country_code', 'region', 'city', 'timezone', 'attributes_source', 'attributes_updated_at',
] as const;

export const ACCOUNT_ATTRIBUTE_COLUMNS = [
  'industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city',
  'description', 'attributes_source', 'attributes_updated_at',
] as const;
