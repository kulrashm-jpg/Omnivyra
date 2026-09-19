// Held-out execution authorization and execution-log audit (CPG_U1_PROTOCOL_004 §6.5). What this can and cannot do:
// it builds a deterministic authorization bound to the published seal, and it AUDITS an execution log against the
// no-preview rule. It cannot prove that no private query happened: the log is procedural evidence, its timestamps
// come from the operator's systems, and a query that was never logged is invisible to it.
import { canonicalJson, hashRecords, sha256 } from './canonical.mjs';
import { recomputeRecordSha } from './raterOrder.mjs';

export const AUTHORIZATION_SCHEMA = 'cpg-u1-execution-authorization/v1';
export const LOG_SCHEMA = 'cpg-u1-execution-log/v1';
export const EXECUTION_STATE = Object.freeze({
  CLEAN: 'NO_VIOLATION_IN_LOG',
  NOT_EXECUTED: 'NOT_EXECUTED',
  PREVIEW: 'STUDY_VOID_PREVIEW',
  UNAUTHORIZED: 'STUDY_VOID_UNAUTHORIZED_EXECUTION',
  POST_WINDOW: 'STUDY_VOID_POST_WINDOW_EXECUTION',
  REPEATED: 'STUDY_VOID_REPEATED_EXECUTION',
});
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const epoch = (s, what) => {
  if (!ISO_UTC.test(s ?? '') || Number.isNaN(Date.parse(s))) throw new Error(`${what} must be an ISO-8601 UTC timestamp`);
  return Date.parse(s);
};
const iso = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');

/** seal_hash = sha256(canonicalJson(seal without seal_hash)) — recomputed, never trusted. */
export function recomputeSealHash(seal) {
  const { seal_hash: claimed, ...rest } = seal ?? {};
  const h = sha256(canonicalJson(rest));
  if (h !== claimed) throw new Error('seal_hash does not recompute from the seal');
  return h;
}

/**
 * The execution window opens at the registry-issued timestamp of the published seal record (§9.6) and closes when the
 * single authorized run completes. The authorization binds (CPG-044): study and registration; protocol; tooling; frame;
 * registry; scan; both commitments and their randomness (sampling records, recomputed); asOf and provider configuration;
 * the seal and its publication; the development, held-out and frame candidate sets.
 */
