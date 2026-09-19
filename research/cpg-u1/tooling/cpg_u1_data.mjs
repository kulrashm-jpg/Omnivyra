#!/usr/bin/env node
// CPG U1 dataset tooling v4 — governed by CPG_U1_PROTOCOL_004.md.
// Pipeline: registration-fields → check-funding-prerequisites → [registration] → frame → scan
//           → check-frame-sufficiency → commitment-payload(D) → verify-sampling(D) → draw-development → size
//           → commitment-payload(H: same frame, scan, registry) → verify-sampling(H) → draw-held-out
//           → reference-adjudication-packet → reconcile → seal → authorize-execution → rater-order → audit-execution-log.
// Contains no company and no fact. Creates no key, transaction, registration or seed input.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv, toCsv } from './lib/csv.mjs';
import { canonicalJson, hashRecords, sha256 } from './lib/canonical.mjs';
import {
  ADJUDICATION_COLUMNS, BLIND_RECORD_COLUMNS, DEVELOPMENT_QUOTA, FIELDS, FRAME_COLUMNS, REFERENCE_COLUMNS, checkFrameRow,
} from './lib/schema.mjs';
import { registryMatches, scanScope, scanText, tokensFor } from './lib/scan.mjs';
import { drawDevelopment, drawHeldOut, poolShortfall } from './lib/select.mjs';
import { heldOutQuotas } from './lib/sizing.mjs';
import { reconcile } from './lib/reconcile.mjs';
import { toolingManifest } from './lib/aggregate.mjs';
import { crosscheckArchives, encodeCommitmentScript, networkParams, verifyArchive } from './lib/bitcoin.mjs';
import { PAYLOAD_SCHEMA, STUDY_ID, appendOnlyProof, checkPayload, payloadDigest } from './lib/commitment.mjs';
import { QUICKNET } from './lib/drand.mjs';
import { PROTOCOL_VERSION, checkAuthority, checkRegistration, registrationTemplate } from './lib/registration.mjs';
import { D, EvidenceError, STATE, SEED_DOMAIN, evaluateStage } from './lib/sampling.mjs';
import { FRAME_MINIMUM, frameSufficiency } from './lib/frame.mjs';
import { orderArtifact, recomputeRecordSha } from './lib/raterOrder.mjs';
import { buildReferenceAdjudicationPacket, checkRatingAdjudicationPacket, checkReferenceAdjudicationPacket, resolveReferenceDecisions } from './lib/packets.mjs';
import { checkPersonnelRegister } from './lib/personnel.mjs';
import { EXECUTION_STATE, auditExecutionLog, buildAuthorization } from './lib/execution.mjs';
import { closeInterruptedRun, executionLogFromEvents, providerConfigurationSha, runHeldOut, runPilot } from './lib/harness.mjs';
import { readEventLog } from './lib/eventlog.mjs';
import { archiveMerkleRoot, compareReplay, pilotResultFromArchive, verifyArchiveRecord } from './lib/archive.mjs';
import { realExecutor, replayRecord } from './lib/cpgExecutor.mjs';
import { CITED_URL_RULE, buildRaterPacket, evaluationItemsFromArchive, raterPacketBytes, verifyRaterPacket } from './lib/raterPackets.mjs';
import { EVALUATION_TREE_DOMAIN, verifyEvaluationTree } from './lib/evaluationTree.mjs';

const TOOL_VERSION = 'cpg-u1-data-tooling-5';
const ROOT = dirname(fileURLToPath(import.meta.url));

// Exit codes: 0 ok · 1 refused/abort · 2 pool below minimum · 3 HALT · 4 BLOCKED (human prerequisite) · 5 WAITING · 6 VOID/ABANDONED
const EXIT = { REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 };

// ── plumbing ────────────────────────────────────────────────────────────────
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else o._.push(a);
  }
  return o;
}
function fail(msg, code = 1) { console.error(`ERROR: ${msg}`); process.exit(code); }
const need = (o, k) => { if (!o[k] || o[k] === true) fail(`--${k} is required`); return o[k]; };
const readText = (p) => readFileSync(p, 'utf8');
const fileSha = (p) => sha256(readFileSync(p));
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(readText(p));

function loadCsv(path, columns) {
  const { header, records } = parseCsv(readText(path));
  const missing = columns.filter((c) => !header.includes(c));
  const extra = header.filter((c) => !columns.includes(c));
  if (missing.length || extra.length) fail(`${path}: columns must match the template exactly (missing: ${missing.join(',') || '-'}; extra: ${extra.join(',') || '-'})`);
  return records;
}
function writeOnce(path, content) {
  if (existsSync(path)) fail(`${path} already exists — outputs are write-once (no re-roll). Use a new output path.`);
  writeFileSync(path, content);
}
function newDir(dir) {
  if (existsSync(dir)) fail(`${dir} already exists — draws are write-once`);
  mkdirSync(dir, { recursive: true });
}

const rowHash = (r) => sha256(canonicalJson(r));
const frameRowHashes = (frame) => Object.fromEntries(frame.map((r) => [r.candidate_id, rowHash(r)]));

/** Load + validate the frame; refuse on MALFORMED rows and on duplicate candidate_id. */
function loadFrame(o) {
  const frame = loadCsv(need(o, 'frame'), FRAME_COLUMNS);
  const allowSynthetic = o['allow-synthetic'] === true;
  const seen = new Set();
  const checked = frame.map((r) => {
    const res = checkFrameRow(r, { allowSynthetic });
    if (seen.has(r.candidate_id)) res.errors.push('duplicate candidate_id');
    seen.add(r.candidate_id);
    return { r, res };
  });
  return { frame, checked, frameHash: hashRecords(frame, 'candidate_id') };
}

/** Bind scan → frame → registry; merge every contamination source into one basis map. */
function contamination(o, frame, checked, frameHash) {
  const scanPath = need(o, 'scan');
  const scan = readJson(scanPath);
  const registryPath = need(o, 'registry');
  if (scan.frame_hash !== frameHash) fail('scan was produced for a different frame (frame_hash mismatch) — re-scan the exact frame');
  if (scan.registry_sha256 !== fileSha(registryPath)) fail('scan was produced with a different development-only registry — re-scan');
  const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
  const basis = {};
  for (const { r, res } of checked) {
    const b = [];
    const s = byId.get(r.candidate_id);
    if (!s) fail(`scan has no result for ${r.candidate_id}`);
    if (s.repository_hits.length) b.push(`CPG-C1(1) repository: ${s.repository_hits.length} hit(s), e.g. ${s.repository_hits[0].scope} ${s.repository_hits[0].file}:${s.repository_hits[0].line}`);
    for (const m of s.registry_matches) b.push(`CPG-C1(6) development-only registry ${m.entry_id} (${m.matched})`);
    b.push(...(res.contamination || []));
    if (b.length) basis[r.candidate_id] = b;
  }
  return { scan, scanSha: fileSha(scanPath), registrySha: fileSha(registryPath), basis, ineligible: new Set(Object.keys(basis)) };
}

function refuseMalformed(checked) {
  const bad = checked.filter((x) => x.res.errors.length);
  if (bad.length) fail(`${bad.length} malformed frame row(s) — run "frame" and fix before drawing`);
}

const entry = (c, split, basis) => ({
  candidate_id: c.candidate_id, company_name: c.company_name, canonical_domain: c.canonical_domain,
  jurisdiction_family: c.jurisdiction_family, identifier_scheme: c.identifier_scheme, identifier_value: c.identifier_value,
  wikidata_qid: c.wikidata_qid, stratum: c.expected_outcome_class, split, held_out_ineligible_basis: basis[c.candidate_id] ?? [],
});

