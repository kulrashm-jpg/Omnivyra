// Bitcoin verification primitives (CPG_U1_PROTOCOL_003 §5.5). Node crypto only — no Bitcoin
// framework, no wallet, no key, no network. Verifies what an outsider can check offline:
// header proof of work, linkage, difficulty retargeting, median-time-past, Merkle inclusion,
// strict transaction parsing and the commitment OP_RETURN.
import { createHash } from 'node:crypto';

const HEX = /^(?:[0-9a-f]{2})*$/;
const HASH64 = /^[0-9a-f]{64}$/;

export const sha256d = (buf) => createHash('sha256').update(createHash('sha256').update(buf).digest()).digest();
/** Display (RPC) order is the byte-reverse of the internal order. */
export const toDisplay = (buf) => Buffer.from(buf).reverse().toString('hex');
export const fromDisplay = (hex) => {
  if (!HASH64.test(hex)) throw new Error(`hash must be 64 lowercase hex characters: ${hex}`);
  return Buffer.from(hex, 'hex').reverse();
};
export function hexToBuf(hex, what = 'hex') {
  if (typeof hex !== 'string' || !HEX.test(hex)) throw new Error(`${what} must be lowercase hex with an even number of digits`);
  return Buffer.from(hex, 'hex');
}

// ── network parameters (pinned) ──────────────────────────────────────────────
export const MAINNET = Object.freeze({
  name: 'bitcoin-mainnet',
  powLimit: (1n << 224n) - 1n, // 0x00000000ffff…ff — Bitcoin Core consensus.powLimit
  retargetInterval: 2016,
  targetTimespan: 14n * 24n * 60n * 60n, // 1209600
  noRetargeting: false,
});
/** Test-only network (easy target, no retargeting). Refused everywhere unless --allow-synthetic. */
export const SYNTHETIC = Object.freeze({
  name: 'synthetic-test',
  powLimit: (1n << 255n) - 1n, // 0x7fffff…
  retargetInterval: 2016,
  targetTimespan: 14n * 24n * 60n * 60n,
  noRetargeting: true,
});
export function networkParams(name, { allowSynthetic = false } = {}) {
  if (name === MAINNET.name) return MAINNET;
  if (name === SYNTHETIC.name) {
    if (!allowSynthetic) throw new Error('synthetic-test network is permitted only in test mode (--allow-synthetic)');
    return SYNTHETIC;
  }
  throw new Error(`unknown network "${name}" (expected ${MAINNET.name})`);
}

// ── compact difficulty ───────────────────────────────────────────────────────
/** Bitcoin Core arith_uint256::SetCompact, with negative/overflow flags treated as invalid. */
export function bitsToTarget(bits) {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xffffffff) throw new Error('nBits must be a uint32');
  const size = bits >>> 24;
  const word = bits & 0x007fffff;
  const target = size <= 3 ? BigInt(word >>> (8 * (3 - size))) : BigInt(word) << BigInt(8 * (size - 3));
  const negative = word !== 0 && (bits & 0x00800000) !== 0;
  const overflow = word !== 0 && (size > 34 || (word > 0xff && size > 33) || (word > 0xffff && size > 32));
  if (negative || overflow) throw new Error(`nBits 0x${bits.toString(16)} encodes a negative or overflowing target`);
  return target;
}

/** Bitcoin Core arith_uint256::GetCompact (non-negative). */
export function targetToBits(target) {
  let size = target === 0n ? 0 : Math.ceil(target.toString(2).length / 8);
  let compact = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number(target >> BigInt(8 * (size - 3)));
  if (compact & 0x00800000) { compact >>>= 8; size++; }
  return (compact | (size << 24)) >>> 0;
}

/** Expected work of one block: 2^256 / (target + 1). */
export const blockWork = (target) => (1n << 256n) / (target + 1n);

// ── headers ──────────────────────────────────────────────────────────────────
export function parseHeader(hex) {
  const b = hexToBuf(hex, 'block header');
  if (b.length !== 80) throw new Error(`block header must be exactly 80 bytes (got ${b.length})`);
  return {
    raw: b,
    version: b.readInt32LE(0),
    prev: toDisplay(b.subarray(4, 36)),
    merkleRoot: toDisplay(b.subarray(36, 68)),
    time: b.readUInt32LE(68),
    bits: b.readUInt32LE(72),
    nonce: b.readUInt32LE(76),
    hash: toDisplay(sha256d(b)),
  };
}