export function buildAuthorization({ registration, seal, sealPublication, devManifest, devManifestSha, hoManifest, hoManifestSha, frameRows }) {
  if (!registration || typeof registration !== 'object') throw new Error('registration record required');
  const sealHash = recomputeSealHash(seal);
  if (seal.development.manifest_sha256 !== devManifestSha) throw new Error('seal does not bind this development manifest');
  if (seal.held_out.manifest_sha256 !== hoManifestSha) throw new Error('seal does not bind this held-out manifest');
  if (devManifest.frame_hash !== hoManifest.frame_hash) throw new Error('development and held-out frames differ (single frozen frame)');
  if (hashRecords(frameRows, 'candidate_id') !== hoManifest.frame_hash) throw new Error('supplied frame is not the sealed frame');
  for (const m of [devManifest, hoManifest]) {
    if (m.study_id !== registration.study_id || m.registration_id !== registration.registration_id) throw new Error('manifest names a different study or registration');
    for (const k of ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256']) if (m[k] !== registration[k]) throw new Error(`manifest ${k} differs from the registration`);
  }
  if (devManifest.scan_sha256 !== hoManifest.scan_sha256) throw new Error('development and held-out scans differ (eligibility frozen)');
  const devRec = recomputeRecordSha(devManifest.sampling); const hoRec = recomputeRecordSha(hoManifest.sampling);
  if (devManifest.sampling.stage !== 'development' || hoManifest.sampling.stage !== 'held-out') throw new Error('sampling records name the wrong stages');
  if (seal.development.sampling_record_sha256 !== devRec || seal.held_out.sampling_record_sha256 !== hoRec) throw new Error('seal does not bind these sampling records');
  if (sealPublication?.seal_hash !== sealHash) throw new Error('published seal record names a different seal_hash');
  if (typeof sealPublication.record_id !== 'string' || !sealPublication.record_id.trim()) throw new Error('published seal record_id required');
  epoch(sealPublication.registry_timestamp, 'seal registry_timestamp');
  const commitment = (m, rec) => ({ commitment_txid: m.sampling.commitment_txid, payload_digest: m.sampling.payload_digest, commitment_height: m.sampling.commitment_height,
    randomness_block_hash: m.sampling.randomness_block_hash, drand_round: m.sampling.drand_round, drand_randomness: m.sampling.drand_randomness, sampling_record_sha256: rec });
  const auth = {
    schema: AUTHORIZATION_SCHEMA,
    study_id: registration.study_id,
    registration_id: registration.registration_id,
    protocol_sha256: registration.protocol_sha256,
    tooling_aggregate_sha256: registration.tooling_aggregate_sha256,
    registry_sha256: registration.registry_sha256,
    scan_sha256: hoManifest.scan_sha256,
    as_of: registration.as_of,
    provider_configuration_sha256: registration.provider_configuration_sha256,
    development_commitment: commitment(devManifest, devRec),
    held_out_commitment: commitment(hoManifest, hoRec),
    seal_hash: sealHash,
    seal_publication: { record_id: sealPublication.record_id, registry_timestamp: sealPublication.registry_timestamp },
    window_opens_at: sealPublication.registry_timestamp,
    frame_hash: hoManifest.frame_hash,
    development_draw_earliest: iso(devManifest.sampling.drand_round_time),
    held_out_draw_earliest: iso(hoManifest.sampling.drand_round_time),
    development_candidate_ids: devManifest.development.map((e) => e.candidate_id).sort(),
    held_out_candidate_ids: hoManifest.held_out.map((e) => e.candidate_id).sort(),
    frame_candidates: frameRows.map((r) => ({ candidate_id: r.candidate_id, canonical_domain: r.canonical_domain })).sort((a, b) => (a.candidate_id < b.candidate_id ? -1 : 1)),
  };
  if (epoch(auth.window_opens_at, 'window') < Date.parse(auth.held_out_draw_earliest)) throw new Error('seal published before the held-out draw could exist — seal record timestamp inconsistent');
  return { ...auth, authorization_sha256: sha256(canonicalJson(auth)) };
}

export function checkAuthorization(auth) {
  const { authorization_sha256: claimed, ...rest } = auth ?? {};
  if (!auth || auth.schema !== AUTHORIZATION_SCHEMA) throw new Error(`authorization schema must be ${AUTHORIZATION_SCHEMA}`);
  if (!HEX64.test(claimed ?? '') || sha256(canonicalJson(rest)) !== claimed) throw new Error('authorization_sha256 does not recompute');
  return claimed;
}

/**
 * Audit rules (§6.5):
 *  - exactly one run of kind "held-out-authorized", naming this authorization, starting at/after window_opens_at;
 *  - held-out candidates may be executed ONLY inside that run's [started_at, completed_at];
 *  - development candidates may be executed only at/after development_draw_earliest;
 *  - other frame candidates may be executed only at/after held_out_draw_earliest (no longer held-out candidates);
 *  - the authorized run contains held-out candidates only.
 */
export function auditExecutionLog(auth, log) {
  const authSha = checkAuthorization(auth);
  if (!log || log.schema !== LOG_SCHEMA || !Array.isArray(log.runs)) throw new Error(`execution log must be {schema: ${LOG_SCHEMA}, runs: [...]}`);
  const findings = [];
  const add = (state, msg) => findings.push({ state, msg });
  const opens = epoch(auth.window_opens_at, 'window_opens_at');
  const devEarliest = Date.parse(auth.development_draw_earliest);
  const hoEarliest = Date.parse(auth.held_out_draw_earliest);
  const ho = new Set(auth.held_out_candidate_ids); const dev = new Set(auth.development_candidate_ids);
  const byDomain = new Map(auth.frame_candidates.map((c) => [c.canonical_domain, c.candidate_id]));
  const inFrame = new Set(auth.frame_candidates.map((c) => c.candidate_id));
  const resolve = (inv) => {
    if (inv.candidate_id && inFrame.has(inv.candidate_id)) return inv.candidate_id;
    if (inv.canonical_domain && byDomain.has(inv.canonical_domain)) return byDomain.get(inv.canonical_domain);
    if (!inv.candidate_id && !inv.canonical_domain) throw new Error('every invocation must identify a company (candidate_id or canonical_domain)');
    return null; // not a frame candidate
  };

  for (const r of log.runs) {
    const start = epoch(r.started_at, `run ${r.run_id} started_at`); const end = epoch(r.completed_at, `run ${r.run_id} completed_at`);
    if (end < start) throw new Error(`run ${r.run_id}: completed_at precedes started_at`);
  }
  const authorized = log.runs.filter((r) => r.kind === 'held-out-authorized');
  if (authorized.length > 1) add(EXECUTION_STATE.REPEATED, `${authorized.length} held-out-authorized runs — the held-out set is executed once`);
  let window = null;
  for (const r of authorized) {
    if (r.authorization_sha256 !== authSha) { add(EXECUTION_STATE.UNAUTHORIZED, `run ${r.run_id}: names authorization ${r.authorization_sha256}, not ${authSha}`); continue; }
    const start = epoch(r.started_at, `run ${r.run_id} started_at`); const end = epoch(r.completed_at, `run ${r.run_id} completed_at`);
    if (end < start) throw new Error(`run ${r.run_id}: completed_at precedes started_at`);
    if (start < opens) add(EXECUTION_STATE.UNAUTHORIZED, `run ${r.run_id}: started before the execution window opened (seal publication)`);
    if (!window) window = { start, end, run_id: r.run_id };
  }

  for (const r of log.runs) {
    for (const inv of r.invocations ?? []) {
      const at = epoch(inv.at, `run ${r.run_id} invocation time`);
      const id = resolve(inv);
      const inAuthorizedRun = window && r.run_id === window.run_id && r.kind === 'held-out-authorized';
      if (inAuthorizedRun && (id === null || !ho.has(id))) { add(EXECUTION_STATE.UNAUTHORIZED, `run ${r.run_id}: authorized run executed a non-held-out company (${id ?? inv.canonical_domain})`); continue; }
      if (id === null) continue;
      if (ho.has(id)) {
        if (inAuthorizedRun && at >= window.start && at <= window.end) continue;
        if (window && at > window.end) add(EXECUTION_STATE.POST_WINDOW, `run ${r.run_id}: held-out company ${id} executed after the authorized run completed`);
        else add(EXECUTION_STATE.PREVIEW, `run ${r.run_id}: held-out company ${id} executed outside the authorized run (preview)`);
      } else if (dev.has(id)) {
        if (at < devEarliest) add(EXECUTION_STATE.PREVIEW, `run ${r.run_id}: company ${id} executed before the development draw existed (preview of a potential held-out company)`);
      } else if (at < hoEarliest) {
        add(EXECUTION_STATE.PREVIEW, `run ${r.run_id}: frame company ${id} executed before the held-out draw existed (preview of a potential held-out company)`);
      }
    }
  }
  const priority = [EXECUTION_STATE.PREVIEW, EXECUTION_STATE.UNAUTHORIZED, EXECUTION_STATE.REPEATED, EXECUTION_STATE.POST_WINDOW];
  const worst = priority.find((s) => findings.some((f) => f.state === s));
  return { state: worst ?? (window ? EXECUTION_STATE.CLEAN : EXECUTION_STATE.NOT_EXECUTED), findings, authorization_sha256: authSha };
}
