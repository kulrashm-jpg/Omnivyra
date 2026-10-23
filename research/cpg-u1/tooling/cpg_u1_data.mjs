#!/usr/bin/env node
// CPG U1 dataset tooling (TOOL_VERSION below) — governed by CPG_U1_PROTOCOL_004.md.
// Pipeline: registration-fields → check-funding-prerequisites → [registration] → frame → scan
//           → check-frame-sufficiency → commitment-payload(D) → sampling-evidence-bundle → verify-sampling(D) → draw-development → size
//           → rater-assignment-fingerprint (published before the held-out commitment, §4A.3)
//           → commitment-payload(H: same frame, scan, registry) → verify-sampling(H) → draw-held-out
//           → reference-adjudication-packet → [blind reference adjudication] → resolve-reference-adjudication → reconcile → seal
//           → [seal published] → authorize-execution → harness-held-out → evaluation-items → rater-order / rater-packet
//           → [rating] → ingest-ratings (×2) → rating-adjudication-packet → [blind rating adjudication] → resolve-rating-adjudication
//           → analyze.
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
import { buildRatingAdjudicationPacket, buildReferenceAdjudicationPacket, checkRatingAdjudicationPacket, checkReferenceAdjudicationPacket, resolveReferenceDecisions } from './lib/packets.mjs';
import { checkPersonnelRegister } from './lib/personnel.mjs';
import { checkEnumerationAttribution } from './lib/enumeration.mjs';
import { EXECUTION_STATE, auditExecutionLog, buildAuthorization, checkAuthorization, recomputeSealHash } from './lib/execution.mjs';
import { PROVIDER_CONFIG_VERDICT, checkProviderConfiguration, closeInterruptedRun, executionLogFromEvents, providerConfigurationSha, runHeldOut, runPilot } from './lib/harness.mjs';
import { IDENTITY_CLASS } from './lib/identity.mjs';
import { readEventLog } from './lib/eventlog.mjs';
import { archiveMerkleRoot, compareReplay, pilotResultFromArchive, verifyArchiveRecord } from './lib/archive.mjs';
import { realExecutor, replayRecord } from './lib/cpgExecutor.mjs';
import { CITED_URL_RULE, buildRaterPacket, raterPacketBytes, verifyRaterPacket } from './lib/raterPackets.mjs';
import { EVALUATION_TREE_DOMAIN, verifyEvaluationTree } from './lib/evaluationTree.mjs';
import { buildEvaluation, checkEvaluation, heldOutObservations } from './lib/evaluation.mjs';
import { assignedPerson, assignmentFingerprint, checkRaterAssignment } from './lib/assignment.mjs';
import { RATING_COLUMNS, checkSheet, ingestRatings, ratingPacketInputs, resolveRatingAdjudication } from './lib/ratings.mjs';
import { DECISIONS_SCHEMA, analyze, checkDeclarations, readDecisions } from './lib/analysis.mjs';
import { buildEvidenceBundle } from './lib/evidenceBundle.mjs';

const TOOL_VERSION = 'cpg-u1-data-tooling-6';
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
  // DR-11 (ADOPTED): one scan result per candidate_id. The `new Map(scan.results.map(...))` on the line
  // below keeps only the LAST entry for a repeated candidate_id, so an earlier occurrence — and every
  // contamination reason it carried — vanished silently, while `scan.frame_hash` (checked just above)
  // still attested to the whole frame. DR-10 closed the same collapse on the FRAME inside `scan`; the
  // scan ARTEFACT is a separate input, read here by all four sampling commands, and a hand-edited,
  // concatenated or reordered artefact can repeat an id without any frame ever doing so. Every
  // occurrence is printed with its own ordinal and its OWN three findings — repository_hits,
  // registry_matches and held_out_ineligible_by_scan — so the occurrence the old code dropped stays
  // attributable; then this refuses at exit 1 (EXIT.REFUSED) naming the scan file, and writes no
  // artefact. One guard covers all four call sites.
  // DELIBERATELY NOT CHECKED HERE — neither is the DR-11 defect and both would broaden scan semantics:
  // a `scan.results.length === frame.length` cardinality check, and refusal of ids absent from the frame.
  const resultOccurrences = new Map();
  scan.results.forEach((x, i) => {
    const list = resultOccurrences.get(x.candidate_id);
    if (list) list.push({ x, ordinal: i + 1 }); else resultOccurrences.set(x.candidate_id, [{ x, ordinal: i + 1 }]);
  });
  const repeatedResults = [...resultOccurrences.entries()].filter(([, list]) => list.length !== 1);
  if (repeatedResults.length) {
    for (const [id, list] of repeatedResults) {
      console.error(`  DUPLICATE scan result candidate_id ${id}: ${list.length} occurrences in ${scanPath}`);
      for (const { x, ordinal } of list) {
        const why = [
          ...(x.repository_hits ?? []).map((h) => `CPG-C1(1) repository ${h.scope} ${h.file}:${h.line}`),
          ...(x.registry_matches ?? []).map((m) => `CPG-C1(6) development-only registry ${m.entry_id} (${m.matched})`),
        ];
        console.error(`    result ${ordinal}: held_out_ineligible_by_scan=${x.held_out_ineligible_by_scan} — ${why.length ? why.join(' ; ') : 'no contamination recorded in this occurrence'}`);
      }
    }
    fail(`SCAN_RESULT_DUPLICATE_REFUSED: ${repeatedResults.length} candidate_id(s) occur more than once in the results of ${scanPath} — one result per candidate_id cannot attest to two results sharing an id, and the collapsed occurrence takes its own contamination with it (every occurrence is reported above)`, EXIT.REFUSED);
  }
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
 * R28 (§3): identity attestations are read ONLY from a file supplied separately on the command line.
 * An attestation carried inside the registration record is the record vouching for itself, which is
 * exactly the defect R15 removes for the provider-configuration hash, so it is refused outright.
 */
