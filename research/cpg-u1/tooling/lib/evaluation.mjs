// Sealed evaluation artifact (CPG_U1_PROTOCOL_004 §10.1, §10.3, §12, §12.3, §13.1, §15.2). One artifact per study: every
// held-out company × field, derived mechanically from the archived authorised run and the sealed reference file, and
// BOUND to the seal, the authorisation, the frame, the frozen treatment, the hash-chained event log and the archive.
//
// Completeness (B5): every held-out company appears exactly once — as an archived record named by its AUTHORIZED_EXECUTION
// event, or as an unexecuted company named by the run's interruption closure. A company missing from both, a record no
// event names, a duplicate, a record of another run, stage or study, or a record whose hash differs from the logged
// hash is REFUSED. A company cannot be dropped silently.
//
// Explicit validity (B6): every observation carries machine_state SCORABLE or INVALID with a reason. No response, a
// harness error and an unexecuted company are INVALID (§15.2) and are never read as an abstention. A response that is
// present but does not have the shape the protocol reads (facts, grounding arrays, evidence URLs) is REFUSED — as §12.3
// requires, nothing is produced until the response is understood; it is never repaired or read as null.
import { canonicalJson, sha256 } from './canonical.mjs';
import { FIELDS, REFERENCE_COLUMNS } from './schema.mjs';
import { recomputeRecordSha } from './raterOrder.mjs';
import { EXECUTION_STATE, auditExecutionLog, checkAuthorization, recomputeSealHash } from './execution.mjs';
import { executionLogFromEvents } from './harness.mjs';
import { FIELD_TO_FACT, archiveMerkleRoot, verifyArchiveRecord } from './archive.mjs';
import { CITED_URL_RULE, checkItem, extractCitedUrls } from './raterPackets.mjs';
import { EVALUATION_ITEM_KEYS } from './packets.mjs';

export const EVALUATION_SCHEMA = 'cpg-u1-evaluation/v1';
export const MACHINE_STATES = Object.freeze(['SCORABLE', 'INVALID']);
export const INVALID_REASONS = Object.freeze(['NO_RESPONSE_OR_HARNESS_ERROR', 'NOT_EXECUTED_RUN_INTERRUPTED']);
export const OBSERVATION_KEYS = Object.freeze(['candidate_id', 'field', 'machine_state', 'invalid_reason', 'executor_error', 'archive_record_sha256',
  'cpg_filled', 'cited_url_count', 'evidence_state', 'registry_unavailable', 'unavailable_sources', 'registry_ambiguity_count', 'latency_ms']);

const obsKey = (x) => `${x.candidate_id}|${x.field}`;
const isArr = Array.isArray;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Every held-out company × field, companies by candidate_id, fields in protocol order (§12.1 rater list). */
export const heldOutObservations = (hoManifest) => [...hoManifest.held_out].map((e) => e.candidate_id).sort()
  .flatMap((candidate_id) => FIELDS.map((field) => ({ candidate_id, field })));

/**
 * Strict reading of one archived CPG response. The response at the frozen treatment always carries `facts` with the
 * three keys (string or null) and the grounding arrays; anything else is refused rather than read as an abstention.
 */
