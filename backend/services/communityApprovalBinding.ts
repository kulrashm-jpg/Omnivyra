/**
 * Prompt 3 — the content binding of one community-action approval.
 *
 * The hash names exactly what a human approved: the tenant, the action row, the platform,
 * the action type, the target, the recipient, the playbook and the text. It is computed
 * server-side from the stored row, both when the passkey challenge is issued and again
 * when the approval is recorded, and persisted as community_ai_actions.approved_content_hash.
 *
 * NOT bound (LD-2): execution_mode. The executor still selects the transport at execute
 * time (api / rpa / browser); the approval authorises the action and its content, not the
 * transport.
 *
 * Same construction as the D-02 outreach binding (approvalBinding.ts): SHA-256 over a JSON
 * array, versioned. The version string differs from outreach's, so the two never collide.
 */

import { createHash } from 'crypto';
import { APPROVAL_LIFETIME_MS } from './leadOutreachExecution/approvalBinding';
import { APPROVAL_PROOF_MAX_AGE_MS } from './leadOutreachExecution/approvalPasskey';

export const COMMUNITY_APPROVAL_BINDING_VERSION = 'community.approval.v1';

const sha256 = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** The stored-row fields the binding reads. */
export interface CommunityApprovalBindingInput {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string | null | undefined;
  action_type: string | null | undefined;
  target_id: string | null | undefined;
  suggested_text: string | null | undefined;
  playbook_id?: string | null;
  discovered_user_id?: string | null;
}

export type CommunityApprovalBindingResult =
  | { ok: true; hash: string }
  | { ok: false; reason: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * The binding hash of `action`, or a refusal when the row cannot be bound (missing id,
 * tenant, platform, action type or target, or tenant_id ≠ organization_id). Never throws.
 */
export function communityApprovalBindingHash(action: CommunityApprovalBindingInput): CommunityApprovalBindingResult {
  const id = str(action?.id);
  const tenant = str(action?.tenant_id);
  const org = str(action?.organization_id);
  const platform = str(action?.platform);
  const actionType = str(action?.action_type);
  const target = str(action?.target_id);
  if (!id || !tenant || !org) return { ok: false, reason: 'the action has no id or tenant scope' };
  if (tenant !== org) return { ok: false, reason: 'the action tenant and organization differ' };
  if (!platform || !actionType || !target) return { ok: false, reason: 'the action has no platform, action type or target' };
  const text = typeof action.suggested_text === 'string' ? action.suggested_text : '';
  const contentHash = sha256(['community.approval.content.v1', text]);
  return {
    ok: true,
    hash: sha256([
      COMMUNITY_APPROVAL_BINDING_VERSION,
      org,
      tenant,
      id,
      platform,
      actionType,
      target,
      str(action.discovered_user_id),
      str(action.playbook_id),
      contentHash,
    ]),
  };
}

/** True when `v` has the shape of a binding hash (64 lowercase hex). */
export const isWellFormedCommunityApprovalHash = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// ── Approval evidence (TS mirror of the claim RPC; defence in depth) ─────────

/**
 * A passkey verification may follow the server-stamped approval by at most this much
 * (the same +60 s the D-02 claim trigger allows, 20270120000011). Before it: at most
 * APPROVAL_PROOF_MAX_AGE_MS (−5 min).
 */
const PASSKEY_AFTER_APPROVAL_MS = 60_000;
/** Application-to-database clock skew tolerated for "approved in the future". */
const APPROVAL_CLOCK_SKEW_MS = 60_000;

export interface CommunityApprovalEvidenceRow extends CommunityApprovalBindingInput {
  approved_at?: string | null;
  approved_by?: string | null;
  approved_content_hash?: string | null;
  passkey_credential_id?: string | null;
  passkey_verified_at?: string | null;
}

export type CommunityApprovalEvidenceCode =
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'APPROVAL_EVIDENCE_REQUIRED'
  | 'APPROVAL_CONTENT_CHANGED'
  | 'APPROVAL_EXPIRED';

export type CommunityApprovalEvidenceResult =
  | { ok: true; approvedAt: string; expiresAt: string }
  | { ok: false; code: CommunityApprovalEvidenceCode; detail: string };

/**
 * Whether `row` carries a current, content-bound, passkey-verified human approval at
 * `nowMs`. Mirrors the claim RPC (20270126000001); the database stays authoritative.
 *
 * 7-day boundary (same as D-02): valid while now < approved_at + 7 days. Exactly at
 * approved_at + 7 days it has EXPIRED.
 */
export function evaluateCommunityApprovalEvidence(
  row: CommunityApprovalEvidenceRow | null | undefined,
  nowMs: number = Date.now(),
): CommunityApprovalEvidenceResult {
  if (!row || !str(row.approved_at)) {
    return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', detail: 'no human approval is recorded' };
  }
  const approvedMs = Date.parse(String(row.approved_at));
  if (!Number.isFinite(approvedMs)) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the approval time is not readable' };
  }
  if (!str(row.approved_by)) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the approval has no recorded approver' };
  }
  if (!isWellFormedCommunityApprovalHash(row.approved_content_hash)) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the approval is not bound to content' };
  }
  if (!str(row.passkey_credential_id) || !str(row.passkey_verified_at)) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the approval has no passkey verification' };
  }
  const verifiedMs = Date.parse(String(row.passkey_verified_at));
  if (!Number.isFinite(verifiedMs)
    || verifiedMs > approvedMs + PASSKEY_AFTER_APPROVAL_MS
    || verifiedMs < approvedMs - APPROVAL_PROOF_MAX_AGE_MS) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the passkey verification does not belong to this approval' };
  }
  const binding = communityApprovalBindingHash(row);
  if (binding.ok !== true) return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: binding.reason };
  if (binding.hash !== row.approved_content_hash) {
    return { ok: false, code: 'APPROVAL_CONTENT_CHANGED', detail: 'the action or its content changed after approval' };
  }
  if (approvedMs > nowMs + APPROVAL_CLOCK_SKEW_MS) {
    return { ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED', detail: 'the approval time is later than the server clock' };
  }
  const expiresMs = approvedMs + APPROVAL_LIFETIME_MS;
  if (nowMs >= expiresMs) {
    return { ok: false, code: 'APPROVAL_EXPIRED', detail: 'the approval is older than 7 days; approve again' };
  }
  return { ok: true, approvedAt: new Date(approvedMs).toISOString(), expiresAt: new Date(expiresMs).toISOString() };
}

/** The columns the evidence check reads from community_ai_actions. */
export const COMMUNITY_APPROVAL_EVIDENCE_COLUMNS =
  'id, tenant_id, organization_id, status, platform, action_type, target_id, suggested_text, playbook_id, discovered_user_id, '
  + 'approved_at, approved_by, approved_content_hash, passkey_credential_id, passkey_verified_at';
