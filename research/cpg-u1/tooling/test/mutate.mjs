// Mutation check for the tooling: each mutation disables one protocol guard in a THROWAWAY COPY;
// the self-test must then fail. Originals are never written. `--anchors` only verifies that every
// anchor occurs exactly once. `--jobs N` runs N mutants concurrently (default 4).
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const anchorsOnly = argv.includes('--anchors');
const jobs = Number(argv[argv.indexOf('--jobs') + 1]) || 4;

// CPG-037A: the self-test requires CPG_U1_RESOLVER_CLONE. Without it every mutant's self-test would exit on the
// missing input and be falsely counted as KILLED, so the mutation run refuses to start instead.
// CPG-044: adapter mutants (marked 'adapter') are ALSO run against test/adapter_conformance.mjs, which needs a resolver clone
// with installed dependencies (CPG_U1_ADAPTER_CLONE). Without it the run refuses to start.
if (!anchorsOnly && !process.env.CPG_U1_ADAPTER_CLONE) {
  console.error('MUTATION RUN PRECONDITION FAILED: CPG_U1_ADAPTER_CLONE is not set (a clone at the frozen SHA with installed dependencies).');
  process.exit(2);
}
if (!anchorsOnly && !process.env.CPG_U1_RESOLVER_CLONE) {
  console.error('MUTATION RUN PRECONDITION FAILED: CPG_U1_RESOLVER_CLONE is not set (see README "Reproducibility").');
  process.exit(2);
}
const S = 'lib/schema.mjs'; const SC = 'lib/scan.mjs'; const SEL = 'lib/select.mjs'; const SZ = 'lib/sizing.mjs';
const RC = 'lib/reconcile.mjs'; const CLI = 'cpg_u1_data.mjs';
const BT = 'lib/bitcoin.mjs'; const DRN = 'lib/drand.mjs'; const CMT = 'lib/commitment.mjs'; const REG = 'lib/registration.mjs'; const SAM = 'lib/sampling.mjs';
const FRM = 'lib/frame.mjs'; const RO = 'lib/raterOrder.mjs'; const PKT = 'lib/packets.mjs'; const PER = 'lib/personnel.mjs'; const EXE = 'lib/execution.mjs';
const ADP = 'harness/cpgAdapter.ts'; const CEX = 'lib/cpgExecutor.mjs';
const ETR = 'lib/evaluationTree.mjs';
const EVL = 'lib/eventlog.mjs'; const HAR = 'lib/harness.mjs'; const ARC = 'lib/archive.mjs'; const RPK = 'lib/raterPackets.mjs';
const EVA = 'lib/evaluation.mjs'; const ASG = 'lib/assignment.mjs'; const RAT = 'lib/ratings.mjs'; const ANA = 'lib/analysis.mjs'; const EBU = 'lib/evidenceBundle.mjs';
const ENU = 'lib/enumeration.mjs'; const IDN = 'lib/identity.mjs';

