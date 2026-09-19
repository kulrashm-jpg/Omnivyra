// Sampling-event evaluation (CPG_U1_PROTOCOL_003 §5.5–§5.8, §21). Given a registration and an evidence
// bundle, mechanically decides each stage's state and — only when FINAL — derives its seed.
// No input selects randomness: the round is computed, the block is H_commit + K, the seed is recomputed.
import { canonicalJson, sha256 } from './canonical.mjs';
import {
  confirmations, crosscheckArchives, decodeCommitment, isP2wpkh, medianTimePast, networkParams, parseOutpoint,
  parseTransaction, spendsOutpoint, verifyArchive, verifyMerkleBranch,
} from './bitcoin.mjs';
import { STAGES, checkPayload, payloadDigest } from './commitment.mjs';
import { MISSING_ROUND_EXPIRY_SECONDS, QUICKNET, checkChainInfo, roundTime, selectRound, verifyBeacon } from './drand.mjs';
import { registrationEpoch } from './registration.mjs';

export const D = 6;
export const K = 12;
export const ABANDONMENT_SECONDS = 180 * 24 * 60 * 60;
export const EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1';
export const SEED_DOMAIN = 'cpg-u1-chain-drand-seed/v1';
const FINGERPRINT_DOMAIN = 'cpg-u1-seed-fingerprint/v1';

/** Terminal and waiting states. Any VOID_* voids the study (a VOID stage cannot be retried). */
export const STATE = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  ABANDONED: 'STUDY_ABANDONED',
  WAITING_COMMITMENT_DEPTH: 'WAITING_COMMITMENT_DEPTH',
  WAITING_RANDOMNESS_DEPTH: 'WAITING_RANDOMNESS_DEPTH',
  WAITING_DRAND: 'WAITING_DRAND_ROUND',
  WAITING_DEVELOPMENT: 'WAITING_DEVELOPMENT_FINALITY',
  VOID_REGISTRATION: 'STUDY_VOID_REGISTRATION',
  VOID_PRE_REGISTRATION_SPEND: 'STUDY_VOID_PRE_REGISTRATION_SPEND',
  VOID_MALFORMED: 'STAGE_VOID_MALFORMED_COMMITMENT',
  VOID_CROSS_SPEND: 'STUDY_VOID_SLOT_CROSS_SPEND',
  VOID_BINDING: 'STAGE_VOID_BINDING_MISMATCH',
  VOID_REORG: 'STUDY_VOID_POST_FINALITY_REORG',
  VOID_RANDOMNESS: 'STUDY_VOID_RANDOMNESS_UNAVAILABLE',
  FINAL: 'FINAL',
});