const LOG_COLUMNS = ['candidate_id', 'company_name', 'canonical_domain', 'jurisdiction', 'identifier_scheme', 'decisive_identifier',
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'held_out_eligible', 'held_out_ineligible_basis', 'admitted', 'exclusion_reason',
  'stratum', 'split', 'stage', 'screened_by', 'screened_at', 'frame_hash'];

function screeningLog(checked, split, basis, stage, screenedBy, frameHash) {
  return checked.map(({ r, res }) => {
    const admitted = res.exclusion === null;
    const s = split.get(r.candidate_id) ?? 'none';
    const ineligible = !!basis[r.candidate_id];
    let reason = admitted ? '' : res.exclusion;
    if (admitted && s === 'none') reason = ineligible ? 'DEVELOPMENT_SURPLUS' : 'NOT_DRAWN';
    return {
      candidate_id: r.candidate_id, company_name: r.company_name, canonical_domain: r.canonical_domain,
      jurisdiction: r.jurisdiction_family, identifier_scheme: r.identifier_scheme, decisive_identifier: r.identifier_value,
      a1: res.admissibility.A1, a2: res.admissibility.A2, a3: res.admissibility.A3, a4: res.admissibility.A4,
      a5: res.admissibility.A5, a6: res.admissibility.A6, held_out_eligible: ineligible ? 'no' : 'yes',
      held_out_ineligible_basis: (basis[r.candidate_id] ?? []).join(' ; '), admitted: admitted ? 'yes' : 'no',
      exclusion_reason: reason, stratum: r.expected_outcome_class, split: s, stage, screened_by: screenedBy,
      screened_at: today(), frame_hash: frameHash,
    };
  });
}

// ── registration, identity and hash bindings ────────────────────────────────
function reportRegistrationCheck({ errors, blockers }) {
  for (const e of errors) console.error(`  ERROR   ${e}`);
  for (const b of blockers) console.error(`  BLOCKED ${b}`);
  if (errors.length) fail(`registration record refused (${errors.length} error(s))`);
  if (blockers.length) fail(`BLOCKED — ${blockers.length} named prerequisite(s) missing; the tooling will not invent them`, EXIT.BLOCKED);
}

/**
 * A complete, authoritative registration whose protocol and tooling hashes match the files in use.
 * Every sampling command passes through here first.
 */
function registered(o) {
  const allowSynthetic = o['allow-synthetic'] === true;
  const reg = readJson(need(o, 'registration'));
  reportRegistrationCheck(checkRegistration(reg, { phase: 'registered', allowSynthetic }));
  if (fileSha(need(o, 'protocol')) !== reg.protocol_sha256) fail('VERIFY_ABORT_HASH_MISMATCH: --protocol does not hash to the registered protocol_sha256');
  const aggregate = toolingManifest(ROOT).aggregate;
  if (aggregate !== reg.tooling_aggregate_sha256) fail(`VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ${aggregate}) is not the registered tooling`);
  let voidReason;
  try { voidReason = checkAuthority(reg, readJson(need(o, 'identity-registrations'))); } catch (e) { fail(`identity registration list refused: ${e.message}`); }
  if (voidReason) fail(`STUDY_VOID_REGISTRATION: ${voidReason}`, EXIT.VOID);
  return { reg, allowSynthetic };
}

const isVoid = (state) => state.startsWith('STUDY_') || state.startsWith('STAGE_');
const stateExit = (state) => (state === STATE.FINAL ? 0 : isVoid(state) ? EXIT.VOID : EXIT.WAITING);

function evaluate(reg, ev, stage, opts) {
  try { return evaluateStage(reg, ev, stage, opts); } catch (e) {
    if (e instanceof EvidenceError) fail(`VERIFY_ABORT_EVIDENCE: ${e.message}`);
    throw e;
  }
}

/** Evaluate a stage from --evidence; exit unless FINAL. */
function finalStage(reg, o, stage, allowSynthetic, priorFinal) {
  const res = evaluate(reg, readJson(need(o, 'evidence')), stage, { allowSynthetic, priorFinal });
  if (res.state !== STATE.FINAL) fail(`${stage} sampling event is ${res.state}: ${res.reason} — nothing drawn`, stateExit(res.state));
  return res;
}