const MUTATIONS = [
  // ── retained from CPG-037A (M23 seed stage separation, M24 reveal check, M25 equal seeds, M26 CLI append-only: code removed or moved) ──
  ['M01 unknown attestation counts as pass', S, "const tri = (v) => (v === 'yes' ? 'pass'", "const tri = (v) => (v === 'yes' || v === 'unknown' ? 'pass'"],
  ['M02 unknown contamination attestation ignored', S, "if (r[c] === 'unknown') contamination.push(", "if (false) contamination.push("],
  ['M03 UNKNOWN domain passes A2', S, "adm.A2 = r.a2_domain_controlled_https === 'no' ? 'fail' : 'unknown';", "adm.A2 = r.a2_domain_controlled_https === 'no' ? 'fail' : 'pass';"],
  ['M04 UNKNOWN identifier passes A3', S, "if (r.identifier_scheme === UNKNOWN) adm.A3 = 'unknown';", "if (r.identifier_scheme === UNKNOWN) adm.A3 = 'pass';"],
  ['M05 blank accepted instead of explicit UNKNOWN', S, "if (r[c] === '') errors.push(", "if (false) errors.push("],
  ['M06 unknown outcome class admissible', S, "if (!exclusion && r.expected_outcome_class === 'unknown') exclusion = 'OUTCOME_CLASS_NOT_ESTABLISHED';", ''],
  ['M07 A4 evidence URL not required', S, "adm.A4 = a4 === 'pass' && !evidenceOk ? 'fail' : a4;", 'adm.A4 = a4;'],
  ['M08 www domains accepted', S, "if (/^www\\./.test(r.canonical_domain)) errors.push(", 'if (false) errors.push('],
  ['M09 forbidden value kinds accepted', S, 'if (FORBIDDEN_KINDS.includes(r.value_kind)) {', 'if (false) {'],
  ['M37 STATED value format not enforced', S, 'else if (VALUE_FORMAT[r.field] && !VALUE_FORMAT[r.field].re.test(r.expected_value)) {', 'else if (false) {'],
  ['M10 synthetic rows accepted in real frames', S, 'if (!allowSynthetic && (r.company_name.startsWith(SYNTHETIC_PREFIX)', 'if (false && (r.company_name.startsWith(SYNTHETIC_PREFIX)'],
  ['M11 CPG implementation scope dropped', SC, "if (CPG_IMPLEMENTATION_PATH.test(p)) return 'CPG_IMPLEMENTATION';", ''],
  ['M12 registry domain matched by bare suffix', SC, 'domain === d || domain.endsWith(`.${d}`)', 'domain.endsWith(d)'],
  ['M13 registry name matched as substring', SC, 'return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, \'i\');', 'return new RegExp(`${body}`, \'i\');'],
  ['M14 held-out admits ineligible companies', SEL, 'admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))', 'admissible.filter((c) => !developmentIds.has(c.candidate_id))'],
  ['M15 held-out may reuse development companies', SEL, 'admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))', 'admissible.filter((c) => !ineligible.has(c.candidate_id))'],
  ['M16 pool multiplier ignored', SEL, 'const need = POOL_MULTIPLIER * quotas[cls];', 'const need = quotas[cls];'],
  ['M17 development not capped at quota', SEL, 'development.push(...ordered.slice(0, DEVELOPMENT_QUOTA[cls]));', 'development.push(...ordered);'],
  ['M18 duplicate canonical domain allowed', SEL, 'if (domains.has(c.canonical_domain)) throw', 'if (false) throw'],
  ['M19 rank keyed on name (re-rollable)', SEL, 'export const rankKey = (seed, c) => sha256(`${seed}|${idKey(c)}`);', 'export const rankKey = (seed, c) => sha256(`${seed}|${c.company_name}`);'],
  ['M20 sizing floor removed', SZ, "Math.max(HELD_OUT_BASE['fill-expected'], raw)", 'raw'],
  ['M21 zero-fill pilot does not halt', SZ, 'if (total === 0) {', 'if (false) {'],
  ['M22 cap not flagged', SZ, 'capped: raw > SIZING.CAP_FILL_EXPECTED', 'capped: false'],
  ['M27 scan registry binding skipped', CLI, 'if (scan.registry_sha256 !== fileSha(registryPath)) fail(', 'if (false) fail('],
  ['M28 scan frame binding skipped', CLI, 'if (scan.frame_hash !== frameHash) fail(', 'if (false) fail('],
  ['M29 pilot not bound to development manifest', CLI, 'if (pilot.dev_manifest_sha256 !== fileSha(devPath)) fail(', 'if (false) fail('],
  ['M30 seal accepts hand-edited reference', CLI, 'if (readText(refPath) !== toCsv(REFERENCE_COLUMNS, rows)) fail(', 'if (false) fail('],
  ['M31 outputs overwritable', CLI, 'if (existsSync(path)) fail(', 'if (false) fail('],
  ['M32 repo SHA not enforced', CLI, 'if (head !== expectSha) fail(', 'if (false) fail('],
  ['M33 author may confirm own record', RC, 'if (a.recorded_by.trim() === c.recorded_by.trim()) {', 'if (false) {'],
  ['M34 adjudication may override agreement', RC, 'if (j) { errors.push(`${k}: adjudication supplied', 'if (false) { errors.push(`${k}: adjudication supplied'],
  ['M35 adjudicator may be author/confirmer', RC, 'if ([a.recorded_by.trim(), c.recorded_by.trim()].includes(j.adjudicated_by.trim())) {', 'if (false) {'],
  ['M36 disagreement silently resolved to author', RC, "if (!j) { errors.push(`${k}: author and confirmer disagree (${agreementKey(a)} vs ${agreementKey(c)}) — independent adjudication required`); continue; }", "if (!j) { rows.push({ candidate_id: id, field, resolution: 'AGREED' }); continue; }"],

  // ── CPG-041: Bitcoin verification ──
  ['M38 proof of work not checked', BT, 'if (BigInt(`0x${header.hash}`) > target) throw', 'if (false) throw'],
  ['M39 target above powLimit accepted', BT, 'if (target === 0n || target > params.powLimit) throw', 'if (target === 0n) throw'],
  ['M40 header linkage not checked', BT, 'if (hd.prev !== prev.hash) throw', 'if (false) throw'],
  ['M41 nBits may change inside a period', BT, 'if (hd.bits !== prev.bits) throw', 'if (false) throw'],
  ['M42 retarget not recomputed', BT, 'if (hd.bits !== want) throw', 'if (false) throw'],
  ['M43 retarget lower clamp removed', BT, 'if (span < params.targetTimespan / 4n) span = params.targetTimespan / 4n;', ''],
  ['M44 timestamp vs median-time-past not checked', BT, 'hd.time <= medianTimePast(chain, height - 1)', 'false'],
  ['M45 MTP uses newest instead of median', BT, 'return times[5];', 'return times[10];'],
  ['M46 archive need not start at retarget boundary', BT, 'if (!Number.isInteger(start) || start % params.retargetInterval !== 0) throw', 'if (!Number.isInteger(start)) throw'],
  ['M47 registered checkpoint hash not enforced', BT, 'if (cp.hash !== checkpoint.hash) throw', 'if (false) throw'],
  ['M48 header sources not compared', BT, 'if (a.at(h).hash !== b.at(h).hash) throw', 'if (false) throw'],
  ['M49 Merkle sibling order ignored', BT, 'h = p & 1 ? sha256d(Buffer.concat([sib, h])) : sha256d(Buffer.concat([h, sib]));', 'h = sha256d(Buffer.concat([h, sib]));'],
  ['M50 Merkle position range unchecked', BT, '|| pos >= 2 ** branch.length) throw', ') throw'],
  ['M51 trailing transaction bytes accepted', BT, 'if (r.offset !== buf.length) throw', 'if (false) throw'],
  ['M52 txid computed over witness serialization', BT, 'return { txid: toDisplay(sha256d(stripped))', 'return { txid: toDisplay(sha256d(buf))'],
  ['M53 64-byte transaction accepted', BT, 'if (stripped.length === 64) throw', 'if (false) throw'],
  ['M54 non-canonical CompactSize accepted', BT, "if (v < 0xfd) throw new Error('non-canonical CompactSize');", ''],
  ['M55 several OP_RETURN outputs accepted', BT, 'if (opReturns.length !== 1) throw', 'if (opReturns.length < 1) throw'],
  ['M56 OP_RETURN length not exact', BT, 'if (s.length !== 41 || s[1] !== 0x27) throw', 'if (s.length < 41) throw'],
  ['M57 OP_RETURN tag not checked', BT, 'if (!s.subarray(2, 7).equals(COMMITMENT_TAG)) throw', 'if (false) throw'],
  ['M58 OP_RETURN version not checked', BT, 'if (s[7] !== COMMITMENT_VERSION) throw', 'if (false) throw'],
  ['M59 coinbase treated as a spend', BT, 'export const spendsOutpoint = (tx, outpoint) => !tx.coinbase && ', 'export const spendsOutpoint = (tx, outpoint) => '],
  ['M60 synthetic network allowed outside test mode', BT, "if (!allowSynthetic) throw new Error('synthetic-test network", "if (false) throw new Error('synthetic-test network"],
  ['M61 negative compact target accepted', BT, 'if (negative || overflow) throw', 'if (overflow) throw'],

  // ── CPG-041: drand / BLS ──
  ['M62 BLS pairing result ignored', DRN, 'if (!bls12_381.fields.Fp12.eql(e, bls12_381.fields.Fp12.ONE)) return', 'if (false) return'],
  ['M63 wrong hash-to-curve DST', DRN, "export const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';", "export const DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_';"],
  ['M64 round message not hashed', DRN, 'const Hm = G1.hashToCurve(sha256(msg), { DST });', 'const Hm = G1.hashToCurve(msg, { DST });'],
  ['M65 relay randomness not compared', DRN, 'if (v.randomnessHex !== beacon.randomness) throw', 'if (false) throw'],
  ['M66 chain info not pinned', DRN, 'if (got[k] !== QUICKNET[k]) throw', 'if (false) throw'],
  ['M67 3-hour separation removed', DRN, 'export const DELTA_SECONDS = 3 * 60 * 60;', 'export const DELTA_SECONDS = 0;'],
  ['M68 round rule rounds down (round before t)', DRN, 'return Math.ceil((t - QUICKNET.genesis_time) / QUICKNET.period) + 1;', 'return Math.floor((t - QUICKNET.genesis_time) / QUICKNET.period) + 1;'],
  ['M69 missing-round expiry 29 days', DRN, 'export const MISSING_ROUND_EXPIRY_SECONDS = 30 * 24 * 60 * 60;', 'export const MISSING_ROUND_EXPIRY_SECONDS = 29 * 24 * 60 * 60;'],

  // ── CPG-041: commitment payload ──
  ['M70 digest without domain separation', CMT, 'export const payloadDigest = (p) => sha256(`${DIGEST_DOMAIN}|${canonicalJson(p)}`);', 'export const payloadDigest = (p) => sha256(canonicalJson(p));'],
  ['M71 extra payload keys accepted', CMT, '&& Object.keys(obj).length === keys.length ', ''],
  ['M72 append-only: dropped row accepted', CMT, 'if (!Object.hasOwn(hoRowHashes, id)) throw', 'if (false) throw'],
  ['M73 append-only: edited row accepted', CMT, 'if (hoRowHashes[id] !== h) throw', 'if (false) throw'],
  ['M74 development binding may be non-null', CMT, "if (p.stage === 'development' && p.binding !== null) errors.push", 'if (false) errors.push'],
  ['M75 append-only proof not tied to committed frame', CMT, 'if (a.held_out_frame_hash !== p.frame_hash) errors.push', 'if (false) errors.push'],

  // ── CPG-041: registration ──
  ['M76 key custodian role not enforced', REG, "if (kc.role !== 'STUDY_OPERATOR') errors.push", 'if (false) errors.push'],
  // M77's anchor was the pre-DR-12 definition of `assigned`. DR-12 replaced that line, so the anchor is
  // re-pointed at the NEW line and the `to`-string is unchanged: the mutation still deletes the sentinel
  // check and leaves the emptiness check, so this is the same mutant under the same ID.
  ['M77 UNASSIGNED treated as assigned', REG, "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isReservedSentinel(v);", "const assigned = (v) => typeof v === 'string' && v.trim() !== '';"],
  ['M78 embargo allowed', REG, 'if (r.embargo !== false) errors.push', 'if (false) errors.push'],
  ['M79 public registration not required', REG, 'if (r.public !== true) errors.push', 'if (false) errors.push'],
  ['M80 parameters not pinned', REG, 'for (const [k, v] of Object.entries(PARAMETERS)) if (p[k] !== v) errors.push', 'for (const [k, v] of Object.entries(PARAMETERS)) if (false) errors.push'],
  ['M81 SYNTHETIC identities accepted', REG, 'else if (synthetic(v) && !allowSynthetic) errors.push', 'else if (false) errors.push'],
  ['M82 earliest-registration authority skipped', REG, 'if (earliest.registration_id !== reg.registration_id) return', 'if (false) return'],
  ['M83 duplicate registration ignored', REG, 'if (dup) return', 'if (false) return'],
  ['M84 withdrawal ignored', REG, 'if (same.some((x) => x.withdrawn === true)) return', 'if (false) return'],
  ['M85 identical outpoints allowed', REG, "if (o.development === o['held-out']) errors.push", 'if (false) errors.push'],

  // ── CPG-041: sampling state machine ──
  ['M86 D = 5', SAM, 'export const D = 6;', 'export const D = 5;'],
  ['M87 K = 11', SAM, 'export const K = 12;', 'export const K = 11;'],
  ['M88 abandonment window 170 days', SAM, 'export const ABANDONMENT_SECONDS = 180 * 24 * 60 * 60;', 'export const ABANDONMENT_SECONDS = 170 * 24 * 60 * 60;'],
  ['M89 seed omits drand randomness', SAM, "x.drandChainHash, dec(x.round, 'drand round'), x.drandRandomness].join('|'));", "x.drandChainHash, dec(x.round, 'drand round')].join('|'));"],
  ['M90 seed omits stage label', SAM, 'sha256([SEED_DOMAIN, x.stage, x.digest,', 'sha256([SEED_DOMAIN, x.digest,'],
  ['M91 randomness offset unchecked', SAM, 'if (x.randHeight !== x.commitHeight + K) throw', 'if (false) throw'],
  ['M92 one header source named twice accepted', SAM, ' || ev.headers.source === ev.headers_crosscheck.source) {', ') {'],
  ['M93 header crosscheck skipped', SAM, 'try { crosscheckArchives(a, b); } catch (e) { throw new EvidenceError(e.message); }', ''],
  ['M94 agreed tip = longer source', SAM, 'const tip = Math.min(a.tipHeight, b.tipHeight);', 'const tip = Math.max(a.tipHeight, b.tipHeight);'],
  ['M95 Merkle inclusion not required', SAM, 'if (!ok) throw new EvidenceError', 'if (false) throw new EvidenceError'],
  ['M96 funding txid not matched to outpoint', SAM, 'if (f.tx.txid !== out[s].txid) throw', 'if (false) throw'],
  ['M97 funding confirmations at checkpoint unchecked', SAM, 'if (f.height + D - 1 > cp.height) return', 'if (false) return'],
  ['M98 P2WPKH slot not required', SAM, 'if (!o || !isP2wpkh(o.script)) return', 'if (!o) return'],
  ['M99 commitment need not spend the outpoint', SAM, 'if (!spendsOutpoint(t.tx, out[stage])) throw', 'if (false) throw'],
  ['M100 pre-registration spend accepted', SAM, 'if (t.height <= cp.height) return', 'if (false) return'],
  ['M101 cross-slot spend accepted', SAM, 'if (spendsOutpoint(t.tx, out[other])) return', 'if (false) return'],
  ['M102 commitment depth not awaited', SAM, 'if (confirmations(chain.tipHeight, t.height) < D) return', 'if (false) return'],
  ['M103 stage byte vs spent outpoint unchecked', SAM, 'if (decoded.stage !== stage) return', 'if (false) return'],
  ['M104 payload digest not verified', SAM, 'if (!c.payload || payloadDigest(c.payload) !== decoded.digest) {', 'if (!c.payload) {'],
  ['M105 payload registration/protocol/tooling binding unchecked', SAM, 'if (p[k] !== reg[k]) return', 'if (false) return'],
  ['M106 payload outpoint unchecked', SAM, 'if (p.outpoint !== reg.outpoints[stage]) return', 'if (false) return'],
  ['M107 held-out binding to development txid unchecked', SAM, 'if (p.binding.development_commitment_txid !== dev.record.commitment_txid) return', 'if (false) return'],
  ['M108 held-out before development finality accepted', SAM, 'if (t.height <= dev.record.randomness_height + D) return', 'if (false) return'],
  ['M109 late commitment accepted', SAM, 'if (medianTimePast(chain, t.height) >= windowStart + ABANDONMENT_SECONDS) return', 'if (false) return'],
  ['M110 unspent stage never abandoned', SAM, 'if (tipMtp >= windowStart + ABANDONMENT_SECONDS) return', 'if (false) return'],
  ['M111 randomness depth not awaited', SAM, 'if (chain.tipHeight < randHeight + D) return', 'if (false) return'],
  ['M112 post-finality reorganisation ignored', SAM, 'if (prior[k] !== record[k]) return', 'if (false) return'],
  ['M113 missing drand round never expires', SAM, 'if (tipMtp >= record.drand_round_time + MISSING_ROUND_EXPIRY_SECONDS) {', 'if (false) {'],
  ['M114 beacon not selected by the computed round', SAM, '.find((b) => b && b.round === round)', '.find((b) => b && b.round >= 1)'],
  ['M115 held-out window starts at registration', SAM, "const windowStart = stage === 'development' ? registrationEpoch(reg) : dev.record.drand_round_time;", 'const windowStart = registrationEpoch(reg);'],
  ['M127 registration after development randomness accepted', SAM, "if (stage === 'development' && registrationEpoch(reg) >= record.drand_round_time) {", 'if (false) {'],
  ['M116 held-out does not wait for development finality', SAM, 'if (dev.state !== STATE.FINAL) return', 'if (false) return'],

  // ── CPG-041: CLI bindings ──
  ['M117 tooling aggregate not enforced', CLI, 'if (aggregate !== reg.tooling_aggregate_sha256) fail(', 'if (false) fail('],
  ['M118 protocol hash not enforced', CLI, "if (fileSha(need(o, 'protocol')) !== reg.protocol_sha256) fail(", "if (fileSha(need(o, 'protocol')) === null) fail("],
  ['M119 registration authority not enforced', CLI, 'if (voidReason) fail(', 'if (false) fail('],
  ['M120 named prerequisites not enforced', CLI, 'if (blockers.length) fail(`BLOCKED — ${blockers.length} named prerequisite(s)', 'if (false) fail(`BLOCKED — ${blockers.length} named prerequisite(s)'],
  ['M121 committed development frame not enforced', CLI, "const res = finalStage(reg, o, 'development', allowSynthetic, prior);\n  const p = res.payload;\n  if (p.frame_hash !== frameHash) fail(", "const res = finalStage(reg, o, 'development', allowSynthetic, prior);\n  const p = res.payload;\n  if (false) fail("],
  ['M122 held-out binding not enforced', CLI, 'if (bad.length) fail(`${STATE.VOID_BINDING}', 'if (false) fail(`${STATE.VOID_BINDING}'],
  ['M123 development record not compared (payload)', CLI, 'if (canonicalJson(dev.record) !== canonicalJson(h.dev.sampling)) fail(', 'if (false) fail('],
  ['M124 development record not compared (held-out draw)', CLI, 'if (canonicalJson(res.developmentRecord) !== canonicalJson(dev.sampling)) fail(', 'if (false) fail('],
  ['M125 draw proceeds before FINAL', CLI, 'if (res.state !== STATE.FINAL) fail(', 'if (false) fail('],
  ['M126 derive-seed prints the raw seed', CLI, "console.log('The seed itself is not printed; the draw commands recompute it internally.');", 'console.log(r.seed);'],

  // ── CPG-043 / Protocol-004: frame sufficiency (B-1, T-3) ──
  ['M128 frame minimum omits the development quota', FRM, 'POOL_MULTIPLIER * MAX_HELD_OUT_QUOTAS[c] + DEVELOPMENT_QUOTA[c]', 'POOL_MULTIPLIER * MAX_HELD_OUT_QUOTAS[c]'],
  ['M129 maximum quota not taken over all pilot outcomes', FRM, 'max[c] = Math.max(max[c], r.quotas[c]);', 'max[c] = r.quotas[c];'],
  ['M130 held-out-ineligible rows counted toward sufficiency', FRM, "r.expected_outcome_class === c && !ineligible.has(r.candidate_id)", 'r.expected_outcome_class === c'],
  ['M131 sufficiency off by one', FRM, 'if (have < FRAME_MINIMUM[c])', 'if (have < FRAME_MINIMUM[c] - 1)'],
  ['M132 duplicate candidates not refused by sufficiency', FRM, 'assertUnique(admissible);\n  const counts = {};', 'const counts = {};'],
  ['M133 development commitment payload for an insufficient frame', CLI, 'if (!suff.ok) fail(', 'if (false) fail('],
  ['M134 committed insufficient frame drawn instead of VOID', CLI, 'if (!suffDraw.ok) fail(', 'if (false) fail('],
  // ── frozen frame / scan / registry (B-1 T-2, B-2 T-1) ──
  ['M135 CLI held-out frame equality skipped', CLI, "if (frameHash !== dev.frame_hash) fail('FRAME_CHANGED", "if (false) fail('FRAME_CHANGED"],
  ['M136 CLI held-out registry equality skipped', CLI, "if (c.registrySha !== dev.registry_sha256) fail('REGISTRY_CHANGED", "if (false) fail('REGISTRY_CHANGED"],
  ['M137 CLI held-out scan equality skipped', CLI, 'if (c.scanSha !== dev.scan_sha256) fail(', 'if (false) fail('],
  ['M138 chain: held-out frame may differ from development', SAM, 'if (p.frame_hash !== dev.payload.frame_hash) return', 'if (false) return'],
  ['M139 chain: held-out scan may differ from development', SAM, 'if (p.scan_sha256 !== dev.payload.scan_sha256) return', 'if (false) return'],
  ['M140 chain: held-out registry may differ from registration', SAM, 'if (p.registry_sha256 !== reg.registry_sha256) return outcome(stage, STATE.VOID_BINDING', 'if (false) return outcome(stage, STATE.VOID_BINDING'],
  // ── rater order (A-3) ──
  ['M141 rater order without domain separation', RO, 'sha256(`${RATER_ORDER_DOMAIN}|${recordSha}|${label}|', 'sha256(`${recordSha}|${label}|'],
  ['M142 rater order ignores the label', RO, '|${recordSha}|${label}|${candidateId}|${field}`', '|${recordSha}|${candidateId}|${field}`'],
  ['M143 sampling record hash not recomputed', RO, 'if (claimed !== recomputed) throw', 'if (false) throw'],
  ['M144 presentation order descending', RO, '(a.k < b.k ? -1 : a.k > b.k ? 1 :', '(a.k < b.k ? 1 : a.k > b.k ? -1 :'],
  ['M145 CLI rater order: seal-to-manifest binding skipped', CLI, "if (seal.held_out?.manifest_sha256 !== fileSha(hoPath)) fail(", 'if (false) fail('],
  ['M146 CLI rater order: sealed record comparison skipped', CLI, 'if (seal.held_out.sampling_record_sha256 !== recordSha) fail(', 'if (false) fail('],
  ['M147 duplicate order items accepted', RO, 'if (seen.has(id)) throw new Error(`duplicate item', 'if (false) throw new Error(`duplicate item'],
  ['M148 Record 1/2 assignment reuses the ordering label', RO, "orderKey(recordSha, 'reference-adjudicator-record-1', candidateId, field)", "orderKey(recordSha, 'reference-adjudicator', candidateId, field)"],
  // ── adjudication packets (A-2, A-4) ──
  ['M149 agreeing reference records released', PKT, 'if (agreementKey(a) === agreementKey(c)) continue;', ''],
  ['M150 reference packet rebuild check skipped', PKT, "if (canonicalJson(packet) !== canonicalJson(expected)) errors.push('packet differs from the deterministic build (extra or missing items, agreeing records", "if (false) errors.push('packet differs from the deterministic build (extra or missing items, agreeing records"],
  ['M151 rating packet rebuild check skipped', PKT, "if (canonicalJson(packet) !== canonicalJson(expected)) errors.push('packet differs from the deterministic build (extra or missing items, agreeing labels", "if (false) errors.push('packet differs from the deterministic build (extra or missing items, agreeing labels"],
  ['M152 recorder identity left in reference records', PKT, "['candidate_id', 'field', 'recorded_by', 'recorded_at', 'constructed_without_cpg']", "['candidate_id', 'field', 'recorded_at', 'constructed_without_cpg']"],
  ['M153 agreeing rating labels released', PKT, 'if (l1 === l2) continue;', ''],
  ['M154 Label A/B assignment reuses the ordering label', RO, "orderKey(recordSha, 'rating-adjudicator-label-a', candidateId, field)", "orderKey(recordSha, 'rating-adjudicator', candidateId, field)"],
  ['M155 blind reference decision mapping inverted', PKT, "const chooseAuthor = (r.decision === 'RECORD_1') === authorFirst;", "const chooseAuthor = (r.decision === 'RECORD_1') !== authorFirst;"],
  // ── personnel (A-1, A-5, A-6) ──
  ['M156 role collision accepted', PER, 'if (holder.has(a.person_id)) errors.push(', 'if (false) errors.push('],
  ['M157 operator may hold an independent role', PER, 'if (a.person_id === reg.operator?.person_id) errors.push(', 'if (false) errors.push('],
  ['M158 unknown independence declaration accepted', PER, "if (d[k] !== 'no') errors.push(", "if (d[k] === 'yes') errors.push("],
  ['M159 organisation confirmation not required', PER, "if (!HEX64.test(a.organisation_confirmation_sha256 ?? '')) errors.push(", 'if (false) errors.push('],
  ['M160 unfilled role not blocking', PER, 'if (n === 0) blockers.push(', 'if (false) blockers.push('],
  // ── execution window / no-preview audit (X-1) ──
  ['M161 held-out preview not flagged', EXE, "        else add(EXECUTION_STATE.PREVIEW, `run ${r.run_id}: held-out company ${id} executed outside the authorized run (preview)`);", '        else {}'],
  ['M162 run before the window accepted', EXE, 'if (start < opens) add(', 'if (false) add('],
  ['M163 post-window execution not distinguished', EXE, 'if (window && at > window.end) add(EXECUTION_STATE.POST_WINDOW', 'if (false) add(EXECUTION_STATE.POST_WINDOW'],
  ['M164 repeated authorized runs accepted', EXE, 'if (authorized.length > 1) add(', 'if (false) add('],
  ['M165 run naming another authorization accepted', EXE, 'if (r.authorization_sha256 !== authSha) {', 'if (false) {'],
  ['M166 execution before the development draw accepted', EXE, 'if (at < devEarliest) add(', 'if (false) add('],
  ['M167 frame company before the held-out draw accepted', EXE, '} else if (at < hoEarliest) {', '} else if (false) {'],
  ['M168 authorized run may execute non-held-out companies', EXE, 'if (inAuthorizedRun && (id === null || !ho.has(id))) {', 'if (false) {'],
  ['M169 seal hash not recomputed', EXE, "if (h !== claimed) throw new Error('seal_hash does not recompute", "if (false) throw new Error('seal_hash does not recompute"],
  ['M170 publication naming another seal accepted', EXE, 'if (sealPublication?.seal_hash !== sealHash) throw', 'if (false) throw'],
  ['M171 tampered authorization accepted', EXE, "if (!HEX64.test(claimed ?? '') || sha256(canonicalJson(rest)) !== claimed) throw", "if (!HEX64.test(claimed ?? '')) throw"],
  ['M172 seal publication before the held-out draw accepted', EXE, "if (epoch(auth.window_opens_at, 'window') < Date.parse(auth.held_out_draw_earliest)) throw", 'if (false) throw'],
  ['M173 authorization with differing frames accepted', EXE, 'if (devManifest.frame_hash !== hoManifest.frame_hash) throw', 'if (false) throw'],
  ['M174 authorization for a manifest the seal does not bind', EXE, 'if (seal.held_out.manifest_sha256 !== hoManifestSha) throw', 'if (false) throw'],
  ['M175 CLI audit exits 0 on VOID', CLI, 'process.exit(r.state === EXECUTION_STATE.CLEAN || r.state === EXECUTION_STATE.NOT_EXECUTED ? 0 : EXIT.VOID);', 'process.exit(0);'],
  // ── CPG-044: role holders, event log, harness gates, archive, rater packets, authorization bindings, CLI switches ──
  ["M176 one holder per independent role not enforced", PER, "else if (role !== 'enumerator' && n > 1) errors.push(", "else if (false) errors.push("],
  ["M177 event hash chain not checked", EVL, "if (e.prev_event_sha256 !== prev) throw", "if (false) throw"],
  ["M178 event hash not recomputed", EVL, "if (eventHash(e) !== e.event_sha256) throw", "if (false) throw"],
  ["M179 unknown event type appended", EVL, "if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type", "if (false) throw new Error(`unknown event type"],
  ["M180 harness ignores registration completeness", HAR, "verify(rc.errors.length === 0 && rc.blockers.length === 0, 'REGISTRATION_INVALID'", "verify(true, 'REGISTRATION_INVALID'"],
  ["M181 harness ignores a void registration", HAR, "verify(!voidReason, 'STUDY_VOID_REGISTRATION'", "verify(true, 'STUDY_VOID_REGISTRATION'"],
  ["M182 harness ignores protocol hash", HAR, "verify(ctx.protocolSha === reg.protocol_sha256, 'PROTOCOL_MISMATCH'", "verify(true, 'PROTOCOL_MISMATCH'"],
  ["M183 harness ignores tooling aggregate", HAR, "verify(ctx.toolingAggregate === reg.tooling_aggregate_sha256, 'TOOLING_MISMATCH'", "verify(true, 'TOOLING_MISMATCH'"],
  ["M184 harness ignores registry hash", HAR, "verify(ctx.registrySha === reg.registry_sha256, 'REGISTRY_MISMATCH'", "verify(true, 'REGISTRY_MISMATCH'"],
  ["M185 harness ignores development manifest study", HAR, "verify(dev.study_id === reg.study_id && dev.registration_id === reg.registration_id, 'STUDY_MISMATCH'", "verify(true, 'STUDY_MISMATCH'"],
  ["M186 harness ignores development manifest bindings", HAR, "verify(dev.protocol_sha256 === reg.protocol_sha256 && dev.tooling_aggregate_sha256 === reg.tooling_aggregate_sha256 && dev.registry_sha256 === reg.registry_sha256, 'MANIFEST_BINDING_MISMATCH'", "verify(true, 'MANIFEST_BINDING_MISMATCH'"],
  ["M187 harness ignores frame hash", HAR, "verify(ctx.frameHash === dev.frame_hash, 'FRAME_MISMATCH'", "verify(true, 'FRAME_MISMATCH'"],
  ["M188 harness ignores scan hash", HAR, "verify(ctx.scanSha === dev.scan_sha256, 'SCAN_MISMATCH'", "verify(true, 'SCAN_MISMATCH'"],
  ["M189 harness ignores resolver commit", HAR, "verify(ctx.resolver?.head === dev.resolver_sha && ctx.resolver?.clean === true, 'RESOLVER_MISMATCH'", "verify(ctx.resolver?.clean === true, 'RESOLVER_MISMATCH'"],
  ["M190 harness accepts a dirty resolver tree", HAR, "verify(ctx.resolver?.head === dev.resolver_sha && ctx.resolver?.clean === true, 'RESOLVER_MISMATCH'", "verify(ctx.resolver?.head === dev.resolver_sha, 'RESOLVER_MISMATCH'"],
  ["M191 harness ignores provider configuration", HAR, "verify(ctx.resolver?.providerConfigurationSha === reg.provider_configuration_sha256, 'PROVIDER_CONFIG_MISMATCH'", "verify(true, 'PROVIDER_CONFIG_MISMATCH'"],
  ["M192 harness ignores development sampling record", HAR, "verify(canonicalJson(devEval.record) === canonicalJson(dev.sampling), 'SAMPLING_RECORD_MISMATCH'", "verify(true, 'SAMPLING_RECORD_MISMATCH'"],
  ["M193 harness ignores a void sampling state", HAR, "verify(!(r.state.startsWith('STUDY_') || r.state.startsWith('STAGE_')), 'STUDY_VOID'", "verify(true, 'STUDY_VOID'"],
  ["M194 harness executes before commitment/randomness final", HAR, "verify(r.state === STATE.FINAL, 'COMMITMENT_NOT_FINAL'", "verify(true, 'COMMITMENT_NOT_FINAL'"],
  ["M195 harness ignores held-out manifest study", HAR, "verify(ho.study_id === reg.study_id && ho.registration_id === reg.registration_id, 'STUDY_MISMATCH'", "verify(true, 'STUDY_MISMATCH'"],
  ["M196 harness ignores held-out manifest bindings", HAR, "verify(ho.protocol_sha256 === reg.protocol_sha256 && ho.tooling_aggregate_sha256 === reg.tooling_aggregate_sha256 && ho.registry_sha256 === reg.registry_sha256, 'MANIFEST_BINDING_MISMATCH'", "verify(true, 'MANIFEST_BINDING_MISMATCH'"],
  ["M197 harness ignores held-out frame", HAR, "verify(ho.frame_hash === ctx.frameHash, 'FRAME_MISMATCH'", "verify(true, 'FRAME_MISMATCH'"],
  ["M198 harness ignores held-out scan", HAR, "verify(ho.scan_sha256 === ctx.scanSha, 'SCAN_MISMATCH'", "verify(true, 'SCAN_MISMATCH'"],
  ["M199 harness ignores held-out sampling record", HAR, "verify(canonicalJson(hoEval.record) === canonicalJson(ho.sampling), 'SAMPLING_RECORD_MISMATCH'", "verify(true, 'SAMPLING_RECORD_MISMATCH'"],
  ["M200 harness proceeds without authorization", HAR, "verify(ctx.authorization, 'AUTHORIZATION_MISSING'", "verify(true, 'AUTHORIZATION_MISSING'"],
  ["M201 harness accepts altered authorization", HAR, "try { authSha = checkAuthorization(ctx.authorization); } catch (e) { refuse('VERIFICATION_FAILURE', 'AUTHORIZATION_ALTERED', e.message); }", "authSha = ctx.authorization.authorization_sha256;"],
  ["M202 harness accepts authorization not derived from sealed artifacts", HAR, "verify(canonicalJson(rebuilt) === canonicalJson(ctx.authorization), 'AUTHORIZATION_MISMATCH'", "verify(true, 'AUTHORIZATION_MISMATCH'"],
  ["M203 harness ignores the execution window", HAR, "if (Date.parse(now()) < Date.parse(ctx.authorization.window_opens_at)) {", "if (false) {"],
  ["M204 preview attempt logged as plain refusal", HAR, "requested.some((x) => expected.includes(x)) ? 'PREVIEW_ATTEMPT' : 'EXECUTION_REFUSED'", "'EXECUTION_REFUSED'"],
  ["M205 harness executes after the window closed", HAR, "if (state.closed > 0) refuse(", "if (false) refuse("],
  ["M206 harness restarts a started run", HAR, "if (state.started > 0) refuse(", "if (false) refuse("],
  ["M207 harness executes a subset/superset of the authorized set", HAR, "if (canonicalJson(requested) !== canonicalJson(expected)) refuse(", "if (false) refuse("],
  ["M208 pilot executes non-development companies", HAR, "if (outside.length) refuse('PREVIEW_ATTEMPT'", "if (false) refuse('PREVIEW_ATTEMPT'"],
  ["M209 run id not validated", HAR, "if (!RUN_ID.test(request.run_id ?? '')) refuse(", "if (false) refuse("],
  ["M210 duplicate candidates accepted", HAR, "if (new Set(ids).size !== ids.length) refuse(", "if (false) refuse("],
  ["M211 non-frame candidates accepted", HAR, "if (unknown.length) refuse(", "if (false) refuse("],
  ["M212 executor failure not recorded as INVALID", HAR, "if (rec.canonical_response === null) invalid.push(id);", ""],
  ["M213 treatment asOf not the registered asOf", HAR, "const input = lookupInput(rows.get(id), ctx.registration.as_of);", "const input = lookupInput(rows.get(id), new Date().toISOString());"],
  ["M214 closed run may be closed again", HAR, "if (st.closed > 0) throw new Error('the authorized run is already closed');", ""],
  ["M215 pilot run id may overwrite archive", HAR, "if (existsSync(join(archiveDir, request.run_id))) refuse('MALFORMED_EXECUTION', 'ARCHIVE_EXISTS', 'archive directory for run ' + request.run_id + ' already exists (write-once)');\n    appendEvent(logPath, 'PILOT_RUN_STARTED'", "appendEvent(logPath, 'PILOT_RUN_STARTED'"],
  ["M216 archive record hash not recomputed", ARC, "if (!HEX64.test(claimed ?? '') || sha256(canonicalJson(body)) !== claimed) errors.push('record_sha256", "if (!HEX64.test(claimed ?? '')) errors.push('record_sha256"],
  ["M217 archive raw response hash not checked", ARC, "if (rec.raw_response !== null && sha256(rec.raw_response) !== rec.raw_response_sha256) errors.push(", "if (false) errors.push("],
  ["M218 archive canonical form not checked", ARC, "if (c !== rec.canonical_response) errors.push(", "if (false) errors.push("],
  ["M219 archive exchange text hash not checked", ARC, "if (want !== x.text_sha256) errors.push(", "if (false) errors.push("],
  ["M220 replay comparison always identical", ARC, "return c === rec.canonical_response ? { identical: true }", "return true ? { identical: true }"],
  ["M221 pilot result accepts tampered records", ARC, "if (errs.length) throw new Error(`archive record ${r.candidate_id}", "if (false) throw new Error(`archive record ${r.candidate_id}"],
  ["M222 pilot result accepts held-out records", ARC, "if (r.stage !== 'development') throw", "if (false) throw"],
  ["M223 pilot result accepts two runs per company", ARC, "if (byId.has(r.candidate_id)) throw", "if (false) throw"],
  ["M224 pilot result accepts missing companies", ARC, "if (missing.length) throw", "if (false) throw"],
  ["M226 rater packet item keys not enforced", RPK, "if (!exactKeys(it, EVALUATION_ITEM_KEYS)) throw", "if (false) throw"],
  ["M227 rater packet reference record not exact", RPK, "if (!exactKeys(it.reference_record, REFERENCE_COLUMNS)) throw", "if (false) throw"],
  ["M228 rater packet reference of another observation", RPK, "if (it.reference_record.candidate_id !== it.candidate_id || it.reference_record.field !== it.field) throw", "if (false) throw"],
  ["M229 rater packet order not the approved derivation", RPK, "const items = presentationOrder(recordSha, label, evaluationItems).map(", "const items = evaluationItems.map((x) => ({ ...x, order_key: '' })).map("],
  ["M230 rater packet verification not byte-comparing", RPK, "return Buffer.compare(Buffer.from(packetBytes), rebuilt) === 0", "return true"],
  ["M231 rater packet accepts non-rater labels", RPK, "if (!RATER_LABELS.includes(label)) throw", "if (false) throw"],
  ["M232 authorization ignores registration bindings", EXE, "if (m[k] !== registration[k]) throw", "if (false) throw"],
  ["M233 authorization ignores study/registration identity", EXE, "if (m.study_id !== registration.study_id || m.registration_id !== registration.registration_id) throw", "if (false) throw"],
  ["M234 authorization accepts differing scans", EXE, "if (devManifest.scan_sha256 !== hoManifest.scan_sha256) throw", "if (false) throw"],
  ["M235 authorization accepts a frame other than the sealed frame", EXE, "if (hashRecords(frameRows, 'candidate_id') !== hoManifest.frame_hash) throw", "if (false) throw"],
  ["M236 authorization ignores sealed sampling records", EXE, "if (seal.development.sampling_record_sha256 !== devRec || seal.held_out.sampling_record_sha256 !== hoRec) throw", "if (false) throw"],
  ["M237 authorization ignores sampling stages", EXE, "if (devManifest.sampling.stage !== 'development' || hoManifest.sampling.stage !== 'held-out') throw", "if (false) throw"],
  ["M238 authorization does not bind asOf", EXE, "as_of: registration.as_of,", "as_of: null,"],
  ["M239 authorization does not bind provider configuration", EXE, "provider_configuration_sha256: registration.provider_configuration_sha256,", "provider_configuration_sha256: null,"],
  ["M240 authorization does not bind the held-out commitment", EXE, "held_out_commitment: commitment(hoManifest, hoRec),", "held_out_commitment: null,"],
  ["M241 CLI test clock allowed outside synthetic registration", CLI, "if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test') fail('CPG_U1_HARNESS_NOW", "if (false) fail('CPG_U1_HARNESS_NOW"],
  ["M242 CLI synthetic executor allowed outside synthetic registration", CLI, "if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test') fail('--synthetic-executor", "if (false) fail('--synthetic-executor"],
  ["M243 CLI resolver dirty state not read", CLI, "clean: git('status', '--porcelain') === ''", "clean: true"],
  ["M245 archive body hash not checked", ARC, "if (sha256(body) !== h.body_sha256 || body.length !== h.body_bytes) errors.push(", "if (false) errors.push("],
  ["M246 Merkle node without domain separation", ARC, "return h256(Buffer.from([1]),", "return h256(Buffer.from([0]),"],
  ["M247 Merkle leaves not in capture order", ARC, "[...(r.replay?.http_events ?? [])].sort((a, b) => a.seq - b.seq)", "[...(r.replay?.http_events ?? [])]"],
  ["M248 run completion without archive Merkle root", HAR, "authorization_sha256: authSha, executed: records.length, invalid, ...archiveMerkleRoot(records) });", "authorization_sha256: authSha, executed: records.length, invalid });"],
  ["M249 harness accepts a resolver clone with environment files", HAR, "verify(Array.isArray(ctx.resolver?.envFiles) && ctx.resolver.envFiles.length === 0, 'RESOLVER_ENV_FILES'", "verify(true, 'RESOLVER_ENV_FILES'"],
  ["M250 run start without §13.1 run metadata", HAR, "candidate_ids: expected, ...runMetadata(ctx), seal_hash: ctx.authorization.seal_hash });", "candidate_ids: expected });"],
  ["M251 CLI does not read environment files", CLI, "const envFiles = readdirSync(clone).filter((f) => /^\\.env/.test(f) && !f.endsWith('.example'));", "const envFiles = [];"],
  ["M252 adapter inherits the operator environment", CEX, "return { ...env, ...PINNED_ENV, CPG_U1_RESOLVER_CLONE: clone };", "return { ...parent, ...PINNED_ENV, CPG_U1_RESOLVER_CLONE: clone };"],
  ["M253 caches not killed for the adapter", CEX, "export const PINNED_ENV = Object.freeze({ CACHE_KILL_ALL: '1' });", "export const PINNED_ENV = Object.freeze({});"],
  ["M254 adapter drops response body bytes", ADP, "ev.chunks.push(Buffer.from(chunk)); ", "", 'adapter'],
  ["M255 adapter does not capture response headers", ADP, "dc.subscribe('undici:request:headers', onHeaders);", "", 'adapter'],
  ["M256 adapter recording fetcher drops exchanges", ADP, "exchanges.push({ seq, requested_url: url, options, result: result ?", "void ({ seq, requested_url: url, options, result: result ?", 'adapter'],
  ["M257 replay miss not reported", ADP, "if (!x) { misses.push(`fetch ${url}`); return null; }", "if (!x) { return null; }", 'adapter'],
  ["M258 adapter does not record body completion", ADP, "ev.complete = true; ev.completed_at = iso();", "ev.completed_at = iso();", 'adapter'],
  // ── CPG-048: §7.1 evaluated software identity ──
  ["M271 treatment content mismatch not refused", ETR, "if (identity.aggregate !== declared.aggregate) {", "if (false) {"],
  ["M272 instrument accepted as treatment", ETR, "if (identity.instrument_paths.length) {", "if (false) {"],
  ["M273 incomplete §7.1 declaration accepted", ETR, "if (missing.length) throw new Error(", "if (false) throw new Error("],
  ["M274 treatment file count not checked", ETR, "if (identity.files !== declared.files) refusals.push(", "if (false) refusals.push("],
  ["M275 dirty treatment clone accepted", ETR, "if (!identity.clean) refusals.push(", "if (false) refusals.push("],
  ["M276 identical content under a rewritten history refused", ETR, "if (identity.commit !== declared.commit) notes.push({ code: 'COMMIT_ID_DIFFERS'", "if (identity.commit !== declared.commit) refusals.push({ code: 'COMMIT_ID_DIFFERS'"],
  ["M277 §7.1 domain not required", ETR, "if (!body.includes(EVALUATION_TREE_DOMAIN)) throw", "if (false) throw"],
  ["M278 protocol need not state the evaluation-tree domain", CLI, "CITED_URL_RULE, EVALUATION_TREE_DOMAIN];", "CITED_URL_RULE];"],
  ["M279 evaluation-tree CLI exits 0 on mismatch", CLI, "fail('EVALUATION_TREE_MISMATCH: this clone is not the evaluated treatment declared in §7.1');", ""],
  // ── CPG-045: §12.3 Rule A (cited source URLs) ──
  ["M259 cited URLs filtered by value agreement", RPK, "    if (url === null) continue;", "    if (url === null || e.value !== response?.grounding?.facts?.[FIELD_TO_FACT[field]]?.effectiveValue) continue;"],
  ["M260 cited URLs filtered by source authority", RPK, "    if (typeof url !== 'string' || !isHttpsUrl(url)) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} sourceUrl is not an https URL`);", "    if (typeof url !== 'string' || !isHttpsUrl(url)) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} sourceUrl is not an https URL`);\n    if (e.authority !== 'authoritative') continue;"],
  ["M261 duplicate cited URLs not removed", RPK, "    if (!urls.includes(url)) urls.push(url);", "    urls.push(url);"],
  ["M262 cited URLs reordered", RPK, "  return urls;\n}", "  return urls.sort();\n}"],
  ["M263 malformed cited URL silently dropped", RPK, "if (typeof url !== 'string' || !isHttpsUrl(url)) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} sourceUrl is not an https URL`);", "if (typeof url !== 'string' || !isHttpsUrl(url)) continue;"],
  ["M264 missing grounding view treated as no URLs", RPK, "if (!view || typeof view !== 'object') throw new Error(`${record.candidate_id}|${field}: the response carries no grounding view for this field`);", "if (!view || typeof view !== 'object') return [];"],
  ["M265 evidence record without sourceUrl accepted", RPK, "if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'sourceUrl')) throw new Error(`${record.candidate_id}|${field}: evidence record ${i} has no sourceUrl field`);", "if (!e || typeof e !== 'object') continue;"],
  ["M266 another field's evidence cited", RPK, "const view = response?.grounding?.facts?.[FIELD_TO_FACT[field]];", "const view = Object.values(response?.grounding?.facts ?? {})[0];"],
  ["M267 item cited URLs not validated as https", RPK, "if (!Array.isArray(it.cpg_source_urls) || it.cpg_source_urls.some((u) => typeof u !== 'string' || !isHttpsUrl(u))) throw", "if (!Array.isArray(it.cpg_source_urls) || it.cpg_source_urls.some((u) => typeof u !== 'string')) throw"],
  ["M268 duplicate item cited URLs accepted", RPK, "if (new Set(it.cpg_source_urls).size !== it.cpg_source_urls.length) throw", "if (false) throw"],
  ["M269 packet does not record the cited-URL rule", RPK, "const body = { schema: RATER_PACKET_SCHEMA, label, cited_url_rule: CITED_URL_RULE,", "const body = { schema: RATER_PACKET_SCHEMA, label,"],
  ["M270 protocol need not state the cited-URL rule", CLI, "CITED_URL_RULE, EVALUATION_TREE_DOMAIN];", "EVALUATION_TREE_DOMAIN];"],
  // ── DEEPTECH-PARALLEL-002: B1 blinded reference adjudication before the seal ──
  ["M300 seal skips the blind reference adjudication", CLI, "const blindAdj = blindReferenceAdjudication(o, dev, ho, author, confirmer, adjudication);", "const blindAdj = { packetSha: null, decisionsSha: null };"],
  ["M301 seal accepts a reference packet that is not the deterministic packet", CLI, "if (errors.length) fail(`BLIND_ADJUDICATION_REFUSED: the reference adjudication packet", "if (false) fail(`BLIND_ADJUDICATION_REFUSED: the reference adjudication packet"],
  ["M302 blind decisions need not cover exactly the packet items", CLI, "if (canonicalJson(got) !== canonicalJson(want)) fail('BLIND_ADJUDICATION_REFUSED", "if (false) fail('BLIND_ADJUDICATION_REFUSED"],
  ["M303 adjudication need not be the resolution of the blind decisions", CLI, "if (rowsKey(resolved) !== rowsKey(adjudication)) fail(", "if (false) fail("],
  ["M304 disagreements sealed without any blind packet", CLI, "if (!expected.items.length && !given('reference-packet') && !given('blind-decisions')) return", "if (true) return"],
  ["M305 seal does not bind the blind packet", CLI, "reference_adjudication_packet_sha256: blindAdj.packetSha,", "reference_adjudication_packet_sha256: null,"],
  ["M306 reference packet verification ignores the seal binding", CLI, "if (o.seal && o.seal !== true && readJson(o.seal)", "if (false && readJson(o.seal)"],
  // ── B5 CLI bindings ──
  ["M307 sealed commands accept a seal whose hash does not recompute", CLI, "try { recomputeSealHash(seal); } catch (e) { fail(`WRONG_SEAL: ${e.message}`); }", ""],
  ["M308 evaluation artifact not checked before use", CLI, "if (errors.length) fail(`EVALUATION_REFUSED: ${errors.join('; ')}`);", "if (false) fail(`EVALUATION_REFUSED: ${errors.join('; ')}`);"],
  ["M309 ratings ingested without verifying the packet", CLI, "if (!v.identical) fail(`RATER_PACKET_MISMATCH: ${v.reason} — labels are ingested", "if (false) fail(`RATER_PACKET_MISMATCH: ${v.reason} — labels are ingested"],
  ["M310 sheet not bound to the published assignment", CLI, "if (sheet.rated_by !== person || sheet.assignment_fingerprint !== fp) fail(", "if (false) fail("],
  ["M311 decisions override allowed outside a synthetic study", CLI, "if (o['allow-synthetic'] !== true || reg?.network !== 'synthetic-test' || reg?.registration_id !== r.seal.registration_id) fail('--decisions", "if (false) fail('--decisions"],
  ["M312 undecided decisions do not block the analysis", CLI, "if (dec.undecided.length) fail(", "if (false) fail("],
  ["M313 invalid decisions file accepted", CLI, "if (dec.errors.length) fail(", "if (false) fail("],
  ["M314 analysis accepts a substituted event log", CLI, "if (!log.events.some((e) => e.event_sha256 === r.evaluation.event_log_head)) fail(", "if (false) fail("],
  ["M315 declarations not checked", CLI, "if (dErr.length) fail(", "if (false) fail("],
  ["M316 evidence bundle written without verification", CLI, "const states = ['development', 'held-out'].map((stage) => evaluate(reg, ev, stage, { allowSynthetic, priorFinal: prior }));", "const states = [];"],
  // ── B5 rater packet binding ──
  ["M317 unbound rater packet accepted", RPK, "if (!HEX64.test(binding?.seal_hash ?? '') || !HEX64.test(binding?.evaluation_sha256 ?? '')) throw", "if (false) throw"],
  ["M318 rater packet omits its seal/evaluation binding", RPK, "seal_hash: binding.seal_hash, evaluation_sha256: binding.evaluation_sha256, item_count", "item_count"],
  // ── B3 pending never adjudicated ──
  ["M319 pending rating treated as a disagreement", PKT, "if (l1 === PENDING || l2 === PENDING) continue;", ""],
  // ── B5/B6 evaluation artifact ──
  ["M320 evaluation trusts the claimed seal hash", EVA, "try { sealHash = recomputeSealHash(seal); } catch (e) { throw new Error(`WRONG_SEAL: ${e.message}`); }", "sealHash = seal.seal_hash;"],
  ["M321 evaluation: seal need not bind the manifest", EVA, "if (seal.held_out?.manifest_sha256 !== hoManifestSha) throw new Error('WRONG_SEAL: the seal does not bind this held-out manifest');", ""],
  ["M322 evaluation: unsealed reference accepted", EVA, "if (referenceSha !== seal.reference_file_sha256) throw", "if (false) throw"],
  ["M323 evaluation: authorisation of another seal accepted", EVA, "if (authorization.seal_hash !== sealHash) throw new Error('WRONG_SEAL: the authorisation names a different seal');", ""],
  ["M324 evaluation: wrong frame accepted", EVA, "if (authorization.frame_hash !== hoManifest.frame_hash || seal.held_out.frame_hash !== hoManifest.frame_hash) throw", "if (false) throw"],
  ["M325 evaluation: authorised set need not equal the sealed set", EVA, "if (!same(authorization.held_out_candidate_ids, hoIds)) throw", "if (false) throw"],
  ["M326 evaluation ignores the execution audit", EVA, "if (audit.state !== EXECUTION_STATE.CLEAN) {", "if (false) {"],
  ["M327 evaluation: wrong treatment accepted", EVA, "if (start.resolver_sha !== seal.resolver_sha || hoManifest.resolver_sha !== seal.resolver_sha) throw", "if (false) throw"],
  ["M328 evaluation: other provider configuration accepted", EVA, "if (start.provider_configuration_sha256 !== authorization.provider_configuration_sha256) throw", "if (false) throw"],
  ["M329 evaluation: other asOf accepted", EVA, "if (start.as_of !== authorization.as_of) throw", "if (false) throw"],
  ["M330 evaluation: misnamed record accepted", EVA, "if (file !== `${id}.json`) throw", "if (false) throw"],
  ["M331 evaluation: altered archive record accepted", EVA, "if (errs.length) throw new Error(`ARCHIVE_REFUSED ${id}: ${errs.join('; ')}`);", ""],
  ["M332 evaluation: record of another run/stage accepted", EVA, "if (record.stage !== 'held-out' || record.run_id !== start.run_id) throw", "if (false) throw"],
  ["M333 evaluation: duplicate record accepted", EVA, "if (records.has(id)) throw new Error(`ARCHIVE_REFUSED ${id}: duplicate record`);", ""],
  ["M334 evaluation: record differing from the logged one accepted", EVA, "if (ev.archive_record_sha256 !== record.record_sha256) throw", "if (false) throw"],
  ["M335 evaluation: executed company silently dropped", EVA, "for (const id of executed.keys()) if (!records.has(id)) throw", "for (const id of executed.keys()) if (false) throw"],
  ["M336 no-response observation read as scorable (abstention)", EVA, "obs = { machine_state: 'INVALID', invalid_reason: rec ? 'NO_RESPONSE_OR_HARNESS_ERROR' : 'NOT_EXECUTED_RUN_INTERRUPTED',", "obs = { machine_state: 'SCORABLE', invalid_reason: rec ? 'NO_RESPONSE_OR_HARNESS_ERROR' : 'NOT_EXECUTED_RUN_INTERRUPTED',"],
  ["M337 missing facts object read as abstentions", EVA, "if (!facts || typeof facts !== 'object' || isArr(facts)) throw", "if (false) throw"],
  ["M338 missing fact key read as an abstention", EVA, "if (!Object.hasOwn(facts, k)) throw", "if (false) throw"],
  ["M339 non-string fact value read as an abstention", EVA, "if (v !== null && (typeof v !== 'string' || !v.trim())) throw", "if (false) throw"],
  ["M340 missing grounding arrays accepted", EVA, "if (!isArr(g[k])) throw", "if (false) throw"],
  ["M341 checkEvaluation trusts the evaluation hash", EVA, "if (sha256(canonicalJson(body)) !== claimed) errors.push(", "if (false) errors.push("],
  ["M342 checkEvaluation: other seal accepted", EVA, "if (ev.seal_hash !== sealHash) errors.push(", "if (false) errors.push("],
  ["M343 checkEvaluation: incomplete item set accepted", EVA, "if (!same(ev.items.map(obsKey), expected)) errors.push(", "if (false) errors.push("],
  ["M344 checkEvaluation: incomplete observations accepted", EVA, "if (!same(ev.observations.map(obsKey), expected)) errors.push(", "if (false) errors.push("],
  ["M345 checkEvaluation: INVALID observation with a value accepted", EVA, "else if (o.machine_state === 'INVALID' && (!INVALID_REASONS.includes(o.invalid_reason) || it.cpg_value !== null || it.cpg_source_urls.length)) errors.push(", "else if (false) errors.push("],
  ["M346 checkEvaluation: unknown machine state accepted", EVA, "else if (!MACHINE_STATES.includes(o.machine_state)) errors.push(", "else if (false) errors.push("],
  ["M347 checkEvaluation: other treatment accepted", EVA, "if (ev.resolver_sha !== seal?.resolver_sha) errors.push(", "if (false) errors.push("],
  // ── §4A.3 rater assignment ──
  ["M348 one person may hold two rating labels", ASG, "if (new Set(ASSIGNED_LABELS.map((l) => m[l])).size !== ASSIGNED_LABELS.length) errors.push(", "if (false) errors.push("],
  ["M349 assignment not checked against the personnel register", ASG, "if (holders.length !== 1 || holders[0] !== m[l]) errors.push(", "if (false) errors.push("],
  ["M350 assignment nonce not required", ASG, "if (!HEX64.test(a.nonce ?? '')) errors.push(", "if (false) errors.push("],
  ["M351 assignment need not match the published fingerprint", ASG, "if (!HEX64.test(publishedFingerprint ?? '') || assignmentFingerprint(a) !== publishedFingerprint) throw", "if (false) throw"],
  ["M352 assignment extra fields accepted", ASG, "if (Object.keys(a).length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(a, k))) return", "if (false) return"],
  // ── B2 ingestion ──
  ["M353 rating for an item outside the packet accepted", RAT, "if (!byKey.has(k(r))) { errors.push(", "if (false) { errors.push("],
  ["M354 duplicate rating accepted", RAT, "if (seen.has(k(r))) { errors.push(", "if (false) { errors.push("],
  ["M355 rating by an unassigned person accepted", RAT, "if (r.rated_by !== ratedBy) errors.push(", "if (false) errors.push("],
  ["M356 missing rating row silently allowed", RAT, "for (const key of byKey.keys()) if (!seen.has(key)) errors.push(", "for (const key of byKey.keys()) if (false) errors.push("],
  ["M357 fill label accepted where CPG returned no value", RAT, "if (FILL_LABELS.includes(r.label) && item.cpg_value === null) errors.push(", "if (false) errors.push("],
  ["M358 abstention label accepted where CPG returned a value", RAT, "if (ABSTENTION_LABELS.includes(r.label) && item.cpg_value !== null) errors.push(", "if (false) errors.push("],
  ["M359 sub-reason on the wrong label/field accepted", RAT, "else if (rule.label !== r.label || !rule.fields.includes(r.field)) errors.push(", "else if (false) errors.push("],
  ["M360 unknown rating label accepted", RAT, "if (![...RATING_LABELS, PENDING].includes(r.label)) errors.push(", "if (false) errors.push("],
  ["M361 pending row with a rating date accepted", RAT, "if (r.label === PENDING) { if (r.rated_at !== '') errors.push(", "if (r.label === PENDING) { if (false) errors.push("],
  ["M362 edited sheet accepted", RAT, "if (sha256(canonicalJson(body(sheet, 'sheet_sha256'))) !== sheet.sheet_sha256) errors.push(", "if (false) errors.push("],
  ["M363 sheet accepted under another label", RAT, "if (sheet.label !== label) errors.push(", "if (false) errors.push("],
  // ── B3 rating adjudication ──
  ["M364 same person may rate both sheets", RAT, "if (sheet1.rated_by === sheet2.rated_by) errors.push(", "if (false) errors.push("],
  ["M365 a rater may adjudicate", RAT, "if ([sheet1.rated_by, sheet2.rated_by].includes(adjudicator)) errors.push(", "if (false) errors.push("],
  ["M366 decision on a non-packet item accepted", RAT, "if (!items.has(k(r))) errors.push(", "if (false) errors.push("],
  ["M367 decision by someone other than the rating adjudicator accepted", RAT, "if (r.adjudicated_by !== adjudicator) errors.push(", "if (false) errors.push("],
  ["M368 disagreement left undecided", RAT, "for (const key of items.keys()) if (!seen.has(key)) errors.push(", "for (const key of items.keys()) if (false) errors.push("],
  ["M369 altered resolution accepted", RAT, "if (resolution.schema !== RATING_RESOLUTION_SCHEMA || sha256(canonicalJson(body(resolution, 'resolution_sha256'))) !== resolution.resolution_sha256) errs.push(", "if (false) errs.push("],
  ["M370 resolution bound to other sheets accepted", RAT, "if (resolution.sheet_1_sha256 !== sheet1.sheet_sha256 || resolution.sheet_2_sha256 !== sheet2.sheet_sha256 || resolution.evaluation_sha256 !== evaluation.evaluation_sha256) errs.push(", "if (false) errs.push("],
  ["M371 disagreements scored without a resolution", RAT, "if (!resolution) throw new Error(`RATING_ADJUDICATION_MISSING", "if (false) throw new Error(`RATING_ADJUDICATION_MISSING"],
  ["M372 pending rating scored", RAT, "if (a.label !== PENDING && b.label !== PENDING) {", "if (true) {"],
  // ── B4 analysis ──
  ["M373 G1 threshold lowered", ANA, "const G1 = { fills, threshold: 20, holds: fills >= 20 };", "const G1 = { fills, threshold: 20, holds: fills >= 19 };"],
  ["M374 P1 boundary made strict", ANA, "met: fills > 0 && 20 * bad <= fills", "met: fills > 0 && 20 * bad < fills"],
  ["M375 P2 boundary made strict", ANA, "10 * CA >= 9 * (CA + U)", "10 * CA > 9 * (CA + U)"],
  ["M376 falsification boundary made inclusive", ANA, "else if (M > 0 || 10 * bad > fills) outcome = 'FALSIFIED';", "else if (M > 0 || 10 * bad >= fills) outcome = 'FALSIFIED';"],
  ["M377 misattribution does not falsify", ANA, "else if (M > 0 || 10 * bad > fills) outcome = 'FALSIFIED';", "else if (10 * bad > fills) outcome = 'FALSIFIED';"],
  ["M378 INCONCLUSIVE not checked first", ANA, "if (inconclusive.length) outcome = 'INCONCLUSIVE';", "if (false) outcome = 'INCONCLUSIVE';"],
  ["M379 §15.5(2) VALID share ignored", ANA, "triggered: 10 * valid.length < 9 * total", "triggered: false"],
  ["M380 §15.5(3) α threshold ignored", ANA, "(alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha))", "(alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : false)"],
  ["M381 α threshold changed", ANA, "1000 * (a.expected_den - a.observed_num) < 667 * a.expected_den", "1000 * (a.expected_den - a.observed_num) < 600 * a.expected_den"],
  ["M382 completely-rated share threshold changed", ANA, "10 * completelyRated < 9 * total", "10 * completelyRated < 8 * total"],
  ["M383 §15.5(4) registry threshold changed", ANA, "triggered: 10 * registryDown.length > companies.length", "triggered: 10 * registryDown.length > 2 * companies.length"],
  ["M384 AD-4 decisive-identifier option ignored", ANA, "return o.registry_unavailable.some((x) => x.identifier === heldOut.get(id).identifier_value);", "return o.registry_unavailable.length > 0;"],
  ["M385 §15.5(5) SOURCE-COINCIDENT boundary made inclusive", ANA, "10 * sc > 6 * valid.length", "10 * sc >= 6 * valid.length"],
  ["M386 AD-3 exact option ignored", ANA, "return urls.includes(ref.source_url);", "return urls.map(stripFragment).includes(stripFragment(ref.source_url));"],
  ["M387 §15.5(6) seal publication ignored", ANA, "triggered: sealPublication?.seal_hash !== evaluation.seal_hash ||", "triggered: false ||"],
  ["M388 §15.5(7) protocol violation ignored", ANA, "'7_protocol_violation': { triggered: declarations.protocol_violations.length > 0,", "'7_protocol_violation': { triggered: false,"],
  ["M389 VOID execution audit not VOID", ANA, "if (audit.state.startsWith('STUDY_VOID')) voidBasis.push(", "if (false) voidBasis.push("],
  ["M390 AD-7 VOID option ignored", ANA, "if (declarations.protocol_violations.length && D['AD-7'] === 'VOID') voidBasis.push(", "if (false) voidBasis.push("],
  ["M391 machine INVALID not applied (enters abstention)", ANA, "else if (o.machine_state === 'INVALID') { disposition = 'INVALID'; reason = o.invalid_reason; }", "else if (false) { disposition = 'INVALID'; reason = o.invalid_reason; }"],
  ["M392 identity inadmissibility ignored", ANA, "if (inadmissible.has(it.candidate_id)) { disposition = 'INVALID';", "if (false) { disposition = 'INVALID';"],
  ["M393 sealed REFERENCE-CONFLICT scored", ANA, "else if (ref.resolution === 'REFERENCE_CONFLICT')", "else if (false)"],
  ["M394 staleness boundary made inclusive", ANA, "ref.as_of_date < cutoff)", "ref.as_of_date <= cutoff)"],
  ["M395 temporal rule applied to founded_year", ANA, "['employee_count', 'revenue_range'].includes(it.field) &&", "true &&"],
  ["M396 AD-6 scope ignored", ANA, "(D['AD-6'] === 'ALL_REFERENCE_RECORDS' || ref.value_kind === 'STATED')", "true"],
  ["M397 rater REFERENCE-AMBIGUOUS scored", ANA, "else if (f.final.label === 'REFERENCE-AMBIGUOUS') disposition = 'REFERENCE-AMBIGUOUS';", "else if (false) disposition = 'REFERENCE-AMBIGUOUS';"],
  ["M398 α computed on adjudicated labels", ANA, "alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label]))", "alphaNominal(alphaPop.map((r) => [r.label ?? r.rater_1_label, r.label ?? r.rater_2_label]))"],
  ["M399 AD-1 exclusion option ignored", ANA, "(D['AD-1'] === 'ALL_COMPLETELY_RATED_ITEMS' || !", "(true || !"],
  ["M400 AD-2 option ignored", ANA, "(alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha))", "(alphaUndefined ? true : alphaBelow(alpha))"],
  ["M401 AD-8 option ignored", ANA, "const p2Inconclusive = !arDefined && D['AD-8'] === 'INCONCLUSIVE';", "const p2Inconclusive = false;"],
  ["M402 calendar months not clamped", ANA, "Math.min(d.getUTCDate(), last)", "d.getUTCDate()"],
  ["M403 AD-9 option ignored", ANA, "(D['AD-9'] === 'ANY_UNAVAILABLE_ENTRY' ? o.registry_unavailable.length + o.unavailable_sources.length > 0 : o.registry_unavailable.length > 0)", "(o.registry_unavailable.length + o.unavailable_sources.length > 0)"],
  ["M404 UNDECIDED not recognised", ANA, "if (d.value === UNDECIDED) undecided.push(id);", "if (false) undecided.push(id);"],
  ["M405 decision options not pinned", ANA, "if (canonicalJson(d.options) !== canonicalJson(DECISIONS[id])) errors.push(", "if (false) errors.push("],
  ["M406 decision value outside options accepted", ANA, "else if (!DECISIONS[id].includes(d.value)) errors.push(", "else if (false) errors.push("],
  ["M407 decision set not exact", ANA, "if (canonicalJson(ids) !== canonicalJson(Object.keys(DECISIONS).sort())) errors.push(", "if (false) errors.push("],
  ["M408 declarations of another seal accepted", ANA, "if (d.seal_hash !== sealHash) errors.push(", "if (false) errors.push("],
  ["M409 inadmissibility of a non-held-out company accepted", ANA, "if (!x || !heldOutIds.includes(x.candidate_id)) errors.push(", "if (false) errors.push("],
  ["M410 α coincidence weight wrong", ANA, "const num = (n - 1) * 2 * disagreements;", "const num = n * 2 * disagreements;"],
  // ── §13.2A evidence bundle ──
  ["M411 one header source accepted twice", EBU, "if (headers.source === crosscheck.source) throw", "if (false) throw"],
  ["M412 conflicting relay beacons accepted", EBU, "if (prior && (prior.randomness !== v.randomness || prior.signature !== v.signature)) throw", "if (false) throw"],
  ["M413 held-out commitment bundled without development", EBU, "if (commitments['held-out'] && !commitments.development) throw", "if (false) throw"],
  ["M414 commitment bundled without its payload", EBU, "if (!c.payload || typeof c.payload !== 'object') throw", "if (false) throw"],
  ["M415 malformed transaction hex accepted by the builder", EBU, "if (typeof p.tx_hex !== 'string' || !HEX.test(p.tx_hex)) throw", "if (false) throw"],
  // ── §19.3 / §21 step 5: the ≥ 2 differently named drand relay floor and its per-relay attribution (DR-1) ──
  ["M416 beacon accepted without a well-formed named relay", EBU, "if (typeof b.relay !== 'string' || !b.relay.trim() || b.relay.trim() !== b.relay) throw", "if (false) throw"],
  ["M417 single-relay round accepted by the verifier", SAM, "if (relays.size < MIN_DRAND_RELAYS) throw new EvidenceError(", "if (false) throw new EvidenceError("],
  ["M418 the same relay counted twice towards the floor", EBU, "if (!prior.relays.includes(b.relay)) prior.relays.push(b.relay);", "prior.relays.push(b.relay);"],
  // ── DR-10 (DEEPTECH-PARALLEL-009): the cmdScan duplicate collapse ──
  ["M419 scan state keyed on candidate_id (the historical collapse restored)", CLI, 'const state = frame.map((r, i) => ({ r, record: i + 1, tokens: tokensFor(r), hits: [] }));', 'const state = new Map(frame.map((r) => [r.candidate_id, { r, tokens: tokensFor(r), hits: [] }]));'],
  ["M420 duplicate candidate_id in a scanned frame not refused", CLI, 'if (repeated.length) {', 'if (false) {'],
  ["M421 a pair of occurrences not counted as a duplicate", CLI, 'filter(([, list]) => list.length > 1)', 'filter(([, list]) => list.length > 2)'],
  ["M422 duplicate occurrence reported without its contamination reason", CLI, "why.length ? why.join(' ; ') : 'no contamination found in this occurrence'", "''"],
  ["M423 duplicate occurrence reported without its source record", CLI, 'record ${c.record}:', 'record:'],
  // ── DEEPTECH-PARALLEL-009: §4A.2 enumeration attribution (the last two are POSITIVE controls: the mutant must break acceptance) ──
  ["M424 forged/unregistered enumerator accepted", ENU, "if (a.id && !eligible.has(a.id)) errors.push(", "if (false) errors.push("],
  ["M425 enumerator not eligible under §4A.1 accepted", ENU, "errors.push(...reg.errors.map((e) => `personnel register: ${e}`));", ""],
  ["M426 any registered role accepted as enumerator", ENU, ".filter((a) => a?.role === ENUMERATOR_ROLE)", ".filter((a) => typeof a?.role === 'string')"],
  ["M427 row without an enumerator identity accepted", ENU, "for (const a of attributed) if (!a.id) errors.push(", "for (const a of attributed) if (false) errors.push("],
  ["M428 one person in both enumerator slots accepted", ENU, "if (new Set(enumerators).size !== enumerators.length) errors.push(", "if (false) errors.push("],
  ["M429 POSITIVE CONTROL: registered enumerator A no longer resolves", ENU, ".filter((a) => a?.role === ENUMERATOR_ROLE)", ".filter((a) => a?.role === 'rater-1')"],
  ["M430 POSITIVE CONTROL: only the first registered enumerator resolves (B rejected)", ENU, ".map((a) => a.person_id);", ".map((a) => a.person_id).slice(0, 1);"],

  // == DEEPTECH-PARALLEL-013 · DR-12 (§6): normalisation of the reserved UNASSIGNED sentinel. M431-M436.
  //    M433 and M435 are POSITIVE CONTROLS: the mutant must break ACCEPTANCE of a legitimate case.
  ["M431 sentinel compared without trimming (surrounding-whitespace variant read as assigned)", IDN, "export const trimmedFor = (v) => (typeof v === 'string' ? v.trim() : '');", "export const trimmedFor = (v) => (typeof v === 'string' ? v : '');"],
  ["M432 sentinel compared case-sensitively (lowercase unassigned read as assigned)", IDN, "export const isReservedSentinel = (v) => trimmedFor(v).toUpperCase() === UNASSIGNED;", "export const isReservedSentinel = (v) => trimmedFor(v) === UNASSIGNED;"],
  ["M433 POSITIVE CONTROL: internal whitespace squashed, so UN ASSIGNED stops being ASSIGNED", IDN, "export const isReservedSentinel = (v) => trimmedFor(v).toUpperCase() === UNASSIGNED;", "export const isReservedSentinel = (v) => trimmedFor(v).replace(/\\s+/g, '').toUpperCase() === UNASSIGNED;"],
  ["M434 empty / whitespace-only value no longer unassigned", IDN, "export const isEmptyValue = (v) => trimmedFor(v) === '';", "export const isEmptyValue = (v) => false;"],
  ["M435 POSITIVE CONTROL: only empty values count as assigned, so legitimate values stop being assigned", IDN, "export const assignedValue = (v) => typeof v === 'string' && !isEmptyValue(v) && !isReservedSentinel(v);", "export const assignedValue = (v) => typeof v === 'string' && isEmptyValue(v) && !isReservedSentinel(v);"],
  ["M436 DR-12 defect restored: registration compares the sentinel untrimmed and case-sensitively", REG, "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isReservedSentinel(v);", "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;"],
  // == DEEPTECH-PARALLEL-013 · R28 (§3): identity / authority validation. M437-M459.
  ["M437 non-string identity value not MALFORMED", IDN, "if (typeof raw !== 'string') return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_NOT_A_STRING'", "if (false) return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_NOT_A_STRING'"],
  ["M438 EMPTY not distinguished as its own class", IDN, "if (isEmptyValue(raw)) return verdict(IDENTITY_CLASS.EMPTY,", "if (false) return verdict(IDENTITY_CLASS.EMPTY,"],
  ["M439 RESERVED/UNASSIGNED not distinguished as its own class", IDN, "if (isReservedSentinel(raw)) return verdict(IDENTITY_CLASS.RESERVED,", "if (false) return verdict(IDENTITY_CLASS.RESERVED,"],
  ["M440 control / zero-width / bidi characters accepted in an identity", IDN, "if (hasInvisibleCharacter(raw)) return verdict(", "if (false) return verdict("],
  ["M441 surrounding-whitespace identity silently canonicalised instead of refused", IDN, "if (raw !== raw.trim()) return verdict(", "if (false) return verdict("],
  ["M442 identity containing the field separator pipe accepted", IDN, "if (raw.includes(DELIMITER)) return verdict(", "if (false) return verdict("],
  ["M443 the instrument's own SYNTHETIC fixture marker no longer detected", IDN, "if (raw.toUpperCase().includes(TEST_FIXTURE_MARKER)) return verdict(", "if (false) return verdict("],
  // M444 RE-POINTED (F4, same ID, same mutant): its anchor was the FOREIGN synthetic-marker list, which F4
  // removed because no document defines those words as forbidden identity tokens. Substring matching still
  // exists, and still matters, for the instrument's OWN fixture marker, so the anchor moves there and the
  // mutation is unchanged in kind: substring match -> whole-value match.
  ["M444 synthetic marker matched only as the whole value, not as a substring", IDN, "raw.toUpperCase().includes(TEST_FIXTURE_MARKER)", "raw.toUpperCase() === TEST_FIXTURE_MARKER"],
  ["M445 reserved placeholder tokens (TBD, PLACEHOLDER) accepted as identities", IDN, "if (PLACEHOLDER_TOKENS.includes(squash(raw))) return verdict(", "if (false) return verdict("],
  ["M446 placeholder token matched case-sensitively (lowercase tbd evades)", IDN, "const squash = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');", "const squash = (v) => v.replace(/[^A-Z0-9]/g, '');"],
  ["M447 placeholder token evaded by punctuation (T.B.D. evades)", IDN, "const squash = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');", "const squash = (v) => v.toUpperCase();"],
  ["M448 zero-pattern identifier accepted", IDN, "if (isZeroPattern(raw)) return verdict(", "if (false) return verdict("],
  ["M449 zero-pattern evaded by group separators", IDN, "const core = String(v).replace(GROUP_SEPARATORS, '');", "const core = String(v);"],
  ["M450 INVARIANT BREACH: an unattested value promoted from PLAUSIBLE to AUTHORITATIVE", IDN, "return verdict(IDENTITY_CLASS.PLAUSIBLE, 'NO_AUTHORITY_ATTESTATION',", "return verdict(IDENTITY_CLASS.AUTHORITATIVE, 'NO_AUTHORITY_ATTESTATION',"],
  ["M451 attestation not bound to the exact value it attests to", IDN, "if (att.resolved_value !== value) e.push(", "if (false) e.push("],
  ["M452 an insufficient attestation promoted to AUTHORITATIVE", IDN, "if (errs.length) return verdict(IDENTITY_CLASS.PLAUSIBLE, 'ATTESTATION_INSUFFICIENT'", "if (false) return verdict(IDENTITY_CLASS.PLAUSIBLE, 'ATTESTATION_INSUFFICIENT'"],
  ["M453 attestation accepted without a UTC resolution instant", IDN, "if (!ISO_UTC.test(att.resolved_at ?? '')) e.push(", "if (false) e.push("],
  ["M454 attestation's authority / resolver / method not themselves screened", IDN, "if (bad) e.push(`attestation.${k} is not an explicit value", "if (false) e.push(`attestation.${k} is not an explicit value"],
  ["M455 self-attestation inside the registration record accepted", CLI, "if (Object.hasOwn(reg, 'identity_attestations')) fail(", "if (false) fail("],
  ["M456 the exit-0 line claims public, unembargoed and authoritative again", CLI, "console.log(`registration ${reg.registration_id}: ESTABLISHED", "console.log(`registration ${reg.registration_id} complete, public, unembargoed, authoritative; ESTABLISHED"],
  // M457 RE-POINTED (F4b, same ID, same mutant): F4b lifted the classification out of the `else if` chain so
  // that a piped registration_id is classified too, which removed the leading `else `. The anchor follows
  // the line; the mutation still deletes the classification and nothing else.
  ["M457 registration_id not identity-screened", REG, "human(reg.registration_id, 'registration_id', 'registration_id');", "if (false) human(reg.registration_id, 'registration_id', 'registration_id');"],
  ["M458 a MALFORMED identity value accepted by the registration check", REG, "else if (c.class === IDENTITY_CLASS.MALFORMED) errors.push(", "else if (false) errors.push("],
  ["M459 a reserved-placeholder identity value accepted by the registration check", REG, "else if (c.class === IDENTITY_CLASS.SYNTHETIC && c.code !== 'SYNTHETIC_MARKER') errors.push(", "else if (false) errors.push("],
  // == DEEPTECH-PARALLEL-013 · R15 (§4): provider-configuration authority. M460-M467.
  ["M460 R15 defect restored: the registered provider hash is never compared with the derived one", HAR, "if (recorded !== derived) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MISMATCH'", "if (false) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MISMATCH'"],
  ["M461 a malformed provider hash accepted instead of blocked", HAR, "if (!PROVIDER_HEX64.test(recorded)) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MALFORMED'", "if (false) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MALFORMED'"],
  ["M462 the current hash taken from the submitted record instead of derived from the clone", HAR, "try { derived = providerConfigurationSha(cloneDir); }", "try { derived = recorded; }"],
  ["M463 provider hash derived from a clone that is not the pinned evaluation tree", HAR, "if (!tree.ok) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_TREE_MISMATCH'", "if (false) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_TREE_MISMATCH'"],
  ["M464 a missing provider hash not blocked", HAR, "if (!assignedValue(recorded)) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MISSING'", "if (false) return out(PROVIDER_CONFIG_VERDICT.BLOCKED, 'PROVIDER_CONFIG_MISSING'"],
  ["M465 an uncompared provider hash reported as ACCEPTABLE when no clone is supplied", HAR, "if (!cloneDir) return out(PROVIDER_CONFIG_VERDICT.NOT_COMPARED, 'PROVIDER_CONFIG_NOT_COMPARED'", "if (!cloneDir) return out(PROVIDER_CONFIG_VERDICT.ACCEPTABLE, 'PROVIDER_CONFIG_NOT_COMPARED'"],
  ["M466 a BLOCKED provider verdict does not stop the command", CLI, "if (provider.verdict === PROVIDER_CONFIG_VERDICT.BLOCKED) fail(", "if (false) fail("],
  ["M467 --require-provider-config does not block an uncompared provider hash", CLI, "if (provider.verdict === PROVIDER_CONFIG_VERDICT.NOT_COMPARED && o['require-provider-config'] === true) fail(", "if (false) fail("],
  // == DEEPTECH-PARALLEL-015 - DR-11 (ADOPTED): duplicate `scan.results` refusal in cpg_u1_data.mjs
  //    `contamination()`. These four land in the block reserved for exactly this fix: nothing is renumbered.
  ["M468 duplicate scan results not refused (the byId collapse restored)", CLI, 'if (repeatedResults.length) {', 'if (false) {'],
  ["M469 a pair of scan results not counted as a duplicate", CLI, 'filter(([, list]) => list.length !== 1)', 'filter(([, list]) => list.length > 2)'],
  ["M470 duplicate scan result reported without its own contamination reasons", CLI, "why.length ? why.join(' ; ') : 'no contamination recorded in this occurrence'", "''"],
  ["M471 duplicate scan result reported without its own held_out_ineligible_by_scan", CLI, 'held_out_ineligible_by_scan=${x.held_out_ineligible_by_scan}', 'held_out_ineligible_by_scan=(not reported)'],

  // == DEEPTECH-PARALLEL-015 - F3: a supplied but nonexistent resolver clone (an S1 missed refusal).
  //    M473 and M474 are POSITIVE CONTROLS: the mutant must break the HONEST behaviour, not a refusal.
  ["M472 F3 defect restored: a supplied but missing resolver clone silently becomes 'no clone supplied'", CLI, 'if (!existsSync(supplied)) fail(', 'if (false) fail('],
  ["M473 POSITIVE CONTROL: genuine absence of a clone turned into a refusal instead of NOT_COMPARED", CLI, 'if (!supplied) return null;', 'if (false) return null;'],
  ["M474 the supplied-but-missing refusal does not name where the path came from", CLI, "${flag ? '--resolver-clone' : 'CPG_U1_RESOLVER_CLONE'} names", 'a resolver clone path names'],

  // == DEEPTECH-PARALLEL-015 - F1: `checkpoint` routed through the DR-12 normalised sentinel test.
  ["M475 F1 defect restored: the checkpoint sentinel compared raw (padded/mis-cased sentinel misrouted to the format error)", REG, 'if (isReservedSentinel(cp.height) || isReservedSentinel(cp.hash)) blockers.push(', 'if (cp.height === UNASSIGNED || cp.hash === UNASSIGNED) blockers.push('],
  ["M476 the checkpoint prerequisite blocker removed entirely", REG, 'if (isReservedSentinel(cp.height) || isReservedSentinel(cp.hash)) blockers.push(', 'if (false) blockers.push('],

  // == DEEPTECH-PARALLEL-015 - F4b: the registration_id pipe guard no longer short-circuits classification.
  ["M477 F4b defect restored: the pipe guard short-circuits classification, so identity.registration_id is absent", REG, "human(reg.registration_id, 'registration_id', 'registration_id');", "if (!reg.registration_id.includes('|')) human(reg.registration_id, 'registration_id', 'registration_id');"],
  ["M478 the registration_id pipe refusal dropped now that classification runs first", REG, "if (reg.registration_id.includes('|')) errors.push(", 'if (false) errors.push('],

  // == DEEPTECH-PARALLEL-015 - F4: ZWNJ/ZWJ, prose screening, and the narrowed forbidden-token list.
  //    M479 and M484 are POSITIVE CONTROLS: the mutant must break ACCEPTANCE of a legitimate case.
  ["M479 POSITIVE CONTROL: ZWNJ/ZWJ swallowed again, so legitimate Persian/Indic names are MALFORMED", IDN, '[0x200b, 0x200b], [0x200e, 0x200f]', '[0x200b, 0x200f]'],
  ["M480 U+200B zero-width space no longer refused (the ZWNJ narrowing over-applied)", IDN, '[0x200b, 0x200b], [0x200e, 0x200f]', '[0x200e, 0x200f]'],
  ["M481 attestation.method identifier-screened again, so a truthful method sentence is refused for a word it contains", IDN, '...ATTESTATION_PROSE_FIELDS.map((k) => [k, screenProseValue(att[k])]),', '...ATTESTATION_PROSE_FIELDS.map((k) => [k, screenIdentityValue(att[k])]),'],
  ["M482 attestation prose fields not screened at all, so an empty method confers authority", IDN, '...ATTESTATION_PROSE_FIELDS.map((k) => [k, screenProseValue(att[k])]),', '...ATTESTATION_PROSE_FIELDS.map((k) => [k, null]),'],
  ["M483 blanket lexical refusal restored (Na/None/Test/Mock forbidden again)", IDN, "const PLACEHOLDER_TOKENS = Object.freeze(['TBD', 'PLACEHOLDER']);", "const PLACEHOLDER_TOKENS = Object.freeze(['TBD', 'PLACEHOLDER', 'NA', 'NONE', 'TEST', 'MOCK']);"],
  ["M484 POSITIVE CONTROL: authority/resolved_by prose-screened, so a placeholder authority confers authority", IDN, '...ATTESTATION_IDENTIFIER_FIELDS.map((k) => [k, screenIdentityValue(att[k])]),', '...ATTESTATION_IDENTIFIER_FIELDS.map((k) => [k, screenProseValue(att[k])]),'],
];

