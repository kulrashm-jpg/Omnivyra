/**
 * EXECUTION-SAFETY-001 / ES-101 — Server-owned approval authority (THE ONE approval source).
 *
 * The execution bridge determines approval EXCLUSIVELY from persisted server state here —
 * client-supplied `approved` is never trusted. A dispatch is approved only when an approval
 * row is: active, not revoked, not expired, and bound to (company_id, campaign_id, version).
 * Fail-CLOSED: any lookup error, or any missing/ambiguous field, yields NOT approved.
 *
 * Reuses `ownedDbTable` (same write seam + observability). No duplicate approval logic exists.
 */

import { ownedDbTable } from '../../db/writeOwner';

const T = 'execution_approvals';
/** Approvals older than this are treated as expired (must be re-approved). Generous default. */
const APPROVAL_TTL_MS = Number(process.env.EXEC_APPROVAL_TTL_MS || 30 * 86_400_000); // 30d

export interface ApprovalRow {
  company_id: string; campaign_id: string; version: string;
  approved_by: string; approved_at: string; active: boolean; revoked_at: string | null;
}
export interface ApprovalDecision { approved: boolean; reason: string; approver?: string }

/**
 * PURE decision core (unit-testable without a DB). An approval authorizes a dispatch only if
 * every binding matches and it is currently active/non-revoked/non-expired.
 */
export function evaluateApproval(
  row: ApprovalRow | null | undefined,
  ctx: { companyId: string; campaignId: string; version: string; nowMs: number; ttlMs?: number },
): ApprovalDecision {
  if (!row) return { approved: false, reason: 'no_approval' };                                   // forged/absent → fail closed
  if (row.company_id !== ctx.companyId) return { approved: false, reason: 'cross_tenant_approval' };
  if (row.campaign_id !== ctx.campaignId) return { approved: false, reason: 'campaign_mismatch' };
  if (row.version !== ctx.version) return { approved: false, reason: 'version_mismatch' };        // approval bound to a different message/version
  if (row.active !== true || row.revoked_at) return { approved: false, reason: 'approval_revoked' };
  const approvedMs = Date.parse(row.approved_at);
  if (!Number.isFinite(approvedMs)) return { approved: false, reason: 'approval_timestamp_invalid' };
  const ttl = ctx.ttlMs ?? APPROVAL_TTL_MS;
  if (approvedMs + ttl < ctx.nowMs) return { approved: false, reason: 'approval_expired' };
  return { approved: true, reason: 'approved', approver: row.approved_by };
}

/** Authoritative read → decision. Fail-closed on any error. */
export async function getApprovalDecision(companyId: string, campaignId: string, version: string): Promise<ApprovalDecision> {
  try {
    const { data, error } = await ownedDbTable(T)
      .select('company_id, campaign_id, version, approved_by, approved_at, active, revoked_at')
      .eq('company_id', companyId).eq('campaign_id', campaignId).eq('version', version).eq('active', true)
      .maybeSingle();
    if (error) return { approved: false, reason: 'approval_lookup_error_failclosed' };
    return evaluateApproval((data as ApprovalRow) ?? null, { companyId, campaignId, version, nowMs: Date.now() });
  } catch {
    return { approved: false, reason: 'approval_exception_failclosed' };
  }
}

/** Record an approval. Caller MUST have verified the approver holds `campaign.approve` (API-enforced). */
export async function recordApproval(input: { companyId: string; campaignId: string; version?: string; approverId: string; reason?: string; correlationId?: string | null }): Promise<{ id: string | null }> {
  const { data } = await ownedDbTable(T).upsert({
    company_id: input.companyId, campaign_id: input.campaignId, version: input.version ?? 'default',
    approved_by: input.approverId, approved_at: new Date().toISOString(), active: true, revoked_at: null, revoked_by: null,
    reason: input.reason ?? null, correlation_id: input.correlationId ?? null,
  }, { onConflict: 'company_id,campaign_id,version' }).select('id').maybeSingle();
  return { id: data ? String((data as any).id) : null };
}

/** Revoke an approval (respected immediately by the bridge). */
export async function revokeApproval(input: { companyId: string; campaignId: string; version?: string; actorId: string; reason?: string }): Promise<void> {
  await ownedDbTable(T).update({ active: false, revoked_at: new Date().toISOString(), revoked_by: input.actorId, reason: input.reason ?? null })
    .eq('company_id', input.companyId).eq('campaign_id', input.campaignId).eq('version', input.version ?? 'default').eq('active', true);
}
