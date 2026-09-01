/**
 * D1 — CONTRACT 17, enforced. The one place that decides whether a criterion is
 * expressible at all.
 *
 * The rule it implements, verbatim: criteria may use ONLY vocabularies the
 * DATABASE already enforces. Everything else gets exact-match or a numeric
 * range, and nothing more.
 *
 *   ENFORCED VOCABULARIES (mirrored by DB CHECKs, imported not copied)
 *     seniority       SENIORITY_VALUES   — unified_persons_seniority_valid
 *     employee_band   EMPLOYEE_BANDS     — prospect_accounts_employee_band_valid
 *     country_code    normalizeCountryCode — ISO-3166-1 alpha-2, or nothing
 *
 *   NO VOCABULARY, THEREFORE EXACT MATCH ONLY
 *     industry, revenue_band, funding_stage, region, city, department, job_title
 *
 *   NUMERIC / ARRAY
 *     employee_count, annual_revenue, founded_year   (range predicates)
 *     technologies                                   (exact membership)
 *
 * ─── WHY NOT JUST INVENT THE MISSING VOCABULARIES ─────────────────────────
 * Because P2A explicitly assigned `revenue_band` and `funding_stage` to the
 * first real enrichment provider, and that provider has not been chosen. An
 * invented list would be enforced by this file, written into tenants' ratified
 * ICPs, and then contradicted by whatever the provider actually sends —
 * producing criteria that can never match anything, inside documents that are
 * immutable by contract 16. The cost of waiting is that a tenant must type
 * their provider's exact label. The cost of guessing is unfixable.
 *
 * `toAccountAttributes` in prospectIdentity/attributes.ts takes the same
 * position for the same reason: `revenueBand` and `fundingStage` go through
 * plain display-text normalisation, "because the repository has no vocabulary
 * for either and a provider's own label is the fact being recorded."
 *
 * This module is PURE: no database, no network, no clock.
 */

import {
  EMPLOYEE_BANDS, SENIORITY_VALUES,
  isEmployeeBand, isSeniority,
  normalizeCountryCode, normalizeDisplayText,
} from '../prospectIdentity/attributes';
import {
  ICP_CRITERION_KINDS, ICP_SUBJECTS, IcpContractError,
  type IcpCriterion, type IcpCriterionKind, type IcpPredicate, type IcpPredicateOp, type IcpSubject,
} from './types';

/**
 * How an attribute's values are checked. This is the ONLY axis that decides
 * which predicates are legal, which is why contract 17 collapses to a table
 * lookup rather than a rule scattered across the validator.
 */
type AttributeKind = 'closed_vocabulary' | 'country_code' | 'exact_text' | 'numeric' | 'string_array';

/** Predicates each kind admits. Anything absent is refused. */
const OPS_BY_KIND: Record<AttributeKind, readonly IcpPredicateOp[]> = {
  // A closed vocabulary is still exact match — the closure only narrows WHICH
  // exact values are legal.
  closed_vocabulary: ['one_of'],
  country_code:      ['one_of'],
  // CONTRACT 17: no `contains`, no `like`, no `matches`. Exact only.
  exact_text:        ['one_of'],
  numeric:           ['between', 'at_least', 'at_most'],
  string_array:      ['includes_any', 'includes_all'],
};

/**
 * The attribute surface, per subject. Deliberately a CLOSED list of real
 * columns: an ICP may only speak about attributes the platform actually stores,
 * because a criterion naming `account.mrr` would be permanently `unknown` and
 * would look like a data gap rather than the modelling error it is.
 *
 * Account columns: `prospect_accounts` (LI-1 + P2A).
 * Person columns:  `unified_persons` (LI-1).
 */
const ACCOUNT_ATTRIBUTES: Readonly<Record<string, AttributeKind>> = {
  industry:       'exact_text',
  employee_count: 'numeric',
  employee_band:  'closed_vocabulary',
  country_code:   'country_code',
  region:         'exact_text',
  city:           'exact_text',
  annual_revenue: 'numeric',
  revenue_band:   'exact_text',
  founded_year:   'numeric',
  technologies:   'string_array',
  funding_stage:  'exact_text',
};

