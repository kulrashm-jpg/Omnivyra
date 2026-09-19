// Public preregistration record (CPG_U1_PROTOCOL_003 §5.2). The tooling never creates, publishes or
// names anything: it writes a template whose identities are UNASSIGNED and refuses to proceed
// until a human supplies them. It cannot see the registry; outsiders confirm the record there.
import { MAINNET, SYNTHETIC, parseOutpoint } from './bitcoin.mjs';
import { STUDY_ID } from './commitment.mjs';
import { DELTA_SECONDS, MISSING_ROUND_EXPIRY_SECONDS, QUICKNET } from './drand.mjs';

export const REGISTRATION_SCHEMA = 'cpg-u1-registration/v1';
export const PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_004';
export const UNASSIGNED = 'UNASSIGNED';
export const REGISTRY = Object.freeze({ name: 'OSF Registries', public: true, embargo: false });

/** Pinned sampling parameters (U2, U3 approvals). A registration must reproduce them exactly. */
export const PARAMETERS = Object.freeze({
  confirmations_D: 6,
  randomness_offset_K: 12,
  abandonment_days: 180,
  randomness_model: 'B',
  drand_chain_hash: QUICKNET.hash,
  drand_delta_seconds: DELTA_SECONDS,
  drand_missing_round_expiry_days: MISSING_ROUND_EXPIRY_SECONDS / 86400,
  commitment_opreturn: 'CPGU1|01|44(D)/48(H)|sha256 digest',
  digest_domain: 'cpg-u1-commitment-digest/v1',
  seed_derivation: 'cpg-u1-chain-drand-seed/v1',
  rank_key: 'sha256("<seed>|<scheme>:<identifier>")',
  bls_implementation: '@noble/curves@1.9.7 + @noble/hashes@1.8.0 (vendored)',
});

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SYNTHETIC_PREFIX = 'SYNTHETIC';

export function registrationTemplate({ protocolSha, toolingAggregate, registrySha }) {
  return {
    schema: REGISTRATION_SCHEMA,
    study_id: STUDY_ID,
    protocol_version: PROTOCOL_VERSION,
    protocol_sha256: protocolSha,
    tooling_aggregate_sha256: toolingAggregate,
    registry_sha256: registrySha,
    registry: { ...REGISTRY },
    registration_id: UNASSIGNED,
    registration_timestamp: UNASSIGNED,
    accountable_identity: { status: 'REQUIRED_AT_REGISTRATION', value: UNASSIGNED },
    persistent_identifier: { type: UNASSIGNED, value: UNASSIGNED },
    bitcoin_key_custodian: { status: 'REQUIRED_BEFORE_FUNDING', role: 'STUDY_OPERATOR', value: UNASSIGNED },
    network: MAINNET.name,
    outpoints: { development: UNASSIGNED, 'held-out': UNASSIGNED },
    checkpoint: { height: UNASSIGNED, hash: UNASSIGNED },
    parameters: { ...PARAMETERS },
    // §7 / §19.1: one frozen asOf for the run and the provider configuration hash, both fixed before registration.
    as_of: UNASSIGNED,
    provider_configuration_sha256: UNASSIGNED,
    authority_rule: 'The earliest registration under the accountable identity with this study_id is authoritative; a second registration with different sampling fields, or a withdrawal, voids the study.',
    verification_procedure: `${PROTOCOL_VERSION} §21 (cpg_u1_data.mjs verify-sampling)`,
  };
}

const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;

/**
 * phase 'funding'     — may Bitcoin outputs be created? Needs the key custodian (role STUDY_OPERATOR).
 * phase 'registered'  — is this a complete registered record? Needs everything.
 * Returns { errors, blockers }: errors = malformed/forbidden; blockers = named human prerequisites missing.
 */