// ── frame ───────────────────────────────────────────────────────────────────
function cmdFrame(o) {
  const { frame, checked, frameHash } = loadFrame(o);
  let malformed = 0; const tally = {}; let attestedIneligible = 0;
  for (const { r, res } of checked) {
    if (res.errors.length) { malformed++; console.log(`  MALFORMED ${r.candidate_id}: ${res.errors.join('; ')}`); continue; }
    tally[res.exclusion ?? 'ADMISSIBLE'] = (tally[res.exclusion ?? 'ADMISSIBLE'] ?? 0) + 1;
    if (res.contamination.length) attestedIneligible++;
  }
  console.log(`frame rows: ${frame.length}  malformed: ${malformed}`);
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(32)} ${v}`);
  console.log(`  held-out-ineligible by attestation (before scan/registry): ${attestedIneligible}`);
  console.log(`frame_hash: ${frameHash}`);
  if (malformed) process.exit(1);
}

// ── scan: CPG-C1(1) repository + CPG-C1(6) registry ─────────────────────────
function cmdScan(o) {
  const repo = resolve(need(o, 'repo'));
  const expectSha = need(o, 'expect-sha');
  const registryPath = need(o, 'registry');
  const out = need(o, 'out');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const head = git('rev-parse', 'HEAD').trim();
  if (head !== expectSha) fail(`repo HEAD ${head} != --expect-sha ${expectSha} (contamination is assessed at the FROZEN resolver SHA)`);
  if (git('status', '--porcelain').trim()) fail('repo has working-tree changes — scan a clean clone only');

  const frame = loadCsv(need(o, 'frame'), FRAME_COLUMNS);
  const registry = readJson(registryPath);
  const files = git('ls-files', '-z').split('\0').filter(Boolean).map((f) => ({ f, scope: scanScope(f) })).filter((x) => x.scope);
  const state = new Map(frame.map((r) => [r.candidate_id, { r, tokens: tokensFor(r), hits: [] }]));
  const scopeCount = { TEST: 0, CPG_IMPLEMENTATION: 0 };
  for (const { f, scope } of files) {
    const p = join(repo, f);
    let st; try { st = statSync(p); } catch { continue; }
    if (!st.isFile() || st.size > 5 * 1024 * 1024) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue;
    scopeCount[scope]++;
    const text = buf.toString('utf8');
    for (const c of state.values()) for (const h of scanText(text, c.tokens)) c.hits.push({ ...h, file: f, scope });
  }
  const results = [...state.values()].map((c) => {
    const registry_matches = registryMatches(c.r, registry);
    return { candidate_id: c.candidate_id ?? c.r.candidate_id, repository_hits: c.hits, registry_matches,
      held_out_ineligible_by_scan: c.hits.length > 0 || registry_matches.length > 0 };
  });
  const report = {
    tool: TOOL_VERSION, rules: ['CPG-C1(1) repository scope D-D', 'CPG-C1(6) development-only registry'],
    repo_sha: head, frame_hash: hashRecords(frame, 'candidate_id'), registry_sha256: fileSha(registryPath),
    files_scanned: scopeCount, results,
  };
  writeOnce(out, JSON.stringify(report, null, 2) + '\n');
  const flagged = results.filter((x) => x.held_out_ineligible_by_scan);
  console.log(`scanned TEST=${scopeCount.TEST} CPG_IMPLEMENTATION=${scopeCount.CPG_IMPLEMENTATION} files at ${head}`);
  console.log(`held-out-ineligible by scan/registry: ${flagged.length} of ${results.length}`);
  for (const x of flagged) {
    const why = x.registry_matches.length ? `registry ${x.registry_matches.map((m) => m.entry_id).join(',')}` : '';
    const rep = x.repository_hits.length ? `${x.repository_hits.length} repo hit(s), e.g. ${x.repository_hits[0].file}:${x.repository_hits[0].line}` : '';
    console.log(`  ${x.candidate_id}: ${[why, rep].filter(Boolean).join(' | ')}`);
  }
  console.log(`scan_sha256: ${fileSha(out)}`);
}

// ── registration-fields / check-funding-prerequisites / verify-protocol / verify-registration ──
function cmdRegistrationFields(o) {
  const t = registrationTemplate({ protocolSha: fileSha(need(o, 'protocol')), toolingAggregate: toolingManifest(ROOT).aggregate, registrySha: fileSha(need(o, 'registry')) });
  writeOnce(need(o, 'out'), JSON.stringify(t, null, 2) + '\n');
  console.log('registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED');
  console.log(`tooling_aggregate_sha256: ${t.tooling_aggregate_sha256}`);
}

function cmdCheckFundingPrerequisites(o) {
  const reg = readJson(need(o, 'registration'));
  reportRegistrationCheck(checkRegistration(reg, { phase: 'funding', allowSynthetic: o['allow-synthetic'] === true }));
  console.log('funding prerequisites present: key custodian assigned (role STUDY_OPERATOR); parameters match the pinned values.');
  console.log('The tooling creates no key and no transaction. Funding is an external act outside this tool.');
}

/** Normative strings the governing protocol must state, so the protocol and the tooling cannot silently diverge. */
const PROTOCOL_MARKERS = [PROTOCOL_VERSION, STUDY_ID, 'D = 6', 'K = 12', '180 days', 'Δ = 3 h', '30 days', QUICKNET.hash,
  'bls-unchained-g1-rfc9380', SEED_DOMAIN, 'cpg-u1-commitment-digest/v1', PAYLOAD_SCHEMA, 'OSF Registries', 'STUDY_OPERATOR', 'UNASSIGNED',
  'cpg-u1-rater-order/v1', 'cpg-u1-execution-authorization/v1', 'E ≥ 126 / 52 / 32', CITED_URL_RULE, EVALUATION_TREE_DOMAIN];

function cmdVerifyProtocol(o) {
  const text = readText(need(o, 'protocol'));
  const missing = PROTOCOL_MARKERS.filter((m) => !text.includes(m));
  if (missing.length) fail(`protocol does not state: ${missing.join(' | ')}`);
  const sha = fileSha(o.protocol);
  if (o.registration && o.registration !== true && readJson(o.registration).protocol_sha256 !== sha) fail('VERIFY_ABORT_HASH_MISMATCH: protocol differs from the registered protocol_sha256');
  console.log(`protocol states every pinned parameter; protocol_sha256: ${sha}`);
}

function cmdVerifyRegistration(o) {
  const { reg, allowSynthetic } = registered(o);
  if (fileSha(need(o, 'registry')) !== reg.registry_sha256) fail('VERIFY_ABORT_HASH_MISMATCH: development-only registry differs from the registered registry_sha256');
  if (o.evidence && o.evidence !== true) {
    const r = evaluate(reg, readJson(o.evidence), 'development', { allowSynthetic });
    if (r.state === STATE.VOID_REGISTRATION || r.state === STATE.VOID_PRE_REGISTRATION_SPEND) fail(`${r.state}: ${r.reason}`, EXIT.VOID);
    console.log('funding outputs verified against the registered checkpoint');
  }
  console.log(`registration ${reg.registration_id} complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match`);
}

// ── verify-archive ──────────────────────────────────────────────────────────
function cmdVerifyArchive(o) {
  let params;
  try { params = networkParams(need(o, 'network'), { allowSynthetic: o['allow-synthetic'] === true }); } catch (e) { fail(e.message); }
  const checkpoint = { height: Number(need(o, 'checkpoint-height')), hash: need(o, 'checkpoint-hash') };
  try {
    const a = verifyArchive(readJson(need(o, 'archive')), checkpoint, params);
    const b = verifyArchive(readJson(need(o, 'crosscheck')), checkpoint, params);
    const r = crosscheckArchives(a, b);
    console.log(`archive valid ${a.startHeight}..${a.tipHeight}; crosscheck valid ${b.startHeight}..${b.tipHeight}; agree over ${r.from}..${r.to}`);
  } catch (e) { fail(`archive refused: ${e.message}`); }
}

// ── commitment-payload ──────────────────────────────────────────────────────
function cmdCommitmentPayload(o) {
  const stage = need(o, 'stage');
  if (!['development', 'held-out'].includes(stage)) fail('--stage must be development|held-out');
  const { reg, allowSynthetic } = registered(o);
  let payload;
  if (stage === 'development') {
    const { frame, checked, frameHash } = loadFrame(o);
    refuseMalformed(checked);
    const c = contamination(o, frame, checked, frameHash);
    if (c.registrySha !== reg.registry_sha256) fail('development-only registry differs from the registered registry_sha256');
    const suff = sufficiencyOf(checked, c);
    if (!suff.ok) fail(`FRAME_INSUFFICIENT: no development commitment may be made — ${describeShortfall(suff)}`);
    payload = { schema: PAYLOAD_SCHEMA, study_id: STUDY_ID, stage, registration_id: reg.registration_id, protocol_sha256: reg.protocol_sha256,
      tooling_aggregate_sha256: reg.tooling_aggregate_sha256, registry_sha256: c.registrySha, frame_hash: frameHash, scan_sha256: c.scanSha,
      outpoint: reg.outpoints.development, binding: null };
  } else {
    const h = heldOutInputs(o);
    const dev = finalStage(reg, o, 'development', allowSynthetic, { development: h.dev.sampling });
    if (canonicalJson(dev.record) !== canonicalJson(h.dev.sampling)) fail('VERIFY_ABORT_SEED_MISMATCH: development manifest sampling record differs from the chain-verified development event');
    payload = { schema: PAYLOAD_SCHEMA, study_id: STUDY_ID, stage, registration_id: reg.registration_id, protocol_sha256: reg.protocol_sha256,
      tooling_aggregate_sha256: reg.tooling_aggregate_sha256, registry_sha256: h.c.registrySha, frame_hash: h.frameHash, scan_sha256: h.c.scanSha,
      outpoint: reg.outpoints['held-out'],
      binding: {
        development_commitment_txid: dev.record.commitment_txid, development_payload_digest: dev.record.payload_digest,
        development_manifest_sha256: fileSha(h.devPath), development_frame_hash: h.dev.frame_hash, pilot_result_sha256: h.sizing.pilot_sha256,
        sizing_sha256: fileSha(h.sizingPath), append_only_proof: h.appendOnly,
      } };
  }
  const errors = checkPayload(payload);
  if (errors.length) fail(`payload invalid: ${errors.join('; ')}`);
  writeOnce(need(o, 'out'), JSON.stringify(payload, null, 2) + '\n');
  const digest = payloadDigest(payload);
  console.log(`payload_digest: ${digest}`);
  console.log(`op_return_script: ${encodeCommitmentScript(stage, digest).toString('hex')}`);
  console.log(`Spend ONLY ${payload.outpoint}, with exactly this one OP_RETURN output. The tooling creates no transaction.`);
}

// ── verify-sampling / verify-commitment / derive-seed ───────────────────────
function evaluateFromArgs(o) {
  const { reg, allowSynthetic } = registered(o);
  const stage = need(o, 'stage');
  if (!['development', 'held-out'].includes(stage)) fail('--stage must be development|held-out');
  const prior = o['prior-final'] && o['prior-final'] !== true ? readJson(o['prior-final']) : undefined;
  return evaluate(reg, readJson(need(o, 'evidence')), stage, { allowSynthetic, priorFinal: prior });
}

function cmdVerifySampling(o) {
  const r = evaluateFromArgs(o);
  console.log(JSON.stringify({ stage: r.stage, state: r.state, reason: r.reason, record: r.record ?? null }, null, 2));
  process.exit(stateExit(r.state));
}

const COMMITMENT_VALID_STATES = new Set([STATE.WAITING_RANDOMNESS_DEPTH, STATE.WAITING_DRAND, STATE.VOID_RANDOMNESS, STATE.VOID_REORG, STATE.FINAL]);
function cmdVerifyCommitment(o) {
  const r = evaluateFromArgs(o);
  if (COMMITMENT_VALID_STATES.has(r.state)) {
    console.log(`${r.stage} commitment valid, confirmed ≥ ${D} (sampling state ${r.state})`);
    process.exit(0);
  }
  console.log(`${r.stage} commitment not valid or not yet confirmed: ${r.state} — ${r.reason}`);
  process.exit(stateExit(r.state));
}

function cmdDeriveSeed(o) {
  const r = evaluateFromArgs(o);
  if (r.state !== STATE.FINAL) fail(`${r.stage} is ${r.state}: ${r.reason} — no seed exists`, stateExit(r.state));
  const x = r.record;
  console.log(`derivation: ${SEED_DOMAIN}|${x.stage}|${x.payload_digest}|${x.commitment_txid}|${x.commitment_height}|${x.randomness_height}|${x.randomness_block_hash}|${x.drand_chain_hash}|${x.drand_round}|${x.drand_randomness}`);
  console.log(`seed_fingerprint: ${x.seed_fingerprint}`);
  console.log('The seed itself is not printed; the draw commands recompute it internally.');
}

// ── draw-development ────────────────────────────────────────────────────────
function cmdDrawDevelopment(o) {
  const { reg, allowSynthetic } = registered(o);
  const { frame, checked, frameHash } = loadFrame(o);
  refuseMalformed(checked);
  const c = contamination(o, frame, checked, frameHash);
  const prior = o['prior-final'] && o['prior-final'] !== true ? readJson(o['prior-final']) : undefined;
  const res = finalStage(reg, o, 'development', allowSynthetic, prior);
  const p = res.payload;
  if (p.frame_hash !== frameHash) fail('VERIFY_ABORT_HASH_MISMATCH: frame hash differs from the committed frame_hash — the draw is impossible');
  if (p.scan_sha256 !== c.scanSha) fail('VERIFY_ABORT_HASH_MISMATCH: scan differs from the committed scan_sha256');
  if (p.registry_sha256 !== c.registrySha) fail('VERIFY_ABORT_HASH_MISMATCH: registry differs from the committed registry_sha256');
  const suffDraw = sufficiencyOf(checked, c);
  if (!suffDraw.ok) fail(`STAGE_VOID_FRAME_INSUFFICIENT: the committed frame was insufficient — ${describeShortfall(suffDraw)}`, EXIT.VOID);
  const admissible = checked.filter((x) => x.res.exclusion === null).map((x) => x.r);
  let result;
  try { result = drawDevelopment(admissible, c.ineligible, res.seed); } catch (e) { fail(e.message); }
  if (!result.ok) {
    console.error('DEVELOPMENT POOL BELOW MINIMUM — nothing written. The committed frame cannot supply the development quota:');
    for (const s of result.shortfall) console.error(`  ${s.class}: quota ${s.quota}, pool required ${s.pool_required}, available ${s.pool_available}`);
    process.exit(2);
  }
  const outDir = need(o, 'out'); newDir(outDir);
  const split = new Map(result.development.map((x) => [x.candidate_id, 'development']));
  const manifest = {
    manifest_version: 3, tool: TOOL_VERSION, stage: 'development', status: 'DRAWN — NOT EXECUTED',
    study_id: STUDY_ID, registration_id: reg.registration_id, protocol_sha256: reg.protocol_sha256, tooling_aggregate_sha256: reg.tooling_aggregate_sha256,
    resolver_sha: c.scan.repo_sha, registry_sha256: c.registrySha,
    frame_hash: frameHash, frame_row_hashes: frameRowHashes(frame), scan_sha256: c.scanSha,
    sampling: res.record, quotas: DEVELOPMENT_QUOTA,
    counts: { frame: frame.length, admissible: admissible.length, held_out_ineligible: c.ineligible.size, development: result.development.length },
    development: result.development.map((x) => entry(x, 'development', c.basis)),
  };
  writeOnce(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeOnce(join(outDir, 'screening_log.csv'), toCsv(LOG_COLUMNS, screeningLog(checked, split, c.basis, 'development', need(o, 'screened-by'), frameHash)));
  console.log(`development: ${result.development.length}`);
  console.log(`seed_fingerprint:     ${res.record.seed_fingerprint}`);
  console.log(`manifest_sha256:      ${fileSha(join(outDir, 'manifest.json'))}`);
  console.log(`screening_log_sha256: ${fileSha(join(outDir, 'screening_log.csv'))}`);
}

// ── size ────────────────────────────────────────────────────────────────────
function cmdSize(o) {
  const devPath = need(o, 'dev-manifest');
  const dev = readJson(devPath);
  if (dev.stage !== 'development') fail('--dev-manifest is not a development manifest');
  const pilot = readJson(need(o, 'pilot'));
  if (pilot.dev_manifest_sha256 !== fileSha(devPath)) fail('pilot was not produced against this development manifest (dev_manifest_sha256 mismatch)');
  if (pilot.resolver_sha !== dev.resolver_sha) fail('pilot resolver_sha differs from the frozen resolver SHA');
  const ids = new Set(dev.development.filter((e) => e.stratum === 'fill-expected').map((e) => e.candidate_id));
  const res = heldOutQuotas(pilot, ids);
  if (!res.ok) fail(res.error, res.halt ? 3 : 1);
  const sizing = { sizing_version: 1, tool: TOOL_VERSION, dev_manifest_sha256: fileSha(devPath), pilot_sha256: fileSha(o.pilot), ...res };
  writeOnce(need(o, 'out'), JSON.stringify(sizing, null, 2) + '\n');
  console.log(`held-out quotas: ${canonicalJson(res.quotas)}  (yield/company ${res.yield_per_company.toFixed(3)}, raw ${res.raw_fill_expected}${res.capped ? ', CAPPED' : ''})`);
}

function heldOutInputs(o) {
  const { frame, checked, frameHash } = loadFrame(o);
  refuseMalformed(checked);
  const devPath = need(o, 'dev-manifest');
  const dev = readJson(devPath);
  if (dev.stage !== 'development') fail('--dev-manifest is not a development manifest');
  let appendOnly;
  try { appendOnly = appendOnlyProof(dev.frame_row_hashes, dev.frame_hash, frameRowHashes(frame), frameHash); } catch (e) { fail(e.message); }
  if (frameHash !== dev.frame_hash) fail('FRAME_CHANGED: held-out frame_hash differs from the development frame_hash — the single frame is frozen before the development commitment (no additions after sizing)');
  const sizingPath = need(o, 'sizing');
  const sizing = readJson(sizingPath);
  if (sizing.dev_manifest_sha256 !== fileSha(devPath)) fail('sizing was not computed from this development manifest');
  const c = contamination(o, frame, checked, frameHash);
  if (c.registrySha !== dev.registry_sha256) fail('REGISTRY_CHANGED: development-only registry differs from the registered registry used at the development stage — the registry is frozen at registration for both stages');
  if (c.scanSha !== dev.scan_sha256) fail('SCAN_CHANGED: scan differs from the development-committed scan — eligibility is fixed before any CPG outcome');
  const admissible = checked.filter((x) => x.res.exclusion === null).map((x) => x.r);
  const devIds = new Set(dev.development.map((e) => e.candidate_id));
  return { frame, checked, frameHash, dev, devPath, sizing, sizingPath, c, admissible, devIds, appendOnly };
}

// ── pool-check (no randomness) ──────────────────────────────────────────────
function cmdPoolCheck(o) {
  const { admissible, c, devIds, sizing } = heldOutInputs(o);
  const pool = admissible.filter((x) => !c.ineligible.has(x.candidate_id) && !devIds.has(x.candidate_id));
  const shortfall = poolShortfall(pool, sizing.quotas);
  for (const cls of Object.keys(sizing.quotas)) {
    const have = pool.filter((x) => x.expected_outcome_class === cls).length;
    console.log(`  ${cls.padEnd(22)} quota ${sizing.quotas[cls]}  pool ${have}  required ${2 * sizing.quotas[cls]}`);
  }
  if (shortfall.length) { console.error('HELD-OUT POOL BELOW MINIMUM — impossible for a frame that met the sufficiency rule; the frame cannot be extended'); process.exit(2); }
  console.log('pool sufficient — the held-out commitment payload may now be created');
}

// ── draw-held-out ───────────────────────────────────────────────────────────
function cmdDrawHeldOut(o) {
  const { reg, allowSynthetic } = registered(o);
  const { frame, checked, frameHash, dev, devPath, sizing, sizingPath, c, admissible, devIds, appendOnly } = heldOutInputs(o);
  const res = finalStage(reg, o, 'held-out', allowSynthetic, { development: dev.sampling });
  if (canonicalJson(res.developmentRecord) !== canonicalJson(dev.sampling)) fail('VERIFY_ABORT_SEED_MISMATCH: development manifest sampling record differs from the chain-verified development event');
  const p = res.payload;
  if (p.frame_hash !== frameHash) fail('VERIFY_ABORT_HASH_MISMATCH: frame hash differs from the committed frame_hash — the draw is impossible');
  if (p.scan_sha256 !== c.scanSha) fail('VERIFY_ABORT_HASH_MISMATCH: scan differs from the committed scan_sha256');
  if (p.registry_sha256 !== c.registrySha) fail('VERIFY_ABORT_HASH_MISMATCH: registry differs from the committed registry_sha256');
  const b = p.binding;
  const bad = [
    [b.development_manifest_sha256 === fileSha(devPath), 'development_manifest_sha256'],
    [b.development_frame_hash === dev.frame_hash, 'development_frame_hash'],
    [b.pilot_result_sha256 === sizing.pilot_sha256, 'pilot_result_sha256'],
    [b.sizing_sha256 === fileSha(sizingPath), 'sizing_sha256'],
    [canonicalJson(b.append_only_proof) === canonicalJson(appendOnly), 'append_only_proof'],
  ].filter(([okay]) => !okay).map(([, k]) => k);
  if (bad.length) fail(`${STATE.VOID_BINDING}: committed held-out binding differs from the supplied development artifacts (${bad.join(', ')})`, EXIT.VOID);
  if (res.record.seed_fingerprint === dev.sampling.seed_fingerprint) fail('held-out seed must differ from the development seed');
  let result;
  try { result = drawHeldOut(admissible, c.ineligible, devIds, res.seed, sizing.quotas); } catch (e) { fail(e.message); }
  if (!result.ok) {
    console.error('HELD-OUT POOL BELOW MINIMUM — nothing written:');
    for (const s of result.shortfall) console.error(`  ${s.class}: quota ${s.quota}, pool required ${s.pool_required}, available ${s.pool_available}`);
    process.exit(2);
  }
  const outDir = need(o, 'out'); newDir(outDir);
  const split = new Map([...dev.development.map((e) => [e.candidate_id, 'development']), ...result.heldOut.map((x) => [x.candidate_id, 'held-out'])]);
  const manifest = {
    manifest_version: 3, tool: TOOL_VERSION, stage: 'held-out', status: 'DRAWN — NOT EXECUTED',
    study_id: STUDY_ID, registration_id: reg.registration_id, protocol_sha256: reg.protocol_sha256, tooling_aggregate_sha256: reg.tooling_aggregate_sha256,
    resolver_sha: c.scan.repo_sha, registry_sha256: c.registrySha,
    frame_hash: frameHash, scan_sha256: c.scanSha, dev_manifest_sha256: fileSha(devPath), sizing_sha256: fileSha(sizingPath),
    sampling: res.record, quotas: sizing.quotas,
    counts: { frame: frame.length, admissible: admissible.length, held_out_ineligible: c.ineligible.size, held_out: result.heldOut.length },
    held_out: result.heldOut.map((x) => entry(x, 'held-out', c.basis)),
  };
  writeOnce(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeOnce(join(outDir, 'screening_log.csv'), toCsv(LOG_COLUMNS, screeningLog(checked, split, c.basis, 'held-out', need(o, 'screened-by'), frameHash)));
  console.log(`held-out: ${result.heldOut.length}`);
  console.log(`seed_fingerprint:     ${res.record.seed_fingerprint}`);
  console.log(`manifest_sha256:      ${fileSha(join(outDir, 'manifest.json'))}`);
  console.log(`screening_log_sha256: ${fileSha(join(outDir, 'screening_log.csv'))}`);
}

// ── reconcile + seal ────────────────────────────────────────────────────────
function reconcileFrom(o, devManifest, hoManifest) {
  const author = loadCsv(need(o, 'author'), BLIND_RECORD_COLUMNS);
  const confirmer = loadCsv(need(o, 'confirmer'), BLIND_RECORD_COLUMNS);
  const adjudication = o.adjudication && o.adjudication !== true ? loadCsv(o.adjudication, ADJUDICATION_COLUMNS) : [];
  return reconcile([...devManifest.development, ...hoManifest.held_out], author, confirmer, adjudication);
}

function cmdReconcile(o) {
  const dev = readJson(need(o, 'dev-manifest'));
  const ho = readJson(need(o, 'held-out-manifest'));
  const { errors, rows, stratumMismatches } = reconcileFrom(o, dev, ho);
  console.log(`reconciled rows: ${rows.length}  errors: ${errors.length}  stratum mismatches: ${stratumMismatches.length}`);
  for (const e of errors.slice(0, 200)) console.log(`  ${e}`);
  if (errors.length) process.exit(1);
  writeOnce(need(o, 'out'), toCsv(REFERENCE_COLUMNS, rows));
  console.log(`reference_file_sha256: ${fileSha(o.out)}`);
}

function cmdSeal(o) {
  const devDir = need(o, 'dev-dir'); const hoDir = need(o, 'held-out-dir');
  const devPath = join(devDir, 'manifest.json'); const hoPath = join(hoDir, 'manifest.json');
  const dev = readJson(devPath); const ho = readJson(hoPath);
  if (ho.dev_manifest_sha256 !== fileSha(devPath)) fail('held-out manifest was not drawn after this development manifest');
  const sizingPath = need(o, 'sizing');
  if (ho.sizing_sha256 !== fileSha(sizingPath)) fail('sizing file does not match the one the held-out draw used');
  const { errors, rows, stratumMismatches } = reconcileFrom(o, dev, ho);
  if (errors.length) fail(`reference truth has ${errors.length} error(s) — a dataset is never sealed with errors`);
  const refPath = need(o, 'reference');
  if (readText(refPath) !== toCsv(REFERENCE_COLUMNS, rows)) fail('--reference is not byte-identical to the reconciliation of the blind records — reference truth must come from reconcile, never be hand-edited');
  const seal = {
    seal_version: 3, tool: TOOL_VERSION, status: 'DATASET SEALED — NOT EXECUTED',
    study_id: STUDY_ID, registration_id: ho.registration_id, protocol_sha256: ho.protocol_sha256, tooling_aggregate_sha256: ho.tooling_aggregate_sha256,
    resolver_sha: ho.resolver_sha, registry_sha256: ho.registry_sha256,
    development: { manifest_sha256: fileSha(devPath), screening_log_sha256: fileSha(join(devDir, 'screening_log.csv')), sampling_record_sha256: dev.sampling.record_sha256, frame_hash: dev.frame_hash },
    held_out: { manifest_sha256: fileSha(hoPath), screening_log_sha256: fileSha(join(hoDir, 'screening_log.csv')), sampling_record_sha256: ho.sampling.record_sha256, frame_hash: ho.frame_hash, quotas: ho.quotas },
    sizing_sha256: fileSha(sizingPath),
    blind_records: { author_sha256: fileSha(o.author), confirmer_sha256: fileSha(o.confirmer), adjudication_sha256: o.adjudication && o.adjudication !== true ? fileSha(o.adjudication) : null },
    reference_file_sha256: fileSha(refPath), reference_hash: hashRecords(rows.map((r) => ({ ...r, _k: `${r.candidate_id}|${r.field}` })), '_k'),
    resolutions: rows.reduce((m, r) => ({ ...m, [r.resolution]: (m[r.resolution] ?? 0) + 1 }), {}),
    stratum_mismatches: stratumMismatches, sealed_on: today(),
  };
  seal.seal_hash = sha256(canonicalJson(seal));
  writeOnce(need(o, 'out'), JSON.stringify(seal, null, 2) + '\n');
  console.log(`seal_hash: ${seal.seal_hash}`);
  console.log('Give the OPERATOR only this seal hash. The reference file stays with the reference team until execution completes.');
}

// ── Protocol-004: frame sufficiency (§5.7.2) ────────────────────────────────
function sufficiencyOf(checked, c) {
  const admissible = checked.filter((x) => x.res.exclusion === null).map((x) => x.r);
  try { return frameSufficiency(admissible, c.ineligible); } catch (e) { fail(`FRAME_INVALID: ${e.message}`); }
}
const describeShortfall = (s) => s.shortfall.map((x) => `${x.class} eligible ${x.eligible_admissible} < required ${x.required}`).join('; ');

function cmdCheckFrameSufficiency(o) {
  const { frame, checked, frameHash } = loadFrame(o);
  refuseMalformed(checked);
  const c = contamination(o, frame, checked, frameHash);
  const s = sufficiencyOf(checked, c);
  for (const k of Object.keys(FRAME_MINIMUM)) console.log(`  ${k.padEnd(22)} eligible admissible ${s.counts[k]}  required ${FRAME_MINIMUM[k]}`);
  if (!s.ok) fail(`FRAME_INSUFFICIENT: ${describeShortfall(s)}`);
  console.log(`frame sufficient for every permitted pilot outcome; frame_hash ${frameHash}`);
}

// ── Protocol-004: rater order (§12.1) ───────────────────────────────────────
function sealedHeldOut(o) {
  const hoPath = need(o, 'held-out-manifest');
  const ho = readJson(hoPath);
  const seal = readJson(need(o, 'seal'));
  if (ho.stage !== 'held-out') fail('--held-out-manifest is not a held-out manifest');
  if (seal.held_out?.manifest_sha256 !== fileSha(hoPath)) fail('RATER_ORDER_SUBSTITUTION: seal does not bind this held-out manifest');
  let recordSha;
  try { recordSha = recomputeRecordSha(ho.sampling); } catch (e) { fail(`RATER_ORDER_SUBSTITUTION: ${e.message}`); }
  if (seal.held_out.sampling_record_sha256 !== recordSha) fail('RATER_ORDER_SUBSTITUTION: sampling record differs from the sealed held-out record');
  return { ho, recordSha };
}
const heldOutObservations = (ho) => ho.held_out.flatMap((e) => FIELDS.map((field) => ({ candidate_id: e.candidate_id, field })));

function cmdRaterOrder(o) {
  const label = need(o, 'label');
  if (!['rater-1', 'rater-2', 'rating-adjudicator'].includes(label)) fail('--label must be one of rater-1|rater-2|rating-adjudicator');
  const { ho, recordSha } = sealedHeldOut(o);
  const art = orderArtifact(recordSha, label, heldOutObservations(ho));
  writeOnce(need(o, 'out'), JSON.stringify(art, null, 2) + '\n');
  console.log(`order_sha256: ${art.order_sha256}  (${art.items.length} items, label ${label})`);
}

function cmdVerifyRaterOrder(o) {
  const { ho, recordSha } = sealedHeldOut(o);
  const given = readJson(need(o, 'order'));
  let expected;
  try { expected = orderArtifact(recordSha, given.label, heldOutObservations(ho)); } catch (e) { fail(`RATER_ORDER_SUBSTITUTION: ${e.message}`); }
  if (canonicalJson(given) !== canonicalJson(expected)) fail('RATER_ORDER_SUBSTITUTION: order does not equal the derivation from the sealed held-out record');
  console.log(`rater order verified: ${expected.order_sha256}`);
}

// ── Protocol-004: blinded reference adjudication (§9.2.1) ────────────────────
function referenceInputs(o) {
  const { ho, recordSha } = sealedHeldOut(o);
  const dev = readJson(need(o, 'dev-manifest'));
  return { entries: [...dev.development, ...ho.held_out], author: loadCsv(need(o, 'author'), BLIND_RECORD_COLUMNS), confirmer: loadCsv(need(o, 'confirmer'), BLIND_RECORD_COLUMNS), recordSha };
}

function cmdReferenceAdjudicationPacket(o) {
  let packet;
  try { packet = buildReferenceAdjudicationPacket(referenceInputs(o)); } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), JSON.stringify(packet, null, 2) + '\n');
  console.log(`reference adjudication packet: ${packet.items.length} disagreeing item(s); no class, split, CPG output or recorder identity`);
}

function cmdVerifyAdjudicationPacket(o) {
  const type = need(o, 'type');
  const packet = readJson(need(o, 'packet'));
  let errors;
  try {
    if (type === 'reference') errors = checkReferenceAdjudicationPacket(packet, referenceInputs(o));
    else if (type === 'rating') {
      const { recordSha } = sealedHeldOut(o);
      errors = checkRatingAdjudicationPacket(packet, { evaluationItems: readJson(need(o, 'evaluation')), rater1: readJson(need(o, 'rater-1')), rater2: readJson(need(o, 'rater-2')), recordSha });
    } else fail('--type must be reference|rating');
  } catch (e) { fail(e.message); }
  if (errors.length) fail(`FORBIDDEN_OR_ALTERED_PACKET: ${errors.join('; ')}`);
  console.log(`${type} adjudication packet verified against the deterministic build`);
}

function cmdResolveReferenceAdjudication(o) {
  const { recordSha } = sealedHeldOut(o);
  const rows = loadCsv(need(o, 'decisions'), ADJUDICATION_COLUMNS);
  let out;
  try { out = resolveReferenceDecisions(rows, recordSha); } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), toCsv(ADJUDICATION_COLUMNS, out));
  console.log(`resolved ${out.length} blind decision(s) to AUTHOR / CONFIRMER / REFERENCE-CONFLICT`);
}

// ── Protocol-004: personnel (§4A) ───────────────────────────────────────────
function cmdCheckPersonnel(o) {
  const { errors, blockers } = checkPersonnelRegister(readJson(need(o, 'personnel')));
  for (const e of errors) console.error(`  ERROR   ${e}`);
  for (const b of blockers) console.error(`  BLOCKED ${b}`);
  if (errors.length) fail(`personnel register refused (${errors.length} error(s))`);
  if (blockers.length) fail(`BLOCKED — ${blockers.length} role(s) unfilled`, EXIT.BLOCKED);
  console.log('personnel register: seven independent roles filled, mutually exclusive, operator in none, declarations complete');
}

// ── Protocol-004: execution authorization + audit (§6.5) ────────────────────
function cmdAuthorizeExecution(o) {
  const devPath = need(o, 'dev-manifest'); const hoPath = need(o, 'held-out-manifest');
  const { frame, checked, frameHash } = loadFrame(o);
  refuseMalformed(checked);
  const devManifest = readJson(devPath); const hoManifest = readJson(hoPath);
  if (frameHash !== hoManifest.frame_hash) fail('FRAME_CHANGED: supplied frame is not the sealed frame');
  let auth;
  try {
    auth = buildAuthorization({ registration: readJson(need(o, 'registration')), seal: readJson(need(o, 'seal')), sealPublication: readJson(need(o, 'seal-publication')), devManifest, devManifestSha: fileSha(devPath), hoManifest, hoManifestSha: fileSha(hoPath), frameRows: frame });
  } catch (e) { fail(`AUTHORIZATION_REFUSED: ${e.message}`); }
  writeOnce(need(o, 'out'), JSON.stringify(auth, null, 2) + '\n');
  console.log(`authorization_sha256: ${auth.authorization_sha256}; window opens ${auth.window_opens_at}; ${auth.held_out_candidate_ids.length} held-out companies`);
  console.log('The tooling runs no CPG. The execution harness must refuse to run held-out companies without this authorization.');
}

function cmdAuditExecutionLog(o) {
  let r;
  try { r = auditExecutionLog(readJson(need(o, 'authorization')), readJson(need(o, 'log'))); } catch (e) { fail(`EXECUTION_LOG_REFUSED: ${e.message}`); }
  for (const f of r.findings) console.error(`  ${f.state}: ${f.msg}`);
  console.log(`execution audit: ${r.state} (audits the supplied log only; it cannot prove that unlogged queries did not occur)`);
  process.exit(r.state === EXECUTION_STATE.CLEAN || r.state === EXECUTION_STATE.NOT_EXECUTED ? 0 : EXIT.VOID);
}

// ── CPG-044: execution harness (§6.3, §6.5, §7, §11, §13.1) ──────────────────
function harnessClock(o, reg) {
  const fixed = process.env.CPG_U1_HARNESS_NOW;
  if (fixed === undefined) return () => new Date().toISOString();
  if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test') fail('CPG_U1_HARNESS_NOW is a test clock — refused outside a synthetic-test registration');
  return () => fixed;
}

function resolverState() {
  const clone = process.env.CPG_U1_RESOLVER_CLONE;
  if (!clone || !existsSync(clone)) fail('CPG_U1_RESOLVER_CLONE must name the frozen resolver clone');
  const git = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8' }).trim();
  const envFiles = readdirSync(clone).filter((f) => /^\.env/.test(f) && !f.endsWith('.example'));
  return { clone, head: git('rev-parse', 'HEAD'), clean: git('status', '--porcelain') === '', envFiles, providerConfigurationSha: providerConfigurationSha(clone) };
}

async function harnessExecutor(o, reg, resolver) {
  if (o['synthetic-executor'] && o['synthetic-executor'] !== true) {
    if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test') fail('--synthetic-executor is refused outside a synthetic-test registration');
    const mod = await import(pathToFileURL(resolve(o['synthetic-executor'])).href);
    return mod.default;
  }
  return realExecutor({ clone: resolver.clone, resolverSha: resolver.head });
}

function harnessContext(o, { heldOut }) {
  const reg = readJson(need(o, 'registration'));
  const { frame, checked, frameHash } = loadFrame(o);
  refuseMalformed(checked);
  const devPath = need(o, 'dev-manifest');
  const ctx = {
    registration: reg, identityRegistrations: readJson(need(o, 'identity-registrations')), protocolSha: fileSha(need(o, 'protocol')),
    toolingAggregate: toolingManifest(ROOT).aggregate, frameRows: frame, frameHash, scanSha: fileSha(need(o, 'scan')), registrySha: fileSha(need(o, 'registry')),
    devManifest: readJson(devPath), devManifestSha: fileSha(devPath), evidence: readJson(need(o, 'evidence')), resolver: resolverState(),
  };
  if (heldOut) {
    const hoPath = need(o, 'held-out-manifest');
    Object.assign(ctx, { hoManifest: readJson(hoPath), hoManifestSha: fileSha(hoPath), seal: readJson(need(o, 'seal')), sealPublication: readJson(need(o, 'seal-publication')),
      authorization: o.authorization && o.authorization !== true && existsSync(o.authorization) ? readJson(o.authorization) : null });
  }
  return ctx;
}

function reportHarness(r) {
  if (r.status === 'EXECUTED') {
    console.log(`EXECUTED: ${r.records.length} compan${r.records.length === 1 ? 'y' : 'ies'}; INVALID (no response): ${r.invalid.length ? r.invalid.join(', ') : 'none'}`);
    process.exit(0);
  }
  console.error(`REFUSED ${r.type} ${r.code}: ${r.reason}`);
  process.exit(r.type === 'VERIFICATION_FAILURE' && ['STUDY_VOID', 'STUDY_VOID_REGISTRATION'].includes(r.code) ? EXIT.VOID : EXIT.REFUSED);
}

async function cmdHarnessPilot(o) {
  const ctx = harnessContext(o, { heldOut: false });
  const request = { run_id: need(o, 'run-id'), candidate_ids: String(need(o, 'candidates')).split(',').filter(Boolean) };
  const executor = await harnessExecutor(o, ctx.registration, ctx.resolver);
  reportHarness(await runPilot({ ctx, request, executor, logPath: need(o, 'log'), archiveDir: need(o, 'archive-dir'), now: harnessClock(o, ctx.registration), allowSynthetic: o['allow-synthetic'] === true }));
}

async function cmdHarnessHeldOut(o) {
  const ctx = harnessContext(o, { heldOut: true });
  const ids = o.candidates && o.candidates !== true ? String(o.candidates).split(',').filter(Boolean) : (Array.isArray(ctx.hoManifest?.held_out) ? ctx.hoManifest.held_out.map((e) => e.candidate_id) : []);
  const request = { run_id: need(o, 'run-id'), candidate_ids: ids };
  const executor = await harnessExecutor(o, ctx.registration, ctx.resolver);
  reportHarness(await runHeldOut({ ctx, request, executor, logPath: need(o, 'log'), archiveDir: need(o, 'archive-dir'), now: harnessClock(o, ctx.registration), allowSynthetic: o['allow-synthetic'] === true }));
}

function cmdHarnessCloseInterrupted(o) {
  const reg = o.registration && o.registration !== true ? readJson(o.registration) : null;
  let e;
  try { e = closeInterruptedRun({ logPath: need(o, 'log'), authorization: readJson(need(o, 'authorization')), now: harnessClock(o, reg) }); } catch (err) { fail(err.message); }
  console.log(`run ${e.run_id} closed; INVALID (never executed): ${e.invalid_unexecuted.length ? e.invalid_unexecuted.join(', ') : 'none'}. Nothing was executed.`);
}

function cmdVerifyEventLog(o) {
  let log;
  try { log = readEventLog(need(o, 'log')); } catch (err) { fail(`EVENT_LOG_BROKEN: ${err.message}`); }
  const counts = log.events.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {});
  console.log(`event log intact: ${log.events.length} event(s), head ${log.head}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (o.authorization && o.authorization !== true) {
    let r;
    try { r = auditExecutionLog(readJson(o.authorization), executionLogFromEvents(log.events)); } catch (err) { fail(`EXECUTION_LOG_REFUSED: ${err.message}`); }
    for (const f of r.findings) console.error(`  ${f.state}: ${f.msg}`);
    console.log(`execution audit of harness events: ${r.state} (covers harness executions only; it cannot prove that queries outside the harness did not occur)`);
    if (!(r.state === EXECUTION_STATE.CLEAN || r.state === EXECUTION_STATE.NOT_EXECUTED)) process.exit(EXIT.VOID);
  }
}

