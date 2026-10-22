// Person-to-label assignment and its fingerprint (CPG_U1_PROTOCOL_004 §4A.3, §12.1, §13.2). The assignment of individuals
// to `rater-1`, `rater-2` and `rating-adjudicator` is fixed and its SHA-256 fingerprint published BEFORE the held-out
// commitment is broadcast, so no one can choose which person rates in which order after the order becomes knowable.
//
// The artifact names pseudonymous person ids from the personnel register and a 256-bit nonce, so the published
// fingerprint cannot be confirmed by guessing a small set of ids. The tooling cannot check WHEN the fingerprint was
// published — that is the publication record's timestamp (procedural) — only that the artifact matches it.
import { canonicalJson, sha256 } from './canonical.mjs';
import { STUDY_ID } from './commitment.mjs';
import { checkPersonnelRegister } from './personnel.mjs';

export const ASSIGNMENT_SCHEMA = 'cpg-u1-rater-assignment/v1';
export const ASSIGNED_LABELS = Object.freeze(['rater-1', 'rater-2', 'rating-adjudicator']);
const HEX64 = /^[0-9a-f]{64}$/;
const PERSON = /^[A-Za-z0-9_-]{1,64}$/;
const KEYS = ['schema', 'study_id', 'registration_id', 'assignments', 'nonce'];

/** Structural check; with a personnel register, each label's person must hold exactly that role there. */
export function checkRaterAssignment(a, { personnel } = {}) {
  const errors = [];
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['assignment must be an object'];
  if (Object.keys(a).length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(a, k))) return [`assignment keys must be exactly ${KEYS.join(',')}`];
  if (a.schema !== ASSIGNMENT_SCHEMA) errors.push(`schema must be ${ASSIGNMENT_SCHEMA}`);
  if (a.study_id !== STUDY_ID) errors.push(`study_id must be ${STUDY_ID}`);
  if (typeof a.registration_id !== 'string' || !a.registration_id.trim()) errors.push('registration_id required');
  if (!HEX64.test(a.nonce ?? '')) errors.push('nonce must be 64 lowercase hex characters (256 bits)');
  const m = a.assignments;
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length !== ASSIGNED_LABELS.length || !ASSIGNED_LABELS.every((l) => Object.hasOwn(m, l))) {
    errors.push(`assignments must map exactly ${ASSIGNED_LABELS.join(',')}`);
    return errors;
  }
  for (const l of ASSIGNED_LABELS) if (!PERSON.test(m[l] ?? '')) errors.push(`${l}: person id missing or malformed`);
  if (new Set(ASSIGNED_LABELS.map((l) => m[l])).size !== ASSIGNED_LABELS.length) errors.push('ROLE COLLISION: rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)');
  if (personnel !== undefined) {
    const reg = checkPersonnelRegister(personnel);
    errors.push(...reg.errors.map((e) => `personnel register: ${e}`), ...reg.blockers.map((b) => `personnel register: ${b}`));
    for (const l of ASSIGNED_LABELS) {
      const holders = (personnel?.assignments ?? []).filter((x) => x.role === l).map((x) => x.person_id);
      if (holders.length !== 1 || holders[0] !== m[l]) errors.push(`${l}: the personnel register assigns this role to ${holders.join(',') || 'nobody'}, not ${m[l]}`);
    }
  }
  return errors;
}

/** fingerprint = sha256(canonicalJson(assignment)). */
export const assignmentFingerprint = (a) => sha256(canonicalJson(a));

/** The person who must have produced the work of `label`; throws unless the assignment matches the published fingerprint. */
export function assignedPerson(a, publishedFingerprint, label) {
  const errors = checkRaterAssignment(a);
  if (errors.length) throw new Error(`RATER_ASSIGNMENT_REFUSED: ${errors.join('; ')}`);
  if (!HEX64.test(publishedFingerprint ?? '') || assignmentFingerprint(a) !== publishedFingerprint) throw new Error('RATER_ASSIGNMENT_REFUSED: the assignment does not hash to the published fingerprint');
  if (!ASSIGNED_LABELS.includes(label)) throw new Error(`RATER_ASSIGNMENT_REFUSED: no assignment for label ${label}`);
  return a.assignments[label];
}
