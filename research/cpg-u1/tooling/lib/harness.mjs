// U1 execution harness (CPG_U1_PROTOCOL_004 §6.3, §6.5, §7, §11, §13.1). Fails closed: nothing is executed unless every
// technically checkable precondition holds, and every attempt — executed or refused — is appended to the hash-chained
// event log. What it cannot do: prevent or prove the absence of CPG queries made OUTSIDE this harness (§6.5, §20.20).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './canonical.mjs';
import { checkAuthority, checkRegistration } from './registration.mjs';
import { EvidenceError, STATE, evaluateStage } from './sampling.mjs';
import { buildAuthorization, checkAuthorization, LOG_SCHEMA } from './execution.mjs';
import { appendEvent, readEventLog } from './eventlog.mjs';
import { archiveMerkleRoot, buildArchiveRecord } from './archive.mjs';

export const FIXTURE_COMPANY_ID = 'CPG-U1-FIXTURE';
export const EVIDENCE_BUDGET_MS = 45_000;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CANDIDATE = /^[A-Za-z0-9_-]{1,64}$/;
const PROVIDER_CONFIG_FILES = Object.freeze(['backend/services/companyProfile/grounding/registry/builtins.ts', 'backend/services/companyProfile/grounding/registry/coverageInventory.ts']);

/** §13.1 provider configuration hash: domain-separated hash over the two named files' hashes, in order. */
export function providerConfigurationSha(cloneDir) {
  const parts = PROVIDER_CONFIG_FILES.map((f) => sha256(readFileSync(join(cloneDir, f))));
  return sha256(['cpg-u1-provider-config/v1', ...PROVIDER_CONFIG_FILES.flatMap((f, i) => [f, parts[i]])].join('|'));
}

class Refusal extends Error {
  constructor(type, code, message) { super(message); this.type = type; this.code = code; }
}
const refuse = (type, code, message) => { throw new Refusal(type, code, message); };
const verify = (cond, code, message) => { if (!cond) refuse('VERIFICATION_FAILURE', code, message); };

/** §7 treatment input, built only from the sealed frame row and the registered asOf. */
export function lookupInput(frameRow, asOf) {
  return { companyId: FIXTURE_COMPANY_ID, companyName: frameRow.company_name, websiteUrl: `https://${frameRow.canonical_domain}`, linkedinUrl: null, asOf };
}

function commonVerification(ctx, { allowSynthetic }) {
  const reg = ctx.registration;
  const rc = checkRegistration(reg, { phase: 'registered', allowSynthetic });
  verify(rc.errors.length === 0 && rc.blockers.length === 0, 'REGISTRATION_INVALID', `registration incomplete or invalid: ${[...rc.errors, ...rc.blockers].join('; ')}`);
  let voidReason;
  try { voidReason = checkAuthority(reg, ctx.identityRegistrations); } catch (e) { refuse('VERIFICATION_FAILURE', 'AUTHORITY_INVALID', e.message); }
  verify(!voidReason, 'STUDY_VOID_REGISTRATION', voidReason);
  verify(ctx.protocolSha === reg.protocol_sha256, 'PROTOCOL_MISMATCH', 'protocol file does not hash to the registered protocol_sha256');
  verify(ctx.toolingAggregate === reg.tooling_aggregate_sha256, 'TOOLING_MISMATCH', 'this tooling is not the registered tooling');
  verify(ctx.registrySha === reg.registry_sha256, 'REGISTRY_MISMATCH', 'registry differs from the registered registry_sha256');
  const dev = ctx.devManifest;
  verify(dev && dev.stage === 'development', 'MANIFEST_INVALID', 'development manifest required');
  verify(dev.study_id === reg.study_id && dev.registration_id === reg.registration_id, 'STUDY_MISMATCH', 'development manifest names a different study or registration');
  verify(dev.protocol_sha256 === reg.protocol_sha256 && dev.tooling_aggregate_sha256 === reg.tooling_aggregate_sha256 && dev.registry_sha256 === reg.registry_sha256, 'MANIFEST_BINDING_MISMATCH', 'development manifest protocol/tooling/registry differ from the registration');
  verify(ctx.frameHash === dev.frame_hash, 'FRAME_MISMATCH', 'frame differs from the committed frame');
  verify(ctx.scanSha === dev.scan_sha256, 'SCAN_MISMATCH', 'scan differs from the committed scan');
  verify(ctx.resolver?.head === dev.resolver_sha && ctx.resolver?.clean === true, 'RESOLVER_MISMATCH', 'resolver clone is not the frozen resolver at a clean tree');
  verify(Array.isArray(ctx.resolver?.envFiles) && ctx.resolver.envFiles.length === 0, 'RESOLVER_ENV_FILES', `resolver clone contains environment files (${(ctx.resolver?.envFiles ?? ['unknown']).join(', ')}); the evidence environment must hold no credentials`);
  verify(ctx.resolver?.providerConfigurationSha === reg.provider_configuration_sha256, 'PROVIDER_CONFIG_MISMATCH', 'provider configuration differs from the registered hash');
  const devEval = stageFinal(reg, ctx.evidence, 'development', { development: dev.sampling }, allowSynthetic);
  verify(canonicalJson(devEval.record) === canonicalJson(dev.sampling), 'SAMPLING_RECORD_MISMATCH', 'development manifest sampling record differs from the chain-verified event');
  return devEval;
}

