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

/**
 * PI WS-7 FR-21. Buying roles. Mirrors `unified_persons_buying_role_valid`
 * exactly; the database is the authority and this array must not drift from it.
 *
 * This is the ONE attribute WS-6/WS-7 added with a closed vocabulary, because
 * the Playbook fixes it (§17). `authority` and `influence` name a concept
 * without fixing its values, so they stay free text rather than being given a
 * vocabulary invented here — an invented vocabulary becomes the contract the
 * moment a provider maps onto it.
 */
export const BUYING_ROLES = [
  'decision_maker', 'economic_buyer', 'champion',
  'influencer', 'evaluator', 'blocker', 'unknown',
] as const;
export type BuyingRole = typeof BUYING_ROLES[number];

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

  // ── PI WS-7 (FR-21) ───────────────────────────────────────────────────────
  /** Decision authority, verbatim from a source. No vocabulary is imposed. */
  authority?: string | null;
  /** Influence, verbatim from a source. No vocabulary is imposed. */
  influence?: string | null;
  /** Closed vocabulary — the Playbook fixes these values. */
  buyingRole?: BuyingRole | null;
}

/**
 * Canonical prospect-account attributes — firmographics only.
 *
 * NOT here: name, legalName, websiteUrl, domain. Those already exist on
 * `prospect_accounts` and two of them are identity keys.
 */
export interface AccountAttributes {
  industry?: string | null;
  /**
   * Exact headcount when asserted. A distinct claim from the band.
   *
   * The STRING form is accepted because providers routinely send one ("240"),
   * and `normalizeEmployeeCount` is deliberately written to take it. LI-1
   * originally typed this `number | null`, which made the normaliser's string
   * branch unreachable through this entry point — the two contracts disagreed.
   */
  employeeCount?: number | string | null;
  employeeBand?: EmployeeBand | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;

  // ── P2A firmographics ─────────────────────────────────────────────────────
  // The six attributes P2A added to `prospect_accounts`. Like `employeeCount`,
  // the numeric ones accept a provider's STRING form, because providers
  // routinely send one and the normalisers are written to take it.
  annualRevenue?: number | string | null;
  revenueBand?: string | null;
  foundedYear?: number | string | null;
  /** A list of technology names. Normalised to a JSON array string for jsonb. */
  technologies?: string[] | string | null;
  fundingStage?: string | null;
  /** ISO-8601 instant of the most recent funding event. */
  lastFundingAt?: string | null;

  // ── PI WS-6 (FR-16) ───────────────────────────────────────────────────────
  /** Market/segment, verbatim. No vocabulary imposed (revenueBand precedent). */
  market?: string | null;
  /** How the account makes money, verbatim. No vocabulary imposed. */
  businessModel?: string | null;
  /** Growth STAGE — a stateable fact. A growth RATE would need a window. */
  growthStage?: string | null;
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

export function isBuyingRole(value: unknown): value is BuyingRole {
  return typeof value === 'string' && (BUYING_ROLES as readonly string[]).includes(value);
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
 * Annual revenue as a finite, non-negative number.
 *
 * Unlike headcount this is NOT required to be an integer — revenue is routinely
 * fractional. A negative figure is refused rather than clamped: it is a parsing
 * error, and storing 0 would assert a fact the provider never stated. The
 * database CHECK refuses it too, so this normaliser is the polite half of a
 * rule the schema enforces regardless.
 */
export function normalizeAnnualRevenue(value?: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * A four-digit founding year inside the bounds the column accepts.
 *
 * The same 1800–2200 window as `prospect_accounts_founded_year_valid`. A value
 * outside it is a parsing artefact — a timestamp, a row number, a truncated
 * string — and is dropped rather than written and rejected by the database.
 */
export function normalizeFoundedYear(value?: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1800 || n > 2200) return null;
  return n;
}

/**
 * A technology list, normalised to the JSON ARRAY TEXT that jsonb accepts.
 *
 * Returning a string rather than an array is deliberate: every canonical value
 * travels through `source_assertions.normalized_value`, which is text, so an
 * array would be stringified by whatever wrote it — `String(['a','b'])` yields
 * `'a,b'`, which is not JSON and would fail the column's is-array CHECK. JSON
 * is produced here, once, so the boundary never has to know the difference.
 *
 * Entries are trimmed and de-duplicated; blanks are dropped. An input that is
 * genuinely an empty list is preserved as `[]` — "we looked and found none" is
 * a fact, and is not the same as never having looked.
 */
export function normalizeTechnologies(value?: string[] | string | null): string | null {
  if (value === null || value === undefined) return null;

  let list: unknown[];
  if (Array.isArray(value)) {
    list = value;
  } else {
    const text = value.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;   // an object or scalar is not a technology list
      list = parsed;
    } catch {
      return null;                                // unparseable is absent, never a guess
    }
  }

  const cleaned = [...new Set(
    list.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0),
  )];
  return JSON.stringify(cleaned);
}

