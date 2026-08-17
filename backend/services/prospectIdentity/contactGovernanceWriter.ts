/**
 * LI-3D — the canonical contact governance WRITER.
 *
 * LI-3B created the table and the pure evaluator; LI-3C wired the evaluator into
 * Path B's gate. Neither could create a record, so the table has been live and
 * permanently empty. This is the only module permitted to write it.
 *
 * It decides nothing. Every rule — the nine-type vocabulary, channel semantics,
 * the idempotency key, revocation being append-only — is fixed by
 * OMNIVYRA_LI3_CONTACT_GOVERNANCE_ADR.md and by the CHECK constraints in
 * 20261003000000_li3_contact_governance.sql. This module enforces them at the
 * edge so a caller gets a clear error instead of a raw SQLSTATE, and otherwise
 * lets the database be the authority.
 *
 * ─── IDEMPOTENCY IS BY DATABASE CONSTRAINT (ADR §13) ──────────────────────
 * The canonical key is a PARTIAL unique index (`WHERE revoked_at IS NULL`).
 * PostgREST cannot infer a partial index, so `ON CONFLICT` answers `42P10` —
 * the trap this programme hit in W0.1, W0.2 and W3. Persistence is therefore
 * INSERT → catch `23505` → re-resolve, exactly as LI-2's `upsertSourceRecord`
 * does. There is no SELECT-then-INSERT: that is a race, not an idempotency
 * mechanism.
 *
 * ─── TENANT SAFETY IS ENFORCED BY THE DATABASE, NOT BY A PRE-CHECK ────────
 * `(person_id, organization_id) → unified_persons(id, company_id)` means
 * attaching Tenant A's person to a Tenant B record raises `23503`. We do not
 * pre-validate with a SELECT: between the check and the insert the world can
 * change, and a composite foreign key cannot.
 *
 * ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 * No parser, no opt-out detection, no provider, no send path, no channel
 * activation, no quiet hours, no contact fatigue, no frequency caps. It writes
 * standing instructions and revokes them. Nothing else.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { GOVERNANCE_TYPES, isGovernanceType, type GovernanceChannel, type GovernanceType } from './contactGovernance';
import { normalizeGovernanceTarget } from './contactGovernanceRepository';

/** Evidence keys that would carry content rather than a summary (ADR §6/§12). */
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  'body', 'html', 'text', 'transcript', 'payload', 'message', 'messages',
  'raw', 'raw_email', 'email_body', 'content', 'attachment', 'attachments',
]);

/** A summary stays small. This is a backstop against a payload dump, not a tuning knob. */
const MAX_EVIDENCE_BYTES = 4_096;

export interface RecordGovernanceInput {
  organizationId: string;
  governanceType: GovernanceType;
  channel: GovernanceChannel;
  /** Canonical person, when known. Either this or `target` must be present. */
  personId?: string | null;
  /** Raw address or number; normalised here with the same function the reader uses. */
  target?: string | null;
  /** Provider-neutral provenance, e.g. 'manual', 'webhook:ses'. */
  source: string;
  /** LI-2 evidence row, when the instruction came from one. */
  sourceRecordId?: string | null;
  /** SUMMARY ONLY — matched phrase, confidence, detector version, actor. */
  evidence?: Record<string, unknown>;
  effectiveFrom?: string;
  /** Only `deferred` may carry one (DB CHECK enforces this too). */
  effectiveUntil?: string | null;
}

export interface RecordGovernanceResult {
  id: string;
  /** `created` on a fresh insert; `already_present` when the canonical key collided. */
  outcome: 'created' | 'already_present';
}

export class GovernanceWriteError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'GovernanceWriteError';
  }
}

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/**
 * Reject evidence that carries content instead of a summary.
 *
 * The ADR is explicit that transcripts, bodies and provider payloads live in
 * `source_records`, never here. Enforcing it at the writer means a careless
 * caller fails loudly rather than quietly turning a compliance table into a PII
 * store that must later be purged.
 */