// `--only M176,M204` restricts a run to named mutants (spot checks only; a full run never uses it)
const onlyArg = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
if (onlyArg) MUTATIONS.splice(0, MUTATIONS.length, ...MUTATIONS.filter((m) => onlyArg.has(m[0].split(' ')[0])));
let failedAnchors = 0;
for (const [name, file, from] of MUTATIONS) {
  const count = readFileSync(join(ROOT, file), 'utf8').split(from).length - 1;
  if (count !== 1) { failedAnchors++; console.log(`  ANCHOR?  ${name} (${count}x in ${file})`); }
}
console.log(`anchors: ${MUTATIONS.length - failedAnchors}/${MUTATIONS.length} occur exactly once`);
if (anchorsOnly || failedAnchors) process.exit(failedAnchors ? 1 : 0);

const runNode = (script, cwd, env) => new Promise((done) => execFile(process.execPath, [script], { cwd, env, timeout: 3600000, maxBuffer: 1 << 26 }, (err, stdout) => done({ err, stdout })));

// Windows holds handles briefly after a child exits: retry, then leave the directory and carry on. Never abort the run.
async function cleanup(dir) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { rmSync(dir, { recursive: true, force: true }); return null; } catch (e) { await sleep(500); lastCleanupError = e.message; }
  }
  leftovers.push(dir);
  return dir;
}
let lastCleanupError = null; const leftovers = [];

