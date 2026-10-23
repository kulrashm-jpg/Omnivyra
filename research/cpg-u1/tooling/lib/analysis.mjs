// Analysis stage (CPG_U1_PROTOCOL_004 §9.8, §10.2–§10.5, §12, §15). Offline and deterministic: from the sealed evaluation
// artifact, the two rater sheets, the rating resolution, the execution audit and the declarations, compute every
// observation's disposition, the endpoints G1/P1/P2/P3/R1, Krippendorff's α (nominal), SOURCE-COINCIDENT, REFERENCE-STALE,
// the §15.5 conditions, exactly one §10.5 outcome, the §10.4 diagnostics and the exclusion table.
//
// Nothing here chooses a value the protocol does not define. Every such value is a named decision (DECISIONS below) read
// from rules/analysis_decisions.json — pinned inside the tooling, so it is frozen by the registered tooling aggregate.
// While any decision is UNDECIDED the analysis is BLOCKED. Thresholds are compared exactly, in integers.
import { canonicalJson, sha256 } from './canonical.mjs';
import { FIELDS, isCalendarDate } from './schema.mjs';
import { EXECUTION_STATE, auditExecutionLog } from './execution.mjs';
import { executionLogFromEvents } from './harness.mjs';
import { RATING_LABELS } from './packets.mjs';
import { finalRatings } from './ratings.mjs';

export const DECISIONS_SCHEMA = 'cpg-u1-analysis-decisions/v1';
export const DECLARATIONS_SCHEMA = 'cpg-u1-analysis-declarations/v1';
export const RESULTS_SCHEMA = 'cpg-u1-results/v1';
export const UNDECIDED = 'UNDECIDED';

/** The permitted options of every methodological decision the protocol leaves open. The file must name exactly these. */
export const DECISIONS = Object.freeze({
  'AD-1': Object.freeze(['ALL_COMPLETELY_RATED_ITEMS', 'EXCLUDE_INVALID_CONFLICT_AND_STALE']),
  'AD-2': Object.freeze(['INCONCLUSIVE', 'NOT_BELOW_THRESHOLD']),
  'AD-3': Object.freeze(['EXACT_URL_STRING', 'URL_WITHOUT_FRAGMENT']),
  'AD-4': Object.freeze(['ANY_REGISTRY_UNAVAILABLE_ENTRY', 'ENTRY_FOR_DECISIVE_IDENTIFIER']),
  'AD-5': Object.freeze(['CALENDAR_MONTHS', 'DAYS_730']),
  'AD-6': Object.freeze(['STATED_REFERENCE_VALUES_ONLY', 'ALL_REFERENCE_RECORDS']),
  'AD-7': Object.freeze(['INCONCLUSIVE', 'VOID']),
  'AD-8': Object.freeze(['P2_NOT_MET', 'INCONCLUSIVE']),
  'AD-9': Object.freeze(['ANY_UNAVAILABLE_ENTRY', 'REGISTRY_UNAVAILABLE_ONLY']),
});

const FILL = ['SUPPORTED-FILL', 'UNSUPPORTED-FILL', 'INCORRECT-FILL', 'MISATTRIBUTED-FILL'];
const k = (x) => `${x.candidate_id}|${x.field}`;
const frac = (num, den) => ({ numerator: num, denominator: den, value: den === 0 ? null : num / den });

/** Validate a decisions file; returns { values, undecided, errors }. */
export function readDecisions(file) {
  const errors = [];
  if (!file || file.schema !== DECISIONS_SCHEMA || !file.decisions || typeof file.decisions !== 'object') return { values: {}, undecided: [], errors: [`decisions schema must be ${DECISIONS_SCHEMA}`] };
  const ids = Object.keys(file.decisions).sort();
  if (canonicalJson(ids) !== canonicalJson(Object.keys(DECISIONS).sort())) errors.push(`decisions must name exactly ${Object.keys(DECISIONS).join(', ')}`);
  const values = {}; const undecided = [];
  for (const id of Object.keys(DECISIONS)) {
    const d = file.decisions[id];
    if (!d) continue;
    if (canonicalJson(d.options) !== canonicalJson(DECISIONS[id])) errors.push(`${id}: options must be exactly ${DECISIONS[id].join(' | ')}`);
    if (d.value === UNDECIDED) undecided.push(id);
    else if (!DECISIONS[id].includes(d.value)) errors.push(`${id}: value ${JSON.stringify(d.value)} is not a permitted option`);
    values[id] = d.value;
  }
  return { values, undecided, errors };
}