export function readResponse(rec) {
  const id = rec.candidate_id;
  let response;
  try { response = JSON.parse(rec.canonical_response); } catch { throw new Error(`MALFORMED_RESPONSE ${id}: canonical_response is not JSON`); }
  const facts = response?.facts;
  if (!facts || typeof facts !== 'object' || isArr(facts)) throw new Error(`MALFORMED_RESPONSE ${id}: the response carries no facts object`);
  const values = {};
  for (const field of FIELDS) {
    const k = FIELD_TO_FACT[field];
    if (!Object.hasOwn(facts, k)) throw new Error(`MALFORMED_RESPONSE ${id}: facts carries no ${k}`);
    const v = facts[k];
    if (v !== null && (typeof v !== 'string' || !v.trim())) throw new Error(`MALFORMED_RESPONSE ${id}: facts.${k} must be a non-empty string or null`);
    values[field] = v;
  }
  const g = response.grounding;
  if (!g || typeof g !== 'object' || isArr(g)) throw new Error(`MALFORMED_RESPONSE ${id}: the response carries no grounding object`);
  for (const k of ['registryUnavailable', 'unavailableSources', 'registryAmbiguity']) {
    if (!isArr(g[k])) throw new Error(`MALFORMED_RESPONSE ${id}: grounding.${k} must be an array`);
  }
  const registryUnavailable = g.registryUnavailable.map((x, i) => {
    if (!x || typeof x !== 'object' || typeof x.provider !== 'string' || typeof x.identifier !== 'string' || typeof x.outcome !== 'string') {
      throw new Error(`MALFORMED_RESPONSE ${id}: grounding.registryUnavailable[${i}] must carry provider, identifier and outcome strings`);
    }
    return { provider: x.provider, identifier: x.identifier, outcome: x.outcome, failure: typeof x.failure === 'string' ? x.failure : null };
  });
  const unavailableSources = g.unavailableSources.map((x, i) => {
    if (!x || typeof x !== 'object' || typeof x.sourceId !== 'string' || typeof x.state !== 'string') {
      throw new Error(`MALFORMED_RESPONSE ${id}: grounding.unavailableSources[${i}] must carry sourceId and state strings`);
    }
    return { sourceId: x.sourceId, state: x.state, reason: typeof x.reason === 'string' ? x.reason : null };
  });
  const evidenceState = {};
  for (const field of FIELDS) {
    const s = g.facts?.[FIELD_TO_FACT[field]]?.evidenceState;
    evidenceState[field] = typeof s === 'string' ? s : null;
  }
  return { values, registryUnavailable, unavailableSources, registryAmbiguityCount: g.registryAmbiguity.length, evidenceState };
}

