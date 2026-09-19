// Blinded adjudication packets (CPG_U1_PROTOCOL_004 §9.2.1, §12.2). Packets are BUILT deterministically from sealed
// inputs and VERIFIED by rebuilding: any added key, extra item, agreeing record, identity or wrong position is refused.
// This checks the packet artifact; what a person otherwise learns is controlled procedurally (§4A).
import { canonicalJson } from './canonical.mjs';
import { BLIND_RECORD_COLUMNS, REFERENCE_COLUMNS, agreementKey } from './schema.mjs';
import { authorIsRecord1, presentationOrder, rater1IsLabelA } from './raterOrder.mjs';

export const RATING_LABELS = Object.freeze(['SUPPORTED-FILL', 'UNSUPPORTED-FILL', 'INCORRECT-FILL', 'MISATTRIBUTED-FILL', 'CORRECT-ABSTENTION', 'MISSED-FILL', 'REFERENCE-AMBIGUOUS']);

export const REFERENCE_ITEM_KEYS = Object.freeze(['candidate_id', 'field', 'company_name', 'canonical_domain', 'jurisdiction_family', 'identifier_scheme', 'identifier_value', 'record_1', 'record_2']);
/** Blind-record content only: no candidate/field duplication, no recorder identity, no timestamps. */
export const RECORD_KEYS = Object.freeze(BLIND_RECORD_COLUMNS.filter((c) => !['candidate_id', 'field', 'recorded_by', 'recorded_at', 'constructed_without_cpg'].includes(c)));
export const EVALUATION_ITEM_KEYS = Object.freeze(['candidate_id', 'field', 'cpg_value', 'cpg_source_urls', 'reference_record']);
export const RATING_ITEM_KEYS = Object.freeze([...EVALUATION_ITEM_KEYS, 'label_a', 'label_b']);

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));

// ── reference adjudication ──────────────────────────────────────────────────
export function buildReferenceAdjudicationPacket({ entries, author, confirmer, recordSha }) {
  const byEntry = new Map(entries.map((e) => [e.candidate_id, e]));
  const idx = (rows) => new Map(rows.map((r) => [`${r.candidate_id}|${r.field}`, r]));
  const A = idx(author); const C = idx(confirmer);
  const disagreements = [];
  for (const [k, a] of A) {
    const c = C.get(k);
    if (!c) throw new Error(`missing confirmer record ${k}`);
    if (agreementKey(a) === agreementKey(c)) continue; // agreeing records are never released
    const e = byEntry.get(a.candidate_id);
    if (!e) throw new Error(`record for undrawn company ${a.candidate_id}`);
    const authorFirst = authorIsRecord1(recordSha, a.candidate_id, a.field);
    disagreements.push({
      candidate_id: a.candidate_id, field: a.field, company_name: e.company_name, canonical_domain: e.canonical_domain,
      jurisdiction_family: e.jurisdiction_family, identifier_scheme: e.identifier_scheme, identifier_value: e.identifier_value,
      record_1: pick(authorFirst ? a : c, RECORD_KEYS), record_2: pick(authorFirst ? c : a, RECORD_KEYS),
    });
  }
  const items = presentationOrder(recordSha, 'reference-adjudicator', disagreements).map(({ order_key, ...rest }) => rest);
  return { schema: 'cpg-u1-reference-adjudication-packet/v1', items };
}

export function checkReferenceAdjudicationPacket(packet, inputs) {
  const errors = [];
  if (!exactKeys(packet, ['schema', 'items']) || packet.schema !== 'cpg-u1-reference-adjudication-packet/v1' || !Array.isArray(packet.items)) {
    return ['reference adjudication packet must be exactly {schema, items}'];
  }
  packet.items.forEach((it, i) => {
    if (!exactKeys(it, REFERENCE_ITEM_KEYS)) errors.push(`item ${i}: keys must be exactly ${REFERENCE_ITEM_KEYS.join(',')} (forbidden information present or field missing)`);
    else if (!exactKeys(it.record_1, RECORD_KEYS) || !exactKeys(it.record_2, RECORD_KEYS)) errors.push(`item ${i}: records must carry exactly ${RECORD_KEYS.join(',')} (no recorder identity)`);
  });
  if (errors.length) return errors;
  const expected = buildReferenceAdjudicationPacket(inputs);
  if (canonicalJson(packet) !== canonicalJson(expected)) errors.push('packet differs from the deterministic build (extra or missing items, agreeing records, order or Record 1/2 assignment)');
  return errors;
}