export function checkRegistration(reg, { phase, allowSynthetic = false }) {
  const errors = []; const blockers = [];
  if (!reg || typeof reg !== 'object') return { errors: ['registration record missing'], blockers };
  const synthetic = (v) => typeof v === 'string' && v.toUpperCase().includes(SYNTHETIC_PREFIX);
  const human = (v, name, label) => {
    if (!assigned(v)) blockers.push(`${label} is UNASSIGNED (${name})`);
    else if (synthetic(v) && !allowSynthetic) errors.push(`${name} is a SYNTHETIC test value — refused outside test mode`);
  };

  if (reg.schema !== REGISTRATION_SCHEMA) errors.push(`schema must be ${REGISTRATION_SCHEMA}`);
  if (reg.study_id !== STUDY_ID) errors.push(`study_id must be ${STUDY_ID}`);
  if (reg.protocol_version !== PROTOCOL_VERSION) errors.push(`protocol_version must be ${PROTOCOL_VERSION}`);
  for (const k of ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256']) if (!HEX64.test(reg[k] ?? '')) errors.push(`${k} must be 64 lowercase hex characters`);
  if (reg.network !== MAINNET.name && !(allowSynthetic && reg.network === SYNTHETIC.name)) errors.push(`network must be ${MAINNET.name}`);
  const p = reg.parameters ?? {};
  if (Object.keys(p).length !== Object.keys(PARAMETERS).length) errors.push('parameters must contain exactly the pinned parameter set');
  for (const [k, v] of Object.entries(PARAMETERS)) if (p[k] !== v) errors.push(`parameters.${k} must be ${JSON.stringify(v)} (pinned by U2/U3)`);

  const kc = reg.bitcoin_key_custodian ?? {};
  if (kc.role !== 'STUDY_OPERATOR') errors.push('bitcoin_key_custodian.role must be STUDY_OPERATOR (CPG-040 §3.2)');
  human(kc.value, 'bitcoin_key_custodian.value', 'Bitcoin wallet-key custodian');
  if (phase === 'funding') return { errors, blockers };

  const r = reg.registry ?? {};
  if (r.name !== REGISTRY.name) errors.push(`registry.name must be ${REGISTRY.name} (U1)`);
  if (r.public !== true) errors.push('registry.public must be true (U1: public)');
  if (r.embargo !== false) errors.push('registry.embargo must be false (U1: no embargo)');
  human(reg.accountable_identity?.value, 'accountable_identity.value', 'Accountable OSF identity');
  human(reg.persistent_identifier?.type, 'persistent_identifier.type', 'Persistent identifier type');
  human(reg.persistent_identifier?.value, 'persistent_identifier.value', 'Persistent identifier');
  if (!assigned(reg.registration_id)) blockers.push('registration_id is UNASSIGNED (issued by the registry at registration)');
  else if (reg.registration_id.includes('|')) errors.push('registration_id must not contain "|"');
  if (!assigned(reg.registration_timestamp)) blockers.push('registration_timestamp is UNASSIGNED (issued by the registry at registration)');
  else if (!ISO_UTC.test(reg.registration_timestamp) || Number.isNaN(Date.parse(reg.registration_timestamp))) errors.push('registration_timestamp must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ');

  const o = reg.outpoints ?? {};
  if (!assigned(o.development) || !assigned(o['held-out'])) blockers.push('outpoints are UNASSIGNED (created by the key custodian before registration)');
  else {
    try { parseOutpoint(o.development); parseOutpoint(o['held-out']); } catch (e) { errors.push(e.message); }
    if (o.development === o['held-out']) errors.push('development and held-out outpoints must be distinct');
  }
  const cp = reg.checkpoint ?? {};
  if (cp.height === UNASSIGNED || cp.hash === UNASSIGNED) blockers.push('checkpoint is UNASSIGNED (a block at or after both funding confirmations)');
  else if (!Number.isSafeInteger(cp.height) || cp.height < 0 || !HEX64.test(cp.hash ?? '')) errors.push('checkpoint must be {height: integer, hash: 64 hex}');
  if (!assigned(reg.as_of)) blockers.push('as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)');
  else if (!ISO_UTC.test(reg.as_of) || Number.isNaN(Date.parse(reg.as_of))) errors.push('as_of must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ');
  if (!assigned(reg.provider_configuration_sha256)) blockers.push('provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)');
  else if (!HEX64.test(reg.provider_configuration_sha256)) errors.push('provider_configuration_sha256 must be 64 lowercase hex characters');
  return { errors, blockers };
}

export const registrationEpoch = (reg) => Math.floor(Date.parse(reg.registration_timestamp) / 1000);

const SAMPLING_FIELDS = ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'network', 'outpoints', 'checkpoint', 'parameters'];
const samplingView = (r) => JSON.stringify(SAMPLING_FIELDS.map((k) => r[k]));

/**
 * Authority (U1 / CPG-040 §2.3) over the full list of the accountable identity's registrations
 * for this study_id, as enumerated from the registry by the verifier.
 * Returns null when `reg` is authoritative, else the VOID reason.
 */
export function checkAuthority(reg, identityRegistrations) {
  if (!Array.isArray(identityRegistrations)) throw new Error('identity registration list must be an array');
  const same = identityRegistrations.filter((x) => x && x.study_id === STUDY_ID);
  if (!same.some((x) => x.registration_id === reg.registration_id)) throw new Error('the registration is not in the identity registration list');
  for (const x of same) {
    if (!ISO_UTC.test(x.registration_timestamp ?? '')) throw new Error(`listed registration ${x.registration_id} has no valid registration_timestamp`);
    if (x.accountable_identity?.value !== reg.accountable_identity.value) throw new Error(`listed registration ${x.registration_id} is under a different identity`);
  }
  const earliest = [...same].sort((a, b) => Date.parse(a.registration_timestamp) - Date.parse(b.registration_timestamp) || (a.registration_id < b.registration_id ? -1 : 1))[0];
  if (earliest.registration_id !== reg.registration_id) return `an earlier registration (${earliest.registration_id}) exists for ${STUDY_ID} — this record is not authoritative`;
  const self = same.find((x) => x.registration_id === reg.registration_id);
  if (samplingView(self) !== samplingView(reg)) return 'the registry copy of this registration differs from the supplied record in sampling fields';
  if (same.some((x) => x.withdrawn === true)) return 'a registration for this study was withdrawn — study VOID';
  const dup = same.find((x) => x.registration_id !== reg.registration_id && samplingView(x) !== samplingView(reg));
  if (dup) return `duplicate registration ${dup.registration_id} names different sampling fields — study VOID`;
  return null;
}