/** Proof of work: 0 < target ≤ powLimit and hash ≤ target. */
export function checkProofOfWork(header, params) {
  const target = bitsToTarget(header.bits);
  if (target === 0n || target > params.powLimit) throw new Error(`header ${header.hash}: target outside (0, powLimit]`);
  if (BigInt(`0x${header.hash}`) > target) throw new Error(`header ${header.hash}: hash exceeds its target (invalid proof of work)`);
  return target;
}

/** Bitcoin Core CalculateNextWorkRequired for the block at a retarget boundary. */
export function expectedRetargetBits(firstOfPeriod, lastOfPeriod, params) {
  let span = BigInt(lastOfPeriod.time - firstOfPeriod.time);
  if (span < params.targetTimespan / 4n) span = params.targetTimespan / 4n;
  if (span > params.targetTimespan * 4n) span = params.targetTimespan * 4n;
  let next = (bitsToTarget(lastOfPeriod.bits) * span) / params.targetTimespan;
  if (next > params.powLimit) next = params.powLimit;
  return targetToBits(next);
}

/** Bitcoin Core GetMedianTimePast: median time of the block and its ≤ 10 predecessors. */
export function medianTimePast(chain, height) {
  const times = [];
  for (let h = height; h > height - 11; h--) {
    const hd = chain.at(h);
    if (!hd) throw new Error(`median-time-past of ${height} needs header ${h}, which is not in the archive`);
    times.push(hd.time);
  }
  times.sort((a, b) => a - b);
  return times[5];
}

/**
 * Verify a contiguous header range. Every header: 80 bytes, valid proof of work, linked to its
 * predecessor, timestamp > median-time-past of the previous 11 (when all 11 are present), and
 * nBits equal to the predecessor's except at a retarget boundary, where it must equal the
 * recomputed retarget (the period's first header must then be present).
 * Returns a chain view: at(height) → header, tip, cumulative work.
 */
export function verifyHeaderChain(startHeight, headersHex, params) {
  if (!Number.isInteger(startHeight) || startHeight < 0) throw new Error('start_height must be a non-negative integer');
  if (!Array.isArray(headersHex) || headersHex.length === 0) throw new Error('header archive is empty');
  const headers = headersHex.map(parseHeader);
  const at = (h) => headers[h - startHeight];
  const chain = { startHeight, tipHeight: startHeight + headers.length - 1, at, work: 0n };
  headers.forEach((hd, i) => {
    const height = startHeight + i;
    const target = checkProofOfWork(hd, params);
    chain.work += blockWork(target);
    if (i === 0) return;
    const prev = headers[i - 1];
    if (hd.prev !== prev.hash) throw new Error(`header ${height} does not link to header ${height - 1}`);
    if (height - 11 >= startHeight && hd.time <= medianTimePast(chain, height - 1)) {
      throw new Error(`header ${height}: timestamp not greater than median-time-past of the previous 11 blocks`);
    }
    if (params.noRetargeting || height % params.retargetInterval !== 0) {
      if (hd.bits !== prev.bits) throw new Error(`header ${height}: nBits changed outside a retarget boundary`);
    } else {
      const first = at(height - params.retargetInterval);
      if (!first) throw new Error(`header ${height} is a retarget boundary but the period start ${height - params.retargetInterval} is not in the archive`);
      const want = expectedRetargetBits(first, prev, params);
      if (hd.bits !== want) throw new Error(`header ${height}: nBits 0x${hd.bits.toString(16)} != recomputed retarget 0x${want.toString(16)}`);
    }
  });
  return chain;
}

/**
 * A sampling archive must start at a retarget boundary at or below the registered checkpoint,
 * so every difficulty transition after it is recomputed rather than trusted, and it must contain
 * the checkpoint block with the registered hash.
 */
export function verifyArchive(archive, checkpoint, params) {
  if (!archive || typeof archive !== 'object') throw new Error('header archive missing');
  const { start_height: start, headers_hex: hx } = archive;
  if (!Number.isInteger(start) || start % params.retargetInterval !== 0) throw new Error('header archive must start at a retarget boundary (height divisible by 2016)');
  if (!checkpoint || !Number.isInteger(checkpoint.height) || !HASH64.test(checkpoint.hash || '')) throw new Error('checkpoint must be {height, hash}');
  if (start > checkpoint.height) throw new Error('header archive must start at or below the registered checkpoint');
  const chain = verifyHeaderChain(start, hx, params);
  const cp = chain.at(checkpoint.height);
  if (!cp) throw new Error('header archive does not reach the registered checkpoint');
  if (cp.hash !== checkpoint.hash) throw new Error(`checkpoint mismatch at ${checkpoint.height}: archive ${cp.hash} != registered ${checkpoint.hash}`);
  return chain;
}