/** Declarations the tooling cannot discover itself (§15.2 identity inadmissibility; §15.5(7) protocol violations). */
export function checkDeclarations(d, { sealHash, heldOutIds }) {
  const errors = [];
  const KEYS = ['schema', 'seal_hash', 'protocol_violations', 'identity_inadmissible'];
  if (!d || Object.keys(d).length !== KEYS.length || !KEYS.every((x) => Object.hasOwn(d, x))) return [`declarations keys must be exactly ${KEYS.join(',')}`];
  if (d.schema !== DECLARATIONS_SCHEMA) errors.push(`declarations schema must be ${DECLARATIONS_SCHEMA}`);
  if (d.seal_hash !== sealHash) errors.push('declarations name a different seal');
  if (!Array.isArray(d.protocol_violations) || d.protocol_violations.some((v) => !v || typeof v.description !== 'string' || !v.description.trim() || !isCalendarDate(v.discovered_at ?? ''))) errors.push('protocol_violations must be [{description, discovered_at: YYYY-MM-DD}]');
  if (!Array.isArray(d.identity_inadmissible)) errors.push('identity_inadmissible must be an array');
  else {
    const seen = new Set();
    for (const x of d.identity_inadmissible) {
      if (!x || !heldOutIds.includes(x.candidate_id)) errors.push(`identity_inadmissible: ${x?.candidate_id} is not a held-out company`);
      else if (seen.has(x.candidate_id)) errors.push(`identity_inadmissible: ${x.candidate_id} listed twice`);
      else if (typeof x.basis !== 'string' || !x.basis.trim()) errors.push(`identity_inadmissible: ${x.candidate_id} needs a basis`);
      seen.add(x?.candidate_id);
    }
  }
  return errors;
}

/**
 * Krippendorff's α, nominal, two coders, pairable units only (a unit with a missing value carries no pairable information).
 * α = 1 − (n − 1)·Σ_{c≠k} o_ck / Σ_{c≠k} n_c·n_k, n = 2·units. Returned as an exact ratio: α = 1 − num/den.
 */
export function alphaNominal(pairs) {
  const n = 2 * pairs.length;
  const counts = new Map();
  let disagreements = 0;
  for (const [a, b] of pairs) {
    counts.set(a, (counts.get(a) ?? 0) + 1); counts.set(b, (counts.get(b) ?? 0) + 1);
    if (a !== b) disagreements++;
  }
  const den = n * n - [...counts.values()].reduce((s, c) => s + c * c, 0);
  const num = (n - 1) * 2 * disagreements;
  return { units: pairs.length, disagreements, observed_num: num, expected_den: den, defined: den > 0, value: den > 0 ? 1 - num / den : null };
}
/** α < 0.667 exactly: 1 − num/den < 667/1000 ⇔ 1000·(den − num) < 667·den. */
const alphaBelow = (a) => 1000 * (a.expected_den - a.observed_num) < 667 * a.expected_den;

/** Calendar date `months` before an ISO instant (UTC), day clamped to the month's end. */
export function monthsBefore(isoInstant, months) {
  const d = new Date(Date.parse(isoInstant));
  const y = d.getUTCFullYear(); const m = d.getUTCMonth() - months;
  const ty = y + Math.floor(m / 12); const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
}
const daysBefore = (isoInstant, days) => new Date(Date.parse(isoInstant.slice(0, 10)) - days * 86400000).toISOString().slice(0, 10);

const stripFragment = (u) => { const i = u.indexOf('#'); return i === -1 ? u : u.slice(0, i); };

/**
 * Run the analysis. All inputs must already be verified by the caller (hashes, bindings, assignment).
 * Returns the results artifact (with results_sha256).
 */
