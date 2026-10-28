/**
 * Operator attestation store — `identity_verification_attestations`
 * (migration 20261231000007).
 *
 * An operator may RECORD that, in their judgement, a platform account is a
 * person's, with the basis, a statement, supporting references and their step-up
 * provenance; and may WITHDRAW it. That is all. An attestation:
 *   - never writes, reads or changes `identity_claims` (the only table this
 *     module touches is ATTESTATIONS_TABLE);
 *   - never sets `verification_state` and never satisfies the community person
 *     proof (communityIdentityProof.ts requires an ACCEPTED method in the claim's
 *     evidence — verificationContract.ts — and operator attestation is
 *     NON_PROVING);
 *   - is answered with `confersVerification: false`, always.
 *
 * Tenant: every read and write is filtered by the VERIFIED organization the
 * route passes; the database adds a composite (person_id, organization_id) FK
 * and a guard that re-checks the optional claim / discovered-user references in
 * the same tenant and refuses any edit but recorded → withdrawn.
 * Concurrency: one RECORDED attestation per (tenant, platform, provider id),
 * enforced by a partial unique index; a concurrent loser reads the winner.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { normalizeClaimValue } from '../prospectIdentity/normalization';
import { operatorAttestationConfersVerification } from './verificationContract';

export const ATTESTATIONS_TABLE = 'identity_verification_attestations';
export const ATTESTATION_METHOD = 'operator_attestation' as const;
export const ATTESTATION_BASES = ['public_profile_review', 'direct_communication', 'customer_provided', 'other'] as const;
export type AttestationBasis = typeof ATTESTATION_BASES[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM = /^[a-z][a-z0-9_]{1,31}$/;
const COLUMNS = 'id, organization_id, person_id, platform, provider_user_id, identity_claim_id, discovered_user_id, method, basis, statement, evidence, attested_by, step_up_session_id, step_up_factor, attested_at, status, withdrawn_at, withdrawn_by, withdrawn_reason, confers_verification, created_at';

export type AttestationErrorCode =
  | 'invalid_input'
  | 'evidence_invalid'
  | 'person_not_found'
  | 'not_found'
  | 'account_already_attested'
  | 'reference_invalid'
  | 'attestation_unreadable'
  | 'attestation_write_failed';

export class AttestationError extends Error {
  constructor(message: string, readonly code: AttestationErrorCode) {
    super(message);
    this.name = 'AttestationError';
  }
}
const fail = (message: string, code: AttestationErrorCode): never => { throw new AttestationError(message, code); };

export interface AttestationRow {
  id: string;
  organization_id: string;
  person_id: string;
  platform: string;
  provider_user_id: string;
  identity_claim_id: string | null;
  discovered_user_id: string | null;
  method: string;
  basis: string;
  statement: string;
  evidence: Record<string, unknown>;
  attested_by: string;
  step_up_session_id: string | null;
  step_up_factor: string | null;
  attested_at: string;
  status: 'recorded' | 'withdrawn';
  withdrawn_at: string | null;
  withdrawn_by: string | null;
  withdrawn_reason: string | null;
  confers_verification: boolean;
  created_at: string;
}

/** What callers see. `confersVerification` is the constant false, never read from data. */
export interface Attestation {
  id: string;
  organizationId: string;
  personId: string;
  platform: string;
  providerUserId: string;
  identityClaimId: string | null;
  discoveredUserId: string | null;
  method: typeof ATTESTATION_METHOD;
  basis: string;
  statement: string;
  evidence: Record<string, unknown>;
  attestedBy: string;
  stepUpSessionId: string | null;
  stepUpFactor: string | null;
  attestedAt: string;
  status: 'recorded' | 'withdrawn';
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnReason: string | null;
  confersVerification: false;
}

export function toAttestation(r: AttestationRow): Attestation {
  return {
    id: r.id, organizationId: r.organization_id, personId: r.person_id, platform: r.platform,
    providerUserId: r.provider_user_id, identityClaimId: r.identity_claim_id ?? null,
    discoveredUserId: r.discovered_user_id ?? null, method: ATTESTATION_METHOD, basis: r.basis,
    statement: r.statement, evidence: r.evidence ?? {}, attestedBy: r.attested_by,
    stepUpSessionId: r.step_up_session_id ?? null, stepUpFactor: r.step_up_factor ?? null,
    attestedAt: r.attested_at, status: r.status, withdrawnAt: r.withdrawn_at ?? null,
    withdrawnBy: r.withdrawn_by ?? null, withdrawnReason: r.withdrawn_reason ?? null,
    confersVerification: operatorAttestationConfersVerification(),
  };
}

// ── input validation ────────────────────────────────────────────────────────

const EVIDENCE_KEYS = new Set(['references', 'notes', 'observed_at']);