function identityAttestations(o, reg) {
  if (Object.hasOwn(reg, 'identity_attestations')) fail('SELF_ATTESTATION_REFUSED: the registration record carries identity_attestations. A record cannot attest to its own identities; supply them with --identity-attestations, from outside the record');
  if (!o['identity-attestations'] || o['identity-attestations'] === true) return {};
  const a = readJson(o['identity-attestations']);
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail('--identity-attestations must be a JSON object keyed by registration field path');
  return a;
}

/**
 * The resolver clone R15 derives the current provider configuration from.
 *
 * F3 (an S1 missed refusal): `return c && existsSync(c) ? c : null` converted an EXPLICITLY SUPPLIED but
 * nonexistent path into "no clone supplied". checkProviderConfiguration then returned NOT_COMPARED, so a
 * WRONG or STALE but well-formed provider_configuration_sha256 exited 0 as ESTABLISHED — the outcome R15
 * exists to prevent (§13.1/§19.1 require stale -> BLOCKED) — and the printed reason ("no resolver clone
 * was supplied") was factually false, because one was. The two states are now distinguished:
 *   supplied and readable  -> compared, as before;
 *   supplied and missing   -> REFUSED here (exit 1): the caller asked for the comparison and it cannot be made;
 *   genuinely not supplied -> null, and the existing honest NOT_COMPARED verdict, unchanged.
 * A valueless `--resolver-clone` (the flag with no path after it) keeps its existing fall-through to the
 * environment variable: that is an argument-parsing question, not the missed refusal F3 names.
 */
const resolverCloneFor = (o) => {
  const flag = o['resolver-clone'] && o['resolver-clone'] !== true ? o['resolver-clone'] : null;
  // An empty CPG_U1_RESOLVER_CLONE means "not set", not "set to the empty path", so `||` is deliberate.
  const fromEnv = process.env.CPG_U1_RESOLVER_CLONE || null;
  const supplied = flag ?? fromEnv;
  if (!supplied) return null;
  if (!existsSync(supplied)) fail(`RESOLVER_CLONE_NOT_FOUND: ${flag ? '--resolver-clone' : 'CPG_U1_RESOLVER_CLONE'} names "${supplied}", which does not exist. A supplied clone that cannot be read is NOT "no resolver clone was supplied": reporting it as absent would make provider_configuration_sha256 NOT_COMPARED and let a WRONG or STALE value exit 0 as ESTABLISHED, which R15 requires to be BLOCKED. Supply the path of a clone at the §7.1 evaluation-tree commit, or supply none at all`, EXIT.REFUSED);
  return supplied;
};

/**
 * A complete, authoritative registration whose protocol and tooling hashes match the files in use.
 * Every sampling command passes through here first.
 */
