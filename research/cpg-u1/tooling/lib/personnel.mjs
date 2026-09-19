// Personnel register checks (CPG_U1_PROTOCOL_004 §4A). The register itself is restricted; the tooling checks its
// STRUCTURE: every independent role filled, seven roles mutually exclusive, the operator in none, every §4A.1
// declaration answered "no", and the §4A.1 evidence fingerprints present. It cannot verify that declarations are true.

export const PERSONNEL_SCHEMA = 'cpg-u1-personnel/v1';
export const INDEPENDENT_ROLES = Object.freeze(['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator']);
/** §4A.1 items 1–4 and 6, and §4A.2 (a)/(b) for enumerators and all roles alike. Every answer must be "no". */
export const DECLARATION_KEYS = Object.freeze([
  'employed_by_developing_organisation', 'contract_or_work_for_developing_organisation', 'payment_other_than_study_fee',
  'financial_interest_in_developing_organisation', 'close_relationship_with_developer_operator_or_role_holder',
  'implemented_cpg_protocol_tooling_or_registry', 'ran_or_saw_cpg_output',
]);
const HEX64 = /^[0-9a-f]{64}$/;
const PERSON = /^[A-Za-z0-9_-]{1,64}$/;

export function checkPersonnelRegister(reg) {
  const errors = []; const blockers = [];
  if (!reg || reg.schema !== PERSONNEL_SCHEMA) return { errors: [`schema must be ${PERSONNEL_SCHEMA}`], blockers };
  if (!PERSON.test(reg.operator?.person_id ?? '')) errors.push('operator.person_id missing or malformed');
  const assignments = Array.isArray(reg.assignments) ? reg.assignments : [];
  if (!Array.isArray(reg.assignments)) errors.push('assignments must be an array');

  for (const role of INDEPENDENT_ROLES) {
    const n = assignments.filter((a) => a.role === role).length;
    if (n === 0) blockers.push(`role ${role} is UNFILLED`);
    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
  }
  const holder = new Map();
  for (const [i, a] of assignments.entries()) {
    const where = `assignment ${i} (${a.role})`;
    if (!INDEPENDENT_ROLES.includes(a.role)) { errors.push(`${where}: unknown role`); continue; }
    if (!PERSON.test(a.person_id ?? '')) { errors.push(`${where}: person_id missing or malformed`); continue; }
    if (a.person_id === reg.operator?.person_id) errors.push(`${where}: ROLE COLLISION — the operator may hold no independent role`);
    if (holder.has(a.person_id)) errors.push(`${where}: ROLE COLLISION — ${a.person_id} already holds ${holder.get(a.person_id)}; all independent roles are mutually exclusive`);
    else holder.set(a.person_id, a.role);
    const d = a.declaration ?? {};
    for (const k of DECLARATION_KEYS) if (d[k] !== 'no') errors.push(`${where}: declaration ${k} must be "no" (got ${JSON.stringify(d[k])}) — not independent`);
    if (a.study_fee_agreement_sha256 !== null && !HEX64.test(a.study_fee_agreement_sha256 ?? '')) errors.push(`${where}: study_fee_agreement_sha256 must be 64 hex or null (no fee)`);
    if (!HEX64.test(a.organisation_confirmation_sha256 ?? '')) errors.push(`${where}: organisation_confirmation_sha256 (developing organisation's no-relationship confirmation) required`);
  }
  return { errors, blockers };
}