export function analyze({ evaluation, hoManifest, sheet1, sheet2, resolution, recordSha, authorization, events, sealPublication, declarations, decisions, decisionsSource, decisionsSha }) {
  const D = decisions;
  const heldOut = new Map(hoManifest.held_out.map((e) => [e.candidate_id, e]));
  const base = {
    schema: RESULTS_SCHEMA, study_id: evaluation.study_id, registration_id: evaluation.registration_id, seal_hash: evaluation.seal_hash,
    evaluation_sha256: evaluation.evaluation_sha256, sheet_1_sha256: sheet1.sheet_sha256, sheet_2_sha256: sheet2.sheet_sha256,
    rating_resolution_sha256: resolution ? resolution.resolution_sha256 : null, declarations_sha256: sha256(canonicalJson(declarations)),
    decisions: { source: decisionsSource, sha256: decisionsSha, values: D },
  };
  const seal = (x) => ({ ...x, results_sha256: sha256(canonicalJson(x)) });

  // §15.5(8) / §6.5: a VOID study reports no endpoint.
  const audit = auditExecutionLog(authorization, executionLogFromEvents(events));
  const voidBasis = [];
  if (audit.state.startsWith('STUDY_VOID')) voidBasis.push(`execution audit ${audit.state}`);
  if (declarations.protocol_violations.length && D['AD-7'] === 'VOID') voidBasis.push(`${declarations.protocol_violations.length} declared protocol violation(s) (AD-7 = VOID)`);
  if (voidBasis.length) return seal({ ...base, execution_audit: audit.state, outcome: 'VOID', outcome_basis: voidBasis, endpoints: null, note: 'VOID: no endpoint may be reported (§15.5(8), §18)' });
  if (audit.state !== EXECUTION_STATE.CLEAN) throw new Error(`ANALYSIS_REFUSED: execution audit is ${audit.state}`);

  const finals = finalRatings({ evaluation, sheet1, sheet2, resolution, recordSha });
  const inadmissible = new Map(declarations.identity_inadmissible.map((x) => [x.candidate_id, x.basis]));
  const asOf = authorization.as_of;
  const cutoff = D['AD-5'] === 'CALENDAR_MONTHS' ? monthsBefore(asOf, 24) : daysBefore(asOf, 730);
  const coincident = (ref, urls) => {
    if (!ref.source_url) return false;
    if (D['AD-3'] === 'EXACT_URL_STRING') return urls.includes(ref.source_url);
    return urls.map(stripFragment).includes(stripFragment(ref.source_url));
  };

  const rows = evaluation.items.map((it, i) => {
    const o = evaluation.observations[i];
    const ref = it.reference_record;
    const f = finals.get(k(it));
    let disposition; let reason = null;
    if (inadmissible.has(it.candidate_id)) { disposition = 'INVALID'; reason = 'IDENTITY_INADMISSIBLE_AFTER_DRAW'; }
    else if (o.machine_state === 'INVALID') { disposition = 'INVALID'; reason = o.invalid_reason; }
    else if (ref.resolution === 'REFERENCE_CONFLICT') disposition = 'REFERENCE-CONFLICT';
    else if (['employee_count', 'revenue_range'].includes(it.field) && (D['AD-6'] === 'ALL_REFERENCE_RECORDS' || ref.value_kind === 'STATED') && ref.as_of_date < cutoff) { disposition = 'REFERENCE-STALE'; reason = `reference as_of_date ${ref.as_of_date} before ${cutoff}`; }
    else if (f.final === null) disposition = 'PENDING';
    else if (f.final.label === 'REFERENCE-AMBIGUOUS') disposition = 'REFERENCE-AMBIGUOUS';
    else disposition = 'VALID';
    const valid = disposition === 'VALID';
    return {
      candidate_id: it.candidate_id, field: it.field, disposition, reason, machine_state: o.machine_state,
      label: valid ? f.final.label : null, sub_reason: valid ? f.final.sub_reason : null, adjudicated: f.final ? f.final.adjudicated : false,
      rater_1_label: f.r1.label, rater_2_label: f.r2.label, cpg_filled: it.cpg_value !== null,
      independence: valid ? (coincident(ref, it.cpg_source_urls) ? 'SOURCE-COINCIDENT' : 'INDEPENDENT') : null,
      contamination_disclosed: (heldOut.get(it.candidate_id)?.held_out_ineligible_basis ?? []).length > 0,
      _o: o,
    };
  });
  const total = rows.length;
  const valid = rows.filter((r) => r.disposition === 'VALID');
  const n = (label) => valid.filter((r) => r.label === label).length;
  const S = n('SUPPORTED-FILL'); const U = n('UNSUPPORTED-FILL'); const I = n('INCORRECT-FILL'); const M = n('MISATTRIBUTED-FILL');
  const CA = n('CORRECT-ABSTENTION'); const MF = n('MISSED-FILL');
  const fills = S + U + I + M; const bad = U + I + M;

  // Endpoints (§10.3), exact integer comparisons.
  const G1 = { fills, threshold: 20, holds: fills >= 20 };
  const P1 = { ...frac(bad, fills), threshold: 0.05, met: fills > 0 && 20 * bad <= fills };
  const arDefined = CA + U > 0;
  const P2 = { ...frac(CA, CA + U), threshold: 0.9, met: arDefined ? 10 * CA >= 9 * (CA + U) : false, undefined_rule: arDefined ? null : `AD-8 = ${D['AD-8']}` };
  const P3 = { misattributed: M, threshold: 0, met: M === 0 };
  const R1 = { ...frac(S, S + MF + I), threshold: null };

  // Krippendorff's α over the raters' own labels (before adjudication).
  const alphaPop = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending'
    && (D['AD-1'] === 'ALL_COMPLETELY_RATED_ITEMS' || !['INVALID', 'REFERENCE-CONFLICT', 'REFERENCE-STALE'].includes(r.disposition)));
  const alpha = { population: D['AD-1'], ...alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label])), threshold: 0.667 };
  const coincidence = Object.fromEntries(RATING_LABELS.map((a) => [a, Object.fromEntries(RATING_LABELS.map((b) => [b, alphaPop.filter((r) => r.rater_1_label === a && r.rater_2_label === b).length]))]));
  const completelyRated = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending').length;

  // §15.5 conditions.
  const companies = [...heldOut.keys()].sort();
  const firstObs = new Map(); for (const r of rows) if (!firstObs.has(r.candidate_id)) firstObs.set(r.candidate_id, r._o);
  const registryDown = companies.filter((id) => {
    const o = firstObs.get(id);
    if (o.machine_state !== 'SCORABLE') return false;
    if (D['AD-4'] === 'ANY_REGISTRY_UNAVAILABLE_ENTRY') return o.registry_unavailable.length > 0;
    return o.registry_unavailable.some((x) => x.identifier === heldOut.get(id).identifier_value);
  });
  const sc = valid.filter((r) => r.independence === 'SOURCE-COINCIDENT').length;
  const alphaUndefined = !alpha.defined;
  const cond = {
    '1_G1_fills_below_20': { triggered: !G1.holds, detail: `${fills} fills` },
    '2_valid_below_90pct': { triggered: 10 * valid.length < 9 * total, detail: `${valid.length} of ${total} observations VALID` },
    '3_rating': { triggered: (alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha)) || sheet1.rated_by === sheet2.rated_by || 10 * completelyRated < 9 * total,
      detail: `α ${alpha.value === null ? `undefined (AD-2 = ${D['AD-2']})` : alpha.value}; 2 raters; ${completelyRated} of ${total} completely rated` },
    '4_registry_unavailable_above_10pct': { triggered: 10 * registryDown.length > companies.length, detail: `${registryDown.length} of ${companies.length} companies (AD-4 = ${D['AD-4']})` },
    '5_source_coincident_above_60pct': { triggered: valid.length > 0 && 10 * sc > 6 * valid.length, detail: `${sc} of ${valid.length} scored observations (AD-3 = ${D['AD-3']})` },
    '6_seal_publication': { triggered: sealPublication?.seal_hash !== evaluation.seal_hash || sealPublication?.record_id !== authorization.seal_publication.record_id || sealPublication?.registry_timestamp !== authorization.seal_publication.registry_timestamp,
      detail: 'published seal record must name the seal used and be the one the authorisation opened the window on' },
    '7_protocol_violation': { triggered: declarations.protocol_violations.length > 0, detail: `${declarations.protocol_violations.length} declared (AD-7 = ${D['AD-7']})` },
  };
  const p2Inconclusive = !arDefined && D['AD-8'] === 'INCONCLUSIVE';
  const inconclusive = Object.entries(cond).filter(([, c]) => c.triggered).map(([id]) => id);
  if (p2Inconclusive) inconclusive.push('P2_undefined (AD-8 = INCONCLUSIVE)');
  let outcome;
  if (inconclusive.length) outcome = 'INCONCLUSIVE';
  else if (M > 0 || 10 * bad > fills) outcome = 'FALSIFIED';
  else if (!P1.met || !P2.met || !P3.met) outcome = 'FAILURE';
  else outcome = 'SUCCESS';

  // §10.4 diagnostics (never an acceptance basis) and the §10.3 abstention split.
  const abst = valid.filter((r) => ['CORRECT-ABSTENTION', 'MISSED-FILL'].includes(r.label));
  const unavailable = (o) => (D['AD-9'] === 'ANY_UNAVAILABLE_ENTRY' ? o.registry_unavailable.length + o.unavailable_sources.length > 0 : o.registry_unavailable.length > 0);
  const byField = Object.fromEntries(FIELDS.map((fld) => [fld, Object.fromEntries(RATING_LABELS.filter((l) => l !== 'REFERENCE-AMBIGUOUS').map((l) => [l, valid.filter((r) => r.field === fld && r.label === l).length]))]));
  const subReasons = Object.fromEntries(['CURRENCY_NOT_STATED', 'STALE_VALUE', 'SUB_REASON_DISAGREED'].map((s) => [s, valid.filter((r) => r.sub_reason === s).length]));
  const validFills = valid.filter((r) => FILL.includes(r.label));
  const fillsPerCompany = companies.map((id) => validFills.filter((r) => r.candidate_id === id).length);
  const lat = companies.map((id) => firstObs.get(id).latency_ms).filter((x) => x !== null).sort((a, b) => a - b);
  const secondary = {
    S1: { computed: false, reason: 'company-level identity correctness needs a registry-identity comparison rule not implemented by this tooling' },
    S2: { ...frac(CA, CA + MF), label: 'CORRECT-ABSTENTION ÷ all abstentions' },
    S3: { per_field_per_label: byField, sub_reasons: subReasons },
    S4: { ...frac(validFills.filter((r) => r._o.cited_url_count > 0).length, validFills.length), label: 'fills with ≥ 1 cited URL under §12.3 Rule A (resolvability not tested)' },
    S5: { computed: false, reason: '"independent evidence items" is not defined by the protocol' },
    S6: { conflicting_evidence_state: rows.filter((r) => r._o.evidence_state === 'CONFLICTING').length, companies_with_registry_ambiguity: companies.filter((id) => firstObs.get(id).registry_ambiguity_count > 0).length, limitation: 'user-vs-public conflict unreachable while userClaims is empty' },
    S7: { fills_per_company_histogram: [0, 1, 2, 3].map((x) => fillsPerCompany.filter((y) => y === x).length) },
    S8: { companies_timed: lat.length, min_ms: lat[0] ?? null, median_ms: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null, max_ms: lat.at(-1) ?? null, over_45s: lat.filter((x) => x > 45000).length, over_60s: lat.filter((x) => x > 60000).length },
  };
  const dispositions = Object.fromEntries(['VALID', 'INVALID', 'REFERENCE-CONFLICT', 'REFERENCE-STALE', 'REFERENCE-AMBIGUOUS', 'PENDING'].map((d) => [d, rows.filter((r) => r.disposition === d).length]));
  return seal({
    ...base, execution_audit: audit.state, as_of: asOf, staleness_cutoff: cutoff, outcome, outcome_basis: inconclusive,
    endpoints: { G1, P1, P2, P3, R1, falsification: { misattributed: M, efr_above_2x_theta: fills > 0 && 10 * bad > fills } },
    labels: { 'SUPPORTED-FILL': S, 'UNSUPPORTED-FILL': U, 'INCORRECT-FILL': I, 'MISATTRIBUTED-FILL': M, 'CORRECT-ABSTENTION': CA, 'MISSED-FILL': MF },
    alpha, rater_label_coincidence: coincidence, completely_rated: completelyRated, observations_total: total,
    conditions: cond, dispositions,
    source_coincident: { count: sc, of_scored: valid.length },
    abstention_split: { source_unavailable: abst.filter((r) => unavailable(r._o)).length, other: abst.filter((r) => !unavailable(r._o)).length, basis: `AD-9 = ${D['AD-9']}` },
    zero_fill_companies: companies.filter((id) => rows.filter((r) => r.candidate_id === id).every((r) => r.machine_state === 'SCORABLE' && !r.cpg_filled)).length,
    registry_unavailable_companies: registryDown,
    secondary,
    exclusion_table: rows.filter((r) => r.disposition !== 'VALID').map((r) => ({ candidate_id: r.candidate_id, field: r.field, disposition: r.disposition, reason: r.reason })),
    observations: rows.map(({ _o, ...r }) => r),
  });
}
