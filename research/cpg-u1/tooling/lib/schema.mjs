// Column specifications and row-level rules for the CPG U1 dataset — v2.
// Governed by CPG_U1_PREREGISTRATION_CANDIDATE_002.md. Every constant here is
// protocol, and the candidate cites it by name; the tooling adds no rule of its own.
import { validateIdentifier } from './identifiers.mjs';

export const SYNTHETIC_PREFIX = 'SYNTHETIC-';

/** Explicit "not established" token. NEVER means false; NEVER satisfies a requirement. */
export const UNKNOWN = 'UNKNOWN';

// ── candidate frame (candidate-002 §5) ─────────────────────────────────────
export const FRAME_COLUMNS = Object.freeze([
  'candidate_id',
  'company_name',
  'canonical_domain',                  // lowercase registrable host, no scheme/path/www — or UNKNOWN
  'jurisdiction_family',               // US-SEC | FR-SIRENE | BR-CNPJ | LEI-ONLY | UNKNOWN
  'identifier_scheme',                 // CIK | SIREN | CNPJ | LEI | UNKNOWN
  'identifier_value',                  // empty iff identifier_scheme = UNKNOWN
  'wikidata_qid',                      // optional secondary identifier
  'identifier_domain_evidence_url',    // A4
  'identifier_domain_evidence_note',   // A4
  'expected_outcome_class',            // fill-expected | abstention-expected | identity-hazard | unknown
  'identity_hazard_note',              // required iff identity-hazard
  'a1_operating_legal_entity',         // yes | no | unknown
  'a2_domain_controlled_https',        // yes | no | unknown
  'a4_tie_independent_of_cpg',         // yes | no | unknown
  'a6_reference_obtainable',           // yes | no | unknown
  'c1_2_used_in_cpg_work',             // yes | no | unknown — resolver, protocol, tooling or reference-truth development
  'c1_3_values_derived_from_cpg',      // yes | no | unknown
  'c1_4_prior_cpg_execution',          // yes | no | unknown — any smoke, live, pilot or production CPG run
  'c1_5_internal_or_owned',            // yes | no | unknown — the implementers' own company, tenant, or an entity they control
  'enumerated_by',
  'enumerated_at',
  'enumeration_source_url',
]);

export const ATTESTATIONS = Object.freeze(['yes', 'no', 'unknown']);
export const CONTAMINATION_ATTESTATIONS = Object.freeze([
  'c1_2_used_in_cpg_work', 'c1_3_values_derived_from_cpg', 'c1_4_prior_cpg_execution', 'c1_5_internal_or_owned',
]);

/** §4.3 / §5.1 A5 — accessible provider families at the frozen resolver SHA. */
export const JURISDICTION_FAMILIES = Object.freeze({
  'US-SEC': ['CIK', 'LEI'],
  'FR-SIRENE': ['SIREN', 'LEI'],
  'BR-CNPJ': ['CNPJ', 'LEI'],
  'LEI-ONLY': ['LEI'],
});
/** Fixed, published round-robin order (decision D-A). */
export const FAMILY_ORDER = Object.freeze(['US-SEC', 'FR-SIRENE', 'BR-CNPJ', 'LEI-ONLY']);

export const OUTCOME_CLASSES = Object.freeze(['fill-expected', 'abstention-expected', 'identity-hazard']);

/** Development set: EXACT counts (decision D-B). */
export const DEVELOPMENT_QUOTA = Object.freeze({ 'fill-expected': 6, 'abstention-expected': 2, 'identity-hazard': 2 });
/** Held-out base (floor) counts; the final counts come from the sizing rule (lib/sizing.mjs). */
export const HELD_OUT_BASE = Object.freeze({ 'fill-expected': 12, 'abstention-expected': 5, 'identity-hazard': 3 });
/** Candidate pool must hold at least this multiple of each stage's quota, per class (decision on pool minimum). */
export const POOL_MULTIPLIER = 2;

/** Closed list of screening exclusion reasons (candidate-002 §15.4). */
export const EXCLUSION_REASONS = Object.freeze([
  'A1_NOT_OPERATING_ENTITY', 'A1_NOT_ESTABLISHED',
  'A2_NO_CONTROLLED_DOMAIN', 'A2_NOT_ESTABLISHED',
  'A3_INVALID_IDENTIFIER', 'A3_NOT_ESTABLISHED',
  'A4_NO_INDEPENDENT_TIE', 'A4_NOT_ESTABLISHED',
  'A5_INACCESSIBLE_JURISDICTION', 'A5_NOT_ESTABLISHED',
  'A6_REFERENCE_NOT_OBTAINABLE', 'A6_NOT_ESTABLISHED',
  'OUTCOME_CLASS_NOT_ESTABLISHED',
  'MALFORMED_ROW',
  'NOT_DRAWN',
  'DEVELOPMENT_SURPLUS',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isHttpsUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname; } catch { return false; }
}

