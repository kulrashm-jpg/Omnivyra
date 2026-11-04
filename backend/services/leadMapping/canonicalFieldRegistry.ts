/**
 * PI-LDB-01 — the canonical attribute registry for semantic mapping.
 *
 * ─── THIS IS NOT A NEW TAXONOMY ───────────────────────────────────────────
 * Every `key` here is a field that ALREADY exists on `ManualLeadInput`
 * (`leadIngestion/adapters/manualAdapter.ts`), which is the same vocabulary
 * `CsvLeadInput` and the CRM adapter use. Every `column` here is a real
 * column already on `PERSON_ATTRIBUTE_COLUMNS` or `ACCOUNT_ATTRIBUTE_COLUMNS`
 * (`prospectIdentity/attributes.ts`), which is the `ingestionBoundary` write
 * allowlist. This file adds no destination; it describes the destinations
 * that exist so a mapping can be reasoned about and audited.
 *
 * Consequence worth stating plainly: a canonical column that `ManualLeadInput`
 * does not expose is NOT mappable from a source file, however writable it is
 * at the database. `seniority`, `authority`, `influence` and `buying_role` on
 * the person, and `market`, `business_model` and `growth_stage` on the
 * account, are all in that position — they are derived or enrichment-supplied,
 * not file-supplied. A header that means "seniority" therefore resolves to
 * `unmapped`, and that is correct rather than a gap: inventing an input path
 * for a derived field is how a guess becomes a stored fact.
 *
 * ─── SYNONYMS ARE EVIDENCE, NOT A WHITELIST ───────────────────────────────
 * `synonyms` is one of eight scoring signals. It is NOT the set of accepted
 * headers. A header absent from every synonym list can still be mapped by the
 * model proposer and then validated; a header present in one still fails if
 * its values do not fit. Treating this list as exhaustive would reduce the
 * feature to a lookup table, which is the thing the brief rules out.
 */

/** Keys are `ManualLeadInput` field names, exactly. */
export type CanonicalFieldKey =
  // ── contact identity
  | 'referenceId'
  | 'email'
  | 'phone'
  // ── contact detail
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'jobTitle'
  | 'department'
  | 'countryCode'
  | 'region'
  | 'city'
  | 'observedAt'
  // ── employer identity
  | 'companyName'
  | 'companyDomain'
  | 'companyExternalId'
  // ── employer firmographics
  | 'description'
  | 'industry'
  | 'employeeCount'
  | 'employeeBand'
  | 'annualRevenue'
  | 'revenueBand'
  | 'foundedYear'
  | 'technologies'
  | 'fundingStage'
  | 'lastFundingAt'
  | 'companyCountryCode'
  | 'companyRegion'
  | 'companyCity';

import type { CanonicalDataType, TransformationName } from './mappingTypes';

export interface CanonicalFieldDef {
  key: CanonicalFieldKey;
  entity: 'contact' | 'company';
  /**
   * The real database column this ends up in, for provenance. Several keys
   * share a column name across the two entities — `country_code` exists on
   * both the person and the account — which is exactly why `entity` is part
   * of the identity of a destination and never omitted.
   */
  column: string;
  label: string;
  /** Shown to the tenant in the review UI. Written for a non-engineer. */
  description: string;
  dataType: CanonicalDataType;
  enumValues?: readonly string[];
  synonyms: readonly string[];
  defaultTransformation: TransformationName;
  /**
   * Identity-critical fields decide WHO a record is, or WHICH employer it
   * belongs to. A wrong value here does not degrade a row, it creates or
   * merges the wrong person. They can never reach
   * `high_confidence_suggestion`: a tenant must confirm them, always.
   */
  identityCritical: boolean;
  sensitivity: 'public' | 'business' | 'personal';
}

/**
 * The person's geography and the employer's geography are different facts
 * with the same natural-language names. `ManualLeadInput` says so directly:
 * reusing one name for the other "would silently overwrite one with the
 * other". A bare `Country`, `Region`, `City` or `Location` header is
 * therefore genuinely undecidable from the header alone, and these keys are
 * cross-linked so the engine raises `entity_ambiguous` instead of guessing.
 */
