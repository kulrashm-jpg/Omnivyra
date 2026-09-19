// drand quicknet verification (CPG_U1_PROTOCOL_003 §5.6, Model B). Offline and deterministic.
// BLS12-381 comes from the vendored, pinned @noble/curves 1.9.7 (with @noble/hashes 1.8.0), the
// library the official drand JS client builds on; its files are part of the tooling aggregate.
// The verification equation is the one drand-client uses for bls-unchained-g1-rfc9380.
import { createHash } from 'node:crypto';
import { bls12_381 } from '@noble/curves/bls12-381';

/** Pinned chain. Evidence must reproduce these values exactly; no other chain is accepted. */
export const QUICKNET = Object.freeze({
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  public_key: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  period: 3,
  genesis_time: 1692803367,
  schemeID: 'bls-unchained-g1-rfc9380',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  beaconID: 'quicknet',
});
export const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
/** Δ = 3 h (U3 approval). */
export const DELTA_SECONDS = 3 * 60 * 60;
/** Missing-round expiry = 30 days after R's scheduled time (U3 approval). */
export const MISSING_ROUND_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

const sha256 = (b) => createHash('sha256').update(b).digest();

/** Scheduled time of round r (round 1 = genesis). */
export function roundTime(round) {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error('drand round must be a positive integer');
  return QUICKNET.genesis_time + (round - 1) * QUICKNET.period;
}

/** First round whose scheduled time is ≥ t. */
export function roundAtOrAfter(t) {
  if (!Number.isSafeInteger(t)) throw new Error('time must be an integer number of seconds');
  if (t <= QUICKNET.genesis_time) return 1;
  return Math.ceil((t - QUICKNET.genesis_time) / QUICKNET.period) + 1;
}

/** R = first round scheduled ≥ MTP(H_rand + D) + Δ. The caller supplies the MTP only; never a round. */
export const selectRound = (mtpAfterRandomnessDepth) => roundAtOrAfter(mtpAfterRandomnessDepth + DELTA_SECONDS);

/** Chain info in evidence must match the pinned chain field-for-field. */
export function checkChainInfo(info) {
  if (!info || typeof info !== 'object') throw new Error('drand chain info missing');
  const got = {
    hash: info.hash, public_key: info.public_key, period: info.period, genesis_time: info.genesis_time,
    schemeID: info.schemeID, groupHash: info.groupHash, beaconID: info.metadata?.beaconID,
  };
  for (const k of Object.keys(QUICKNET)) {
    if (got[k] !== QUICKNET[k]) throw new Error(`drand chain info ${k} does not match the pinned quicknet chain`);
  }
}

const HEX96 = /^[0-9a-f]{96}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Verify one quicknet beacon: message = sha256(uint64_be(round)); H(m) = hash_to_curve G1 (RFC 9380,
 * DST above); check e(H(m), −PK) · e(S, G2) = 1. The signature must be a canonical compressed,
 * on-curve, prime-order-subgroup, non-identity G1 point (noble fromHex enforces encoding, curve
 * and subgroup; identity is rejected here). randomness = sha256(signature bytes).
 */
export function verifyDrandRound(chainInfo, round, signatureHex) {
  checkChainInfo(chainInfo);
  if (!Number.isSafeInteger(round) || round < 1) return { valid: false, reason: 'round must be a positive integer' };
  if (typeof signatureHex !== 'string' || !HEX96.test(signatureHex)) return { valid: false, reason: 'signature must be 96 lowercase hex characters (48-byte compressed G1)' };
  const { G1, G2 } = bls12_381;
  let S; let P;
  try {
    S = G1.ProjectivePoint.fromHex(signatureHex);
    P = G2.ProjectivePoint.fromHex(QUICKNET.public_key);
  } catch (e) {
    return { valid: false, reason: `signature is not a valid G1 point: ${e.message}` };
  }
  if (S.equals(G1.ProjectivePoint.ZERO)) return { valid: false, reason: 'signature is the identity point' };
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(round));
  const Hm = G1.hashToCurve(sha256(msg), { DST });
  const e = bls12_381.pairingBatch([
    { g1: Hm, g2: P.negate() },
    { g1: S, g2: G2.ProjectivePoint.BASE },
  ]);
  if (!bls12_381.fields.Fp12.eql(e, bls12_381.fields.Fp12.ONE)) return { valid: false, reason: 'BLS signature does not verify for this round under the pinned group key' };
  return { valid: true, randomnessHex: sha256(Buffer.from(signatureHex, 'hex')).toString('hex') };
}

/**
 * Verify a relay-reported beacon for the REQUIRED round. The round is computed by the tooling;
 * a beacon for any other round is refused, and relay-reported randomness must equal
 * sha256(signature).
 */
export function verifyBeacon(chainInfo, beacon, requiredRound) {
  if (!beacon || typeof beacon !== 'object') throw new Error('drand beacon missing');
  if (beacon.round !== requiredRound) throw new Error(`drand beacon is for round ${beacon.round}; the protocol requires round ${requiredRound}`);
  if (!HEX64.test(beacon.randomness || '')) throw new Error('drand randomness must be 64 lowercase hex characters');
  const v = verifyDrandRound(chainInfo, requiredRound, beacon.signature);
  if (!v.valid) throw new Error(`drand verification failed: ${v.reason}`);
  if (v.randomnessHex !== beacon.randomness) throw new Error('drand relay randomness != sha256(signature)');
  return v.randomnessHex;
}
