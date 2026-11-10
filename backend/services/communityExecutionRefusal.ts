/**
 * Community execution refusal record (OD-3 governance record, LD-6).
 *
 * One refusal is recorded once: record_community_execution_refusal
 * (20270126000002_community_execution_refusal_governance.sql) derives a
 * refusal_key from (action, claim point, code, approved_at, policy version)
 * and inserts ON CONFLICT DO NOTHING. It writes only 'skipped' or
 * 'skipped_due_to_platform_policy' and never 'approved'.
 *
 * Never throws. On failure it logs the code only (no payload, no ids beyond
 * the refusal code) and returns false.
 */
import { ownedDbRpc } from '../db/writeOwner';

export type CommunityClaimPoint = 'manual' | 'scheduler' | 'auto' | 'orchestration' | 'rpa_retry' | 'browser';

export async function recordCommunityExecutionRefusal(input: {
  actionId: string;
  organizationId: string;
  tenantId: string;
  claimPoint: CommunityClaimPoint;
  code: string;
  actorId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<boolean> {
  try {
    const { data, error } = await ownedDbRpc('record_community_execution_refusal', {
      p_action_id: input.actionId,
      p_org: input.organizationId,
      p_tenant: input.tenantId,
      p_claim_point: input.claimPoint,
      p_code: input.code,
      p_actor: input.actorId ?? null,
      p_payload: input.payload ?? {},
    });
    if (error) {
      console.warn('[community-execution-refusal] record failed for code', input.code);
      return false;
    }
    const first = Array.isArray(data) ? data[0] : data;
    if (first && typeof first === 'object') {
      return Object.values(first as Record<string, unknown>)[0] === true;
    }
    return first === true;
  } catch {
    console.warn('[community-execution-refusal] record failed for code', input.code);
    return false;
  }
}
