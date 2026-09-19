// Response archive records (CPG_U1_PROTOCOL_004 §13.1, §11; CPG-044 pilot archive). One record per executed company:
// the raw CPG response exactly as emitted, its canonical form, every evidence exchange the recording fetcher saw, every
// HTTP request observed on undici's diagnostics channels (status, headers, timestamps, response body bytes and their
// SHA-256), every Wikidata adapter call, timing metadata, study/stage/run identity and the executor identity (including
// its pinned environment). Records are hashed and replayable: replay feeds the recorded
// exchanges back to CPG and must reproduce the canonical response byte-for-byte.
import { createHash } from 'node:crypto';
import { canonicalJson, sha256 } from './canonical.mjs';

export const ARCHIVE_SCHEMA = 'cpg-u1-response-archive/v1';
export const STAGE_KINDS = Object.freeze({ development: 'pilot', 'held-out': 'held-out-authorized' });
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Canonical response = canonicalJson(JSON.parse(raw)). A raw response that is not JSON is recorded as an executor error. */
export function canonicalResponse(raw) {
  return canonicalJson(JSON.parse(raw));
}

export function buildArchiveRecord({ study_id, registration_id, stage, run_id, candidate_id, input, execution }) {
  if (!Object.hasOwn(STAGE_KINDS, stage)) throw new Error('stage must be development|held-out');
  const e = execution ?? {};
  const rawOk = typeof e.raw_response === 'string';
  let canonical = null; let error = e.executor_error ?? null;
  if (rawOk) { try { canonical = canonicalResponse(e.raw_response); } catch { error = error ?? 'raw response is not JSON'; } }
  const exchanges = (e.exchanges ?? []).map((x) => ({ ...x, text_sha256: x.result && typeof x.result.text === 'string' ? sha256(x.result.text) : null }));
  const body = {
    schema: ARCHIVE_SCHEMA, study_id, registration_id, stage, run_kind: STAGE_KINDS[stage], run_id, candidate_id,
    input,
    started_at: e.started_at ?? null, completed_at: e.completed_at ?? null,
    executor: e.executor ?? null,
    raw_response: rawOk ? e.raw_response : null,
    raw_response_sha256: rawOk ? sha256(e.raw_response) : null,
    canonical_response: canonical,
    canonical_response_sha256: canonical === null ? null : sha256(canonical),
    executor_error: error,
    replay: { exchanges, wikidata_calls: e.wikidata_calls ?? [], http_events: e.http_events ?? [] },
  };
  return { ...body, record_sha256: sha256(canonicalJson(body)) };
}

/** Returns a list of integrity violations; empty = intact. */
export function verifyArchiveRecord(rec) {
  const errors = [];
  if (!rec || rec.schema !== ARCHIVE_SCHEMA) return [`schema must be ${ARCHIVE_SCHEMA}`];
  const { record_sha256: claimed, ...body } = rec;
  if (!HEX64.test(claimed ?? '') || sha256(canonicalJson(body)) !== claimed) errors.push('record_sha256 does not recompute (record altered)');
  if (rec.raw_response !== null && sha256(rec.raw_response) !== rec.raw_response_sha256) errors.push('raw_response_sha256 does not match raw_response');
  if (rec.raw_response !== null && rec.canonical_response !== null) {
    let c = null; try { c = canonicalResponse(rec.raw_response); } catch { /* recorded as error */ }
    if (c !== rec.canonical_response) errors.push('canonical_response is not the canonical form of raw_response');
    if (sha256(rec.canonical_response) !== rec.canonical_response_sha256) errors.push('canonical_response_sha256 does not match');
  }
  for (const [i, x] of (rec.replay?.exchanges ?? []).entries()) {
    const want = x.result && typeof x.result.text === 'string' ? sha256(x.result.text) : null;
    if (want !== x.text_sha256) errors.push(`exchange ${i}: text_sha256 does not match recorded text`);
  }
  for (const [i, h] of (rec.replay?.http_events ?? []).entries()) {
    const body = Buffer.from(String(h.body_base64 ?? ''), 'base64');
    if (body.toString('base64') !== String(h.body_base64 ?? '')) errors.push(`http event ${i}: body_base64 is not canonical base64`);
    if (sha256(body) !== h.body_sha256 || body.length !== h.body_bytes) errors.push(`http event ${i}: body_sha256 / body_bytes do not match the recorded body`);
  }
  for (const k of ['started_at', 'completed_at']) if (rec[k] !== null && !ISO.test(rec[k])) errors.push(`${k} must be ISO-8601 UTC`);
  if (!Object.hasOwn(STAGE_KINDS, rec.stage) || rec.run_kind !== STAGE_KINDS[rec.stage]) errors.push('stage / run_kind inconsistent');
  return errors;
}