/**
 * Two independently sourced archives must agree block-for-block over their common range.
 * Disagreement means a fork or a faulty source — nothing may be derived until it resolves.
 */
export function crosscheckArchives(a, b) {
  const lo = Math.max(a.startHeight, b.startHeight);
  const hi = Math.min(a.tipHeight, b.tipHeight);
  if (lo > hi) throw new Error('header sources do not overlap');
  for (let h = lo; h <= hi; h++) {
    if (a.at(h).hash !== b.at(h).hash) throw new Error(`header sources disagree at height ${h} — fork or faulty source; wait and re-verify`);
  }
  return { from: lo, to: hi };
}

/** Confirmations of a block at `height` given the chain tip (tip itself = 1). */
export const confirmations = (tipHeight, height) => (height > tipHeight ? 0 : tipHeight - height + 1);

// ── Merkle ───────────────────────────────────────────────────────────────────
/** Merkle root from a full txid list (display order), duplicating the last node on odd levels. */
export function merkleRootFromTxids(txids) {
  if (!txids.length) throw new Error('empty transaction list');
  let level = txids.map(fromDisplay);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1] ?? level[i]])));
    level = next;
  }
  return toDisplay(level[0]);
}

/** Verify an inclusion branch (display-order sibling hashes, position index) against a header root. */
export function verifyMerkleBranch(txid, branch, pos, merkleRoot) {
  if (!Array.isArray(branch) || branch.length > 32) throw new Error('merkle branch must be an array of at most 32 hashes');
  if (!Number.isInteger(pos) || pos < 0 || pos >= 2 ** branch.length) throw new Error('merkle position out of range for the branch length');
  let h = fromDisplay(txid);
  let p = pos;
  for (const s of branch) {
    const sib = fromDisplay(s);
    h = p & 1 ? sha256d(Buffer.concat([sib, h])) : sha256d(Buffer.concat([h, sib]));
    p = Math.floor(p / 2);
  }
  return toDisplay(h) === merkleRoot;
}

// ── transactions ─────────────────────────────────────────────────────────────
function reader(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error('transaction truncated'); };
  const r = {
    get offset() { return o; },
    bytes(n) { need(n); const s = buf.subarray(o, o + n); o += n; return s; },
    u8() { need(1); return buf[o++]; },
    u32() { need(4); const v = buf.readUInt32LE(o); o += 4; return v; },
    i64() { need(8); const v = buf.readBigInt64LE(o); o += 8; return v; },
    /** CompactSize, rejecting non-minimal encodings (Bitcoin Core "non-canonical ReadCompactSize"). */
    varint() {
      const first = r.u8();
      if (first < 0xfd) return first;
      if (first === 0xfd) { need(2); const v = buf.readUInt16LE(o); o += 2; if (v < 0xfd) throw new Error('non-canonical CompactSize'); return v; }
      if (first === 0xfe) { const v = r.u32(); if (v < 0x10000) throw new Error('non-canonical CompactSize'); return v; }
      throw new Error('CompactSize above 2^32 is not supported in a transaction');
    },
  };
  return r;
}

/**
 * Strict parse of a legacy or SegWit transaction. Rejects trailing bytes, non-canonical sizes,
 * a SegWit flag other than 1, an all-empty witness under the SegWit marker, and 64-byte
 * stripped transactions (indistinguishable from an inner Merkle node).
 */