function cmdVerifyArchiveRecord(o) {
  const errs = verifyArchiveRecord(readJson(need(o, 'record')));
  if (errs.length) fail(`ARCHIVE_RECORD_INVALID: ${errs.join('; ')}`);
  console.log('archive record intact');
}

async function cmdReplayArchive(o) {
  const rec = readJson(need(o, 'record'));
  const errs = verifyArchiveRecord(rec);
  if (errs.length) fail(`ARCHIVE_RECORD_INVALID: ${errs.join('; ')}`);
  const { clone } = resolverState();
  let out;
  try { out = await replayRecord(clone, rec); } catch (err) { fail(`REPLAY_FAILED: ${err.message}`); }
  const cmp = compareReplay(rec, out.raw_response);
  if (out.misses.length) fail(`REPLAY_MISS: ${out.misses.join('; ')}`);
  if (!cmp.identical) fail(`REPLAY_DIFFERS: ${cmp.reason}`);
  console.log(`replay identical: canonical_response_sha256 ${rec.canonical_response_sha256}`);
}

function cmdPilotResult(o) {
  const dir = need(o, 'archive-dir'); const devPath = need(o, 'dev-manifest');
  const dev = readJson(devPath);
  const records = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f)));
  let pilot;
  try { pilot = pilotResultFromArchive(records, dev, fileSha(devPath), dev.resolver_sha); } catch (err) { fail(`PILOT_ARCHIVE_INVALID: ${err.message}`); }
  writeOnce(need(o, 'out'), JSON.stringify(pilot, null, 2) + '\n');
  console.log(`pilot result derived from ${pilot.results.length} archived development records: total fills ${pilot.results.reduce((s, r) => s + r.fills, 0)}`);
}

