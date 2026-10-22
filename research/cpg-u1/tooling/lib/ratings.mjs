// Rater label ingestion and rating adjudication (CPG_U1_PROTOCOL_004 §10.1, §10.2, §12, §12.2, §13.2).
//
// ingest (B2): a rater's labels arrive as a CSV with one row per item of THAT rater's packet. The tooling refuses a sheet
// with a missing, extra, unknown or duplicated item, an unknown label, a sub-reason outside §10.2, or a row not rated by
// the person the published assignment fingerprint names for that label. Output is a canonical per-rater sheet bound to
// the packet, the evaluation artifact, the seal and the assignment fingerprint, in packet order.
//
// adjudication (B3): only items both raters labelled (not `pending`) and labelled differently enter the rating-adjudicator
// packet (lib/packets.mjs). Decisions are LABEL_A | LABEL_B | REFERENCE-AMBIGUOUS — never a new label — by the assigned
// rating adjudicator, who is neither rater. The chosen label keeps the sub-reason its rater recorded.
import { canonicalJson, sha256 } from './canonical.mjs';
import { isCalendarDate } from './schema.mjs';
import { PENDING, RATING_LABELS, buildRatingAdjudicationPacket, resolveRatingDecisions } from './packets.mjs';
import { buildRaterPacket } from './raterPackets.mjs';
import { rater1IsLabelA } from './raterOrder.mjs';

export const RATING_COLUMNS = Object.freeze(['candidate_id', 'field', 'label', 'sub_reason', 'rated_by', 'rated_at']);
export const RATER_SHEET_SCHEMA = 'cpg-u1-rater-sheet/v1';
export const RATING_RESOLUTION_SCHEMA = 'cpg-u1-rating-resolution/v1';
/** §10.2 sub-reasons: the label each qualifies and the fields it can apply to. */
export const SUB_REASONS = Object.freeze({
  CURRENCY_NOT_STATED: Object.freeze({ label: 'UNSUPPORTED-FILL', fields: Object.freeze(['revenue_range']) }),
  STALE_VALUE: Object.freeze({ label: 'INCORRECT-FILL', fields: Object.freeze(['employee_count', 'revenue_range']) }),
});

const k = (x) => `${x.candidate_id}|${x.field}`;
const body = (x, hashKey) => Object.fromEntries(Object.entries(x).filter(([key]) => key !== hashKey));

const FILL_LABELS = Object.freeze(['SUPPORTED-FILL', 'UNSUPPORTED-FILL', 'INCORRECT-FILL', 'MISATTRIBUTED-FILL']);
const ABSTENTION_LABELS = Object.freeze(['CORRECT-ABSTENTION', 'MISSED-FILL']);

/** Label / sub-reason / date rules for one rating row of `item`. Returns a list of errors. */
export function checkRating(r, item) {
  const errors = [];
  if (![...RATING_LABELS, PENDING].includes(r.label)) errors.push(`label must be one of ${RATING_LABELS.join('|')} or "${PENDING}"`);
  // §10.1 first branch is mechanical: "CPG returned a value?" — a fill label needs a value, an abstention label needs none.
  if (FILL_LABELS.includes(r.label) && item.cpg_value === null) errors.push(`${r.label} for an item where CPG returned no value (§10.1)`);
  if (ABSTENTION_LABELS.includes(r.label) && item.cpg_value !== null) errors.push(`${r.label} for an item where CPG returned a value (§10.1)`);
  if (r.sub_reason !== '') {
    const rule = SUB_REASONS[r.sub_reason];
    if (!rule) errors.push(`sub_reason must be empty, CURRENCY_NOT_STATED or STALE_VALUE`);
    else if (rule.label !== r.label || !rule.fields.includes(r.field)) errors.push(`sub_reason ${r.sub_reason} applies only to ${rule.label} on ${rule.fields.join('/')} (§10.2)`);
  }
  if (r.label === PENDING) { if (r.rated_at !== '') errors.push('a pending row has no rated_at'); } else if (!isCalendarDate(r.rated_at)) errors.push('rated_at must be YYYY-MM-DD');
  return errors;
}