function stageFinal(reg, evidence, stage, priorFinal, allowSynthetic) {
  let r;
  try { r = evaluateStage(reg, evidence, stage, { allowSynthetic, priorFinal }); } catch (e) {
    if (e instanceof EvidenceError) refuse('VERIFICATION_FAILURE', 'EVIDENCE_INVALID', `${stage}: ${e.message}`);
    throw e;
  }
  verify(!(r.state.startsWith('STUDY_') || r.state.startsWith('STAGE_')), 'STUDY_VOID', `${stage} sampling event is ${r.state}: ${r.reason}`);
  verify(r.state === STATE.FINAL, 'COMMITMENT_NOT_FINAL', `${stage} sampling event is ${r.state}: ${r.reason} (commitment, confirmations, randomness or drand not yet verifiable)`);
  return r;
}

/** §13.1 run metadata recorded on the run-start event (wall-clock start/end are the start and completion event times). */
const runMetadata = (ctx) => ({ as_of: ctx.registration.as_of, resolver_sha: ctx.resolver.head, provider_configuration_sha256: ctx.resolver.providerConfigurationSha });

function logState(events, authSha) {
  const started = events.filter((e) => e.type === 'RUN_STARTED' && e.authorization_sha256 === authSha);
  const closed = events.filter((e) => (e.type === 'RUN_COMPLETED' || e.type === 'RUN_INTERRUPTED_CLOSED') && e.authorization_sha256 === authSha);
  return { started: started.length, closed: closed.length, anyStarted: events.some((e) => e.type === 'RUN_STARTED') };
}

function checkRequest(request, frameIds) {
  if (!request || typeof request !== 'object') refuse('MALFORMED_EXECUTION', 'REQUEST_MISSING', 'execution request missing');
  if (!RUN_ID.test(request.run_id ?? '')) refuse('MALFORMED_EXECUTION', 'RUN_ID_INVALID', 'run_id must be 1-64 of [A-Za-z0-9_-]');
  const ids = request.candidate_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => !CANDIDATE.test(x ?? ''))) refuse('MALFORMED_EXECUTION', 'CANDIDATES_INVALID', 'candidate_ids must be a non-empty array of candidate ids');
  if (new Set(ids).size !== ids.length) refuse('MALFORMED_EXECUTION', 'CANDIDATES_DUPLICATE', 'candidate_ids contain duplicates');
  const unknown = ids.filter((x) => !frameIds.has(x));
  if (unknown.length) refuse('MALFORMED_EXECUTION', 'CANDIDATE_NOT_IN_FRAME', `not frame candidates: ${unknown.join(', ')}`);
}