const latency = (rec) => {
  const a = Date.parse(rec.started_at ?? ''); const b = Date.parse(rec.completed_at ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
};

/** The single authorised run named by the authorisation: its start, its closure, and the executions it logged. */
function authorisedRun(events, authSha) {
  const starts = events.filter((e) => e.type === 'RUN_STARTED' && e.authorization_sha256 === authSha);
  if (starts.length !== 1) throw new Error(`EVALUATION_REFUSED: the event log holds ${starts.length} authorised run start(s); exactly one is required`);
  const start = starts[0];
  const closes = events.filter((e) => (e.type === 'RUN_COMPLETED' || e.type === 'RUN_INTERRUPTED_CLOSED') && e.authorization_sha256 === authSha);
  if (closes.length !== 1 || closes[0].run_id !== start.run_id) throw new Error('EVALUATION_REFUSED: the authorised run is not closed exactly once (completed, or closed after interruption)');
  const executed = new Map();
  for (const e of events.filter((x) => x.type === 'AUTHORIZED_EXECUTION' && x.run_id === start.run_id)) {
    if (executed.has(e.candidate_id)) throw new Error(`EVALUATION_REFUSED: ${e.candidate_id} executed more than once in the authorised run`);
    executed.set(e.candidate_id, e);
  }
  return { start, close: closes[0], executed };
}

/**
 * Build the evaluation artifact. `runRecords` = [{ file, record }] for every file in the authorised run's archive
 * directory. Throws (refuses) on any binding, completeness or shape failure.
 */
export function buildEvaluation({ seal, hoManifest, hoManifestSha, referenceRows, referenceSha, authorization, events, eventHead, runRecords }) {
  let sealHash;
  try { sealHash = recomputeSealHash(seal); } catch (e) { throw new Error(`WRONG_SEAL: ${e.message}`); }
  if (hoManifest?.stage !== 'held-out') throw new Error('WRONG_MANIFEST: --held-out-manifest is not a held-out manifest');
  if (seal.held_out?.manifest_sha256 !== hoManifestSha) throw new Error('WRONG_SEAL: the seal does not bind this held-out manifest');
  let recordSha;
  try { recordSha = recomputeRecordSha(hoManifest.sampling); } catch (e) { throw new Error(`WRONG_MANIFEST: ${e.message}`); }
  if (seal.held_out.sampling_record_sha256 !== recordSha) throw new Error('WRONG_SEAL: the held-out sampling record differs from the sealed record');
  if (referenceSha !== seal.reference_file_sha256) throw new Error('WRONG_REFERENCE: the reference file is not the sealed reference file');
  let authSha;
  try { authSha = checkAuthorization(authorization); } catch (e) { throw new Error(`WRONG_AUTHORIZATION: ${e.message}`); }
  if (authorization.seal_hash !== sealHash) throw new Error('WRONG_SEAL: the authorisation names a different seal');
  if (authorization.study_id !== seal.study_id || authorization.registration_id !== seal.registration_id) throw new Error('WRONG_AUTHORIZATION: the authorisation names a different study or registration');
  if (authorization.frame_hash !== hoManifest.frame_hash || seal.held_out.frame_hash !== hoManifest.frame_hash) throw new Error('WRONG_FRAME: the authorisation, the seal and the held-out manifest do not name one frame');
  const hoIds = hoManifest.held_out.map((e) => e.candidate_id).sort();
  if (new Set(hoIds).size !== hoIds.length) throw new Error('WRONG_MANIFEST: the held-out manifest lists a company twice');
  if (!same(authorization.held_out_candidate_ids, hoIds)) throw new Error('WRONG_AUTHORIZATION: the authorised held-out set is not the sealed held-out set');

  const audit = auditExecutionLog(authorization, executionLogFromEvents(events));
  if (audit.state !== EXECUTION_STATE.CLEAN) {
    const err = new Error(`EXECUTION_AUDIT_${audit.state}: ${audit.findings.map((f) => f.msg).join('; ') || 'no authorised execution in the log'}`);
    err.void = audit.state.startsWith('STUDY_VOID');
    throw err;
  }
  const { start, close, executed } = authorisedRun(events, authSha);
  if (start.resolver_sha !== seal.resolver_sha || hoManifest.resolver_sha !== seal.resolver_sha) throw new Error('WRONG_TREATMENT: the run did not execute the sealed resolver SHA');
  if (start.provider_configuration_sha256 !== authorization.provider_configuration_sha256) throw new Error('WRONG_TREATMENT: the run provider configuration differs from the authorised one');
  if (start.as_of !== authorization.as_of) throw new Error('WRONG_TREATMENT: the run asOf differs from the authorised asOf');
  if (start.seal_hash !== sealHash) throw new Error('WRONG_SEAL: the run names a different seal');
  if (!same([...start.candidate_ids].sort(), hoIds)) throw new Error('WRONG_AUTHORIZATION: the run started on a set other than the sealed held-out set');

  const records = new Map();
  for (const { file, record } of runRecords) {
    const id = record?.candidate_id;
    if (file !== `${id}.json`) throw new Error(`ARCHIVE_REFUSED: ${file} does not hold the record it is named after`);
    const errs = verifyArchiveRecord(record);
    if (errs.length) throw new Error(`ARCHIVE_REFUSED ${id}: ${errs.join('; ')}`);
    if (record.stage !== 'held-out' || record.run_id !== start.run_id) throw new Error(`ARCHIVE_REFUSED ${id}: not a record of the authorised held-out run`);
    if (record.study_id !== seal.study_id || record.registration_id !== seal.registration_id) throw new Error(`ARCHIVE_REFUSED ${id}: record names a different study or registration`);
    if (!hoIds.includes(id)) throw new Error(`ARCHIVE_REFUSED ${id}: not a sealed held-out company`);
    if (records.has(id)) throw new Error(`ARCHIVE_REFUSED ${id}: duplicate record`);
    const ev = executed.get(id);
    if (!ev) throw new Error(`ARCHIVE_REFUSED ${id}: no AUTHORIZED_EXECUTION event names this record`);
    if (ev.archive_record_sha256 !== record.record_sha256) throw new Error(`ARCHIVE_REFUSED ${id}: record differs from the one logged at execution`);
    records.set(id, record);
  }
  for (const id of executed.keys()) if (!records.has(id)) throw new Error(`INCOMPLETE: executed company ${id} has no archived record (dropped)`);

  const noResponse = [...records.values()].filter((r) => r.canonical_response === null).map((r) => r.candidate_id).sort();
  let unexecuted = [];
  if (close.type === 'RUN_COMPLETED') {
    if (close.executed !== records.size || !same([...close.invalid].sort(), noResponse)) throw new Error('INCOMPLETE: the archive does not match the run completion event (count or INVALID list)');
    if (archiveMerkleRoot([...records.values()]).archive_merkle_root !== close.archive_merkle_root) throw new Error('INCOMPLETE: the archive Merkle root differs from the one recorded at run completion');
  } else {
    unexecuted = [...close.invalid_unexecuted].sort();
    if (unexecuted.some((id) => records.has(id))) throw new Error('INCOMPLETE: a company is both archived and listed as unexecuted');
  }
  for (const id of hoIds) {
    if (!records.has(id) && !unexecuted.includes(id)) throw new Error(`INCOMPLETE: held-out company ${id} has neither an archived record nor an unexecuted (INVALID) disposition — a company may not be dropped`);
  }
  if (unexecuted.some((id) => !hoIds.includes(id))) throw new Error('INCOMPLETE: the interruption closure names a company outside the sealed held-out set');

  const refs = new Map(referenceRows.map((r) => [obsKey(r), r]));
  const items = []; const observations = [];
  for (const { candidate_id, field } of heldOutObservations(hoManifest)) {
    const ref = refs.get(`${candidate_id}|${field}`);
    if (!ref) throw new Error(`INCOMPLETE: no sealed reference record for ${candidate_id}|${field}`);
    const rec = records.get(candidate_id) ?? null;
    let obs;
    if (!rec || rec.canonical_response === null) {
      items.push({ candidate_id, field, cpg_value: null, cpg_source_urls: [], reference_record: ref });
      obs = { machine_state: 'INVALID', invalid_reason: rec ? 'NO_RESPONSE_OR_HARNESS_ERROR' : 'NOT_EXECUTED_RUN_INTERRUPTED', executor_error: rec ? rec.executor_error : null,
        archive_record_sha256: rec ? rec.record_sha256 : null, cpg_filled: false, cited_url_count: 0, evidence_state: null, registry_unavailable: [], unavailable_sources: [], registry_ambiguity_count: 0, latency_ms: rec ? latency(rec) : null };
    } else {
      const r = readResponse(rec);
      const urls = extractCitedUrls(rec, field);
      items.push({ candidate_id, field, cpg_value: r.values[field], cpg_source_urls: urls, reference_record: ref });
      obs = { machine_state: 'SCORABLE', invalid_reason: null, executor_error: rec.executor_error, archive_record_sha256: rec.record_sha256, cpg_filled: r.values[field] !== null,
        cited_url_count: urls.length, evidence_state: r.evidenceState[field], registry_unavailable: r.registryUnavailable, unavailable_sources: r.unavailableSources,
        registry_ambiguity_count: r.registryAmbiguityCount, latency_ms: latency(rec) };
    }
    observations.push({ candidate_id, field, ...obs });
  }
  items.forEach(checkItem);
  const body = {
    schema: EVALUATION_SCHEMA, study_id: seal.study_id, registration_id: seal.registration_id, seal_hash: sealHash,
    held_out_manifest_sha256: hoManifestSha, held_out_record_sha256: recordSha, reference_file_sha256: referenceSha,
    frame_hash: hoManifest.frame_hash, resolver_sha: seal.resolver_sha, provider_configuration_sha256: authorization.provider_configuration_sha256,
    as_of: authorization.as_of, authorization_sha256: authSha, run_id: start.run_id, run_closure: close.type, event_log_head: eventHead,
    archive_merkle_root: archiveMerkleRoot([...records.values()]).archive_merkle_root, cited_url_rule: CITED_URL_RULE,
    observation_count: items.length, invalid_observation_count: observations.filter((x) => x.machine_state === 'INVALID').length,
    items, observations,
  };
  return { ...body, evaluation_sha256: sha256(canonicalJson(body)) };
}

/**
 * Verify an evaluation artifact against the seal and the held-out manifest WITHOUT the archive: hash, bindings, and
 * exact completeness (every held-out company × field once, observations aligned with items). Returns a list of errors.
 * A full rebuild from the archive (`verify-evaluation`) is the stronger check; this one guards every consumer.
 */
export function checkEvaluation(ev, { seal, hoManifest, hoManifestSha }) {
  const errors = [];
  if (!ev || ev.schema !== EVALUATION_SCHEMA) return [`evaluation schema must be ${EVALUATION_SCHEMA}`];
  const { evaluation_sha256: claimed, ...body } = ev;
  if (sha256(canonicalJson(body)) !== claimed) errors.push('evaluation_sha256 does not recompute (artifact altered after it was built)');
  let sealHash = null;
  try { sealHash = recomputeSealHash(seal); } catch (e) { errors.push(`seal: ${e.message}`); }
  if (ev.seal_hash !== sealHash) errors.push('evaluation is bound to a different seal');
  if (seal?.held_out?.manifest_sha256 !== hoManifestSha || ev.held_out_manifest_sha256 !== hoManifestSha) errors.push('evaluation, seal and held-out manifest do not bind one another');
  let recordSha = null;
  try { recordSha = recomputeRecordSha(hoManifest.sampling); } catch (e) { errors.push(`held-out sampling record: ${e.message}`); }
  if (recordSha === null || ev.held_out_record_sha256 !== recordSha || seal?.held_out?.sampling_record_sha256 !== recordSha) errors.push('evaluation is bound to a different held-out sampling record');
  if (ev.reference_file_sha256 !== seal?.reference_file_sha256) errors.push('evaluation was built from a reference file other than the sealed one');
  if (ev.frame_hash !== seal?.held_out?.frame_hash || ev.frame_hash !== hoManifest?.frame_hash) errors.push('evaluation names a different frame');
  if (ev.resolver_sha !== seal?.resolver_sha) errors.push('evaluation names a different treatment (resolver SHA)');
  if (ev.cited_url_rule !== CITED_URL_RULE) errors.push('evaluation names another cited-URL rule');
  if (errors.length) return errors;
  const expected = heldOutObservations(hoManifest).map(obsKey);
  if (!isArr(ev.items) || !isArr(ev.observations)) return ['evaluation items and observations must be arrays'];
  if (!same(ev.items.map(obsKey), expected)) errors.push(`evaluation items are not exactly every held-out company × field (${ev.items.length} of ${expected.length}; missing, extra, duplicated or reordered)`);
  if (!same(ev.observations.map(obsKey), expected)) errors.push('evaluation observations are not exactly every held-out company × field');
  if (ev.observation_count !== expected.length) errors.push('observation_count differs from the held-out observation count');
  if (errors.length) return errors;
  ev.items.forEach((it, i) => {
    try { checkItem(it); } catch (e) { errors.push(e.message); }
    const o = ev.observations[i];
    if (Object.keys(o).length !== OBSERVATION_KEYS.length || !OBSERVATION_KEYS.every((k) => Object.hasOwn(o, k))) errors.push(`observation ${obsKey(o)}: keys must be exactly ${OBSERVATION_KEYS.join(',')}`);
    else if (!MACHINE_STATES.includes(o.machine_state)) errors.push(`observation ${obsKey(o)}: machine_state must be SCORABLE or INVALID`);
    else if (o.machine_state === 'INVALID' && (!INVALID_REASONS.includes(o.invalid_reason) || it.cpg_value !== null || it.cpg_source_urls.length)) errors.push(`observation ${obsKey(o)}: an INVALID observation carries a reason and no CPG value or URL`);
    else if (o.machine_state === 'SCORABLE' && (o.invalid_reason !== null || o.cpg_filled !== (it.cpg_value !== null))) errors.push(`observation ${obsKey(o)}: SCORABLE state inconsistent with its item`);
    if (!Object.keys(it).every((k) => EVALUATION_ITEM_KEYS.includes(k)) || Object.keys(it.reference_record ?? {}).length !== REFERENCE_COLUMNS.length) errors.push(`item ${obsKey(it)}: not a §12 rater item`);
  });
  if (ev.invalid_observation_count !== ev.observations.filter((x) => x.machine_state === 'INVALID').length) errors.push('invalid_observation_count differs from the observations');
  return errors;
}