/** RECORD_1 / RECORD_2 decisions → AUTHOR / CONFIRMER, recomputed from the held-out record (no mapping file to trust). */
export function resolveReferenceDecisions(rows, recordSha) {
  return rows.map((r) => {
    if (r.decision === 'REFERENCE-CONFLICT') return { ...r };
    if (!['RECORD_1', 'RECORD_2'].includes(r.decision)) throw new Error(`${r.candidate_id}|${r.field}: blind decision must be RECORD_1|RECORD_2|REFERENCE-CONFLICT`);
    const authorFirst = authorIsRecord1(recordSha, r.candidate_id, r.field);
    const chooseAuthor = (r.decision === 'RECORD_1') === authorFirst;
    return { ...r, decision: chooseAuthor ? 'AUTHOR' : 'CONFIRMER' };
  });
}

// ── rating adjudication ─────────────────────────────────────────────────────
export function buildRatingAdjudicationPacket({ evaluationItems, rater1, rater2, recordSha }) {
  const idx = (rows) => new Map(rows.map((r) => [`${r.candidate_id}|${r.field}`, r.label]));
  const R1 = idx(rater1); const R2 = idx(rater2);
  const items = [];
  for (const ev of evaluationItems) {
    if (!exactKeys(ev, EVALUATION_ITEM_KEYS) || !exactKeys(ev.reference_record, REFERENCE_COLUMNS)) throw new Error(`evaluation item ${ev.candidate_id}|${ev.field} is not exactly the §12 rater packet`);
    const k = `${ev.candidate_id}|${ev.field}`;
    const l1 = R1.get(k); const l2 = R2.get(k);
    if (!RATING_LABELS.includes(l1) || !RATING_LABELS.includes(l2)) throw new Error(`${k}: both raters must supply a valid label`);
    if (l1 === l2) continue; // agreement is never adjudicated
    const aFirst = rater1IsLabelA(recordSha, ev.candidate_id, ev.field);
    items.push({ ...pick(ev, EVALUATION_ITEM_KEYS), label_a: aFirst ? l1 : l2, label_b: aFirst ? l2 : l1 });
  }
  return { schema: 'cpg-u1-rating-adjudication-packet/v1', items: presentationOrder(recordSha, 'rating-adjudicator', items).map(({ order_key, ...rest }) => rest) };
}

export function checkRatingAdjudicationPacket(packet, inputs) {
  const errors = [];
  if (!exactKeys(packet, ['schema', 'items']) || packet.schema !== 'cpg-u1-rating-adjudication-packet/v1' || !Array.isArray(packet.items)) {
    return ['rating adjudication packet must be exactly {schema, items}'];
  }
  packet.items.forEach((it, i) => {
    if (!exactKeys(it, RATING_ITEM_KEYS)) errors.push(`item ${i}: keys must be exactly ${RATING_ITEM_KEYS.join(',')} (forbidden information present or field missing)`);
  });
  if (errors.length) return errors;
  const expected = buildRatingAdjudicationPacket(inputs);
  if (canonicalJson(packet) !== canonicalJson(expected)) errors.push('packet differs from the deterministic build (extra or missing items, agreeing labels, order or Label A/B assignment)');
  return errors;
}

/** LABEL_A / LABEL_B / REFERENCE-AMBIGUOUS decisions → the chosen label, recomputed from the held-out record. */
export function resolveRatingDecisions(rows, packet) {
  const byKey = new Map(packet.items.map((it) => [`${it.candidate_id}|${it.field}`, it]));
  return rows.map((r) => {
    const it = byKey.get(`${r.candidate_id}|${r.field}`);
    if (!it) throw new Error(`${r.candidate_id}|${r.field}: not a disagreeing item`);
    if (r.decision === 'REFERENCE-AMBIGUOUS') return { ...r, label: 'REFERENCE-AMBIGUOUS' };
    if (r.decision === 'LABEL_A') return { ...r, label: it.label_a };
    if (r.decision === 'LABEL_B') return { ...r, label: it.label_b };
    throw new Error(`${r.candidate_id}|${r.field}: decision must be LABEL_A|LABEL_B|REFERENCE-AMBIGUOUS`);
  });
}