/** B2: rows (RATING_COLUMNS) for a VERIFIED packet, rated by `ratedBy` (the assigned person) → canonical sheet. */
export function ingestRatings({ packet, rows, ratedBy, assignmentFingerprint }) {
  const errors = [];
  const byKey = new Map(packet.items.map((it) => [k(it), it]));
  const seen = new Map();
  rows.forEach((r, i) => {
    const where = `row ${i + 2} (${k(r)})`;
    if (!byKey.has(k(r))) { errors.push(`${where}: not an item of the ${packet.label} packet (unknown or unauthorized item)`); return; }
    if (seen.has(k(r))) { errors.push(`${where}: duplicate rating for this item`); return; }
    if (r.rated_by !== ratedBy) errors.push(`${where}: rated_by ${JSON.stringify(r.rated_by)} is not the person assigned to ${packet.label}`);
    for (const e of checkRating(r, byKey.get(k(r)))) errors.push(`${where}: ${e}`);
    seen.set(k(r), r);
  });
  for (const key of byKey.keys()) if (!seen.has(key)) errors.push(`${key}: no row — every packet item needs a label or "${PENDING}" (never silently missing)`);
  if (errors.length) throw new Error(`RATINGS_REFUSED (${errors.length}): ${errors.slice(0, 40).join('; ')}`);
  const sheet = {
    schema: RATER_SHEET_SCHEMA, label: packet.label, rated_by: ratedBy, assignment_fingerprint: assignmentFingerprint,
    packet_sha256: packet.packet_sha256, evaluation_sha256: packet.evaluation_sha256, seal_hash: packet.seal_hash,
    held_out_record_sha256: packet.held_out_record_sha256, item_count: packet.items.length,
    pending_count: [...seen.values()].filter((r) => r.label === PENDING).length,
    ratings: packet.items.map((it) => { const r = seen.get(k(it)); return { position: it.position, candidate_id: it.candidate_id, field: it.field, label: r.label, sub_reason: r.sub_reason, rated_at: r.rated_at }; }),
  };
  return { ...sheet, sheet_sha256: sha256(canonicalJson(sheet)) };
}

/** Verify a sheet against the evaluation artifact it claims: hash, binding, and that it rates exactly that rater's packet. */
export function checkSheet(sheet, { evaluation, recordSha, label }) {
  if (!sheet || sheet.schema !== RATER_SHEET_SCHEMA) return [`sheet schema must be ${RATER_SHEET_SCHEMA}`];
  const errors = [];
  if (sha256(canonicalJson(body(sheet, 'sheet_sha256'))) !== sheet.sheet_sha256) errors.push('sheet_sha256 does not recompute (sheet altered after ingestion)');
  if (sheet.label !== label) errors.push(`sheet is for ${sheet.label}, not ${label}`);
  if (sheet.evaluation_sha256 !== evaluation.evaluation_sha256 || sheet.seal_hash !== evaluation.seal_hash) errors.push('sheet is bound to a different evaluation artifact or seal');
  if (errors.length) return errors;
  let packet;
  try { packet = buildRaterPacket({ label, recordSha, evaluationItems: evaluation.items, binding: { seal_hash: evaluation.seal_hash, evaluation_sha256: evaluation.evaluation_sha256 } }); } catch (e) { return [e.message]; }
  if (sheet.packet_sha256 !== packet.packet_sha256) errors.push('sheet was not ingested against this rater packet');
  if (canonicalJson(sheet.ratings.map((r) => [r.position, r.candidate_id, r.field])) !== canonicalJson(packet.items.map((it) => [it.position, it.candidate_id, it.field]))) errors.push('sheet does not rate exactly the packet items in packet order');
  const items = new Map(evaluation.items.map((it) => [k(it), it]));
  for (const r of sheet.ratings) for (const e of checkRating(r, items.get(k(r)))) errors.push(`${k(r)}: ${e}`);
  if (sheet.pending_count !== sheet.ratings.filter((r) => r.label === PENDING).length || sheet.item_count !== sheet.ratings.length) errors.push('sheet counts do not match its ratings');
  return errors;
}

/** Inputs of the §12.2 packet from two verified sheets. */
export const ratingPacketInputs = (evaluation, sheet1, sheet2, recordSha) => ({ evaluationItems: evaluation.items, rater1: sheet1.ratings, rater2: sheet2.ratings, recordSha });