function assertSummaryEvidence(evidence: Record<string, unknown>): void {
  for (const key of Object.keys(evidence)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key.toLowerCase())) {
      throw new GovernanceWriteError(
        `evidence key '${key}' carries content, not a summary — put it in source_records`,
        'evidence_not_summary',
      );
    }
  }
  const size = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
  if (size > MAX_EVIDENCE_BYTES) {
    throw new GovernanceWriteError(
      `evidence is ${size} bytes, over the ${MAX_EVIDENCE_BYTES}-byte summary limit`,
      'evidence_too_large',
    );
  }
}

function validate(input: RecordGovernanceInput): { target: string | null; evidence: Record<string, unknown> } {
  if (!input.organizationId?.trim()) {
    throw new GovernanceWriteError('organizationId is required — governance is never tenant-less', 'tenant_required');
  }
  if (!isGovernanceType(input.governanceType)) {
    throw new GovernanceWriteError(
      `unknown governance type '${input.governanceType}' — the vocabulary is closed: ${GOVERNANCE_TYPES.join(', ')}`,
      'unknown_governance_type',
    );
  }
  if (!input.channel?.trim()) {
    throw new GovernanceWriteError('channel is required', 'channel_required');
  }
  if (!input.source?.trim()) {
    throw new GovernanceWriteError('source is required — a record with no provenance is unauditable', 'source_required');
  }

  const target = normalizeGovernanceTarget(input.channel, input.target);
  const personId = input.personId ?? null;
  if (!personId && !target) {
    throw new GovernanceWriteError(
      'a governance record must be anchored to a person or a target, or it can never match',
      'anchor_required',
    );
  }

  const evidence = input.evidence ?? {};
  assertSummaryEvidence(evidence);
  return { target, evidence };
}

/**
 * Create a standing governance instruction, idempotently.
 *
 * A second identical instruction collides on the canonical key and returns the
 * existing row as `already_present` — the duplicate is a no-op, not an error,
 * because a webhook retrying is normal and must not fail the caller.
 */
export async function recordContactGovernance(input: RecordGovernanceInput): Promise<RecordGovernanceResult> {
  const { target, evidence } = validate(input);
  const personId = input.personId ?? null;

  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    person_id: personId,
    target_normalized: target,
    // Kept beside the normalised form so a normalisation bug stays auditable —
    // the LI-2 precedent.
    target_raw: typeof input.target === 'string' && input.target.trim() ? input.target : null,
    channel: input.channel,
    governance_type: input.governanceType,
    source: input.source,
    source_record_id: input.sourceRecordId ?? null,
    evidence,
  };
  if (input.effectiveFrom) row.effective_from = input.effectiveFrom;
  if (input.effectiveUntil) row.effective_until = input.effectiveUntil;

  const insert = await ownedDbTable('contact_governance_records').insert(row).select('id').single();
  if (!insert.error) {
    return { id: String((insert.data as { id: string }).id), outcome: 'created' };
  }

  const code = errCode(insert.error);

  // A composite-FK violation is the tenant guard firing. Translate it, because
  // "insert or update violates foreign key constraint" does not tell a caller
  // that they attached another tenant's person.
  if (code === '23503') {
    throw new GovernanceWriteError(
      'person or source record does not belong to this tenant — cross-tenant governance is refused by the database',
      'cross_tenant_reference',
    );
  }
  if (code === '23514') {
    throw new GovernanceWriteError(
      `the record violates a governance invariant (${insert.error.message})`,
      'invariant_violation',
    );
  }
  if (code !== '23505') {
    throw new GovernanceWriteError(
      `governance insert failed (${code}): ${insert.error.message}`,
      code ?? 'insert_failed',
    );
  }

  // 23505 — another writer holds the canonical key. Re-resolve it deterministically
  // by that exact key, so concurrent callers converge on one row.
  const existing = await resolveByCanonicalKey(input.organizationId, input.channel, input.governanceType, personId, target);
  if (!existing) {
    throw new GovernanceWriteError(
      'governance insert collided on the canonical key but the winning row could not be resolved',
      'collision_unresolved',
    );
  }
  return { id: existing, outcome: 'already_present' };
}