export function parseTransaction(hex) {
  const buf = hexToBuf(hex, 'transaction');
  const r = reader(buf);
  const version = r.bytes(4);
  let segwit = false;
  const mark = r.offset;
  let nIn = r.varint();
  if (nIn === 0) {
    const flag = r.u8();
    if (flag !== 1) throw new Error('invalid SegWit flag');
    segwit = true;
    nIn = r.varint();
  }
  if (nIn === 0) throw new Error('transaction has no inputs');
  const inputs = [];
  for (let i = 0; i < nIn; i++) {
    const prevHash = r.bytes(32);
    const vout = r.u32();
    const script = r.bytes(r.varint());
    const sequence = r.u32();
    inputs.push({ txid: toDisplay(prevHash), vout, script: Buffer.from(script), sequence });
  }
  const nOut = r.varint();
  if (nOut === 0) throw new Error('transaction has no outputs');
  const outputs = [];
  for (let i = 0; i < nOut; i++) {
    const value = r.i64();
    if (value < 0n) throw new Error('negative output value');
    outputs.push({ value, script: Buffer.from(r.bytes(r.varint())) });
  }
  const afterOutputs = r.offset;
  if (segwit) {
    let nonEmpty = false;
    for (let i = 0; i < nIn; i++) {
      const items = r.varint();
      for (let k = 0; k < items; k++) { r.bytes(r.varint()); nonEmpty = true; }
    }
    if (!nonEmpty) throw new Error('superfluous SegWit marker (all witnesses empty)');
  }
  const locktime = r.bytes(4);
  if (r.offset !== buf.length) throw new Error('trailing bytes after transaction');
  const stripped = segwit
    ? Buffer.concat([version, buf.subarray(mark + 2, afterOutputs), locktime])
    : buf;
  if (stripped.length === 64) throw new Error('64-byte stripped transaction refused (Merkle ambiguity)');
  const coinbase = nIn === 1 && inputs[0].txid === '0'.repeat(64) && inputs[0].vout === 0xffffffff;
  return { txid: toDisplay(sha256d(stripped)), segwit, inputs, outputs, coinbase, strippedSize: stripped.length };
}

export const spendsOutpoint = (tx, outpoint) => !tx.coinbase && tx.inputs.some((i) => i.txid === outpoint.txid && i.vout === outpoint.vout);

export function parseOutpoint(s) {
  const m = /^([0-9a-f]{64}):(0|[1-9][0-9]{0,9})$/.exec(typeof s === 'string' ? s : '');
  if (!m || Number(m[2]) > 0xffffffff) throw new Error(`outpoint must be "<64 lowercase hex txid>:<vout>" (got ${s})`);
  return { txid: m[1], vout: Number(m[2]) };
}

export const isP2wpkh = (script) => script.length === 22 && script[0] === 0x00 && script[1] === 0x14;

// ── commitment OP_RETURN ─────────────────────────────────────────────────────
export const COMMITMENT_TAG = Buffer.from('CPGU1', 'ascii');
export const COMMITMENT_VERSION = 0x01;
export const STAGE_BYTE = Object.freeze({ development: 0x44, 'held-out': 0x48 });

/** Script = 6a 27 ‖ "CPGU1" ‖ 01 ‖ stage byte ‖ 32-byte digest (41 bytes). */
export function encodeCommitmentScript(stage, digestHex) {
  if (!(stage in STAGE_BYTE)) throw new Error(`stage must be development|held-out`);
  if (!HASH64.test(digestHex)) throw new Error('digest must be 64 lowercase hex characters');
  return Buffer.concat([Buffer.from([0x6a, 0x27]), COMMITMENT_TAG, Buffer.from([COMMITMENT_VERSION, STAGE_BYTE[stage]]), Buffer.from(digestHex, 'hex')]);
}

/**
 * The transaction must carry EXACTLY ONE OP_RETURN output, of exactly the commitment form.
 * Returns { stage, digest } or throws with the malformation.
 */
export function decodeCommitment(tx) {
  const opReturns = tx.outputs.filter((o) => o.script.length > 0 && o.script[0] === 0x6a);
  if (opReturns.length !== 1) throw new Error(`commitment transaction must have exactly one OP_RETURN output (found ${opReturns.length})`);
  const s = opReturns[0].script;
  if (s.length !== 41 || s[1] !== 0x27) throw new Error('OP_RETURN must be 6a 27 followed by exactly 39 data bytes');
  if (!s.subarray(2, 7).equals(COMMITMENT_TAG)) throw new Error('OP_RETURN tag is not "CPGU1"');
  if (s[7] !== COMMITMENT_VERSION) throw new Error(`OP_RETURN version byte 0x${s[7].toString(16)} is not 0x01`);
  const stage = Object.keys(STAGE_BYTE).find((k) => STAGE_BYTE[k] === s[8]);
  if (!stage) throw new Error(`OP_RETURN stage byte 0x${s[8].toString(16)} is neither 0x44 (D) nor 0x48 (H)`);
  return { stage, digest: s.subarray(9, 41).toString('hex') };
}