/** Replay verdict: the replayed raw response must canonicalise to exactly the archived canonical response. */
export function compareReplay(rec, replayedRaw) {
  if (typeof replayedRaw !== 'string') return { identical: false, reason: 'replay produced no response' };
  let c;
  try { c = canonicalResponse(replayedRaw); } catch { return { identical: false, reason: 'replay response is not JSON' }; }
  return c === rec.canonical_response ? { identical: true } : { identical: false, reason: 'replayed canonical response differs from the archive' };
}

/** The response's CPG values per protocol field ("fill" = a prefilled fact, §2/§8.5 verified-only gate). */
export const FIELD_TO_FACT = Object.freeze({ founded_year: 'founded_year', employee_count: 'team_size', revenue_range: 'revenue_range' });
export function cpgValue(rec, field) {
  if (!Object.hasOwn(FIELD_TO_FACT, field)) throw new Error(`unknown field ${field}`);
  if (rec.canonical_response === null) return null;
  const v = JSON.parse(rec.canonical_response).facts?.[FIELD_TO_FACT[field]];
  return typeof v === 'string' ? v : null;
}

/** Pilot result for §5.6 sizing, derived from archived development records rather than typed by the operator. */
export function pilotResultFromArchive(records, devManifest, devManifestSha, resolverSha) {
  const fillIds = new Set(devManifest.development.filter((e) => e.stratum === 'fill-expected').map((e) => e.candidate_id));
  const byId = new Map();
  for (const r of records) {
    const errs = verifyArchiveRecord(r);
    if (errs.length) throw new Error(`archive record ${r.candidate_id}: ${errs.join('; ')}`);
    if (r.stage !== 'development') throw new Error(`archive record ${r.candidate_id} is not a development record`);
    if (!fillIds.has(r.candidate_id)) continue;
    if (byId.has(r.candidate_id)) throw new Error(`more than one pilot archive record for ${r.candidate_id} — supply the records of exactly one pilot run`);
    byId.set(r.candidate_id, r);
  }
  const missing = [...fillIds].filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`pilot archive lacks development fill-expected companies: ${missing.join(', ')}`);
  const results = [...fillIds].sort().map((id) => ({ candidate_id: id, fills: Object.keys(FIELD_TO_FACT).filter((f) => cpgValue(byId.get(id), f) !== null).length }));
  return { dev_manifest_sha256: devManifestSha, resolver_sha: resolverSha, derived_from_archive: true, archive_record_sha256s: [...fillIds].sort().map((id) => byId.get(id).record_sha256), results };
}

/**
 * §13.1 "per-document SHA-256 plus a Merkle root". Documents = the response bodies of every recorded HTTP request.
 * Leaves, in order: records sorted by candidate_id, then http_events by seq; leaf data = the 32-byte body SHA-256.
 * Tree = RFC 6962 §2.1 Merkle Tree Hash (leaf 0x00 prefix, node 0x01 prefix, split at the largest power of two < n).
 */
const h256 = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
export function merkleTreeHash(leaves) {
  if (leaves.length === 0) return h256(Buffer.alloc(0));
  if (leaves.length === 1) return h256(Buffer.from([0]), leaves[0]);
  let k = 1; while (k * 2 < leaves.length) k *= 2;
  return h256(Buffer.from([1]), merkleTreeHash(leaves.slice(0, k)), merkleTreeHash(leaves.slice(k)));
}
export function archiveMerkleRoot(records) {
  const docs = [...records].sort((a, b) => (a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0))
    .flatMap((r) => [...(r.replay?.http_events ?? [])].sort((a, b) => a.seq - b.seq).map((h) => ({ candidate_id: r.candidate_id, seq: h.seq, body_sha256: h.body_sha256 })));
  for (const d of docs) if (!HEX64.test(d.body_sha256 ?? '')) throw new Error(`document ${d.candidate_id}#${d.seq}: body_sha256 missing`);
  return { archive_merkle_root: merkleTreeHash(docs.map((d) => Buffer.from(d.body_sha256, 'hex'))).toString('hex'), document_count: docs.length };
}
