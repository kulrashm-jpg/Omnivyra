// Commitment payload, digest, held-out binding and append-only proof (CPG_U1_PROTOCOL_003 §5.4).
import { canonicalJson, sha256 } from './canonical.mjs';
import { parseOutpoint } from './bitcoin.mjs';

export const STUDY_ID = 'CPG-U1-2026-01';
export const STAGES = Object.freeze(['development', 'held-out']);
export const PAYLOAD_SCHEMA = 'cpg-u1-commitment/v1';
export const DIGEST_DOMAIN = 'cpg-u1-commitment-digest/v1';
const APPEND_ONLY_DOMAIN = 'cpg-u1-append-only/v1';

export const PAYLOAD_KEYS = Object.freeze(['schema', 'study_id', 'stage', 'registration_id', 'protocol_sha256', 'tooling_aggregate_sha256',
  'registry_sha256', 'frame_hash', 'scan_sha256', 'outpoint', 'binding']);
export const BINDING_KEYS = Object.freeze(['development_commitment_txid', 'development_payload_digest', 'development_manifest_sha256',
  'development_frame_hash', 'pilot_result_sha256', 'sizing_sha256', 'append_only_proof']);
export const APPEND_ONLY_KEYS = Object.freeze(['development_frame_hash', 'held_out_frame_hash', 'development_row_hashes_sha256', 'proof']);

const HEX64 = /^[0-9a-f]{64}$/;
const sameKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));

/** Returns a list of violations; empty = well-formed. */
export function checkPayload(p) {
  const errors = [];
  if (!sameKeys(p, PAYLOAD_KEYS)) return [`payload must have exactly the keys ${PAYLOAD_KEYS.join(',')}`];
  if (p.schema !== PAYLOAD_SCHEMA) errors.push(`schema must be ${PAYLOAD_SCHEMA}`);
  if (p.study_id !== STUDY_ID) errors.push(`study_id must be ${STUDY_ID}`);
  if (!STAGES.includes(p.stage)) errors.push('stage must be development|held-out');
  if (typeof p.registration_id !== 'string' || !p.registration_id.trim() || p.registration_id === 'UNASSIGNED' || p.registration_id.includes('|')) {
    errors.push('registration_id must be the registry persistent identifier');
  }
  for (const k of ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'frame_hash', 'scan_sha256']) {
    if (!HEX64.test(p[k] ?? '')) errors.push(`${k} must be 64 lowercase hex characters`);
  }
  try { parseOutpoint(p.outpoint); } catch (e) { errors.push(e.message); }
  if (p.stage === 'development' && p.binding !== null) errors.push('development payload binding must be null');
  if (p.stage === 'held-out') {
    const b = p.binding;
    if (!sameKeys(b, BINDING_KEYS)) errors.push(`held-out binding must have exactly the keys ${BINDING_KEYS.join(',')}`);
    else {
      for (const k of BINDING_KEYS.filter((x) => x !== 'append_only_proof')) if (!HEX64.test(b[k] ?? '')) errors.push(`binding.${k} must be 64 lowercase hex characters`);
      const a = b.append_only_proof;
      if (!sameKeys(a, APPEND_ONLY_KEYS)) errors.push(`append_only_proof must have exactly the keys ${APPEND_ONLY_KEYS.join(',')}`);
      else {
        for (const k of APPEND_ONLY_KEYS) if (!HEX64.test(a[k] ?? '')) errors.push(`append_only_proof.${k} must be 64 lowercase hex characters`);
        if (a.development_frame_hash !== b.development_frame_hash) errors.push('append_only_proof.development_frame_hash != binding.development_frame_hash');
        if (a.held_out_frame_hash !== p.frame_hash) errors.push('append_only_proof.held_out_frame_hash != payload frame_hash');
        if (a.proof !== appendOnlyProofHash(a.development_frame_hash, a.held_out_frame_hash, a.development_row_hashes_sha256)) errors.push('append_only_proof.proof does not recompute');
      }
    }
  }
  return errors;
}

/** digest = sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload)). */
export const payloadDigest = (p) => sha256(`${DIGEST_DOMAIN}|${canonicalJson(p)}`);

const appendOnlyProofHash = (devFrame, hoFrame, devRows) => sha256(`${APPEND_ONLY_DOMAIN}|${devFrame}|${hoFrame}|${devRows}`);

/**
 * Recompute the append-only relation: every development-frame row hash appears unchanged in the
 * held-out frame. Throws if any row is dropped or edited.
 */
export function appendOnlyProof(devRowHashes, devFrameHash, hoRowHashes, hoFrameHash) {
  for (const [id, h] of Object.entries(devRowHashes)) {
    if (!Object.hasOwn(hoRowHashes, id)) throw new Error(`held-out frame drops development-frame row ${id} — frames are append-only`);
    if (hoRowHashes[id] !== h) throw new Error(`held-out frame edits development-frame row ${id} — frames are append-only`);
  }
  const rows = sha256(canonicalJson(devRowHashes));
  return { development_frame_hash: devFrameHash, held_out_frame_hash: hoFrameHash, development_row_hashes_sha256: rows, proof: appendOnlyProofHash(devFrameHash, hoFrameHash, rows) };
}
