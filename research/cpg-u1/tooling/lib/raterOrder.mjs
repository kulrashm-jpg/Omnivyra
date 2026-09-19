// Presentation order and blind-label assignment (CPG_U1_PROTOCOL_004 §12.1). No seed exists: every value derives from the
// held-out sampling record — itself derived from the Bitcoin + drand randomness — under a dedicated domain, so it
// can neither influence nor be influenced by the draw, and anyone can recompute it from published artifacts.
import { canonicalJson, sha256 } from './canonical.mjs';
import { FIELDS } from './schema.mjs';

export const RATER_ORDER_DOMAIN = 'cpg-u1-rater-order/v1';
/** Labels whose value orders a presentation sequence. */
export const ORDER_LABELS = Object.freeze(['rater-1', 'rater-2', 'rating-adjudicator', 'reference-adjudicator']);
/** Labels whose value assigns blind positions (kept distinct from ordering labels so order and position are unrelated). */
export const ASSIGNMENT_LABELS = Object.freeze(['reference-adjudicator-record-1', 'rating-adjudicator-label-a']);

const HEX64 = /^[0-9a-f]{64}$/;
const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** record_sha256 = sha256(canonicalJson(record without record_sha256)) — recomputed, never trusted. */
export function recomputeRecordSha(record) {
  if (!record || typeof record !== 'object') throw new Error('sampling record missing');
  const { record_sha256: claimed, ...rest } = record;
  const recomputed = sha256(canonicalJson(rest));
  if (claimed !== recomputed) throw new Error('sampling record_sha256 does not recompute from the record');
  return recomputed;
}

export function orderKey(recordSha, label, candidateId, field) {
  if (!HEX64.test(recordSha ?? '')) throw new Error('record_sha256 must be 64 lowercase hex characters');
  if (![...ORDER_LABELS, ...ASSIGNMENT_LABELS].includes(label)) throw new Error(`unknown order label "${label}"`);
  if (!CANDIDATE_ID.test(candidateId ?? '')) throw new Error('candidate_id must be 1-64 of [A-Za-z0-9_-]');
  if (!FIELDS.includes(field)) throw new Error(`field must be one of ${FIELDS.join('|')}`);
  return sha256(`${RATER_ORDER_DOMAIN}|${recordSha}|${label}|${candidateId}|${field}`);
}

/** Ascending order_key; ties (a SHA-256 collision) broken by "candidate_id|field". Duplicate items are refused. */
export function presentationOrder(recordSha, label, items) {
  if (!ORDER_LABELS.includes(label)) throw new Error(`"${label}" is not an ordering label`);
  const seen = new Set();
  const keyed = items.map((it) => {
    const id = `${it.candidate_id}|${it.field}`;
    if (seen.has(id)) throw new Error(`duplicate item ${id}`);
    seen.add(id);
    return { it, k: orderKey(recordSha, label, it.candidate_id, it.field), id };
  });
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return keyed.map((x) => ({ ...x.it, order_key: x.k }));
}

const evenFirstNibble = (hex) => parseInt(hex[0], 16) % 2 === 0;
/** Record 1 is the Author's record iff the first hex digit of the assignment key is even. */
export const authorIsRecord1 = (recordSha, candidateId, field) => evenFirstNibble(orderKey(recordSha, 'reference-adjudicator-record-1', candidateId, field));
/** Label A is rater-1's label iff the first hex digit of the assignment key is even. */
export const rater1IsLabelA = (recordSha, candidateId, field) => evenFirstNibble(orderKey(recordSha, 'rating-adjudicator-label-a', candidateId, field));

/** Archive representation of an order: canonical, hashable, recomputable. */
export function orderArtifact(recordSha, label, items) {
  const ordered = presentationOrder(recordSha, label, items).map((x) => ({ candidate_id: x.candidate_id, field: x.field, order_key: x.order_key }));
  const body = { schema: 'cpg-u1-rater-order/v1', domain: RATER_ORDER_DOMAIN, held_out_record_sha256: recordSha, label, items: ordered };
  return { ...body, order_sha256: sha256(canonicalJson(body)) };
}
