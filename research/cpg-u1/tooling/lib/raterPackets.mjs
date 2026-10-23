// Deterministic rater packets (CPG_U1_PROTOCOL_004 §12, §12.1, §12.3). A packet is the ordered list of evaluation items
// one rater receives: field; CPG's value or null; the source URLs CPG cited for that value; the sealed reference record.
// Order follows the approved derivation for the rater's label. The packet has one canonical byte representation and a
// hash, and verification rebuilds it from the same inputs and requires byte identity.
//
// RULE A (§12.3, approved CPG-045): the URLs cited for a reported field value are the `sourceUrl` values of that
// field's final evidence records in the CPG response — every one of them, in response order, with exact duplicates
// removed. Nothing is selected, dropped, reordered or filtered by value, authority, identity, rater result or expected
// outcome: `extractCitedUrls` reads only the evidence array's `sourceUrl` field, so no such input reaches it.
import { canonicalJson, sha256 } from './canonical.mjs';
import { FIELDS, REFERENCE_COLUMNS, isHttpsUrl } from './schema.mjs';
import { presentationOrder } from './raterOrder.mjs';
import { EVALUATION_ITEM_KEYS } from './packets.mjs';
import { FIELD_TO_FACT } from './archive.mjs';

export const RATER_PACKET_SCHEMA = 'cpg-u1-rater-packet/v1';
export const RATER_LABELS = Object.freeze(['rater-1', 'rater-2']);
/** The approved §12.3 rule (CPG-045). Recorded in the packet so an outsider sees which rule produced the URL sets. */
export const CITED_URL_RULE = 'cpg-u1-cited-urls/field-evidence-union/v1';

const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));

/**
 * §12.3 Rule A. Returns the ordered, deduplicated https `sourceUrl` values of the field's final evidence records.
 * - a record whose `sourceUrl` is null contributes no URL (none is invented);
 * - a `sourceUrl` that is present but not an https URL is REFUSED (`isHttpsUrl`, the tooling's existing contract);
 * - only the evidence array of THIS field is read: not the Wikidata entity URL, registry identities, provider
 *   metadata, navigation links, replayed request URLs or any other URL in the response or archive.
 */
export function extractCitedUrls(record, field) {
  if (!Object.hasOwn(FIELD_TO_FACT, field)) throw new Error(`unknown field ${field}`);
  if (!record || typeof record !== 'object') throw new Error('archive record required');
  if (record.canonical_response === null || record.canonical_response === undefined) return [];
  let response;
  try { response = JSON.parse(record.canonical_response); } catch { throw new Error(`${record.candidate_id}|${field}: canonical_response is not JSON`); }
  const view = response?.grounding?.facts?.[FIELD_TO_FACT[field]];
  if (!view || typeof view !== 'object') throw new Error(`${record.candidate_id}|${field}: the response carries no grounding view for this field`);
  if (!Array.isArray(view.evidence)) throw new Error(`${record.candidate_id}|${field}: the grounding view has no evidence array`);
  const urls = [];
  for (const [i, e] of view.evidence.entries()) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'sourceUrl')) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} has no sourceUrl field`);
    const url = e.sourceUrl;
    if (url === null) continue;
    if (typeof url !== 'string' || !isHttpsUrl(url)) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} sourceUrl is not an https URL`);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Evaluation items are built only by lib/evaluation.mjs (`evaluation-items`): bound to the seal, complete, with an
// explicit machine state per observation (B5/B6). No unbound item list is derived here.

export function checkItem(it) {
  if (!exactKeys(it, EVALUATION_ITEM_KEYS)) throw new Error(`evaluation item ${it?.candidate_id}|${it?.field}: keys must be exactly ${EVALUATION_ITEM_KEYS.join(',')} (no class, split, pilot or rater information)`);
  if (!FIELDS.includes(it.field)) throw new Error(`evaluation item ${it.candidate_id}: unknown field ${it.field}`);
  if (it.cpg_value !== null && typeof it.cpg_value !== 'string') throw new Error(`evaluation item ${it.candidate_id}|${it.field}: cpg_value must be a string or null`);
  if (!Array.isArray(it.cpg_source_urls) || it.cpg_source_urls.some((u) => typeof u !== 'string' || !isHttpsUrl(u))) throw new Error(`evaluation item ${it.candidate_id}|${it.field}: cpg_source_urls must be an array of https URLs`);
  if (new Set(it.cpg_source_urls).size !== it.cpg_source_urls.length) throw new Error(`evaluation item ${it.candidate_id}|${it.field}: cpg_source_urls contains duplicates (§12.3 removes exact duplicates)`);
  if (!exactKeys(it.reference_record, REFERENCE_COLUMNS)) throw new Error(`evaluation item ${it.candidate_id}|${it.field}: reference_record must be exactly the sealed reference row`);
  if (it.reference_record.candidate_id !== it.candidate_id || it.reference_record.field !== it.field) throw new Error(`evaluation item ${it.candidate_id}|${it.field}: reference record belongs to another observation`);
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Build the packet for one rater. Canonical bytes = canonicalJson(packet); packet_sha256 over the body. `binding` names
 * the seal and the evaluation artifact the items came from (B5): a packet is never unbound from the sealed study.
 */
export function buildRaterPacket({ label, recordSha, evaluationItems, binding }) {
  if (!RATER_LABELS.includes(label)) throw new Error(`label must be ${RATER_LABELS.join('|')}`);
  if (!HEX64.test(binding?.seal_hash ?? '') || !HEX64.test(binding?.evaluation_sha256 ?? '')) throw new Error('rater packet must be bound to a seal_hash and an evaluation_sha256');
  evaluationItems.forEach(checkItem);
  const items = presentationOrder(recordSha, label, evaluationItems).map((x) => ({ position: 0, order_key: x.order_key, ...Object.fromEntries(EVALUATION_ITEM_KEYS.map((k) => [k, x[k]])) }))
    .map((x, i) => ({ ...x, position: i + 1 }));
  const body = { schema: RATER_PACKET_SCHEMA, label, cited_url_rule: CITED_URL_RULE, held_out_record_sha256: recordSha,
    seal_hash: binding.seal_hash, evaluation_sha256: binding.evaluation_sha256, item_count: items.length, items };
  return { ...body, packet_sha256: sha256(canonicalJson(body)) };
}

export const raterPacketBytes = (packet) => Buffer.from(canonicalJson(packet), 'utf8');

/** Rebuild from the same inputs and require byte identity with the supplied packet bytes. */
export function verifyRaterPacket(packetBytes, inputs) {
  const rebuilt = raterPacketBytes(buildRaterPacket(inputs));
  return Buffer.compare(Buffer.from(packetBytes), rebuilt) === 0
    ? { identical: true, packet_sha256: sha256(rebuilt) }
    : { identical: false, reason: 'packet bytes differ from the deterministic rebuild' };
}