function registered(o) {
  const allowSynthetic = o['allow-synthetic'] === true;
  const reg = readJson(need(o, 'registration'));
  const attestations = identityAttestations(o, reg);
  const check = checkRegistration(reg, { phase: 'registered', allowSynthetic, attestations });
  reportRegistrationCheck(check);
  if (fileSha(need(o, 'protocol')) !== reg.protocol_sha256) fail('VERIFY_ABORT_HASH_MISMATCH: --protocol does not hash to the registered protocol_sha256');
  const aggregate = toolingManifest(ROOT).aggregate;
  if (aggregate !== reg.tooling_aggregate_sha256) fail(`VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ${aggregate}) is not the registered tooling`);
  // R15 goes HERE, and deliberately: (a) after reportRegistrationCheck, so an UNASSIGNED value is still
  // the existing exit-4 blocker and a malformed one the existing exit-1 record error — the comparison
  // owns only what a comparison can see; (b) after the protocol hash comparison, because the derivation
  // reads §7.1 out of the protocol, and comparing against a clone pinned by an UNVERIFIED protocol would
  // be a hash of nothing; (c) before checkAuthority, because a record naming the wrong provider
  // configuration must be refused whether or not it happens to be the earliest one listed.
  const provider = checkProviderConfiguration({ recorded: reg.provider_configuration_sha256, cloneDir: resolverCloneFor(o), protocolText: readText(o.protocol) });
  if (provider.verdict === PROVIDER_CONFIG_VERDICT.BLOCKED) fail(`PROVIDER_CONFIG_REFUSED: ${provider.message}`, provider.code === 'PROVIDER_CONFIG_MISSING' ? EXIT.BLOCKED : EXIT.REFUSED);
  if (provider.verdict === PROVIDER_CONFIG_VERDICT.NOT_COMPARED && o['require-provider-config'] === true) fail(`BLOCKED — ${provider.message}`, EXIT.BLOCKED);
  let voidReason;
  try { voidReason = checkAuthority(reg, readJson(need(o, 'identity-registrations'))); } catch (e) { fail(`identity registration list refused: ${e.message}`); }
  if (voidReason) fail(`STUDY_VOID_REGISTRATION: ${voidReason}`, EXIT.VOID);
  return { reg, allowSynthetic, identity: check.identity, provider };
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
  // §4A.2 / §20.18: the frame is independent only if independent enumerators produced it, so every row's enumerator is
  // resolved against the restricted personnel register. `enumerated_by` is already one of the FRAME_COLUMNS hashed into
  // frame_hash above, so the attribution is already inside the frame's deterministic identity.
  const attribution = checkEnumerationAttribution(frame, { personnel: readJson(need(o, 'personnel')) });
  for (const e of attribution) console.error(`  ERROR   ${e}`);
  if (attribution.length) fail(`ENUMERATION_ATTRIBUTION_REFUSED: ${attribution.length} error(s) — the frame is not attributed to eligible registered enumerators`);
  console.log(`enumeration attribution: every row names a registered eligible enumerator (${FRAME_COLUMNS.length}-column frame_hash binds enumerated_by)`);
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

  const framePath = need(o, 'frame');
  const frame = loadCsv(framePath, FRAME_COLUMNS);
  const registry = readJson(registryPath);
  const files = git('ls-files', '-z').split('\0').filter(Boolean).map((f) => ({ f, scope: scanScope(f) })).filter((x) => x.scope);
  // DR-10: one scan state per FRAME OCCURRENCE. `new Map(frame.map((r) => [r.candidate_id, ...]))` kept only the
  // LAST value for a repeated candidate_id, so an occurrence — and every hit it would have produced — vanished
  // merely because another occurrence of the same id was seen. `record` is the 1-based frame record ordinal
  // (header excluded), carried so every occurrence stays attributable to its source row.
  const state = frame.map((r, i) => ({ r, record: i + 1, tokens: tokensFor(r), hits: [] }));
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
  // DR-10: a scan result is keyed on candidate_id, so a frame that repeats a candidate_id cannot be attested by
  // one result per id — and report.frame_hash would still cover the rows the results omit, making the artefact
  // attest to rows it never assessed. Every occurrence has been scanned above; each is reported here with its
  // source file, record ordinal, identity and contamination reason, and then the scan refuses. No artefact is
  // written. Ten downstream commands already refuse a duplicate frame (loadFrame + refuseMalformed); this closes
  // the one command that reached the frame through loadCsv instead.
  const occurrences = new Map();
  for (const c of state.values()) {
    const list = occurrences.get(c.r.candidate_id);
    if (list) list.push(c); else occurrences.set(c.r.candidate_id, [c]);
  }
  const repeated = [...occurrences.entries()].filter(([, list]) => list.length > 1);
  if (repeated.length) {
    for (const [id, list] of repeated) {
      console.error(`  DUPLICATE candidate_id ${id}: ${list.length} occurrences in ${framePath}`);
      for (const c of list) {
        const why = [
          ...c.hits.map((h) => `CPG-C1(1) repository ${h.scope} ${h.file}:${h.line} (${h.kind} "${h.value}")`),
          ...registryMatches(c.r, registry).map((m) => `CPG-C1(6) development-only registry ${m.entry_id} (${m.matched})`),
        ];
        console.error(`    record ${c.record}: name "${c.r.company_name}" domain "${c.r.canonical_domain}" ${c.r.identifier_scheme} ${c.r.identifier_value} — ${why.length ? why.join(' ; ') : 'no contamination found in this occurrence'}`);
      }
    }
    fail(`${repeated.length} duplicate candidate_id(s) in ${framePath} — one scan result per candidate_id cannot attest to two rows sharing an id; de-duplicate the frame and re-scan (each occurrence's contamination, if any, is reported above)`);
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

/**
 * R28 (§3): what the verifier established, and — separately and explicitly — what it did NOT.
 * The previous exit-0 line read "complete, public, unembargoed, authoritative". Three of those four
 * adjectives were not established by this verifier: `public` and `unembargoed` are read off
 * registry.public / registry.embargo INSIDE the record being checked, and "authoritative" meant only
 * "earliest in the file the caller supplied". Validating harder would not have made the claim true, so
 * the claim is corrected here as well as the validation.
 */
function reportRegistrationStanding(reg, identity, provider) {
  console.log(`registration ${reg.registration_id}: ESTABLISHED — the record is complete and well-formed; --protocol, this tooling aggregate and --registry hash to the values the record registers; the record is the EARLIEST entry for ${STUDY_ID} in the supplied --identity-registrations list.`);
  for (const [field, c] of Object.entries(identity)) console.log(`  identity ${field}: ${c.class} (${c.code})`);
  console.log(`  provider_configuration_sha256: ${provider.verdict} (${provider.code})`);
  const unestablished = [
    'PUBLIC / UNEMBARGOED: read from registry.public and registry.embargo INSIDE this record. They are assertions made by the submitter; this tooling never contacts the registry, so neither is checked.',
    'REGISTRY AUTHORITY: "earliest" is authority only over the supplied --identity-registrations file. The verifier does not enumerate the registry, so a registration absent from that file is invisible to it (§20.13).',
    `IDENTITY: no persistent identifier was resolved against any issuing authority. Values classified ${IDENTITY_CLASS.PLAUSIBLE} passed local screens only — surviving a screen is not evidence that a value identifies anyone (§3).`,
  ];
  if (provider.verdict === PROVIDER_CONFIG_VERDICT.NOT_COMPARED) unestablished.push(`PROVIDER CONFIGURATION: ${provider.message}`);
  console.log('NOT ESTABLISHED by this verifier:');
  for (const u of unestablished) console.log(`  - ${u}`);
}

function cmdVerifyRegistration(o) {
  const { reg, allowSynthetic, identity, provider } = registered(o);
  if (fileSha(need(o, 'registry')) !== reg.registry_sha256) fail('VERIFY_ABORT_HASH_MISMATCH: development-only registry differs from the registered registry_sha256');
  if (o.evidence && o.evidence !== true) {
    const r = evaluate(reg, readJson(o.evidence), 'development', { allowSynthetic });
    if (r.state === STATE.VOID_REGISTRATION || r.state === STATE.VOID_PRE_REGISTRATION_SPEND) fail(`${r.state}: ${r.reason}`, EXIT.VOID);
    console.log('funding outputs verified against the registered checkpoint');
  }
  reportRegistrationStanding(reg, identity, provider);
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
  // §19.3: the result names the relays that attested the round, so the ≥ 2-relay claim is readable from the verification output.
  console.log(JSON.stringify({ stage: r.stage, state: r.state, reason: r.reason, drand_relays: r.drandRelays ?? null, record: r.record ?? null }, null, 2));
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
  return { ...reconcile([...devManifest.development, ...hoManifest.held_out], author, confirmer, adjudication), author, confirmer, adjudication };
}

const rowsKey = (rows) => canonicalJson([...rows].map((r) => canonicalJson(r)).sort());

/**
 * §9.2.1 (B1): the reference adjudication happens BLIND, on the deterministic packet, after both blind record sets and
 * BEFORE the seal. The seal therefore requires the packet and the blind RECORD_1/RECORD_2 decisions whenever the blind
 * records disagree, rebuilds the packet from the held-out record, and requires --adjudication to be exactly the mechanical
 * resolution of those decisions. An adjudication typed by role name (AUTHOR/CONFIRMER) without a blind packet is refused.
 */
function blindReferenceAdjudication(o, dev, ho, author, confirmer, adjudication) {
  let recordSha;
  try { recordSha = recomputeRecordSha(ho.sampling); } catch (e) { fail(`BLIND_ADJUDICATION_REFUSED: ${e.message}`); }
  const inputs = { entries: [...dev.development, ...ho.held_out], author, confirmer, recordSha };
  let expected;
  try { expected = buildReferenceAdjudicationPacket(inputs); } catch (e) { fail(`BLIND_ADJUDICATION_REFUSED: ${e.message}`); }
  const given = (k) => o[k] && o[k] !== true;
  if (!expected.items.length && !given('reference-packet') && !given('blind-decisions')) return { packetSha: null, decisionsSha: null };
  const packetPath = need(o, 'reference-packet'); const decisionsPath = need(o, 'blind-decisions');
  const errors = checkReferenceAdjudicationPacket(readJson(packetPath), inputs);
  if (errors.length) fail(`BLIND_ADJUDICATION_REFUSED: the reference adjudication packet is not the deterministic packet — ${errors.join('; ')}`);
  const blind = loadCsv(decisionsPath, ADJUDICATION_COLUMNS);
  const want = expected.items.map((it) => `${it.candidate_id}|${it.field}`).sort();
  const got = blind.map((r) => `${r.candidate_id}|${r.field}`).sort();
  if (canonicalJson(got) !== canonicalJson(want)) fail('BLIND_ADJUDICATION_REFUSED: the blind decisions do not cover exactly the packet items (missing, extra or duplicated decision)');
  let resolved;
  try { resolved = resolveReferenceDecisions(blind, recordSha); } catch (e) { fail(`BLIND_ADJUDICATION_REFUSED: ${e.message}`); }
  if (rowsKey(resolved) !== rowsKey(adjudication)) fail('BLIND_ADJUDICATION_REFUSED: --adjudication is not the mechanical resolution of the blind decisions (resolve-reference-adjudication)');
  return { packetSha: fileSha(packetPath), decisionsSha: fileSha(decisionsPath) };
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
  const { errors, rows, stratumMismatches, author, confirmer, adjudication } = reconcileFrom(o, dev, ho);
  if (errors.length) fail(`reference truth has ${errors.length} error(s) — a dataset is never sealed with errors`);
  const blindAdj = blindReferenceAdjudication(o, dev, ho, author, confirmer, adjudication);
  const refPath = need(o, 'reference');
  if (readText(refPath) !== toCsv(REFERENCE_COLUMNS, rows)) fail('--reference is not byte-identical to the reconciliation of the blind records — reference truth must come from reconcile, never be hand-edited');
  const seal = {
    seal_version: 4, tool: TOOL_VERSION, status: 'DATASET SEALED — NOT EXECUTED',
    study_id: STUDY_ID, registration_id: ho.registration_id, protocol_sha256: ho.protocol_sha256, tooling_aggregate_sha256: ho.tooling_aggregate_sha256,
    resolver_sha: ho.resolver_sha, registry_sha256: ho.registry_sha256,
    development: { manifest_sha256: fileSha(devPath), screening_log_sha256: fileSha(join(devDir, 'screening_log.csv')), sampling_record_sha256: dev.sampling.record_sha256, frame_hash: dev.frame_hash },
    held_out: { manifest_sha256: fileSha(hoPath), screening_log_sha256: fileSha(join(hoDir, 'screening_log.csv')), sampling_record_sha256: ho.sampling.record_sha256, frame_hash: ho.frame_hash, quotas: ho.quotas },
    sizing_sha256: fileSha(sizingPath),
    blind_records: { author_sha256: fileSha(o.author), confirmer_sha256: fileSha(o.confirmer), adjudication_sha256: o.adjudication && o.adjudication !== true ? fileSha(o.adjudication) : null,
      reference_adjudication_packet_sha256: blindAdj.packetSha, blind_decisions_sha256: blindAdj.decisionsSha },
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
  try { recomputeSealHash(seal); } catch (e) { fail(`WRONG_SEAL: ${e.message}`); }
  return { ho, recordSha, seal };
}

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
/**
 * B1: the reference adjudication happens after both blind record sets and BEFORE the seal, so its inputs are the drawn
 * manifests — never a seal. The Record 1/2 assignment and order still derive from the held-out sampling record, which
 * exists from the held-out draw on; `seal` later rebuilds the packet and binds it (blindReferenceAdjudication).
 */
function drawnHeldOut(o) {
  const hoPath = need(o, 'held-out-manifest'); const devPath = need(o, 'dev-manifest');
  const ho = readJson(hoPath); const dev = readJson(devPath);
  if (ho.stage !== 'held-out') fail('--held-out-manifest is not a held-out manifest');
  if (dev.stage !== 'development') fail('--dev-manifest is not a development manifest');
  if (ho.dev_manifest_sha256 !== fileSha(devPath)) fail('held-out manifest was not drawn after this development manifest');
  let recordSha;
  try { recordSha = recomputeRecordSha(ho.sampling); } catch (e) { fail(`RATER_ORDER_SUBSTITUTION: ${e.message}`); }
  return { ho, dev, recordSha };
}

function referenceInputs(o) {
  const { ho, dev, recordSha } = drawnHeldOut(o);
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
    if (type === 'reference') {
      errors = checkReferenceAdjudicationPacket(packet, referenceInputs(o));
      if (o.seal && o.seal !== true && readJson(o.seal).blind_records?.reference_adjudication_packet_sha256 !== fileSha(o.packet)) errors.push('the seal binds a different reference adjudication packet');
    } else if (type === 'rating') errors = checkRatingAdjudicationPacket(packet, ratingInputs(o).packetInputs);
    else fail('--type must be reference|rating');
  } catch (e) { fail(e.message); }
  if (errors.length) fail(`FORBIDDEN_OR_ALTERED_PACKET: ${errors.join('; ')}`);
  console.log(`${type} adjudication packet verified against the deterministic build`);
}

function cmdResolveReferenceAdjudication(o) {
  const { recordSha } = drawnHeldOut(o);
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

// ── B5/B6: the sealed, complete evaluation artifact ──────────────────────────
function evaluationInputs(o) {
  const hoPath = need(o, 'held-out-manifest'); const refPath = need(o, 'reference'); const runDir = need(o, 'archive-dir');
  let log;
  try { log = readEventLog(need(o, 'log')); } catch (err) { fail(`EVENT_LOG_BROKEN: ${err.message}`); }
  if (!existsSync(runDir)) fail(`${runDir} does not exist — name the authorised run's archive directory`);
  const runRecords = readdirSync(runDir).sort().map((f) => {
    if (!f.endsWith('.json')) fail(`ARCHIVE_REFUSED: ${f} is not an archive record`);
    try { return { file: f, record: readJson(join(runDir, f)) }; } catch { return fail(`ARCHIVE_REFUSED: ${f} is not JSON`); }
  });
  return { seal: readJson(need(o, 'seal')), hoManifest: readJson(hoPath), hoManifestSha: fileSha(hoPath), referenceRows: loadCsv(refPath, REFERENCE_COLUMNS),
    referenceSha: fileSha(refPath), authorization: readJson(need(o, 'authorization')), events: log.events, eventHead: log.head, runRecords };
}
function builtEvaluation(o) {
  try { return buildEvaluation(evaluationInputs(o)); } catch (err) { return fail(err.message, err.void ? EXIT.VOID : EXIT.REFUSED); }
}

function cmdEvaluationItems(o) {
  const ev = builtEvaluation(o);
  writeOnce(need(o, 'out'), JSON.stringify(ev, null, 2) + '\n');
  const cited = ev.items.reduce((n, it) => n + it.cpg_source_urls.length, 0);
  console.log(`evaluation: ${ev.observation_count} observations (every held-out company × ${FIELDS.length} fields), ${ev.invalid_observation_count} machine-INVALID; cited URLs ${cited} by ${CITED_URL_RULE}`);
  console.log(`evaluation_sha256: ${ev.evaluation_sha256}`);
}

function cmdVerifyEvaluation(o) {
  const ev = builtEvaluation(o);
  if (canonicalJson(readJson(need(o, 'evaluation'))) !== canonicalJson(ev)) fail('EVALUATION_MISMATCH: the evaluation artifact differs from its rebuild from the archive, event log, seal, authorisation and reference');
  console.log(`evaluation verified by rebuild: ${ev.evaluation_sha256}`);
}

/** Seal + held-out manifest + evaluation artifact, each bound to the others and complete (B5). */
function sealedEvaluation(o) {
  const { ho, recordSha, seal } = sealedHeldOut(o);
  const evaluation = readJson(need(o, 'evaluation'));
  const errors = checkEvaluation(evaluation, { seal, hoManifest: ho, hoManifestSha: fileSha(o['held-out-manifest']) });
  if (errors.length) fail(`EVALUATION_REFUSED: ${errors.join('; ')}`);
  return { ho, recordSha, seal, evaluation };
}

function raterPacketInputs(o) {
  const { recordSha, evaluation } = sealedEvaluation(o);
  return { label: need(o, 'label'), recordSha, evaluationItems: evaluation.items, binding: { seal_hash: evaluation.seal_hash, evaluation_sha256: evaluation.evaluation_sha256 } };
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

// ── §4A.3: person-to-label assignment fingerprint ────────────────────────────
function cmdRaterAssignmentFingerprint(o) {
  const a = readJson(need(o, 'assignment'));
  const errors = checkRaterAssignment(a, { personnel: readJson(need(o, 'personnel')) });
  if (errors.length) fail(`RATER_ASSIGNMENT_REFUSED: ${errors.join('; ')}`);
  console.log(`rater_assignment_fingerprint: ${assignmentFingerprint(a)}`);
  console.log('Publish this fingerprint BEFORE the held-out commitment transaction is broadcast (§4A.3). The assignment itself stays restricted until rating completes.');
}

function cmdVerifyRaterAssignment(o) {
  const a = readJson(need(o, 'assignment'));
  try { assignedPerson(a, need(o, 'fingerprint'), 'rater-1'); } catch (e) { fail(e.message); }
  console.log(`rater assignment matches the published fingerprint ${o.fingerprint}`);
}

// ── B2: rater label ingestion ───────────────────────────────────────────────
function cmdIngestRatings(o) {
  const inputs = raterPacketInputs(o);
  const packetBytes = readFileSync(need(o, 'packet'));
  const v = verifyRaterPacket(packetBytes, inputs);
  if (!v.identical) fail(`RATER_PACKET_MISMATCH: ${v.reason} — labels are ingested only against the deterministic packet of this label`);
  const fp = need(o, 'assignment-fingerprint');
  let person;
  try { person = assignedPerson(readJson(need(o, 'assignment')), fp, inputs.label); } catch (e) { fail(e.message); }
  let sheet;
  try { sheet = ingestRatings({ packet: JSON.parse(packetBytes.toString('utf8')), rows: loadCsv(need(o, 'labels'), RATING_COLUMNS), ratedBy: person, assignmentFingerprint: fp }); } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), JSON.stringify(sheet, null, 2) + '\n');
  console.log(`rater sheet ${sheet.label}: ${sheet.item_count} items, ${sheet.pending_count} pending; sheet_sha256 ${sheet.sheet_sha256} (no tallies are shown)`);
}

/** Two sheets verified against the evaluation, each rated by the person the published assignment names for its label. */
function ratingInputs(o) {
  const ctx = sealedEvaluation(o);
  const assignment = readJson(need(o, 'assignment')); const fp = need(o, 'assignment-fingerprint');
  const sheets = {};
  for (const [label, key] of [['rater-1', 'sheet-1'], ['rater-2', 'sheet-2']]) {
    const sheet = readJson(need(o, key));
    const errs = checkSheet(sheet, { evaluation: ctx.evaluation, recordSha: ctx.recordSha, label });
    if (errs.length) fail(`RATER_SHEET_REFUSED (${label}): ${errs.slice(0, 20).join('; ')}`);
    let person;
    try { person = assignedPerson(assignment, fp, label); } catch (e) { fail(e.message); }
    if (sheet.rated_by !== person || sheet.assignment_fingerprint !== fp) fail(`RATER_SHEET_REFUSED (${label}): not rated by the person the published assignment names`);
    sheets[label] = sheet;
  }
  const sheet1 = sheets['rater-1']; const sheet2 = sheets['rater-2'];
  return { ...ctx, assignment, fp, sheet1, sheet2, packetInputs: ratingPacketInputs(ctx.evaluation, sheet1, sheet2, ctx.recordSha) };
}

// ── B3: rating adjudication ─────────────────────────────────────────────────
function cmdRatingAdjudicationPacket(o) {
  const r = ratingInputs(o);
  let packet;
  try { packet = buildRatingAdjudicationPacket(r.packetInputs); } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), JSON.stringify(packet, null, 2) + '\n');
  console.log(`rating adjudication packet: ${packet.items.length} disagreeing item(s); Label A/B unlabelled; no rater identity, class, split or tally`);
}