export const GEOGRAPHY_AMBIGUITY_PAIRS: ReadonlyArray<readonly [CanonicalFieldKey, CanonicalFieldKey]> = [
  ['countryCode', 'companyCountryCode'],
  ['region', 'companyRegion'],
  ['city', 'companyCity'],
];

/**
 * Headers whose meaning is not recoverable from the header text, whatever the
 * synonym evidence says. The engine caps these at `review_required` AFTER
 * scoring, so a strong-looking score never silently resolves them.
 *
 * Compared case-insensitively against the trimmed header.
 */
export const POLYSEMOUS_HEADERS: Readonly<Record<string, readonly CanonicalFieldKey[]>> = {
  title: ['jobTitle', 'description'],
  role: ['jobTitle'],
  description: ['description'],
  descriptions: ['description'],
  value: ['annualRevenue'],
  location: ['city', 'companyCity', 'countryCode', 'companyCountryCode'],
  country: ['countryCode', 'companyCountryCode'],
  region: ['region', 'companyRegion'],
  city: ['city', 'companyCity'],
  name: ['fullName', 'companyName'],
  type: [],
  status: [],
  owner: [],
  notes: [],
};

export const CANONICAL_FIELDS: readonly CanonicalFieldDef[] = [
  // ── CONTACT IDENTITY ────────────────────────────────────────────────────
  {
    key: 'email',
    entity: 'contact',
    column: 'email',
    label: 'Email address',
    description: "The person's own work email address. Used to recognise them across sources.",
    dataType: 'email',
    synonyms: ['email', 'e-mail', 'email address', 'e mail', 'mail', 'work email', 'business email', 'emailaddress'],
    defaultTransformation: 'lowercase_email',
    identityCritical: true,
    sensitivity: 'personal',
  },
  {
    key: 'phone',
    entity: 'contact',
    column: 'phone',
    label: 'Phone number',
    description: "The person's phone number.",
    dataType: 'phone',
    synonyms: ['phone', 'phone number', 'telephone', 'mobile', 'cell', 'contact number', 'tel', 'mobile number'],
    defaultTransformation: 'digits_only_phone',
    identityCritical: true,
    sensitivity: 'personal',
  },
  {
    key: 'referenceId',
    entity: 'contact',
    column: 'external_lead_key',
    label: 'Your own reference',
    description: 'Your own identifier for this record, if you have one. Lets a re-import update instead of duplicating.',
    dataType: 'text',
    synonyms: ['id', 'reference', 'reference id', 'ref', 'record id', 'lead id', 'external id', 'crm id', 'row id'],
    defaultTransformation: 'trim',
    identityCritical: true,
    sensitivity: 'business',
  },

  // ── CONTACT DETAIL ──────────────────────────────────────────────────────
  {
    key: 'fullName',
    entity: 'contact',
    column: 'full_name',
    label: 'Full name',
    description: "The person's complete name in one column.",
    dataType: 'text',
    synonyms: ['full name', 'name', 'contact name', 'contact', 'person', 'person name', 'fullname', 'lead name'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'firstName',
    entity: 'contact',
    column: 'first_name',
    label: 'First name',
    description: "The person's given name.",
    dataType: 'text',
    synonyms: ['first name', 'firstname', 'given name', 'forename', 'fname', 'first'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'lastName',
    entity: 'contact',
    column: 'last_name',
    label: 'Last name',
    description: "The person's family name.",
    dataType: 'text',
    synonyms: ['last name', 'lastname', 'surname', 'family name', 'lname', 'last'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'jobTitle',
    entity: 'contact',
    column: 'job_title',
    label: 'Job title',
    description: "The person's role at their employer, as written on their profile.",
    dataType: 'text',
    synonyms: [
      'job title', 'designation', 'position', 'role', 'job function', 'jobtitle',
      'job role', 'current title', 'current position', 'function', 'post',
    ],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'business',
  },
  {
    key: 'department',
    entity: 'contact',
    column: 'department',
    label: 'Department',
    description: 'The team or function the person sits in, such as Marketing or Engineering.',
    dataType: 'text',
    synonyms: ['department', 'dept', 'division', 'team', 'business unit', 'function area'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'business',
  },
  {
    key: 'countryCode',
    entity: 'contact',
    column: 'country_code',
    label: "Person's country",
    description: 'The country the PERSON is in — not their employer\'s headquarters.',
    dataType: 'text',
    synonyms: ['country', 'country code', 'person country', 'contact country', 'nation'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'region',
    entity: 'contact',
    column: 'region',
    label: "Person's region",
    description: "The state, province or region the PERSON is in — not their employer's.",
    dataType: 'text',
    synonyms: ['region', 'state', 'province', 'county', 'person region'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'city',
    entity: 'contact',
    column: 'city',
    label: "Person's city",
    description: "The city the PERSON is in — not their employer's head office.",
    dataType: 'text',
    synonyms: ['city', 'town', 'locality', 'person city', 'contact city'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'personal',
  },
  {
    key: 'observedAt',
    entity: 'contact',
    column: 'observed_at',
    label: 'When this was observed',
    description: 'When you learned this, if it was not just now. Keeps the provenance timeline honest.',
    dataType: 'date',
    synonyms: ['observed at', 'date', 'captured at', 'collected on', 'as of', 'date added', 'created at', 'created date'],
    defaultTransformation: 'parse_date',
    identityCritical: false,
    sensitivity: 'business',
  },

  // ── EMPLOYER IDENTITY ───────────────────────────────────────────────────
  // NOTE on `Organization`: this maps to the EMPLOYER's name. It must never
  // reach `organization_id` or `company_id`, which are the TENANT in this
  // schema. That is structurally safe here rather than merely intended —
  // `ManualLeadInput` exposes no tenant field at all, and the route refuses a
  // body that names one — but the hazard is recorded because a future
  // contract change could reintroduce it.
  {
    key: 'companyName',
    entity: 'company',
    column: 'name',
    label: 'Company name',
    description: "The name of the person's employer.",
    dataType: 'text',
    synonyms: [
      'company', 'company name', 'organization', 'organisation', 'account',
      'employer', 'business', 'firm', 'org', 'account name', 'companyname',
    ],
    defaultTransformation: 'trim',
    identityCritical: true,
    sensitivity: 'business',
  },
  {
    key: 'companyDomain',
    entity: 'company',
    column: 'domain',
    label: 'Company website or domain',
    description: "The employer's website. This is the strongest signal for recognising a company you already have.",
    dataType: 'domain',
    synonyms: ['domain', 'website', 'company domain', 'company website', 'url', 'web', 'site', 'homepage', 'web address'],
    defaultTransformation: 'url_to_domain',
    identityCritical: true,
    sensitivity: 'public',
  },
  {
    key: 'companyExternalId',
    entity: 'company',
    column: 'external_id',
    label: "Your own company reference",
    description: 'Your own identifier for the employer, if you have one.',
    dataType: 'text',
    synonyms: ['company id', 'account id', 'company external id', 'org id', 'company ref'],
    defaultTransformation: 'trim',
    identityCritical: true,
    sensitivity: 'business',
  },

  // ── EMPLOYER FIRMOGRAPHICS ──────────────────────────────────────────────
  {
    key: 'description',
    entity: 'company',
    column: 'description',
    label: 'Company description',
    description: "A short description of what the EMPLOYER does. Not a product description, and not a note about the person.",
    dataType: 'text',
    synonyms: ['description', 'descriptions', 'company description', 'company overview', 'overview', 'about', 'summary', 'company summary', 'bio'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'industry',
    entity: 'company',
    column: 'industry',
    label: 'Industry',
    description: "The employer's industry or sector.",
    dataType: 'text',
    synonyms: ['industry', 'sector', 'vertical', 'market segment', 'category', 'line of business'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'employeeCount',
    entity: 'company',
    column: 'employee_count',
    label: 'Employee count',
    description: 'How many people work at the employer, as a number.',
    dataType: 'integer',
    synonyms: ['employees', 'employee count', 'headcount', 'staff', 'size', 'number of employees', 'team size', 'no of employees'],
    defaultTransformation: 'parse_integer',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'employeeBand',
    entity: 'company',
    column: 'employee_band',
    label: 'Employee range',
    description: 'A size bracket rather than an exact number.',
    dataType: 'enum',
    enumValues: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'],
    synonyms: ['employee band', 'employee range', 'company size', 'size range', 'headcount range', 'size band'],
    defaultTransformation: 'match_enum_value',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'annualRevenue',
    entity: 'company',
    column: 'annual_revenue',
    label: 'Annual revenue',
    description: "The employer's yearly revenue, as a number.",
    dataType: 'integer',
    synonyms: ['revenue', 'annual revenue', 'annual turnover', 'turnover', 'arr', 'yearly revenue', 'sales', 'gross revenue'],
    defaultTransformation: 'parse_integer',
    identityCritical: false,
    sensitivity: 'business',
  },
  {
    key: 'revenueBand',
    entity: 'company',
    column: 'revenue_band',
    label: 'Revenue range',
    description: 'A revenue bracket rather than an exact figure.',
    dataType: 'text',
    synonyms: ['revenue band', 'revenue range', 'turnover range', 'revenue bracket', 'annual turnover range'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'business',
  },
  {
    key: 'foundedYear',
    entity: 'company',
    column: 'founded_year',
    label: 'Year founded',
    description: 'The year the employer was founded.',
    dataType: 'integer',
    synonyms: ['founded', 'founded year', 'year founded', 'established', 'inception year', 'founding year'],
    defaultTransformation: 'parse_integer',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'technologies',
    entity: 'company',
    column: 'technologies',
    label: 'Technologies',
    description: 'Technologies the employer uses. Several values in one cell are fine.',
    dataType: 'text[]',
    synonyms: ['technologies', 'tech stack', 'technology', 'tools', 'stack', 'tech', 'software used'],
    defaultTransformation: 'split_delimited_list',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'fundingStage',
    entity: 'company',
    column: 'funding_stage',
    label: 'Funding stage',
    description: "The employer's latest funding stage, such as Series A.",
    dataType: 'text',
    synonyms: ['funding stage', 'stage', 'funding', 'last round', 'round', 'investment stage'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'lastFundingAt',
    entity: 'company',
    column: 'last_funding_at',
    label: 'Last funding date',
    description: 'When the employer last raised funding.',
    dataType: 'date',
    synonyms: ['last funding at', 'last funding date', 'funding date', 'last raised', 'latest round date'],
    defaultTransformation: 'parse_date',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'companyCountryCode',
    entity: 'company',
    column: 'country_code',
    label: "Company's country",
    description: "The country the EMPLOYER is headquartered in — not where the person is.",
    dataType: 'text',
    synonyms: ['company country', 'hq country', 'headquarters country', 'office country', 'company location country'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'companyRegion',
    entity: 'company',
    column: 'region',
    label: "Company's region",
    description: "The state or region the EMPLOYER is headquartered in.",
    dataType: 'text',
    synonyms: ['company region', 'hq region', 'company state', 'headquarters state', 'hq province'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
  {
    key: 'companyCity',
    entity: 'company',
    column: 'city',
    label: "Company's city",
    description: "The city the EMPLOYER is headquartered in.",
    dataType: 'text',
    synonyms: ['company city', 'hq city', 'headquarters', 'headquarters city', 'office city', 'hq'],
    defaultTransformation: 'trim',
    identityCritical: false,
    sensitivity: 'public',
  },
];

const BY_KEY: ReadonlyMap<CanonicalFieldKey, CanonicalFieldDef> = new Map(
  CANONICAL_FIELDS.map((f) => [f.key, f] as const),
);

/**
 * Looks up a destination. Returns `undefined` for anything not in the
 * registry — which is how a model-proposed target that does not exist is
 * discarded rather than trusted. A proposer is an untrusted input.
 */
export function canonicalField(key: string): CanonicalFieldDef | undefined {
  return BY_KEY.get(key as CanonicalFieldKey);
}

export function isCanonicalFieldKey(key: string): key is CanonicalFieldKey {
  return BY_KEY.has(key as CanonicalFieldKey);
}

/** The registry as the proposer is allowed to see it: names and prose only. */
export function allowedTargets(): ReadonlyArray<{
  key: CanonicalFieldKey;
  entity: 'contact' | 'company';
  label: string;
  description: string;
  dataType: CanonicalDataType;
}> {
  return CANONICAL_FIELDS.map((f) => ({
    key: f.key,
    entity: f.entity,
    label: f.label,
    description: f.description,
    dataType: f.dataType,
  }));
}

/** The identity-critical subset, which can never auto-apply. */
export function identityCriticalKeys(): readonly CanonicalFieldKey[] {
  return CANONICAL_FIELDS.filter((f) => f.identityCritical).map((f) => f.key);
}