/** Evidence that is wrong or incomplete (not a protocol outcome): verification aborts, nothing is decided. */
export class EvidenceError extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const dec = (n, what) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer`); return String(n); };

/**
 * seed_S = sha256("cpg-u1-chain-drand-seed/v1|S|digest|txid|H_commit|H_rand|blockhash(H_rand)|drand_chain_hash|R|drand_randomness")
 */
export function deriveSeed(x) {
  if (!STAGES.includes(x.stage)) throw new Error('stage must be development|held-out');
  for (const k of ['digest', 'txid', 'randBlockHash', 'drandChainHash', 'drandRandomness']) if (!HEX64.test(x[k] ?? '')) throw new Error(`${k} must be 64 lowercase hex characters`);
  if (x.randHeight !== x.commitHeight + K) throw new Error('H_rand must equal H_commit + K');
  return sha256([SEED_DOMAIN, x.stage, x.digest, x.txid, dec(x.commitHeight, 'H_commit'), dec(x.randHeight, 'H_rand'), x.randBlockHash,
    x.drandChainHash, dec(x.round, 'drand round'), x.drandRandomness].join('|'));
}
export const seedFingerprint = (seed) => sha256(`${FINGERPRINT_DOMAIN}|${seed}`);

function loadChains(reg, ev, params) {
  let a; let b;
  try {
    a = verifyArchive(ev.headers, reg.checkpoint, params);
    b = verifyArchive(ev.headers_crosscheck, reg.checkpoint, params);
  } catch (e) { throw new EvidenceError(e.message); }
  if (!ev.headers.source || !ev.headers_crosscheck.source || ev.headers.source === ev.headers_crosscheck.source) {
    throw new EvidenceError('headers and headers_crosscheck must name two different sources');
  }
  try { crosscheckArchives(a, b); } catch (e) { throw new EvidenceError(e.message); }
  // Only blocks both sources agree on count.
  const tip = Math.min(a.tipHeight, b.tipHeight);
  return { at: (h) => (h <= tip ? a.at(h) : undefined), startHeight: a.startHeight, tipHeight: tip };
}

function included(chain, item, what) {
  if (!item || typeof item !== 'object') throw new EvidenceError(`${what}: evidence missing`);
  let tx;
  try { tx = parseTransaction(item.tx_hex); } catch (e) { throw new EvidenceError(`${what}: ${e.message}`); }
  const hd = chain.at(item.height);
  if (!hd) throw new EvidenceError(`${what}: block ${item.height} is not in the agreed header range`);
  let ok = false;
  try { ok = verifyMerkleBranch(tx.txid, item.merkle_branch, item.merkle_pos, hd.merkleRoot); } catch (e) { throw new EvidenceError(`${what}: ${e.message}`); }
  if (!ok) throw new EvidenceError(`${what}: Merkle proof does not place transaction ${tx.txid} in block ${item.height}`);
  return { tx, height: item.height, blockHash: hd.hash };
}

const outcome = (stage, state, reason, extra = {}) => ({ stage, state, reason, ...extra });

/**
 * Evaluate one stage. Returns { stage, state, reason, record?, seed? }; `seed` is present only when FINAL.
 * Throws EvidenceError when the evidence is wrong or incomplete.
 * opts.priorFinal: { development?: record, 'held-out'?: record } previously recorded FINAL records (reorg check).
 */
export function evaluateStage(reg, ev, stage, opts = {}) {
  if (!STAGES.includes(stage)) throw new Error('stage must be development|held-out');
  if (!ev || ev.schema !== EVIDENCE_SCHEMA) throw new EvidenceError(`evidence schema must be ${EVIDENCE_SCHEMA}`);
  if (ev.network !== reg.network) throw new EvidenceError('evidence network differs from the registered network');
  let params;
  try { params = networkParams(reg.network, { allowSynthetic: opts.allowSynthetic }); } catch (e) { throw new EvidenceError(e.message); }
  const chain = loadChains(reg, ev, params);
  const cp = reg.checkpoint;
  const out = { development: parseOutpoint(reg.outpoints.development), 'held-out': parseOutpoint(reg.outpoints['held-out']) };
  const other = stage === 'development' ? 'held-out' : 'development';
  const tipMtp = medianTimePast(chain, chain.tipHeight);

  // Funding slots: both registered outputs must exist as single-signature P2WPKH outputs with ≥ D confirmations at the checkpoint.
  for (const s of STAGES) {
    const f = included(chain, ev.funding?.[s], `${s} funding`);
    if (f.tx.txid !== out[s].txid) throw new EvidenceError(`${s} funding transaction is ${f.tx.txid}, not the registered ${out[s].txid}`);
    const o = f.tx.outputs[out[s].vout];
    if (!o || !isP2wpkh(o.script)) return outcome(stage, STATE.VOID_REGISTRATION, `${s} registered outpoint is not a P2WPKH output of its funding transaction`);
    if (f.height + D - 1 > cp.height) return outcome(stage, STATE.VOID_REGISTRATION, `${s} funding has fewer than ${D} confirmations at the registered checkpoint`);
  }

  // Development must be FINAL before held-out can be evaluated.
  let dev = null;
  if (stage === 'held-out') {
    dev = evaluateStage(reg, ev, 'development', opts);
    if (dev.state.startsWith('STUDY_') || dev.state.startsWith('STAGE_')) return outcome(stage, dev.state, `development stage: ${dev.reason}`);
    if (dev.state !== STATE.FINAL) return outcome(stage, STATE.WAITING_DEVELOPMENT, `development stage is ${dev.state}`);
  }
  const windowStart = stage === 'development' ? registrationEpoch(reg) : dev.record.drand_round_time;

  const c = ev.commitments?.[stage] ?? null;
  if (c === null) {
    if (tipMtp >= windowStart + ABANDONMENT_SECONDS) return outcome(stage, STATE.ABANDONED, `${stage} outpoint unspent 180 days after ${stage === 'development' ? 'registration' : 'the development draw'} (per supplied evidence)`);
    return outcome(stage, STATE.NOT_STARTED, `${stage} outpoint unspent (per supplied evidence; non-spend is not provable from headers — confirm with a full node)`);
  }
  const t = included(chain, c, `${stage} commitment`);
  if (!spendsOutpoint(t.tx, out[stage])) throw new EvidenceError(`${stage} commitment transaction does not spend the registered ${stage} outpoint — not a commitment`);
  if (t.height <= cp.height) return outcome(stage, STATE.VOID_PRE_REGISTRATION_SPEND, `${stage} outpoint spent at or before the registered checkpoint`);
  if (spendsOutpoint(t.tx, out[other])) return outcome(stage, STATE.VOID_CROSS_SPEND, `${stage} commitment also spends the ${other} slot`);
  if (confirmations(chain.tipHeight, t.height) < D) return outcome(stage, STATE.WAITING_COMMITMENT_DEPTH, `commitment has ${confirmations(chain.tipHeight, t.height)} of ${D} confirmations`);

  let decoded;
  try { decoded = decodeCommitment(t.tx); } catch (e) { return outcome(stage, STATE.VOID_MALFORMED, e.message); }
  if (decoded.stage !== stage) return outcome(stage, STATE.VOID_MALFORMED, `OP_RETURN stage byte is ${decoded.stage}, but the ${stage} outpoint was spent`);
  if (!c.payload || payloadDigest(c.payload) !== decoded.digest) {
    throw new EvidenceError(`${stage} payload does not hash to the on-chain digest ${decoded.digest} — supply the committed payload`);
  }
  const p = c.payload;
  const perr = checkPayload(p);
  if (perr.length) return outcome(stage, STATE.VOID_MALFORMED, `committed payload invalid: ${perr.join('; ')}`);
  if (p.stage !== stage) return outcome(stage, STATE.VOID_MALFORMED, 'committed payload names a different stage');
  if (p.outpoint !== reg.outpoints[stage]) return outcome(stage, STATE.VOID_MALFORMED, 'committed payload names a different outpoint');
  for (const k of ['registration_id', 'protocol_sha256', 'tooling_aggregate_sha256']) {
    if (p[k] !== reg[k]) return outcome(stage, STATE.VOID_MALFORMED, `committed payload ${k} differs from the registration`);
  }
  if (stage === 'development' && p.registry_sha256 !== reg.registry_sha256) return outcome(stage, STATE.VOID_MALFORMED, 'development payload registry_sha256 differs from the registration');
  if (stage === 'held-out') {
    // Protocol-004 §5.5 / §5.3: one frame, one scan and the registered registry determine eligibility for BOTH stages.
    if (p.frame_hash !== dev.payload.frame_hash) return outcome(stage, STATE.VOID_BINDING, 'held-out frame_hash differs from the development frame_hash (single frozen frame)');
    if (p.scan_sha256 !== dev.payload.scan_sha256) return outcome(stage, STATE.VOID_BINDING, 'held-out scan_sha256 differs from the development scan_sha256 (eligibility fixed before any CPG outcome)');
    if (p.registry_sha256 !== reg.registry_sha256) return outcome(stage, STATE.VOID_BINDING, 'held-out registry_sha256 differs from the registered registry (registry frozen at registration)');
    if (p.binding.development_commitment_txid !== dev.record.commitment_txid) return outcome(stage, STATE.VOID_BINDING, 'held-out binding names a different development commitment');
    if (p.binding.development_payload_digest !== dev.record.payload_digest) return outcome(stage, STATE.VOID_BINDING, 'held-out binding names a different development payload digest');
    if (t.height <= dev.record.randomness_height + D) return outcome(stage, STATE.VOID_BINDING, 'held-out commitment is not after development finality');
  }
  if (medianTimePast(chain, t.height) >= windowStart + ABANDONMENT_SECONDS) return outcome(stage, STATE.ABANDONED, `${stage} commitment confirmed after the 180-day window`);

  const randHeight = t.height + K;
  if (chain.tipHeight < randHeight + D) return outcome(stage, STATE.WAITING_RANDOMNESS_DEPTH, `need block ${randHeight + D} (H_rand + D); agreed tip is ${chain.tipHeight}`);
  const record = {
    stage, commitment_txid: t.tx.txid, payload_digest: decoded.digest, commitment_height: t.height, commitment_block_hash: t.blockHash,
    randomness_height: randHeight, randomness_block_hash: chain.at(randHeight).hash,
  };
  const prior = opts.priorFinal?.[stage];
  if (prior) {
    for (const k of ['commitment_txid', 'commitment_height', 'commitment_block_hash', 'randomness_height', 'randomness_block_hash']) {
      if (prior[k] !== record[k]) return outcome(stage, STATE.VOID_REORG, `previously FINAL ${k} changed (${prior[k]} → ${record[k]})`);
    }
  }
  const mtp = medianTimePast(chain, randHeight + D);
  const round = selectRound(mtp);
  Object.assign(record, { mtp_after_randomness_depth: mtp, drand_chain_hash: QUICKNET.hash, drand_round: round, drand_round_time: roundTime(round) });
  if (prior && (prior.drand_round !== undefined && prior.drand_round !== round)) return outcome(stage, STATE.VOID_REORG, 'previously FINAL drand round changed');
  // Registration must precede the commitment (§5.5.1). The chain can prove the weaker, false-positive-free bound:
  // a registry timestamp at or after R's scheduled time means the study was registered after its randomness existed.
  if (stage === 'development' && registrationEpoch(reg) >= record.drand_round_time) {
    return outcome(stage, STATE.VOID_REGISTRATION, 'registration_timestamp is not before the development drand round — registered after the randomness existed');
  }

  try { checkChainInfo(ev.drand?.chain_info); } catch (e) { throw new EvidenceError(e.message); }
  const beacon = (ev.drand?.beacons ?? []).find((b) => b && b.round === round);
  if (!beacon) {
    if (tipMtp >= record.drand_round_time + MISSING_ROUND_EXPIRY_SECONDS) {
      return outcome(stage, STATE.VOID_RANDOMNESS, `no verifiable drand round ${round} 30 days after its scheduled time (per supplied evidence)`, { record });
    }
    return outcome(stage, STATE.WAITING_DRAND, `drand round ${round} (scheduled ${record.drand_round_time}) not in evidence`, { record });
  }
  let randomness;
  try { randomness = verifyBeacon(ev.drand.chain_info, beacon, round); } catch (e) { throw new EvidenceError(e.message); }
  record.drand_randomness = randomness;
  const seed = deriveSeed({
    stage, digest: record.payload_digest, txid: record.commitment_txid, commitHeight: record.commitment_height, randHeight,
    randBlockHash: record.randomness_block_hash, drandChainHash: QUICKNET.hash, round, drandRandomness: randomness,
  });
  record.seed_fingerprint = seedFingerprint(seed);
  record.record_sha256 = sha256(canonicalJson(record));
  return { ...outcome(stage, STATE.FINAL, 'sampling event final'), record, payload: p, seed, developmentRecord: dev ? dev.record : record };
}