async function executeCompanies({ ctx, stage, runId, ids, executor, archiveDir, logPath, now, eventType, authSha }) {
  const rows = new Map(ctx.frameRows.map((r) => [r.candidate_id, r]));
  const runDir = join(archiveDir, runId);
  if (existsSync(runDir)) refuse('MALFORMED_EXECUTION', 'ARCHIVE_EXISTS', `archive directory for run ${runId} already exists (write-once)`);
  mkdirSync(runDir, { recursive: true });
  const invalid = []; const records = [];
  for (const id of [...ids].sort()) {
    const input = lookupInput(rows.get(id), ctx.registration.as_of);
    let execution;
    try { execution = await executor({ candidate_id: id, input }); } catch (e) { execution = { executor_error: `executor failed: ${e.message}` }; }
    const rec = buildArchiveRecord({ study_id: ctx.registration.study_id, registration_id: ctx.registration.registration_id, stage, run_id: runId, candidate_id: id, input, execution });
    writeFileSync(join(runDir, `${id}.json`), `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' });
    if (rec.canonical_response === null) invalid.push(id);
    records.push(rec);
    appendEvent(logPath, eventType, now(), { run_id: runId, candidate_id: id, archive_record_sha256: rec.record_sha256, executor_error: rec.executor_error, ...(authSha ? { authorization_sha256: authSha } : {}) });
  }
  return { records, invalid };
}

function openLog(logPath, ctx, now) {
  let events;
  try { ({ events } = readEventLog(logPath)); } catch (e) { refuse('VERIFICATION_FAILURE', 'EVENT_LOG_BROKEN', `event log does not verify: ${e.message}`); }
  if (events.length === 0) appendEvent(logPath, 'LOG_OPENED', now(), { study_id: ctx.registration?.study_id ?? null, registration_id: ctx.registration?.registration_id ?? null });
  return readEventLog(logPath).events;
}

async function guarded(logPath, ctx, now, mode, request, body) {
  try {
    openLog(logPath, ctx, now);
    return await body();
  } catch (e) {
    const r = e instanceof Refusal ? e : new Refusal('VERIFICATION_FAILURE', 'UNEXPECTED_ERROR', e.message);
    // a broken log cannot record the refusal: refuse anyway (fail closed) and say that the attempt is unlogged
    try { readEventLog(logPath); } catch { return { status: 'REFUSED', type: r.type, code: r.code, reason: r.message, logged: false }; }
    appendEvent(logPath, r.type, now(), { mode, run_id: typeof request?.run_id === 'string' ? request.run_id : null, candidate_ids: Array.isArray(request?.candidate_ids) ? request.candidate_ids : null, code: r.code, reason: r.message });
    return { status: 'REFUSED', type: r.type, code: r.code, reason: r.message };
  }
}

/** §6.3 / §11: CPG over development companies, after the development draw exists. Unlimited, but never a non-development company. */
export async function runPilot({ ctx, request, executor, logPath, archiveDir, now, allowSynthetic = false }) {
  return guarded(logPath, ctx, now, 'pilot', request, async () => {
    const frameIds = new Set((ctx.frameRows ?? []).map((r) => r.candidate_id));
    checkRequest(request, frameIds);
    commonVerification(ctx, { allowSynthetic });
    const devIds = new Set(ctx.devManifest.development.map((e) => e.candidate_id));
    const outside = request.candidate_ids.filter((x) => !devIds.has(x));
    if (outside.length) refuse('PREVIEW_ATTEMPT', 'NON_DEVELOPMENT_COMPANY', `pilot may execute development companies only; refused: ${outside.join(', ')}`);
    if (existsSync(join(archiveDir, request.run_id))) refuse('MALFORMED_EXECUTION', 'ARCHIVE_EXISTS', 'archive directory for run ' + request.run_id + ' already exists (write-once)');
    appendEvent(logPath, 'PILOT_RUN_STARTED', now(), { run_id: request.run_id, candidate_ids: [...request.candidate_ids].sort(), ...runMetadata(ctx) });
    const { records, invalid } = await executeCompanies({ ctx, stage: 'development', runId: request.run_id, ids: request.candidate_ids, executor, archiveDir, logPath, now, eventType: 'PILOT_EXECUTION' });
    appendEvent(logPath, 'PILOT_RUN_COMPLETED', now(), { run_id: request.run_id, executed: records.length, invalid, ...archiveMerkleRoot(records) });
    return { status: 'EXECUTED', records, invalid };
  });
}

/** §6.5: the single authorised held-out run. */
export async function runHeldOut({ ctx, request, executor, logPath, archiveDir, now, allowSynthetic = false }) {
  return guarded(logPath, ctx, now, 'held-out', request, async () => {
    const frameIds = new Set((ctx.frameRows ?? []).map((r) => r.candidate_id));
    checkRequest(request, frameIds);
    commonVerification(ctx, { allowSynthetic });
    const reg = ctx.registration; const dev = ctx.devManifest; const ho = ctx.hoManifest;
    verify(ho && ho.stage === 'held-out', 'MANIFEST_INVALID', 'held-out manifest required');
    verify(ho.study_id === reg.study_id && ho.registration_id === reg.registration_id, 'STUDY_MISMATCH', 'held-out manifest names a different study or registration');
    verify(ho.protocol_sha256 === reg.protocol_sha256 && ho.tooling_aggregate_sha256 === reg.tooling_aggregate_sha256 && ho.registry_sha256 === reg.registry_sha256, 'MANIFEST_BINDING_MISMATCH', 'held-out manifest protocol/tooling/registry differ from the registration');
    verify(ho.frame_hash === ctx.frameHash, 'FRAME_MISMATCH', 'held-out frame differs from the committed frame');
    verify(ho.scan_sha256 === ctx.scanSha, 'SCAN_MISMATCH', 'held-out scan differs from the committed scan');
    const hoEval = stageFinal(reg, ctx.evidence, 'held-out', { development: dev.sampling, 'held-out': ho.sampling }, allowSynthetic);
    verify(canonicalJson(hoEval.record) === canonicalJson(ho.sampling), 'SAMPLING_RECORD_MISMATCH', 'held-out manifest sampling record differs from the chain-verified event');

    verify(ctx.authorization, 'AUTHORIZATION_MISSING', 'no execution authorization supplied');
    let authSha;
    try { authSha = checkAuthorization(ctx.authorization); } catch (e) { refuse('VERIFICATION_FAILURE', 'AUTHORIZATION_ALTERED', e.message); }
    let rebuilt;
    try {
      rebuilt = buildAuthorization({ registration: reg, seal: ctx.seal, sealPublication: ctx.sealPublication, devManifest: dev, devManifestSha: ctx.devManifestSha, hoManifest: ho, hoManifestSha: ctx.hoManifestSha, frameRows: ctx.frameRows });
    } catch (e) { refuse('VERIFICATION_FAILURE', 'AUTHORIZATION_UNBUILDABLE', e.message); }
    verify(canonicalJson(rebuilt) === canonicalJson(ctx.authorization), 'AUTHORIZATION_MISMATCH', 'authorization does not equal the one derived from the sealed study artifacts');

    const expected = [...ctx.authorization.held_out_candidate_ids];
    const requested = [...request.candidate_ids].sort();
    const { events } = readEventLog(logPath);
    const state = logState(events, authSha);
    if (Date.parse(now()) < Date.parse(ctx.authorization.window_opens_at)) {
      refuse(requested.some((x) => expected.includes(x)) ? 'PREVIEW_ATTEMPT' : 'EXECUTION_REFUSED', 'WINDOW_NOT_OPEN', `execution window opens at ${ctx.authorization.window_opens_at}`);
    }
    if (state.closed > 0) refuse('POST_WINDOW_EXECUTION', 'WINDOW_CLOSED', 'the single authorized run has already completed or been closed — the window is closed');
    if (state.started > 0) refuse('REPEATED_EXECUTION', 'RESTART_REFUSED', 'an authorized run already started — no restart, resumption or repetition');
    if (canonicalJson(requested) !== canonicalJson(expected)) refuse('MALFORMED_EXECUTION', 'CANDIDATES_NOT_AUTHORIZED_SET', 'the authorized run executes exactly the authorized held-out set, each once');

    if (existsSync(join(archiveDir, request.run_id))) refuse('MALFORMED_EXECUTION', 'ARCHIVE_EXISTS', 'archive directory for run ' + request.run_id + ' already exists (write-once)');
    appendEvent(logPath, 'RUN_STARTED', now(), { run_id: request.run_id, authorization_sha256: authSha, candidate_ids: expected, ...runMetadata(ctx), seal_hash: ctx.authorization.seal_hash });
    const { records, invalid } = await executeCompanies({ ctx, stage: 'held-out', runId: request.run_id, ids: expected, executor, archiveDir, logPath, now, eventType: 'AUTHORIZED_EXECUTION', authSha });
    appendEvent(logPath, 'RUN_COMPLETED', now(), { run_id: request.run_id, authorization_sha256: authSha, executed: records.length, invalid, ...archiveMerkleRoot(records) });
    return { status: 'EXECUTED', records, invalid, authorization_sha256: authSha };
  });
}

/** Close a run that started but never completed: executes nothing; unexecuted companies are INVALID (§15.2); no resumption. */
export function closeInterruptedRun({ logPath, authorization, now }) {
  const authSha = checkAuthorization(authorization);
  const { events } = readEventLog(logPath);
  const st = logState(events, authSha);
  if (st.started === 0) throw new Error('no authorized run has started');
  if (st.closed > 0) throw new Error('the authorized run is already closed');
  const runId = events.find((e) => e.type === 'RUN_STARTED' && e.authorization_sha256 === authSha).run_id;
  const done = new Set(events.filter((e) => e.type === 'AUTHORIZED_EXECUTION' && e.run_id === runId).map((e) => e.candidate_id));
  const unexecuted = authorization.held_out_candidate_ids.filter((x) => !done.has(x));
  return appendEvent(logPath, 'RUN_INTERRUPTED_CLOSED', now(), { run_id: runId, authorization_sha256: authSha, invalid_unexecuted: unexecuted });
}

/** Derive the §6.5 audit log (cpg-u1-execution-log/v1) from the harness events, for `audit-execution-log`. */
export function executionLogFromEvents(events) {
  const runs = new Map();
  for (const e of events) {
    if (e.type === 'RUN_STARTED' || e.type === 'PILOT_RUN_STARTED') {
      runs.set(e.run_id, { run_id: e.run_id, kind: e.type === 'RUN_STARTED' ? 'held-out-authorized' : 'development-pilot', ...(e.type === 'RUN_STARTED' ? { authorization_sha256: e.authorization_sha256 } : {}), started_at: e.at, completed_at: e.at, invocations: [] });
    } else if (e.type === 'AUTHORIZED_EXECUTION' || e.type === 'PILOT_EXECUTION') {
      const r = runs.get(e.run_id); if (r) { r.invocations.push({ at: e.at, candidate_id: e.candidate_id }); r.completed_at = e.at; }
    } else if (e.type === 'RUN_COMPLETED' || e.type === 'PILOT_RUN_COMPLETED' || e.type === 'RUN_INTERRUPTED_CLOSED') {
      const r = runs.get(e.run_id); if (r) r.completed_at = e.at;
    }
  }
  return { schema: LOG_SCHEMA, runs: [...runs.values()] };
}
