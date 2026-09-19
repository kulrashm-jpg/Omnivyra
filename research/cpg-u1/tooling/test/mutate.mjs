// Mutation check for tooling v5: each mutation disables one protocol guard in a THROWAWAY COPY;
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
  ['M77 UNASSIGNED treated as assigned', REG, "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;", "const assigned = (v) => typeof v === 'string' && v.trim() !== '';"],
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
