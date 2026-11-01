/**
 * PI / person erasure — the APPLICATION SERVICE behind the erasure API.
 *
 * `erasePerson` (./personErasure) is the erasure procedure and the request
 * ledger (20270112000003) is its durable state. Until this module, nothing in
 * production called either. This module is the one caller: it adds nothing to
 * the procedure and keeps no state of its own beyond what the ledger and the
 * completion verification (20270115000000) record.
 *
 *   start  — the subject must exist IN THIS TENANT (one tenant-first read; a
 *            person of another tenant is indistinguishable from a missing one),
 *            then `erasePerson` opens or RESUMES the ledger request (one open
 *            request per person, leased to one runner), runs steps 3-5, the
 *            `beforeFinalize` hook captures the verification inventory, and
 *            finalize runs steps 6-7 in one transaction. Then the completion
 *            is VERIFIED; only a clean (or owner-accepted) verification is
 *            reported as COMPLETED.
 *   retry  — by request id, from the ledger row (never from a caller-supplied
 *            person id): a pending request re-runs erasePerson (which resumes);
 *            a completed but unverified/residual request re-runs verification.
 *   status / list — read the ledger and the verification record.
 *
 * SYNCHRONOUS, deliberately (not BullMQ/safeEnqueue): the durable state machine
 * is the ledger, which already provides idempotent initiation, a lease against
 * concurrent destructive execution and resumable markers. A queue job would be
 * a second state machine over the same request, and a lost/duplicated job would
 * have to be reconciled against the ledger anyway. A request that dies mid-way
 * (function timeout, crash) is recovered by the ledger: its lease expires and
 * the next start/retry resumes it.
 *
 * NO PERSONAL DATA leaves through here: errors are reduced to their CODE (a
 * PersonErasureError message can quote a contact address), verification
 * reports check names and counts, and nothing logs a person id.
 */
import { ownedDbRpc, ownedDbTable } from '../../db/writeOwner';
import { erasePerson, PersonErasureError } from './personErasure';

// ─── vocabulary ────────────────────────────────────────────────────────────

/** API status model, DERIVED from the ledger (which stores only pending/completed). */
export type ErasureStatus =
  | 'REQUESTED' | 'IN_PROGRESS' | 'PARTIALLY_COMPLETED'
  | 'RETRY_REQUIRED' | 'COMPLETED' | 'FAILED_REQUIRES_REVIEW';

/** Fixed reason vocabulary: the ledger stores the reason, so it must never be free text (no PII). */
export const ERASURE_REASON_CODES = [
  'data_subject_request', 'consent_withdrawn', 'legal_obligation', 'tenant_request',
] as const;
export type ErasureReasonCode = typeof ERASURE_REASON_CODES[number];

/**
 * An optional operator ticket reference, stored in the ledger's `reason` (which
 * OUTLIVES the erasure). Restricted to a ticket-key shape: an uppercase project
 * prefix, a hyphen and a number (e.g. `DSR-1234`, `PRIV-42`). No lower case, no
 * '@', '.', '_', ':', '/' or spaces, and the number part is mandatory, so free
 * text such as `Jane.Doe`, `jane_doe` or an address is refused. The shape alone
 * cannot prove the prefix is not a name: operators must use the ticket key and
 * nothing else.
 */
export const ERASURE_REFERENCE_RE = /^[A-Z][A-Z0-9]{0,15}-[0-9]{1,10}$/;
export const ERASURE_REFERENCE_SHAPE = 'an uppercase ticket key such as DSR-1234 (^[A-Z][A-Z0-9]{0,15}-[0-9]{1,10}$)';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function erasureReason(code: ErasureReasonCode, reference?: string | null): string {
  return reference ? `${code} ref=${reference}` : code;
}

/**
 * OWNER-DECISION SWITCH — residual checks that may still be reported as
 * COMPLETED. EMPTY: no owner decision is signed. Each entry is a verification
 * check name (20270115000000) of category `policy_retained` or `known_gap`;
 * a `violation` is never acceptable whatever is listed here.
 *
 *   SUBJ  (lead subject_id, option R)  → 'leads.personal_fields', 'outreach_tasks.lead_key_legacy'
 *   ODEC  (retain decision references) → 'outreach_decisions.person_id'
 *   ER-GAP (uncovered tables)          → 'form_conversions.rows', 'lead_attributions.rows',
 *          'campaign_touchpoints.rows', 'canonical_attribute_decisions.value',
 *          'prospect_score_evaluations.unredacted_for_prospect',
 *          'capability_audit_log.resource_id', 'polymorphic:<table>.<column>'
 *
 * Adding an entry is the implementation of a SIGNED decision and must cite it.
 */