function runMutant([name, file, from, to, kind]) {
  return new Promise((done) => {
    const work = mkdtempSync(join(tmpdir(), 'cpg044-mut-'));
    if (!resolve(work).startsWith(resolve(tmpdir()))) throw new Error('path guard: mutation workspace must be under tmpdir');
    cpSync(ROOT, work, { recursive: true });
    const target = join(work, file);
    writeFileSync(target, readFileSync(target, 'utf8').replace(from, to));
    const classify = ({ err, stdout }, re) => {
      const m = re.exec(stdout || '');
      if (!err) return { outcome: 'SURVIVED', failed: 0, code: 0 };
      if (err.killed || err.signal) return { outcome: 'TIMEOUT', failed: null, code: err.code };
      if (m && Number(m[2]) > 0 && err.code === 1) return { outcome: 'KILLED', failed: Number(m[2]), code: 1, crash: /SELFTEST CRASHED/.test(stdout || '') };
      return { outcome: 'ERROR', failed: null, code: err.code };
    };
    (async () => {
      try {
        const results = [classify(await runNode(join(work, 'test', 'selftest.mjs'), work, process.env), /selftest: (\d+) passed, (\d+) failed/)];
        if (kind === 'adapter') results.push(classify(await runNode(join(work, 'test', 'adapter_conformance.mjs'), work, { ...process.env, CPG_U1_RESOLVER_CLONE: process.env.CPG_U1_ADAPTER_CLONE }), /adapter conformance: (\d+) passed, (\d+) failed/));
        const killed = results.find((r) => r.outcome === 'KILLED');
        const r = killed ?? results.find((x) => x.outcome === 'TIMEOUT') ?? results.find((x) => x.outcome === 'ERROR') ?? results[0];
        done({ name, ...r });
      } catch (e) {
        done({ name, outcome: 'ERROR', failed: null, code: null, harnessError: e.message });
      } finally {
        await cleanup(work);
      }
    })();
  });
}