// ── §7.1: is this clone the U1 evaluation tree the protocol declares? ────────
function cmdVerifyEvaluationTree(o) {
  const r = verifyEvaluationTree({ repoDir: need(o, 'repo'), protocolText: readText(need(o, 'protocol')) });
  if (r.declared) console.log(`declared (§7.1): commit ${r.declared.commit}  tree ${r.declared.tree}  aggregate ${r.declared.aggregate}  (${r.declared.files} files)`);
  if (r.identity) console.log(`clone:           commit ${r.identity.commit}  tree ${r.identity.tree}  aggregate ${r.identity.aggregate}  (${r.identity.files} files)`);
  for (const n of r.notes) console.log(`  NOTE ${n.code}: ${n.message}`);
  if (!r.ok) {
    for (const f of r.refusals) console.error(`  REFUSED ${f.code}: ${f.message}`);
    fail('EVALUATION_TREE_MISMATCH: this clone is not the evaluated treatment declared in §7.1');
  }
  console.log('evaluation tree verified: the clone IS the declared U1 treatment content (instrument excluded, content authoritative)');
}

function cmdArchiveMerkleRoot(o) {
  const dir = need(o, 'archive-dir');
  const records = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f)));
  for (const r of records) { const errs = verifyArchiveRecord(r); if (errs.length) fail(`ARCHIVE_RECORD_INVALID ${r.candidate_id}: ${errs.join('; ')}`); }
  const m = archiveMerkleRoot(records);
  console.log(`archive_merkle_root: ${m.archive_merkle_root}  (${m.document_count} documents, ${records.length} records; RFC 6962 tree over body SHA-256)`);
}