/** B3: blind decisions on the rating-adjudicator packet → rating resolution artifact. */
export function resolveRatingAdjudication({ packet, rows, sheet1, sheet2, adjudicator, recordSha }) {
  const errors = [];
  if (sheet1.rated_by === sheet2.rated_by) errors.push('the two sheets were rated by the same person — ≥ 2 independent raters are required');
  if ([sheet1.rated_by, sheet2.rated_by].includes(adjudicator)) errors.push('the rating adjudicator must be neither rater (§4A.3)');
  const items = new Map(packet.items.map((it) => [k(it), it]));
  const seen = new Set();
  rows.forEach((r, i) => {
    const where = `row ${i + 2} (${k(r)})`;
    if (!items.has(k(r))) errors.push(`${where}: not an item of the rating-adjudicator packet (agreeing, pending or unknown item)`);
    if (seen.has(k(r))) errors.push(`${where}: duplicate decision`);
    seen.add(k(r));
    if (r.adjudicated_by !== adjudicator) errors.push(`${where}: adjudicated_by is not the assigned rating adjudicator`);
    if (!r.rationale || !r.rationale.trim()) errors.push(`${where}: rationale is required`);
    if (!isCalendarDate(r.adjudicated_at ?? '')) errors.push(`${where}: adjudicated_at must be YYYY-MM-DD`);
  });
  for (const key of items.keys()) if (!seen.has(key)) errors.push(`${key}: disagreement without a decision`);
  if (errors.length) throw new Error(`RATING_ADJUDICATION_REFUSED (${errors.length}): ${errors.slice(0, 40).join('; ')}`);
  const resolved = resolveRatingDecisions(rows, packet);
  const s1 = new Map(sheet1.ratings.map((r) => [k(r), r])); const s2 = new Map(sheet2.ratings.map((r) => [k(r), r]));
  const resolutions = resolved.map((r) => {
    const aIsR1 = rater1IsLabelA(recordSha, r.candidate_id, r.field);
    const source = r.decision === 'REFERENCE-AMBIGUOUS' ? null : (r.decision === 'LABEL_A') === aIsR1 ? s1.get(k(r)) : s2.get(k(r));
    return { candidate_id: r.candidate_id, field: r.field, decision: r.decision, label: r.label, sub_reason: source ? source.sub_reason : '', rationale: r.rationale, adjudicated_at: r.adjudicated_at };
  }).sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
  const out = {
    schema: RATING_RESOLUTION_SCHEMA, evaluation_sha256: sheet1.evaluation_sha256, seal_hash: sheet1.seal_hash,
    rating_adjudication_packet_sha256: sha256(canonicalJson(packet)), sheet_1_sha256: sheet1.sheet_sha256, sheet_2_sha256: sheet2.sheet_sha256,
    adjudicated_by: adjudicator, resolution_count: resolutions.length, resolutions,
  };
  return { ...out, resolution_sha256: sha256(canonicalJson(out)) };
}

/**
 * Final label per observation from two verified sheets and (when any disagreement exists) the verified resolution.
 * Returns Map key → { r1, r2, final: {label, sub_reason, adjudicated} | null (not completely rated) }.
 */
export function finalRatings({ evaluation, sheet1, sheet2, resolution, recordSha }) {
  const packet = buildRatingAdjudicationPacket(ratingPacketInputs(evaluation, sheet1, sheet2, recordSha));
  const s1 = new Map(sheet1.ratings.map((r) => [k(r), r])); const s2 = new Map(sheet2.ratings.map((r) => [k(r), r]));
  let byKey = new Map();
  if (packet.items.length) {
    if (!resolution) throw new Error(`RATING_ADJUDICATION_MISSING: ${packet.items.length} disagreement(s) need the rating adjudicator's resolution`);
    const errs = [];
    if (resolution.schema !== RATING_RESOLUTION_SCHEMA || sha256(canonicalJson(body(resolution, 'resolution_sha256'))) !== resolution.resolution_sha256) errs.push('resolution_sha256 does not recompute (resolution altered)');
    if (resolution.sheet_1_sha256 !== sheet1.sheet_sha256 || resolution.sheet_2_sha256 !== sheet2.sheet_sha256 || resolution.evaluation_sha256 !== evaluation.evaluation_sha256) errs.push('resolution is bound to other sheets or another evaluation');
    if (resolution.rating_adjudication_packet_sha256 !== sha256(canonicalJson(packet))) errs.push('resolution was made on a packet other than the deterministic rating-adjudicator packet');
    if (canonicalJson(resolution.resolutions.map(k).sort()) !== canonicalJson(packet.items.map(k).sort())) errs.push('resolution does not decide exactly the disagreements');
    if (errs.length) throw new Error(`RATING_RESOLUTION_REFUSED: ${errs.join('; ')}`);
    byKey = new Map(resolution.resolutions.map((r) => [k(r), r]));
  } else if (resolution) throw new Error('RATING_RESOLUTION_REFUSED: a resolution was supplied but the raters did not disagree on any completely rated item');
  const out = new Map();
  for (const it of evaluation.items) {
    const key = k(it); const a = s1.get(key); const b = s2.get(key);
    let final = null;
    if (a.label !== PENDING && b.label !== PENDING) {
      if (a.label === b.label) final = { label: a.label, sub_reason: a.sub_reason === b.sub_reason ? a.sub_reason : 'SUB_REASON_DISAGREED', adjudicated: false };
      else { const r = byKey.get(key); final = { label: r.label, sub_reason: r.sub_reason, adjudicated: true }; }
    }
    out.set(key, { r1: a, r2: b, final });
  }
  return out;
}