const results = new Array(MUTATIONS.length);
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < MUTATIONS.length) {
    const i = next++;
    results[i] = await runMutant(MUTATIONS[i]);
    console.log(`  ${results[i].outcome.padEnd(8)} ${results[i].name}${results[i].outcome === 'KILLED' ? ` (${results[i].failed} failing assertion(s)${results[i].crash ? '; includes a selftest crash' : ''})` : results[i].outcome === 'ERROR' ? ` (exit ${results[i].code})` : ''}`);
  }
}));
const by = (o) => results.filter((r) => r.outcome === o).map((r) => r.name);
const survivors = by('SURVIVED'); const timeouts = by('TIMEOUT'); const errors = by('ERROR');
console.log(`\nmutations: total ${MUTATIONS.length}; killed ${by('KILLED').length} (of which with a selftest crash: ${results.filter((r) => r.outcome === 'KILLED' && r.crash).length}); survived ${survivors.length}; timeout ${timeouts.length}; error ${errors.length}`);
for (const s of survivors) console.log(`  SURVIVOR: ${s}`);
for (const s of timeouts) console.log(`  TIMEOUT: ${s}`);
for (const s of errors) console.log(`  ERROR: ${s}`);
if (leftovers.length) console.log(`note: ${leftovers.length} mutant workspace(s) could not be deleted (last: ${lastCleanupError}); they are throwaway copies under ${tmpdir()}`);
process.exit(survivors.length || timeouts.length || errors.length ? 1 : 0);