function cmdResolveRatingAdjudication(o) {
  const r = ratingInputs(o);
  const packet = readJson(need(o, 'packet'));
  const errors = checkRatingAdjudicationPacket(packet, r.packetInputs);
  if (errors.length) fail(`FORBIDDEN_OR_ALTERED_PACKET: ${errors.join('; ')}`);
  let adjudicator;
  try { adjudicator = assignedPerson(r.assignment, r.fp, 'rating-adjudicator'); } catch (e) { fail(e.message); }
  let res;
  try { res = resolveRatingAdjudication({ packet, rows: loadCsv(need(o, 'decisions'), ADJUDICATION_COLUMNS), sheet1: r.sheet1, sheet2: r.sheet2, adjudicator, recordSha: r.recordSha }); } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), JSON.stringify(res, null, 2) + '\n');
  console.log(`resolved ${res.resolution_count} blind decision(s) to the chosen labels; resolution_sha256 ${res.resolution_sha256}`);
}

// ── B4: analysis ────────────────────────────────────────────────────────────
function cmdAnalyze(o) {
  const r = ratingInputs(o);
  const auth = readJson(need(o, 'authorization'));
  let authSha;
  try { authSha = checkAuthorization(auth); } catch (e) { fail(`ANALYSIS_REFUSED: ${e.message}`); }
  if (auth.seal_hash !== r.evaluation.seal_hash || authSha !== r.evaluation.authorization_sha256) fail('ANALYSIS_REFUSED: the authorisation is not the one the evaluation was built under');
  let log;
  try { log = readEventLog(need(o, 'log')); } catch (e) { fail(`EVENT_LOG_BROKEN: ${e.message}`); }
  if (!log.events.some((e) => e.event_sha256 === r.evaluation.event_log_head)) fail('ANALYSIS_REFUSED: the event log does not contain the head the evaluation was built from (substituted or truncated log)');
  const declarations = readJson(need(o, 'declarations'));
  const dErr = checkDeclarations(declarations, { sealHash: r.evaluation.seal_hash, heldOutIds: r.ho.held_out.map((e) => e.candidate_id) });
  if (dErr.length) fail(`DECLARATIONS_REFUSED: ${dErr.join('; ')}`);
  let resolution = null;
  if (o['rating-resolution'] && o['rating-resolution'] !== true) {
    resolution = readJson(o['rating-resolution']);
    let adjudicator;
    try { adjudicator = assignedPerson(r.assignment, r.fp, 'rating-adjudicator'); } catch (e) { fail(e.message); }
    if (resolution.adjudicated_by !== adjudicator) fail('ANALYSIS_REFUSED: the rating resolution was not made by the assigned rating adjudicator');
  }
  let decPath = join(ROOT, 'rules', 'analysis_decisions.json'); let source = 'PINNED';
  if (o.decisions && o.decisions !== true) {
    const reg = o.registration && o.registration !== true ? readJson(o.registration) : null;
    if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test' || reg?.registration_id !== r.seal.registration_id) fail('--decisions (a file other than the pinned rules/analysis_decisions.json) is refused outside this study\'s synthetic-test registration');
    decPath = o.decisions; source = 'SYNTHETIC_OVERRIDE';
  }
  const dec = readDecisions(readJson(decPath));
  if (dec.errors.length) fail(`DECISIONS_INVALID (${DECISIONS_SCHEMA}): ${dec.errors.join('; ')}`);
  if (dec.undecided.length) fail(`ANALYSIS_BLOCKED: methodological decision(s) ${dec.undecided.join(', ')} are UNDECIDED — Protocol-004 does not define them and the tooling does not choose them (rules/analysis_decisions.json)`, EXIT.BLOCKED);
  let results;
  try {
    results = analyze({ evaluation: r.evaluation, hoManifest: r.ho, sheet1: r.sheet1, sheet2: r.sheet2, resolution, recordSha: r.recordSha, authorization: auth, events: log.events,
      sealPublication: readJson(need(o, 'seal-publication')), declarations, decisions: dec.values, decisionsSource: source, decisionsSha: fileSha(decPath) });
  } catch (e) { fail(e.message); }
  writeOnce(need(o, 'out'), JSON.stringify(results, null, 2) + '\n');
  console.log(`outcome: ${results.outcome}${results.outcome_basis.length ? ` (${results.outcome_basis.join('; ')})` : ''}`);
  console.log(`results_sha256: ${results.results_sha256}`);
  process.exit(results.outcome === 'VOID' ? EXIT.VOID : 0);
}