/**
 * Resolve the live record holding a canonical key.
 *
 * Mirrors `uq_contact_governance_identity` exactly, including its
 * `coalesce(person_id, target_normalized)` anchor and its `revoked_at IS NULL`
 * predicate. Any divergence here would resolve a 23505 to the wrong row.
 */
async function resolveByCanonicalKey(
  organizationId: string,
  channel: string,
  governanceType: string,
  personId: string | null,
  target: string | null,
): Promise<string | null> {
  let q = ownedDbTable('contact_governance_records')
    .select('id')
    .eq('organization_id', organizationId)      // TENANT FIRST, always
    .eq('channel', channel)
    .eq('governance_type', governanceType)
    .is('revoked_at', null);

  // The index keys on coalesce(person_id, target_normalized): a person-anchored
  // row is identified by its person, and only an unanchored-by-person row falls
  // through to the target.
  q = personId ? q.eq('person_id', personId) : q.is('person_id', null).eq('target_normalized', target);

  const res = await q.limit(1);
  if (res.error) {
    throw new GovernanceWriteError(
      `could not resolve the colliding governance record: ${res.error.message}`,
      errCode(res.error) ?? 'resolve_failed',
    );
  }
  const rows = (res.data ?? []) as Array<{ id: string }>;
  return rows.length ? String(rows[0].id) : null;
}

export interface RevokeGovernanceInput {
  organizationId: string;
  id: string;
  reason: string;
  revokedAt?: string;
}

/**
 * Revoke a standing instruction.
 *
 * ADR §16: a governance record is NEVER deleted, and revocation mutates
 * `revoked_at` / `revoked_reason` and nothing else. The original instruction,
 * its provenance and its effective period stay readable, which is what makes
 * the history defensible to a regulator.
 *
 * Revoking frees the canonical key (the unique index is partial on
 * `revoked_at IS NULL`), so re-recording the same instruction afterwards is
 * expressible — deliberately, per ADR §13.
 */
export async function revokeContactGovernance(input: RevokeGovernanceInput): Promise<{ revoked: boolean }> {
  if (!input.organizationId?.trim()) {
    throw new GovernanceWriteError('organizationId is required', 'tenant_required');
  }
  if (!input.id?.trim()) {
    throw new GovernanceWriteError('id is required', 'id_required');
  }
  if (!input.reason?.trim()) {
    // The DB CHECK enforces the pair; this makes the reason explicit at the edge.
    throw new GovernanceWriteError('a revocation without a reason is an unusable audit record', 'reason_required');
  }

  const res = await ownedDbTable('contact_governance_records')
    // ADR §16 is literal: "revoked_at/revoked_reason are set on the existing row;
    // no other field is ever updated." `updated_at` is deliberately NOT touched —
    // that it goes stale on revocation is a question for the ADR owner, not one
    // this writer answers by widening the mutation.
    .update({
      revoked_at: input.revokedAt ?? new Date().toISOString(),
      revoked_reason: input.reason,
    })
    .eq('organization_id', input.organizationId)   // TENANT FIRST — never revoke another tenant's record
    .eq('id', input.id)
    .is('revoked_at', null)                        // already-revoked stays as it was; no rewriting history
    .select('id');

  if (res.error) {
    throw new GovernanceWriteError(
      `governance revoke failed (${errCode(res.error)}): ${res.error.message}`,
      errCode(res.error) ?? 'revoke_failed',
    );
  }
  return { revoked: ((res.data ?? []) as unknown[]).length > 0 };
}
