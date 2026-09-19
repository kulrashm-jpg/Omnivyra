// Blind double-entry reconciliation of reference truth (candidate-002 §9.4-§9.6).
// The AUTHOR and the CONFIRMER each record every (company, field) independently.
// Agreement → AGREED. Disagreement → only an independent ADJUDICATOR may resolve it.
// An adjudication may not override an agreed record.
import {
  ADJUDICATION_DECISIONS, FIELDS, agreementKey, checkBlindRecord, isCalendarDate,
} from './schema.mjs';

const key = (r) => `${r.candidate_id}|${r.field}`;

function index(rows, role, drawn, errors) {
  const m = new Map();
  rows.forEach((r, i) => {
    const k = key(r);
    const where = `${role} row ${i + 2} (${k})`;
    if (!drawn.has(r.candidate_id)) errors.push(`${where}: candidate_id is not in a drawn manifest`);
    if (m.has(k)) errors.push(`${where}: duplicate record`);
    for (const e of checkBlindRecord(r)) errors.push(`${where}: ${e}`);
    m.set(k, r);
  });
  return m;
}

/**
 * @param drawnEntries manifest entries [{candidate_id, stratum}] for BOTH stages
 * @returns {{ errors: string[], rows: object[], stratumMismatches: object[] }}
 */
export function reconcile(drawnEntries, authorRows, confirmerRows, adjudicationRows = []) {
  const errors = [];
  const drawn = new Map(drawnEntries.map((e) => [e.candidate_id, e]));
  const A = index(authorRows, 'author', drawn, errors);
  const C = index(confirmerRows, 'confirmer', drawn, errors);
  const J = new Map();
  adjudicationRows.forEach((r, i) => {
    const k = key(r);
    const where = `adjudication row ${i + 2} (${k})`;
    if (J.has(k)) errors.push(`${where}: duplicate adjudication`);
    if (!ADJUDICATION_DECISIONS.includes(r.decision)) errors.push(`${where}: decision must be one of ${ADJUDICATION_DECISIONS.join('|')}`);
    if (!r.rationale || !r.rationale.trim()) errors.push(`${where}: rationale is required`);
    if (!r.adjudicated_by || !r.adjudicated_by.trim()) errors.push(`${where}: adjudicated_by is required`);
    if (!isCalendarDate(r.adjudicated_at || '')) errors.push(`${where}: adjudicated_at must be YYYY-MM-DD`);
    J.set(k, r);
  });

  const rows = [];
  for (const [id] of drawn) {
    for (const field of FIELDS) {
      const k = `${id}|${field}`;
      const a = A.get(k); const c = C.get(k); const j = J.get(k);
      if (!a) { errors.push(`${k}: missing author record`); continue; }
      if (!c) { errors.push(`${k}: missing confirmer record`); continue; }
      if (a.recorded_by.trim() === c.recorded_by.trim()) { errors.push(`${k}: author and confirmer must be different people (§9.4)`); continue; }
      const agreed = agreementKey(a) === agreementKey(c);
      let src = a; let resolution = 'AGREED'; let adjudicatedBy = ''; let conflict = false;
      if (agreed) {
        if (j) { errors.push(`${k}: adjudication supplied for an AGREED record — an adjudicator may not override agreement`); continue; }
      } else {
        if (!j) { errors.push(`${k}: author and confirmer disagree (${agreementKey(a)} vs ${agreementKey(c)}) — independent adjudication required`); continue; }
        if ([a.recorded_by.trim(), c.recorded_by.trim()].includes(j.adjudicated_by.trim())) {
          errors.push(`${k}: adjudicator must differ from both author and confirmer`); continue;
        }
        adjudicatedBy = j.adjudicated_by.trim();
        if (j.decision === 'AUTHOR') resolution = 'ADJUDICATED_AUTHOR';
        else if (j.decision === 'CONFIRMER') { src = c; resolution = 'ADJUDICATED_CONFIRMER'; }
        else { resolution = 'REFERENCE_CONFLICT'; conflict = true; }
      }
      rows.push({
        candidate_id: id, field, value_kind: src.value_kind, expected_value: src.expected_value,
        authoritative_source_name: src.authoritative_source_name, source_class: src.source_class, source_url: src.source_url,
        publication_date: src.publication_date, as_of_date: src.as_of_date, search_note: src.search_note,
        ambiguity_flag: conflict ? 'REFERENCE-CONFLICT' : 'none', independence_class: 'PENDING_RUN',
        author: a.recorded_by.trim(), confirmer: c.recorded_by.trim(), resolution, adjudicated_by: adjudicatedBy,
      });
    }
  }
  for (const k of J.keys()) {
    const [id, field] = k.split('|');
    if (!drawn.has(id) || !FIELDS.includes(field)) errors.push(`adjudication for ${k}: not a drawn company/field`);
  }

  // The stratum is the enumerator's PREDICTION for sampling balance; reference truth, not the
  // stratum, determines every label. Mismatches are recorded and reported, never "fixed".
  const stratumMismatches = [];
  for (const [id, e] of drawn) {
    const stated = rows.filter((r) => r.candidate_id === id && r.value_kind === 'STATED' && r.ambiguity_flag === 'none').length;
    if (e.stratum === 'fill-expected' && stated === 0) stratumMismatches.push({ candidate_id: id, stratum: e.stratum, stated_values: stated });
    if (e.stratum === 'abstention-expected' && stated > 0) stratumMismatches.push({ candidate_id: id, stratum: e.stratum, stated_values: stated });
  }
  return { errors, rows, stratumMismatches };
}