export function isCalendarDate(v) {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Row-level validation of one frame record.
 * Returns { errors, admissibility: {A1..A6: 'pass'|'fail'|'unknown'}, exclusion, contamination: string[] }.
 * `errors` = structural (MALFORMED_ROW). Admissibility failures and UNKNOWNs are screening outcomes.
 */
export function checkFrameRow(r, { allowSynthetic = false } = {}) {
  const errors = [];
  for (const c of FRAME_COLUMNS) if (!(c in r)) errors.push(`missing column ${c}`);
  if (errors.length) return { errors, admissibility: null, exclusion: 'MALFORMED_ROW', contamination: [] };

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.candidate_id)) errors.push('candidate_id must be 1-64 of [A-Za-z0-9_-]');
  if (!r.company_name.trim() || r.company_name !== r.company_name.trim()) errors.push('company_name empty or padded');
  if (!allowSynthetic && (r.company_name.startsWith(SYNTHETIC_PREFIX) || r.canonical_domain.endsWith('.example'))) {
    errors.push('SYNTHETIC row in a real frame — synthetic rows exist only for the self-test');
  }
  // Explicit UNKNOWN is a legitimate value; BLANK is always malformed (catches omissions).
  for (const c of ['canonical_domain', 'jurisdiction_family', 'identifier_scheme', 'expected_outcome_class']) {
    if (r[c] === '') errors.push(`${c} is blank — write ${c === 'expected_outcome_class' ? '"unknown"' : `"${UNKNOWN}"`} if it is not established`);
  }
  if (r.canonical_domain && r.canonical_domain !== UNKNOWN) {
    if (r.canonical_domain !== r.canonical_domain.toLowerCase()) errors.push('canonical_domain must be lowercase');
    if (/^www\./.test(r.canonical_domain)) errors.push('canonical_domain must not start with "www." (canonical form)');
    if (/[/:?#\s]/.test(r.canonical_domain)) errors.push('canonical_domain must be a bare host (no scheme, port, path or whitespace)');
  }
  if (r.identifier_scheme === UNKNOWN && r.identifier_value !== '') errors.push('identifier_value must be empty when identifier_scheme is UNKNOWN');
  if (r.identifier_scheme && r.identifier_scheme !== UNKNOWN && r.identifier_value === '') errors.push('identifier_value is blank — set identifier_scheme to UNKNOWN if no identifier is established');
  for (const c of ['a1_operating_legal_entity', 'a2_domain_controlled_https', 'a4_tie_independent_of_cpg',
    'a6_reference_obtainable', ...CONTAMINATION_ATTESTATIONS]) {
    if (!ATTESTATIONS.includes(r[c])) errors.push(`${c} must be exactly "yes", "no" or "unknown" (blank is not an answer)`);
  }
  if (r.expected_outcome_class && ![...OUTCOME_CLASSES, 'unknown'].includes(r.expected_outcome_class)) {
    errors.push(`expected_outcome_class must be one of ${OUTCOME_CLASSES.join('|')}|unknown`);
  }
  if (r.expected_outcome_class === 'identity-hazard' && !r.identity_hazard_note.trim()) {
    errors.push('identity_hazard_note is required for identity-hazard (name the colliding entity)');
  }
  if (!r.enumerated_by.trim()) errors.push('enumerated_by is required');
  if (!isCalendarDate(r.enumerated_at)) errors.push('enumerated_at must be YYYY-MM-DD');
  if (!isHttpsUrl(r.enumeration_source_url)) errors.push('enumeration_source_url must be an https URL');
  if (r.wikidata_qid && validateIdentifier('QID', r.wikidata_qid)) errors.push(validateIdentifier('QID', r.wikidata_qid));
  if (errors.length) return { errors, admissibility: null, exclusion: 'MALFORMED_ROW', contamination: [] };

  // ── Admissibility: tri-state. 'unknown' is its own outcome and is NEVER a pass. ──
  const tri = (v) => (v === 'yes' ? 'pass' : v === 'no' ? 'fail' : 'unknown');
  const adm = {};
  adm.A1 = tri(r.a1_operating_legal_entity);
  if (r.canonical_domain === UNKNOWN) adm.A2 = r.a2_domain_controlled_https === 'no' ? 'fail' : 'unknown';
  else if (!HOSTNAME.test(r.canonical_domain)) adm.A2 = 'fail';
  else adm.A2 = tri(r.a2_domain_controlled_https);

  const schemes = JURISDICTION_FAMILIES[r.jurisdiction_family];
  adm.A5 = r.jurisdiction_family === UNKNOWN ? 'unknown' : schemes ? 'pass' : 'fail';
  if (r.identifier_scheme === UNKNOWN) adm.A3 = 'unknown';
  else adm.A3 = !validateIdentifier(r.identifier_scheme, r.identifier_value) && (!schemes || schemes.includes(r.identifier_scheme)) ? 'pass' : 'fail';

  const a4 = tri(r.a4_tie_independent_of_cpg);
  const evidenceOk = isHttpsUrl(r.identifier_domain_evidence_url) && !!r.identifier_domain_evidence_note.trim();
  adm.A4 = a4 === 'pass' && !evidenceOk ? 'fail' : a4;
  adm.A6 = tri(r.a6_reference_obtainable);

  const REASON = {
    A1: ['A1_NOT_OPERATING_ENTITY', 'A1_NOT_ESTABLISHED'], A2: ['A2_NO_CONTROLLED_DOMAIN', 'A2_NOT_ESTABLISHED'],
    A3: ['A3_INVALID_IDENTIFIER', 'A3_NOT_ESTABLISHED'], A4: ['A4_NO_INDEPENDENT_TIE', 'A4_NOT_ESTABLISHED'],
    A5: ['A5_INACCESSIBLE_JURISDICTION', 'A5_NOT_ESTABLISHED'], A6: ['A6_REFERENCE_NOT_OBTAINABLE', 'A6_NOT_ESTABLISHED'],
  };
  let exclusion = null;
  for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
    if (adm[k] !== 'pass') { exclusion = REASON[k][adm[k] === 'fail' ? 0 : 1]; break; }
  }
  if (!exclusion && r.expected_outcome_class === 'unknown') exclusion = 'OUTCOME_CLASS_NOT_ESTABLISHED';

  // ── Contamination attestations: 'yes' AND 'unknown' both make a company held-out-ineligible. ──
  const contamination = [];
  const LABEL = {
    c1_2_used_in_cpg_work: 'CPG-C1(2) used in CPG resolver/protocol/tooling/reference-truth work',
    c1_3_values_derived_from_cpg: 'CPG-C1(3) values derived from CPG output',
    c1_4_prior_cpg_execution: 'CPG-C1(4) prior CPG execution (smoke/live/pilot/production)',
    c1_5_internal_or_owned: 'CPG-C1(5) internal or implementer-owned entity',
  };
  for (const c of CONTAMINATION_ATTESTATIONS) {
    if (r[c] === 'yes') contamination.push(LABEL[c]);
    if (r[c] === 'unknown') contamination.push(`${LABEL[c]} — NOT ESTABLISHED, treated as contaminated`);
  }
  return { errors, admissibility: adm, exclusion, contamination };
}