const PERSON_ATTRIBUTES: Readonly<Record<string, AttributeKind>> = {
  job_title:    'exact_text',
  department:   'exact_text',
  seniority:    'closed_vocabulary',
  country_code: 'country_code',
  region:       'exact_text',
  city:         'exact_text',
};

const ATTRIBUTES: Record<IcpSubject, Readonly<Record<string, AttributeKind>>> = {
  account: ACCOUNT_ATTRIBUTES,
  person:  PERSON_ATTRIBUTES,
};

/** The closed vocabulary an attribute is bound to, when it has one. */
const CLOSED_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  employee_band: EMPLOYEE_BANDS,
  seniority:     SENIORITY_VALUES,
};

const GUARDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  employee_band: isEmployeeBand,
  seniority:     isSeniority,
};

export function attributeKind(subject: IcpSubject, attribute: string): AttributeKind | null {
  return ATTRIBUTES[subject]?.[attribute] ?? null;
}

export function attributesFor(subject: IcpSubject): string[] {
  return Object.keys(ATTRIBUTES[subject] ?? {}).sort();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (message: string, code: string): never => {
  throw new IcpContractError(message, code);
};

const CRITERION_ID = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

/** Every value in a text predicate, cleaned exactly as storage would clean it. */
function normalizedValues(predicate: IcpPredicate): string[] {
  const raw = 'values' in predicate ? predicate.values : [];
  if (!Array.isArray(raw)) fail('predicate values must be an array', 'values_not_array');
  if (raw.length === 0) fail('a value set must not be empty — an empty set matches nothing', 'values_empty');
  return raw.map((v) => {
    if (typeof v !== 'string') fail(`value ${JSON.stringify(v)} is not a string`, 'value_not_string');
    const cleaned = normalizeDisplayText(v);
    if (cleaned === null) fail('a value must not be blank', 'value_blank');
    return cleaned as string;
  });
}

function validateNumericPredicate(p: IcpPredicate): IcpPredicate {
  const num = (v: unknown, field: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fail(`${field} must be a finite number`, 'bound_not_finite');
    }
    return v as number;
  };
  if (p.op === 'between') {
    const min = num(p.min, 'min');
    const max = num(p.max, 'max');
    // An inverted range is never satisfiable, so it is a mistake, not a filter.
    if (min > max) fail(`between requires min <= max (got ${min} > ${max})`, 'range_inverted');
    return { op: 'between', min, max };
  }
  if (p.op === 'at_least') return { op: 'at_least', value: num(p.value, 'value') };
  return { op: 'at_most', value: num((p as { value: unknown }).value, 'value') };
}

/**
 * Validate ONE criterion and return its normalised form.
 *
 * Returning a normalised copy rather than mutating is deliberate: the value that
 * is STORED must be the value that was CHECKED, or the two drift and a criterion
 * that passed validation can fail evaluation forever after.
 */