export const ACCEPTED_RESIDUAL_CHECKS: ReadonlySet<string> = new Set<string>([]);

/** Error codes after which a plain retry cannot succeed: an operator must act first. */
const REVIEW_CODES: ReadonlySet<string> = new Set([
  'merge_survivor', 'delete_blocked', 'person_vanished_outside_ledger', 'inventory_missing',
  'request_already_completed',
]);

const FUNCTION_MISSING = new Set(['PGRST202', '42883']);
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

const LEDGER_COLUMNS = 'id, organization_id, person_id, reason, requested_by, status, attempts, lease_expires_at, '
  + 'governance_reanchored_at, governance_revoked_at, evidence_links_cleared_at, provenance_erased_at, '
  + 'person_deleted_at, finalize_counts, last_error_code, last_attempt_at, created_at, completed_at';
const VERIFICATION_COLUMNS = 'id, request_id, verified_at, outcome, checks, policies, inventory_purged';

export interface LedgerRow {
  id: string;
  organization_id: string;
  person_id: string | null;
  reason: string;
  requested_by: string;
  status: 'pending' | 'completed';
  attempts: number;
  lease_expires_at: string | null;
  governance_reanchored_at: string | null;
  governance_revoked_at: string | null;
  evidence_links_cleared_at: string | null;
  provenance_erased_at: string | null;
  person_deleted_at: string | null;
  finalize_counts: Record<string, unknown> | null;
  last_error_code: string | null;
  last_attempt_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VerificationCheck { check: string; category: string; count: number }
export interface VerificationRow {
  id: string;
  request_id: string;
  verified_at: string;
  outcome: 'clean' | 'residual';
  checks: VerificationCheck[];
  policies: Record<string, unknown> | null;
  inventory_purged: boolean;
}

export interface ErasureRequestView {
  requestId: string | null;
  status: ErasureStatus;
  /** Only while the request is open: it is the caller's own tenant's subject. Never after completion. */
  personId: string | null;
  attempts: number;
  steps: {
    governanceReanchored: boolean; governanceRevoked: boolean; evidenceLinksCleared: boolean;
    provenanceErased: boolean; personDeleted: boolean;
  };
  lastErrorCode: string | null;
  policies: Record<string, unknown> | null;
  verification: null | {
    verificationId: string; outcome: 'clean' | 'residual'; verifiedAt: string; inventoryPurged: boolean;
    /** Every non-zero, non-info check, with whether an owner decision accepts it. */
    residual: Array<VerificationCheck & { accepted: boolean }>;
  };
  createdAt: string | null;
  completedAt: string | null;
}

export type ErasureOutcome =
  | { kind: 'subject_not_found' }
  | { kind: 'request_not_found' }
  | { kind: 'ledger_unavailable' }
  | { kind: 'request'; view: ErasureRequestView; errorCode: string | null };

// ─── pure status derivation ────────────────────────────────────────────────

const blockingResidual = (checks: VerificationCheck[], accepted: ReadonlySet<string>) =>
  checks.filter((c) => c.category !== 'info' && Number(c.count) > 0)
    .map((c) => ({ ...c, count: Number(c.count), accepted: c.category !== 'violation' && accepted.has(c.check) }));

/**
 * Ledger row (+ latest verification) → API status. Pure; `nowMs` injected.
 *
 *   completed + clean or fully-accepted verification  → COMPLETED
 *   completed + residual not accepted                 → FAILED_REQUIRES_REVIEW
 *   completed + no verification yet                   → PARTIALLY_COMPLETED (verification pending)
 *   pending, person gone outside the ledger            → FAILED_REQUIRES_REVIEW
 *   pending, lease live                                → IN_PROGRESS
 *   pending, last error needs an operator              → FAILED_REQUIRES_REVIEW
 *   pending, last error retryable                      → RETRY_REQUIRED
 *   pending, markers but no outcome (runner died)      → PARTIALLY_COMPLETED
 *   pending, nothing done yet                          → REQUESTED
 */
export function deriveErasureStatus(
  row: LedgerRow, verification: VerificationRow | null, nowMs: number,
  accepted: ReadonlySet<string> = ACCEPTED_RESIDUAL_CHECKS,
): ErasureStatus {
  if (row.status === 'completed') {
    if (!verification) return 'PARTIALLY_COMPLETED';
    if (verification.outcome === 'clean') return 'COMPLETED';
    // A residual verification is COMPLETED only when every blocking check is
    // owner-accepted (never a violation); `every` of none is true.
    return blockingResidual(verification.checks ?? [], accepted).every((r) => r.accepted)
      ? 'COMPLETED' : 'FAILED_REQUIRES_REVIEW';
  }
  if (row.person_id === null) return 'FAILED_REQUIRES_REVIEW';
  if (row.lease_expires_at && Date.parse(row.lease_expires_at) > nowMs) return 'IN_PROGRESS';
  if (row.last_error_code) return REVIEW_CODES.has(row.last_error_code) ? 'FAILED_REQUIRES_REVIEW' : 'RETRY_REQUIRED';
  if (row.governance_reanchored_at || row.governance_revoked_at || row.evidence_links_cleared_at) return 'PARTIALLY_COMPLETED';
  return 'REQUESTED';
}

export function toView(
  row: LedgerRow, verification: VerificationRow | null, nowMs: number,
  accepted: ReadonlySet<string> = ACCEPTED_RESIDUAL_CHECKS,
): ErasureRequestView {
  return {
    requestId: row.id,
    status: deriveErasureStatus(row, verification, nowMs, accepted),
    personId: row.status === 'pending' ? row.person_id : null,
    attempts: Number(row.attempts ?? 0),
    steps: {
      governanceReanchored: !!row.governance_reanchored_at,
      governanceRevoked: !!row.governance_revoked_at,
      evidenceLinksCleared: !!row.evidence_links_cleared_at,
      provenanceErased: !!row.provenance_erased_at,
      personDeleted: !!row.person_deleted_at,
    },
    lastErrorCode: row.last_error_code,
    policies: row.finalize_counts,
    verification: verification ? {
      verificationId: verification.id,
      outcome: verification.outcome,
      verifiedAt: verification.verified_at,
      inventoryPurged: verification.inventory_purged,
      residual: blockingResidual(verification.checks ?? [], accepted),
    } : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const bareView = (status: ErasureStatus, errorCode: string | null): ErasureRequestView => ({
  requestId: null, status, personId: null, attempts: 0,
  steps: { governanceReanchored: false, governanceRevoked: false, evidenceLinksCleared: false, provenanceErased: false, personDeleted: false },
  lastErrorCode: errorCode, policies: null, verification: null, createdAt: null, completedAt: null,
});

// ─── database seams (service-role server client only) ──────────────────────

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
const safeCode = (c: unknown, fallback: string): string => (typeof c === 'string' && SAFE_CODE.test(c) ? c : fallback);

/** Lease-holder-only inventory capture, run by erasePerson's `beforeFinalize` hook. */
export async function captureErasureInventory(
  organizationId: string, request: { requestId: string; leaseToken: string },
): Promise<void> {
  const res = await ownedDbRpc('pi_person_erasure_capture_inventory', {
    p_organization_id: organizationId, p_request_id: request.requestId, p_lease_token: request.leaseToken,
  });
  if (res.error) {
    const code = errCode(res.error);
    throw new PersonErasureError(
      'could not capture the erasure verification inventory; nothing was finalized',
      code && FUNCTION_MISSING.has(code) ? 'verification_unavailable'
        : code === '55P03' ? 'erasure_lease_lost' : 'inventory_capture_failed',
    );
  }
}

export async function verifyErasureRequest(organizationId: string, requestId: string): Promise<void> {
  const res = await ownedDbRpc('pi_person_erasure_verify', { p_organization_id: organizationId, p_request_id: requestId });
  if (res.error) {
    const code = errCode(res.error);
    const msg = String((res.error as { message?: unknown }).message ?? '');
    throw new PersonErasureError(
      'erasure completion verification failed',
      code && FUNCTION_MISSING.has(code) ? 'verification_unavailable'
        : /inventory_missing/.test(msg) ? 'inventory_missing'
          : /not_completed/.test(msg) ? 'not_completed' : 'verification_failed',
    );
  }
}

async function loadRequest(organizationId: string, requestId: string): Promise<LedgerRow | null> {
  const res = await ownedDbTable('person_erasure_requests').select(LEDGER_COLUMNS)
    .eq('organization_id', organizationId)       // TENANT FIRST, always
    .eq('id', requestId)
    .maybeSingle();
  if (res.error) throw new Error(`erasure ledger read failed (${safeCode(errCode(res.error), 'unknown')})`);
  return (res.data as unknown as LedgerRow | null) ?? null;
}

async function loadOpenRequestForPerson(organizationId: string, personId: string): Promise<LedgerRow | null> {
  const res = await ownedDbTable('person_erasure_requests').select(LEDGER_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('person_id', personId)
    .eq('status', 'pending')
    .maybeSingle();
  if (res.error) throw new Error(`erasure ledger read failed (${safeCode(errCode(res.error), 'unknown')})`);
  return (res.data as unknown as LedgerRow | null) ?? null;
}

async function loadVerifications(organizationId: string, requestIds: string[]): Promise<Map<string, VerificationRow>> {
  const latest = new Map<string, VerificationRow>();
  if (requestIds.length === 0) return latest;
  const res = await ownedDbTable('person_erasure_verifications').select(VERIFICATION_COLUMNS)
    .eq('organization_id', organizationId)
    .in('request_id', requestIds)
    .order('verified_at', { ascending: false });
  if (res.error) {
    const code = errCode(res.error);
    // Undeployed verification layer: no verification exists, so nothing reads COMPLETED.
    if (code === '42P01' || code === 'PGRST205') return latest;
    throw new Error(`erasure verification read failed (${safeCode(code, 'unknown')})`);
  }
  for (const v of (res.data ?? []) as VerificationRow[]) {
    const prev = latest.get(v.request_id);
    if (!prev || Date.parse(v.verified_at) > Date.parse(prev.verified_at)) latest.set(v.request_id, v);
  }
  return latest;
}

async function viewOf(organizationId: string, row: LedgerRow, nowMs: number): Promise<ErasureRequestView> {
  const v = await loadVerifications(organizationId, [row.id]);
  return toView(row, v.get(row.id) ?? null, nowMs);
}

// ─── operations ────────────────────────────────────────────────────────────

export interface StartErasureInput {
  organizationId: string;
  personId: string;
  reason: string;
  /** A role/operator LABEL (never a personal identifier) — the ledger's requested_by contract. */
  requestedBy: string;
  now?: () => number;
}

export async function startPersonErasure(input: StartErasureInput): Promise<ErasureOutcome> {
  const now = input.now ?? Date.now;
  if (!isUuid(input.organizationId) || !isUuid(input.personId)) return { kind: 'subject_not_found' };

  // The subject must belong to THIS tenant. Tenant-first; a cross-tenant id and
  // an unknown id get the same answer (no existence oracle).
  const subject = await ownedDbTable('unified_persons').select('id')
    .eq('company_id', input.organizationId)
    .eq('id', input.personId)
    .maybeSingle();
  if (subject.error) throw new Error(`subject read failed (${safeCode(errCode(subject.error), 'unknown')})`);
  if (!subject.data) return { kind: 'subject_not_found' };

  let requestId: string | null = null;
  let errorCode: string | null = null;
  try {
    const result = await erasePerson({
      organizationId: input.organizationId,
      personId: input.personId,
      reason: input.reason,
      requestedBy: input.requestedBy,
      beforeFinalize: (h) => captureErasureInventory(input.organizationId, h),
    });
    if (result.requestId === null) return { kind: 'subject_not_found' };   // vanished between read and open
    requestId = result.requestId;
  } catch (err) {
    const code = err instanceof PersonErasureError ? safeCode(err.code, 'unexpected') : 'unexpected';
    if (code === 'erasure_ledger_unavailable') return { kind: 'ledger_unavailable' };
    if (code === 'cross_tenant') return { kind: 'subject_not_found' };
    errorCode = code;
  }

  if (requestId !== null) {
    try {
      await verifyErasureRequest(input.organizationId, requestId);
    } catch (err) {
      errorCode = err instanceof PersonErasureError ? safeCode(err.code, 'verification_failed') : 'verification_failed';
    }
    const row = await loadRequest(input.organizationId, requestId);
    if (!row) return { kind: 'request', view: bareView('FAILED_REQUIRES_REVIEW', 'ledger_row_missing'), errorCode: 'ledger_row_missing' };
    return { kind: 'request', view: await viewOf(input.organizationId, row, now()), errorCode };
  }

  // The attempt failed. Report the ledger's view of the (still open) request.
  const open = await loadOpenRequestForPerson(input.organizationId, input.personId);
  if (!open) return { kind: 'request', view: bareView('RETRY_REQUIRED', errorCode), errorCode };
  return { kind: 'request', view: await viewOf(input.organizationId, open, now()), errorCode };
}

/**
 * Retry by REQUEST id. The person is taken from the ledger row, never from the
 * caller, so a retry can only ever continue the request it names.
 */
export async function retryErasureRequest(
  organizationId: string, requestId: string, requestedBy: string, now: () => number = Date.now,
): Promise<ErasureOutcome> {
  if (!isUuid(organizationId) || !isUuid(requestId)) return { kind: 'request_not_found' };
  const row = await loadRequest(organizationId, requestId);
  if (!row) return { kind: 'request_not_found' };

  if (row.status === 'pending' && row.person_id) {
    const out = await startPersonErasure({ organizationId, personId: row.person_id, reason: row.reason, requestedBy, now });
    if (out.kind !== 'subject_not_found') return out;
    // The person is gone but the request is still open: deleted outside the ledger.
    const again = await loadRequest(organizationId, requestId);
    return { kind: 'request', view: await viewOf(organizationId, again ?? row, now()), errorCode: 'person_vanished_outside_ledger' };
  }

  // Open, but the person was deleted by something other than finalize: steps
  // 6-7 can never be proven. An operator must review (the ledger's own report).
  let errorCode: string | null = row.status === 'pending' ? 'person_vanished_outside_ledger' : null;
  if (row.status === 'completed') {
    const current = (await loadVerifications(organizationId, [row.id])).get(row.id) ?? null;
    if (deriveErasureStatus(row, current, now()) !== 'COMPLETED') {
      try {
        await verifyErasureRequest(organizationId, row.id);
      } catch (err) {
        errorCode = err instanceof PersonErasureError ? safeCode(err.code, 'verification_failed') : 'verification_failed';
      }
    }
  }
  return { kind: 'request', view: await viewOf(organizationId, row, now()), errorCode };
}

export async function getErasureRequest(
  organizationId: string, requestId: string, now: () => number = Date.now,
): Promise<ErasureRequestView | null> {
  if (!isUuid(organizationId) || !isUuid(requestId)) return null;
  const row = await loadRequest(organizationId, requestId);
  return row ? viewOf(organizationId, row, now()) : null;
}

export interface ErasureRequestList {
  requests: ErasureRequestView[];
  /** pi_person_erasure_inconsistencies: partial states an operator must look at (codes only). */
  inconsistencies: Array<{ requestId: string | null; problem: string }>;
}

export async function listErasureRequests(
  organizationId: string, opts: { limit?: number; now?: () => number } = {},
): Promise<ErasureRequestList> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 50)), 200);
  const now = opts.now ?? Date.now;
  const res = await ownedDbTable('person_erasure_requests').select(LEDGER_COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`erasure ledger read failed (${safeCode(errCode(res.error), 'unknown')})`);
  const rows = (res.data ?? []) as unknown as LedgerRow[];
  const verifications = await loadVerifications(organizationId, rows.map((r) => r.id));
  const nowMs = now();

  const inc = await ownedDbRpc('pi_person_erasure_inconsistencies', { p_organization_id: organizationId });
  if (inc.error) throw new Error(`erasure inconsistency read failed (${safeCode(errCode(inc.error), 'unknown')})`);
  const inconsistencies = ((inc.data ?? []) as Array<{ request_id: string | null; problem: string }>)
    .map((r) => ({ requestId: r.request_id ?? null, problem: String(r.problem) }));

  return { requests: rows.map((r) => toView(r, verifications.get(r.id) ?? null, nowMs)), inconsistencies };
}