function cmdEvaluationItems(o) {
  const dir = need(o, 'archive-dir');
  const records = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f)));
  const refs = loadCsv(need(o, 'reference'), REFERENCE_COLUMNS);
  let items;
  try { items = evaluationItemsFromArchive(records, refs); } catch (err) { fail(err.message); }
  writeOnce(need(o, 'out'), JSON.stringify(items, null, 2) + '\n');
  const cited = items.reduce((n, it) => n + it.cpg_source_urls.length, 0);
  console.log(`evaluation items: ${items.length} (${records.length} held-out records × ${FIELDS.length} fields); cited URLs ${cited} by ${CITED_URL_RULE}`);
}

function raterPacketInputs(o) {
  const { recordSha } = sealedHeldOut(o);
  return { label: need(o, 'label'), recordSha, evaluationItems: readJson(need(o, 'evaluation')) };
}

function cmdRaterPacket(o) {
  let packet;
  try { packet = buildRaterPacket(raterPacketInputs(o)); } catch (err) { fail(err.message); }
  writeOnce(need(o, 'out'), raterPacketBytes(packet));
  console.log(`rater packet ${packet.label}: ${packet.item_count} items; packet_sha256 ${packet.packet_sha256}`);
}

function cmdVerifyRaterPacket(o) {
  let r;
  try { r = verifyRaterPacket(readFileSync(need(o, 'packet')), raterPacketInputs(o)); } catch (err) { fail(err.message); }
  if (!r.identical) fail(`RATER_PACKET_MISMATCH: ${r.reason}`);
  console.log(`rater packet byte-identical to the deterministic rebuild: ${r.packet_sha256}`);
}