/** Only references, notes and an observation time. Anything else — including a `method` — is refused. */
export function sanitizeAttestationEvidence(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('evidence must be an object', 'evidence_invalid');
  const ev = raw as Record<string, unknown>;
  for (const k of Object.keys(ev)) {
    if (!EVIDENCE_KEYS.has(k)) fail(`evidence key not accepted: ${k.slice(0, 40)}`, 'evidence_invalid');
  }
  const out: Record<string, unknown> = {};
  if (ev.references !== undefined) {
    if (!Array.isArray(ev.references) || ev.references.length > 10
        || ev.references.some((x) => typeof x !== 'string' || x.trim() === '' || x.length > 500)) {
      fail('evidence.references must be up to 10 non-blank strings of at most 500 characters', 'evidence_invalid');
    }
    out.references = (ev.references as string[]).map((x) => x.trim());
  }
  if (ev.notes !== undefined) {
    if (typeof ev.notes !== 'string' || ev.notes.length > 2000) fail('evidence.notes must be a string of at most 2000 characters', 'evidence_invalid');
    out.notes = ev.notes;
  }
  if (ev.observed_at !== undefined) {
    if (typeof ev.observed_at !== 'string' || !Number.isFinite(Date.parse(ev.observed_at))) fail('evidence.observed_at must be an ISO timestamp', 'evidence_invalid');
    out.observed_at = new Date(Date.parse(ev.observed_at as string)).toISOString();
  }
  return out;
}

export interface RecordAttestationInput {
  organizationId: string;   // the VERIFIED tenant
  personId: string;
  platform: string;
  providerUserId: string;
  identityClaimId?: string | null;
  discoveredUserId?: string | null;
  basis: string;
  statement: string;
  evidence?: unknown;
  attestedBy: string;       // the authenticated principal
  stepUpSessionId: string | null;
  stepUpFactor: string | null;
}

function validateRecord(input: RecordAttestationInput) {
  if (!UUID.test(input.organizationId)) fail('organization id must be a uuid', 'invalid_input');
  if (!UUID.test(String(input.personId ?? ''))) fail('person_id must be a uuid', 'invalid_input');
  if (!UUID.test(String(input.attestedBy ?? ''))) fail('the attesting operator must be a canonical user', 'invalid_input');
  const platform = String(input.platform ?? '').trim().toLowerCase();
  if (!PLATFORM.test(platform)) fail('platform is invalid', 'invalid_input');
  const providerUserId = normalizeClaimValue('external_id', typeof input.providerUserId === 'string' ? input.providerUserId : null);
  if (!providerUserId || providerUserId.length > 512) fail('provider_user_id is required (the platform-issued account id)', 'invalid_input');
  for (const [k, v] of [['identity_claim_id', input.identityClaimId], ['discovered_user_id', input.discoveredUserId]] as const) {
    if (v !== undefined && v !== null && !UUID.test(String(v))) fail(`${k} must be a uuid`, 'invalid_input');
  }
  if (!(ATTESTATION_BASES as readonly string[]).includes(String(input.basis))) fail('basis is not one of the accepted bases', 'invalid_input');
  const statement = typeof input.statement === 'string' ? input.statement.trim() : '';
  if (statement.length < 10 || statement.length > 2000) fail('statement must be 10 to 2000 characters', 'invalid_input');
  const evidence = sanitizeAttestationEvidence(input.evidence);
  return { platform, providerUserId: providerUserId as string, statement, evidence };
}

// ── persistence port ────────────────────────────────────────────────────────

type DbResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export interface AttestationPort {
  insert(row: Record<string, unknown>): Promise<DbResult<AttestationRow>>;
  readActiveForAccount(organizationId: string, platform: string, providerUserId: string): Promise<DbResult<AttestationRow>>;
  listForPerson(organizationId: string, personId: string): Promise<DbResult<AttestationRow[]>>;
  withdraw(organizationId: string, id: string, patch: Record<string, unknown>): Promise<DbResult<AttestationRow>>;
}

export const defaultAttestationPort: AttestationPort = {
  async insert(row) {
    return await ownedDbTable(ATTESTATIONS_TABLE).insert(row).select(COLUMNS).single() as unknown as DbResult<AttestationRow>;
  },
  async readActiveForAccount(organizationId, platform, providerUserId) {
    return await ownedDbTable(ATTESTATIONS_TABLE).select(COLUMNS)
      .eq('organization_id', organizationId)              // TENANT FIRST
      .eq('platform', platform)
      .eq('provider_user_id', providerUserId)
      .eq('status', 'recorded')
      .maybeSingle() as unknown as DbResult<AttestationRow>;
  },
  async listForPerson(organizationId, personId) {
    return await ownedDbTable(ATTESTATIONS_TABLE).select(COLUMNS)
      .eq('organization_id', organizationId)              // TENANT FIRST
      .eq('person_id', personId)
      .order('attested_at', { ascending: false })
      .limit(100) as unknown as DbResult<AttestationRow[]>;
  },
  async withdraw(organizationId, id, patch) {
    return await ownedDbTable(ATTESTATIONS_TABLE).update(patch)
      .eq('organization_id', organizationId)              // TENANT FIRST
      .eq('id', id)
      .eq('status', 'recorded')
      .select(COLUMNS)
      .maybeSingle() as unknown as DbResult<AttestationRow>;
  },
};