// ── reference truth: shared value rules (candidate-002 §9) ─────────────────
export const FIELDS = Object.freeze(['founded_year', 'employee_count', 'revenue_range']);

export const SOURCE_CLASSES = Object.freeze([
  'REGISTRY_RECORD', 'REGULATORY_FILING', 'AUDITED_FINANCIAL_FILING', 'ENTITY_OWN_PAGE',
  'ENTITY_OWN_FINANCIAL_STATEMENT', 'PRESS', 'ENCYCLOPAEDIA', 'AGGREGATOR', 'JOB_BOARD',
]);

/** §9.2 authority by field. Anything not listed is NOT_AUTHORITATIVE for that field. */
export const AUTHORITY = Object.freeze({
  founded_year: { REGISTRY_RECORD: 'TIER_1', ENTITY_OWN_PAGE: 'TIER_2' },
  employee_count: { REGULATORY_FILING: 'TIER_1', ENTITY_OWN_PAGE: 'TIER_2' },
  revenue_range: { AUDITED_FINANCIAL_FILING: 'TIER_1', REGULATORY_FILING: 'TIER_1', ENTITY_OWN_FINANCIAL_STATEMENT: 'TIER_2' },
});

export const FORBIDDEN_KINDS = Object.freeze(['TARGET', 'PROJECTION', 'RUN_RATE', 'ORDER_BOOK', 'ESTIMATE']);

/** §9.3 STATED value formats — make the §10.2 agreement rules executable. */
export const VALUE_FORMAT = Object.freeze({
  founded_year: { re: /^[12][0-9]{3}$/, desc: 'a four-digit year, e.g. 1999' },
  employee_count: { re: /^[1-9][0-9]*$/, desc: 'a positive integer without separators, e.g. 3682' },
  revenue_range: { re: /^[A-Z]{3} [1-9][0-9]*$/, desc: 'an ISO 4217 code, one space, and a positive integer in whole units, e.g. USD 1300000000' },
});

export const authorityOf = (field, sourceClass) => AUTHORITY[field]?.[sourceClass] ?? 'NOT_AUTHORITATIVE';