// ── §13.2A: sampling-evidence bundle ────────────────────────────────────────
function cmdSamplingEvidenceBundle(o) {
  const { reg, allowSynthetic } = registered(o);
  const opt = (k) => (o[k] && o[k] !== true ? readJson(o[k]) : null);
  const commitment = (st) => {
    const pr = opt(`commitment-${st}`); const pl = opt(`payload-${st}`);
    if (!pr && pl) fail(`--payload-${st} given without --commitment-${st}`);
    return pr ? { proof: pr, payload: pl } : null;
  };
  let ev;
  try {
    ev = buildEvidenceBundle({ network: reg.network, headers: readJson(need(o, 'headers')), headersCrosscheck: readJson(need(o, 'headers-crosscheck')),
      funding: { development: readJson(need(o, 'funding-development')), 'held-out': readJson(need(o, 'funding-held-out')) },
      commitments: { development: commitment('development'), 'held-out': commitment('held-out') },
      drandChainInfo: readJson(need(o, 'drand-chain-info')),
      beacons: o['drand-beacons'] && o['drand-beacons'] !== true ? String(o['drand-beacons']).split(',').filter(Boolean).flatMap((f) => [].concat(readJson(f))) : [] });
  } catch (e) { fail(`EVIDENCE_BUNDLE_REFUSED: ${e.message}`); }
  const prior = opt('prior-final') ?? undefined;
  const states = ['development', 'held-out'].map((stage) => evaluate(reg, ev, stage, { allowSynthetic, priorFinal: prior }));
  writeOnce(need(o, 'out'), JSON.stringify(ev, null, 2) + '\n');
  for (const x of states) console.log(`  ${x.stage.padEnd(11)} ${x.state}: ${x.reason}`);
  console.log(`evidence bundle written (evidence_sha256 ${fileSha(o.out)}); it holds no seed — verify-sampling recomputes every state from it`);
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
  'verify-evaluation-tree': cmdVerifyEvaluationTree, 'archive-merkle-root': cmdArchiveMerkleRoot, 'evaluation-items': cmdEvaluationItems, 'verify-evaluation': cmdVerifyEvaluation,
  'rater-packet': cmdRaterPacket, 'verify-rater-packet': cmdVerifyRaterPacket,
  'rater-assignment-fingerprint': cmdRaterAssignmentFingerprint, 'verify-rater-assignment': cmdVerifyRaterAssignment, 'ingest-ratings': cmdIngestRatings,
  'rating-adjudication-packet': cmdRatingAdjudicationPacket, 'resolve-rating-adjudication': cmdResolveRatingAdjudication, analyze: cmdAnalyze,
  'sampling-evidence-bundle': cmdSamplingEvidenceBundle,
};
const o = args(process.argv.slice(2));
const cmd = o._[0];
if (!COMMANDS[cmd]) {
  console.log(`usage: node cpg_u1_data.mjs <${Object.keys(COMMANDS).join('|')}> [options] — see README.md`);
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(COMMANDS[cmd](o)).catch((e) => fail(`UNEXPECTED: ${e.message}`));