const REFERENCE_CODES: Record<string, AttestationErrorCode> = {
  'iva:claim_not_found': 'reference_invalid',
  'iva:claim_account_mismatch': 'reference_invalid',
  'iva:claim_revoked': 'reference_invalid',
  'iva:claim_person_mismatch': 'reference_invalid',
  'iva:discovered_user_not_found': 'reference_invalid',
  'iva:discovered_user_account_mismatch': 'reference_invalid',
  'iva:provider_user_id_not_normalized': 'invalid_input',
};

function belongs(row: AttestationRow | null | undefined, organizationId: string): row is AttestationRow {
  return !!row && row.organization_id === organizationId;
}

/** Record an attestation. Idempotent for the same operator + person + account. */
export async function recordAttestation(
  input: RecordAttestationInput,
  port: AttestationPort = defaultAttestationPort,
): Promise<{ attestation: Attestation; replayed: boolean }> {
  const v = validateRecord(input);
  const org = input.organizationId;

  const replayOrConflict = async (): Promise<{ attestation: Attestation; replayed: boolean }> => {
    let existing: DbResult<AttestationRow>;
    try {
      existing = await port.readActiveForAccount(org, v.platform, v.providerUserId);
    } catch {
      return fail('the attestation could not be read', 'attestation_unreadable');
    }
    if (existing.error) fail('the attestation could not be read', 'attestation_unreadable');
    const row = existing.data;
    if (!belongs(row, org)) return fail('the account is already attested; it could not be read back', 'attestation_unreadable');
    if (row.person_id === input.personId && row.attested_by === input.attestedBy) {
      return { attestation: toAttestation(row), replayed: true };
    }
    return fail('the account already carries a recorded attestation; withdraw it first', 'account_already_attested');
  };

  let res: DbResult<AttestationRow>;
  try {
    res = await port.insert({
      organization_id: org,
      person_id: input.personId,
      platform: v.platform,
      provider_user_id: v.providerUserId,
      identity_claim_id: input.identityClaimId ?? null,
      discovered_user_id: input.discoveredUserId ?? null,
      method: ATTESTATION_METHOD,
      basis: input.basis,
      statement: v.statement,
      evidence: v.evidence,
      attested_by: input.attestedBy,
      step_up_session_id: input.stepUpSessionId ?? null,
      step_up_factor: input.stepUpFactor ?? null,
      status: 'recorded',
      confers_verification: false,
    });
  } catch {
    return fail('the attestation could not be recorded', 'attestation_write_failed');
  }
  if (res.error) {
    const code = String(res.error.code ?? '');
    const message = String(res.error.message ?? '');
    if (code === '23505') return replayOrConflict();
    if (code === '23503') return fail('no such person in this tenant', 'person_not_found');
    for (const [marker, mapped] of Object.entries(REFERENCE_CODES)) {
      if (message.includes(marker)) return fail(`a reference does not match the attested account (${marker.slice(4)})`, mapped);
    }
    return fail('the attestation could not be recorded', 'attestation_write_failed');
  }
  if (!belongs(res.data, org)) return fail('the attestation could not be recorded', 'attestation_write_failed');
  return { attestation: toAttestation(res.data), replayed: false };
}

export async function listAttestations(
  organizationId: string, personId: string, port: AttestationPort = defaultAttestationPort,
): Promise<Attestation[]> {
  if (!UUID.test(organizationId) || !UUID.test(String(personId ?? ''))) fail('organization and person ids must be uuids', 'invalid_input');
  let res: DbResult<AttestationRow[]>;
  try {
    res = await port.listForPerson(organizationId, personId);
  } catch {
    return fail('the attestations could not be read', 'attestation_unreadable');
  }
  if (res.error) fail('the attestations could not be read', 'attestation_unreadable');
  return (res.data ?? []).filter((r) => r.organization_id === organizationId && r.person_id === personId).map(toAttestation);
}

export async function withdrawAttestation(
  input: { organizationId: string; attestationId: string; withdrawnBy: string; reason: string; now?: Date },
  port: AttestationPort = defaultAttestationPort,
): Promise<Attestation> {
  if (!UUID.test(input.organizationId) || !UUID.test(String(input.attestationId ?? ''))) fail('ids must be uuids', 'invalid_input');
  if (!UUID.test(String(input.withdrawnBy ?? ''))) fail('the withdrawing operator must be a canonical user', 'invalid_input');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) fail('reason must be 3 to 500 characters', 'invalid_input');
  let res: DbResult<AttestationRow>;
  try {
    res = await port.withdraw(input.organizationId, input.attestationId, {
      status: 'withdrawn',
      withdrawn_at: (input.now ?? new Date()).toISOString(),
      withdrawn_by: input.withdrawnBy,
      withdrawn_reason: reason,
    });
  } catch {
    return fail('the attestation could not be withdrawn', 'attestation_write_failed');
  }
  if (res.error) fail('the attestation could not be withdrawn', 'attestation_write_failed');
  if (!belongs(res.data, input.organizationId)) fail('no recorded attestation with that id in this tenant', 'not_found');
  return toAttestation(res.data as AttestationRow);
}