/** Blind record written independently by the reference AUTHOR or the CONFIRMER (§9.4). */
export const BLIND_RECORD_COLUMNS = Object.freeze([
  'candidate_id', 'field', 'value_kind', 'expected_value', 'authoritative_source_name', 'source_class',
  'source_url', 'publication_date', 'as_of_date', 'search_note', 'constructed_without_cpg', 'recorded_by', 'recorded_at',
]);

/** Written only by the independent ADJUDICATOR, only for author/confirmer disagreements. */
export const ADJUDICATION_COLUMNS = Object.freeze([
  'candidate_id', 'field', 'decision', 'rationale', 'adjudicated_by', 'adjudicated_at',
]);
export const ADJUDICATION_DECISIONS = Object.freeze(['AUTHOR', 'CONFIRMER', 'REFERENCE-CONFLICT']);

/** Reconciled, sealable reference truth — produced ONLY by reconcile (never hand-written). */
export const REFERENCE_COLUMNS = Object.freeze([
  'candidate_id', 'field', 'value_kind', 'expected_value', 'authoritative_source_name', 'source_class', 'source_url',
  'publication_date', 'as_of_date', 'search_note', 'ambiguity_flag', 'independence_class',
  'author', 'confirmer', 'resolution', 'adjudicated_by',
]);
export const RESOLUTIONS = Object.freeze(['AGREED', 'ADJUDICATED_AUTHOR', 'ADJUDICATED_CONFIRMER', 'REFERENCE_CONFLICT']);

/** Value-level rules shared by blind records and reconciled rows. */
export function checkValueFields(r) {
  const errors = [];
  if (!FIELDS.includes(r.field)) errors.push(`field must be one of ${FIELDS.join('|')}`);
  if (FORBIDDEN_KINDS.includes(r.value_kind)) {
    errors.push(`value_kind ${r.value_kind} is never an expected value (§9.2); if no stated value exists, record NOT_AVAILABLE_FROM_SOURCE and describe the ${r.value_kind.toLowerCase()} in search_note`);
  } else if (!['STATED', 'NOT_AVAILABLE_FROM_SOURCE'].includes(r.value_kind)) {
    errors.push('value_kind must be STATED or NOT_AVAILABLE_FROM_SOURCE');
  }
  if (r.value_kind === 'STATED') {
    if (!r.expected_value.trim()) errors.push('STATED requires expected_value');
    else if (VALUE_FORMAT[r.field] && !VALUE_FORMAT[r.field].re.test(r.expected_value)) {
      errors.push(`expected_value for ${r.field} must be ${VALUE_FORMAT[r.field].desc} (§9.3)`);
    }
    if (!SOURCE_CLASSES.includes(r.source_class)) errors.push(`source_class must be one of ${SOURCE_CLASSES.join('|')}`);
    const tier = authorityOf(r.field, r.source_class);
    if (tier === 'NOT_AUTHORITATIVE') errors.push(`source_class ${r.source_class} is not authoritative for ${r.field} (§9.2)`);
    if (r.field === 'employee_count' && tier === 'TIER_2' && r.publication_date === 'NOT_STATED') {
      errors.push("employee_count from the entity's own page requires a stated publication_date (§9.2)");
    }
    if (!r.authoritative_source_name.trim()) errors.push('STATED requires authoritative_source_name');
    if (!isHttpsUrl(r.source_url)) errors.push('STATED requires an https source_url');
  }
  if (r.value_kind === 'NOT_AVAILABLE_FROM_SOURCE') {
    if (r.expected_value !== '') errors.push('NOT_AVAILABLE_FROM_SOURCE requires an empty expected_value');
    if (!r.search_note.trim()) errors.push('NOT_AVAILABLE_FROM_SOURCE requires search_note (what was searched)');
  }
  if (!(r.publication_date === 'NOT_STATED' || isCalendarDate(r.publication_date))) errors.push('publication_date must be YYYY-MM-DD or NOT_STATED');
  if (!isCalendarDate(r.as_of_date)) errors.push('as_of_date must be YYYY-MM-DD');
  return errors;
}

export function checkBlindRecord(r) {
  const errors = [];
  for (const c of BLIND_RECORD_COLUMNS) if (!(c in r)) errors.push(`missing column ${c}`);
  if (errors.length) return errors;
  errors.push(...checkValueFields(r));
  if (r.constructed_without_cpg !== 'yes') errors.push('constructed_without_cpg must be "yes" (§9.3 anti-circularity)');
  if (!r.recorded_by.trim()) errors.push('recorded_by is required');
  if (!isCalendarDate(r.recorded_at)) errors.push('recorded_at must be YYYY-MM-DD');
  return errors;
}

/** Normalised comparison key for agreement: kind + value (whitespace-collapsed, case-insensitive). */
export const agreementKey = (r) => `${r.value_kind}|${r.expected_value.trim().replace(/\s+/g, ' ').toLowerCase()}`;