/**
 * An ISO-8601 instant, or nothing.
 *
 * Normalised to UTC ISO so two providers stating the same moment in different
 * offsets produce ONE value rather than a false disagreement — LI-2 withholds
 * an attribute whose sources disagree, so a formatting difference would
 * silently suppress a fact both providers actually agree on.
 */
export function normalizeInstant(value?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
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
    // WS-7. Free text is cleaned for storage only; `buyingRole` is validated
    // against the closed vocabulary and becomes null when a source asserts
    // something outside it — an unrecognised role is not a role.
    authority: normalizeDisplayText(input.authority),
    influence: normalizeDisplayText(input.influence),
    buyingRole: isBuyingRole(input.buyingRole) ? input.buyingRole : null,
  };
}

/**
 * What `toAccountAttributes` produces: the same shape as the input, except the
 * headcount is always an integer because normalisation has already run.
 *
 * This exists so widening the INPUT to accept a provider's string does not also
 * make the OUTPUT claim a normalised headcount might still be a string. It is
 * assignable to `AccountAttributes`, so consumers that accept the input shape
 * keep working unchanged.
 */
export type NormalizedAccountAttributes =
  Omit<AccountAttributes, 'employeeCount' | 'annualRevenue' | 'foundedYear' | 'technologies'> & {
    employeeCount: number | null;
    annualRevenue: number | null;
    foundedYear: number | null;
    /** JSON array TEXT, ready for a jsonb column — never a JS array. */
    technologies: string | null;
  };

export function toAccountAttributes(input: AccountAttributes): NormalizedAccountAttributes {
  return {
    industry: normalizeDisplayText(input.industry),
    employeeCount: normalizeEmployeeCount(input.employeeCount),
    employeeBand: isEmployeeBand(input.employeeBand) ? input.employeeBand : null,
    countryCode: normalizeCountryCode(input.countryCode),
    region: normalizeDisplayText(input.region),
    city: normalizeDisplayText(input.city),
    description: normalizeDisplayText(input.description),
    // P2A firmographics. `revenueBand` and `fundingStage` go through the same
    // display-text rule as `industry` — trimmed, blank-to-null — because the
    // repository has no vocabulary for either and a provider's own label is the
    // fact being recorded.
    annualRevenue: normalizeAnnualRevenue(input.annualRevenue),
    revenueBand: normalizeDisplayText(input.revenueBand),
    foundedYear: normalizeFoundedYear(input.foundedYear),
    technologies: normalizeTechnologies(input.technologies),
    fundingStage: normalizeDisplayText(input.fundingStage),
    lastFundingAt: normalizeInstant(input.lastFundingAt),
    // WS-6. Same display-text rule, for the same reason: no vocabulary exists
    // for any of the three, so a provider's own label is the fact recorded.
    market: normalizeDisplayText(input.market),
    businessModel: normalizeDisplayText(input.businessModel),
    growthStage: normalizeDisplayText(input.growthStage),
  };
}

/** Database column names, so callers do not hand-write them and drift. */
export const PERSON_ATTRIBUTE_COLUMNS = [
  'full_name', 'first_name', 'last_name', 'job_title', 'department', 'seniority',
  'country_code', 'region', 'city', 'timezone',
  // PI WS-7 (FR-21).
  'authority', 'influence', 'buying_role',
  'attributes_source', 'attributes_updated_at',
] as const;

export const ACCOUNT_ATTRIBUTE_COLUMNS = [
  'industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city',
  'description',
  // P2A. Adding them here does more than name them: the boundary refuses to
  // write any column outside this list, and the enforcement test derives its
  // scan from it — so these become both writable and protected in one step.
  'annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at',
  // PI WS-6 (FR-16). Same contract as P2A: listing them here is what makes them
  // both writable through the boundary and protected from anything else.
  'market', 'business_model', 'growth_stage',
  'attributes_source', 'attributes_updated_at',
] as const;