export function validateCriterion(input: unknown): IcpCriterion {
  if (!isRecord(input)) fail('a criterion must be an object', 'criterion_not_object');
  const c = input as Record<string, unknown>;

  const id = typeof c.id === 'string' ? c.id.trim() : '';
  if (!CRITERION_ID.test(id)) {
    fail(`criterion id '${String(c.id)}' must be a lower-case slug`, 'criterion_id_invalid');
  }

  const kind = c.kind as IcpCriterionKind;
  if (!(ICP_CRITERION_KINDS as readonly string[]).includes(kind)) {
    fail(`criterion '${id}': kind must be one of ${ICP_CRITERION_KINDS.join(', ')}`, 'kind_invalid');
  }

  const subject = c.subject as IcpSubject;
  if (!ICP_SUBJECTS.includes(subject)) {
    fail(`criterion '${id}': subject must be one of ${ICP_SUBJECTS.join(', ')}`, 'subject_invalid');
  }

  const attribute = typeof c.attribute === 'string' ? c.attribute.trim() : '';
  const kindOfAttr = attributeKind(subject, attribute);
  if (kindOfAttr === null) {
    fail(
      `criterion '${id}': '${attribute}' is not a ${subject} attribute. Available: ${attributesFor(subject).join(', ')}`,
      'attribute_unknown',
    );
  }

  if (!isRecord(c.predicate)) fail(`criterion '${id}': predicate must be an object`, 'predicate_not_object');
  const predicate = c.predicate as unknown as IcpPredicate;
  const op = (predicate as { op?: unknown }).op;
  const allowed = OPS_BY_KIND[kindOfAttr as AttributeKind];
  if (typeof op !== 'string' || !allowed.includes(op as IcpPredicateOp)) {
    fail(
      `criterion '${id}': '${attribute}' admits only ${allowed.join(', ')} — got '${String(op)}'. `
      + 'Contract 17 permits exact-match or numeric-range predicates only.',
      'predicate_not_permitted',
    );
  }

  let normalizedPredicate: IcpPredicate;
  if (op === 'between' || op === 'at_least' || op === 'at_most') {
    normalizedPredicate = validateNumericPredicate(predicate);
  } else {
    const values = normalizedValues(predicate);

    // The closed vocabularies. This is the assertion contract 17 exists for: a
    // seniority or employee band outside the DB-enforced set is REFUSED here,
    // not silently stored and then never matched.
    const vocabulary = CLOSED_VOCABULARY[attribute];
    if (vocabulary) {
      const guard = GUARDS[attribute];
      const rejected = values.filter((v) => !guard(v));
      if (rejected.length) {
        fail(
          `criterion '${id}': ${rejected.map((v) => `'${v}'`).join(', ')} outside the closed `
          + `${attribute} vocabulary (${vocabulary.join(', ')})`,
          'value_outside_vocabulary',
        );
      }
    }

    if (kindOfAttr === 'country_code') {
      const normalized = values.map((v) => {
        const code = normalizeCountryCode(v);
        if (code === null) {
          fail(`criterion '${id}': '${v}' is not an ISO-3166-1 alpha-2 country code`, 'country_code_invalid');
        }
        return code as string;
      });
      normalizedPredicate = { op: 'one_of', values: [...new Set(normalized)].sort() };
      return built(id, kind, subject, attribute, normalizedPredicate, c.description);
    }

    const deduped = [...new Set(values)].sort();
    normalizedPredicate = op === 'one_of'
      ? { op: 'one_of', values: deduped }
      : { op: op as 'includes_any' | 'includes_all', values: deduped };
  }

  return built(id, kind, subject, attribute, normalizedPredicate, c.description);
}

function built(
  id: string, kind: IcpCriterionKind, subject: IcpSubject, attribute: string,
  predicate: IcpPredicate, description: unknown,
): IcpCriterion {
  return {
    id, kind, subject, attribute, predicate,
    description: typeof description === 'string' ? normalizeDisplayText(description) : null,
  };
}

/** Hard ceiling. A profile nobody can read is a profile nobody can ratify. */
export const MAX_CRITERIA = 100;

/**
 * Validate a whole criteria array. Criterion ids must be unique WITHIN a
 * version, because every evidence reference cites one and a duplicate would
 * make an explanation ambiguous.
 *
 * An EMPTY array is permitted and is not an error: a draft starts empty, and a
 * ratified version with no criteria simply causes the evaluator to abstain
 * (contract 18) rather than to score everything as a perfect fit.
 */
export function validateCriteria(input: unknown): IcpCriterion[] {
  if (!Array.isArray(input)) fail('criteria must be an array', 'criteria_not_array');
  if (input.length > MAX_CRITERIA) {
    fail(`criteria exceeds the ${MAX_CRITERIA}-criterion limit (got ${input.length})`, 'criteria_too_many');
  }
  const seen = new Set<string>();
  const out: IcpCriterion[] = [];
  for (const raw of input) {
    const criterion = validateCriterion(raw);
    if (seen.has(criterion.id)) {
      fail(`duplicate criterion id '${criterion.id}' — ids must be unique within a version`, 'criterion_id_duplicate');
    }
    seen.add(criterion.id);
    out.push(criterion);
  }
  // Deterministic order, so two equivalent submissions produce byte-identical
  // stored criteria and a version diff shows real changes only.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
