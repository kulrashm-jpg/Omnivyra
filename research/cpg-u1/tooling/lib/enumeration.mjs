// Enumeration attribution binding (CPG_U1_PROTOCOL_004 §4A.2, §4A.3, §5.1, §20.18). Frame independence rests on
// enumerator independence ALONE (§20.18 / limitation 18): cryptographic sampling integrity says nothing about who chose
// the rows. Every enumerated row therefore names the person who enumerated it, and that person must be someone the
// restricted personnel register holds as an eligible enumerator.
//
// Exactly like the rater assignment (lib/assignment.mjs) this is a STRUCTURAL check against the register: the tooling
// cannot verify that a §4A.1 declaration is true, and it adds no rule of its own. It changes no sampling, admissibility
// or frame-construction semantics — `enumerated_by` is already a §5 frame column, and the frame's deterministic identity
// (frame_hash = hashRecords(frame, 'candidate_id')) therefore already binds it.
import { checkPersonnelRegister } from './personnel.mjs';

export const ENUMERATOR_ROLE = 'enumerator';

/** The people the register holds as eligible enumerators (§4A.3: several are permitted; each holds no other role). */
export const registeredEnumerators = (personnel) => (Array.isArray(personnel?.assignments) ? personnel.assignments : [])
  .filter((a) => a?.role === ENUMERATOR_ROLE)
  .map((a) => a.person_id);

/**
 * Structural check of enumeration attribution over frame rows. With a personnel register (supplied exactly as
 * `checkRaterAssignment` takes one), every row's `enumerated_by` must name a person that register holds as an eligible
 * enumerator, and the register's enumerator slots must be distinct people.
 * @param rows frame records (only `candidate_id` and `enumerated_by` are read; no other column is interpreted)
 * @returns string[] errors — empty means accepted
 */
export function checkEnumerationAttribution(rows, { personnel } = {}) {
  const errors = [];
  const attributed = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: typeof r?.enumerated_by === 'string' ? r.enumerated_by.trim() : '',
    where: r?.candidate_id ? String(r.candidate_id) : '(row without candidate_id)',
  }));
  for (const a of attributed) if (!a.id) errors.push(`${a.where}: enumerated_by is missing — every enumerated row names the enumerator who produced it (§4A.2)`);
  if (personnel !== undefined) {
    const reg = checkPersonnelRegister(personnel);
    errors.push(...reg.errors.map((e) => `personnel register: ${e}`));
    const enumerators = registeredEnumerators(personnel);
    // §4A: every role is appointed BEFORE ITS OWN stage, and enumeration is the first one. An unfilled DOWNSTREAM role
    // (rater, adjudicator) is therefore not a prerequisite of attributing the frame — `check-personnel` and
    // `rater-assignment-fingerprint` refuse those before their stages — so reg.blockers are not propagated here; only
    // the enumerator slot must be filled for an enumerated frame to be attributable at all.
    if (!enumerators.length) errors.push('personnel register: role enumerator is UNFILLED — nobody in the register can have enumerated this frame (§4A.3)');
    if (new Set(enumerators).size !== enumerators.length) errors.push('ROLE COLLISION: one person occupies both enumerator slots — Enumerator A and Enumerator B must be different registered people (§4A.3)');
    const eligible = new Set(enumerators);
    for (const a of attributed) {
      if (a.id && !eligible.has(a.id)) errors.push(`${a.where}: enumerated_by ${a.id} is not an eligible enumerator in the personnel register (§4A.2); the register holds ${enumerators.join(',') || 'nobody'}`);
    }
  }
  return errors;
}
