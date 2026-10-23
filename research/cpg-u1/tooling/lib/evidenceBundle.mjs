// Sampling-evidence bundle builder (CPG_U1_PROTOCOL_004 §5.7.1, §13.2A, §21). Assembles the `cpg-u1-sampling-evidence/v1`
// document that `verify-sampling`, `draw-*` and the harness read, from separately obtained local files: two header
// archives from differently named sources, the funding and commitment transactions with their Merkle proofs, the
// committed payloads, the drand chain info and the relay beacons. It fetches nothing and alters no value: it checks the
// shape of each part, keeps only the fields the verifier reads, and refuses conflicting duplicates. Each supplied beacon must
// name the relay it came from; the assembled bundle records the sorted set of relays that attested each round and refuses a
// round attested by fewer than two differently named relays (§19.3, §21 step 5). Verification of the assembled bundle is the
// unchanged `evaluateStage` (the caller runs it before writing).
import { EVIDENCE_SCHEMA, MIN_DRAND_RELAYS } from './sampling.mjs';

const HEX = /^(?:[0-9a-f]{2})+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEADER = /^[0-9a-f]{160}$/;
const STAGES = ['development', 'held-out'];
// §19.3 (protocol line 961) and §21 step 5: "≥ 2 drand relays for verification". Every round carried by a bundle must be
// attested by at least this many differently named relays, and the names are kept so the claim is auditable from the bundle.
// The floor is the one `evaluateStage` enforces; it is defined once, in lib/sampling.mjs, and imported here.
const MIN_RELAYS = MIN_DRAND_RELAYS;

function archive(a, what) {
  if (!a || typeof a !== 'object') throw new Error(`${what}: header archive missing`);
  if (typeof a.source !== 'string' || !a.source.trim()) throw new Error(`${what}: the archive must name its source`);
  if (!Number.isInteger(a.start_height) || a.start_height < 0) throw new Error(`${what}: start_height must be a non-negative integer`);
  if (!Array.isArray(a.headers_hex) || !a.headers_hex.length || a.headers_hex.some((h) => !HEADER.test(h))) throw new Error(`${what}: headers_hex must be 80-byte headers as 160 lowercase hex characters`);
  return { source: a.source, start_height: a.start_height, headers_hex: a.headers_hex };
}

function proof(p, what) {
  if (!p || typeof p !== 'object') throw new Error(`${what}: inclusion proof missing`);
  if (typeof p.tx_hex !== 'string' || !HEX.test(p.tx_hex)) throw new Error(`${what}: tx_hex must be the raw transaction in lowercase hex`);
  if (!Number.isInteger(p.height) || p.height < 0) throw new Error(`${what}: height must be a non-negative integer`);
  if (!Array.isArray(p.merkle_branch) || p.merkle_branch.some((h) => !HEX64.test(h))) throw new Error(`${what}: merkle_branch must be display-order 64-hex hashes`);
  if (!Number.isInteger(p.merkle_pos) || p.merkle_pos < 0) throw new Error(`${what}: merkle_pos must be a non-negative integer`);
  return { tx_hex: p.tx_hex, height: p.height, merkle_branch: p.merkle_branch, merkle_pos: p.merkle_pos };
}

function beacons(list) {
  const byRound = new Map();
  for (const [i, b] of list.entries()) {
    if (!b || !Number.isSafeInteger(b.round) || b.round < 1 || typeof b.randomness !== 'string' || typeof b.signature !== 'string') throw new Error(`drand beacon ${i}: must carry round, randomness and signature`);
    if (typeof b.relay !== 'string' || !b.relay.trim() || b.relay.trim() !== b.relay) throw new Error(`drand beacon ${i}: must name the relay it came from as a non-empty string without leading or trailing whitespace (§19.3 requires ${MIN_RELAYS} differently named relays per round)`);
    const v = { round: b.round, randomness: b.randomness, signature: b.signature, relays: [b.relay] };
    const prior = byRound.get(b.round);
    if (prior && (prior.randomness !== v.randomness || prior.signature !== v.signature)) throw new Error(`drand beacons disagree for round ${b.round} — relays returned different values; do not choose one`);
    if (prior) { if (!prior.relays.includes(b.relay)) prior.relays.push(b.relay); continue; }
    byRound.set(b.round, v);
  }
  for (const v of byRound.values()) {
    v.relays.sort();
    if (v.relays.length < MIN_RELAYS) throw new Error(`drand round ${v.round} is attested by ${v.relays.length} relay(s) (${v.relays.join(', ')}); §19.3 requires at least ${MIN_RELAYS} differently named relays — do not proceed on one relay`);
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

/**
 * parts: { network, headers, headersCrosscheck, funding: {development, 'held-out'}, commitments: {stage: {proof, payload} | null},
 *          drandChainInfo, beacons: [] }
 */
export function buildEvidenceBundle(parts) {
  if (typeof parts.network !== 'string' || !parts.network) throw new Error('network required');
  const headers = archive(parts.headers, 'headers');
  const crosscheck = archive(parts.headersCrosscheck, 'headers_crosscheck');
  if (headers.source === crosscheck.source) throw new Error('the two header archives must come from two differently named sources');
  const funding = Object.fromEntries(STAGES.map((s) => [s, proof(parts.funding?.[s], `${s} funding`)]));
  const commitments = Object.fromEntries(STAGES.map((s) => {
    const c = parts.commitments?.[s] ?? null;
    if (c === null) return [s, null];
    if (!c.payload || typeof c.payload !== 'object') throw new Error(`${s} commitment: the committed payload is required with its transaction`);
    return [s, { payload: c.payload, ...proof(c.proof, `${s} commitment`) }];
  }));
  if (commitments['held-out'] && !commitments.development) throw new Error('a held-out commitment cannot be bundled without the development commitment');
  if (!parts.drandChainInfo || typeof parts.drandChainInfo !== 'object') throw new Error('drand chain info required');
  return {
    schema: EVIDENCE_SCHEMA, network: parts.network, headers, headers_crosscheck: crosscheck, funding, commitments,
    drand: { chain_info: parts.drandChainInfo, beacons: beacons(parts.beacons ?? []) },
  };
}