const COMMANDS = {
  frame: cmdFrame, scan: cmdScan,
  'registration-fields': cmdRegistrationFields, 'check-funding-prerequisites': cmdCheckFundingPrerequisites,
  'verify-protocol': cmdVerifyProtocol, 'verify-registration': cmdVerifyRegistration, 'verify-archive': cmdVerifyArchive,
  'commitment-payload': cmdCommitmentPayload, 'verify-commitment': cmdVerifyCommitment, 'verify-sampling': cmdVerifySampling, 'derive-seed': cmdDeriveSeed,
  'draw-development': cmdDrawDevelopment, size: cmdSize, 'pool-check': cmdPoolCheck, 'draw-held-out': cmdDrawHeldOut,
  reconcile: cmdReconcile, seal: cmdSeal,
  'check-frame-sufficiency': cmdCheckFrameSufficiency, 'rater-order': cmdRaterOrder, 'verify-rater-order': cmdVerifyRaterOrder,
  'reference-adjudication-packet': cmdReferenceAdjudicationPacket, 'verify-adjudication-packet': cmdVerifyAdjudicationPacket,
  'resolve-reference-adjudication': cmdResolveReferenceAdjudication, 'check-personnel': cmdCheckPersonnel,
  'authorize-execution': cmdAuthorizeExecution, 'audit-execution-log': cmdAuditExecutionLog,
  'harness-pilot': cmdHarnessPilot, 'harness-held-out': cmdHarnessHeldOut, 'harness-close-interrupted': cmdHarnessCloseInterrupted,
  'verify-event-log': cmdVerifyEventLog, 'verify-archive-record': cmdVerifyArchiveRecord, 'replay-archive': cmdReplayArchive, 'pilot-result': cmdPilotResult,
  'verify-evaluation-tree': cmdVerifyEvaluationTree, 'archive-merkle-root': cmdArchiveMerkleRoot, 'evaluation-items': cmdEvaluationItems, 'rater-packet': cmdRaterPacket, 'verify-rater-packet': cmdVerifyRaterPacket,
};
const o = args(process.argv.slice(2));
const cmd = o._[0];
if (!COMMANDS[cmd]) {
  console.log(`usage: node cpg_u1_data.mjs <${Object.keys(COMMANDS).join('|')}> [options] — see README.md`);
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(COMMANDS[cmd](o)).catch((e) => fail(`UNEXPECTED: ${e.message}`));
