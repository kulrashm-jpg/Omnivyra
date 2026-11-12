/**
 * Test emulation of the Prompt 3 database functions over the in-memory fake DB
 * (helpers/communityExecutionFakeDb), for unit suites that exercise the executor
 * and its callers. The SQL itself (20270126000001 / 20270126000002) is proven in
 * the real-schema suites (c3_claim_*); this mirrors its contract:
 *
 *   claim_community_ai_action_for_execution(action, org, tenant, claim_point, mode, corr)
 *     scope → row lookup (ACTION_NOT_FOUND / TENANT_SCOPE_VIOLATION) → tenant policy
 *     → for 'auto' the auto-rules switch → approval evidence + 7 days (the same
 *     evaluator the TS gates use) → a refusal records once and leaves the row;
 *     not 'approved' or cancelled → CLAIM_CONFLICT (records nothing) → CAS
 *     approved → executing (stamping a well-formed correlation id, as the SQL
 *     does). The check-and-set is synchronous, so N concurrent
 *     claimants still produce exactly one winner.
 *   record_community_execution_refusal(...) → appended to `refusals`.
 *   community_ai_claim_within_limits(..., p_source) (20270217000021, CLASS-2 A19)
 *     → a row that is missing / another tenant's / not 'approved' goes straight to
 *     the claim (its codes); otherwise the execution_guardrails row of the
 *     organization (none = no limits) is evaluated EXACTLY as the SQL does
 *     (executed in the window + executing of any age; UTC day; per-post only for
 *     'reply'; per-evaluation only for p_source 'evaluation'); a refusal records
 *     once and returns (false, GUARDRAIL_*, status); else the claim, unchanged.
 *     Count and claim run with no await between them (the SQL's advisory lock).
 *
 * It never opens anything the database would not: no evidence, no claim.
 */
import type { FakeDb } from './communityExecutionFakeDb';
import { evaluateCommunityApprovalEvidence } from '../../../services/communityApprovalBinding';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmulatedDecision = { allowed: boolean; code: string | null; auto_rules_enabled: boolean | null };

export function communityRpcEmulation(
  getDb: () => FakeDb,
  decide: (org: string, tenant: string) => EmulatedDecision = () => ({ allowed: true, code: null, auto_rules_enabled: false }),
) {
  const refusals: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  const rpc = async (name: string, args: Record<string, any>) => {
    await Promise.resolve();
    if (name === 'record_community_execution_refusal') {
      refusals.push({ action_id: args.p_action_id, claim_point: args.p_claim_point, code: args.p_code });
      return { data: true, error: null };
    }
    if (name === 'community_execution_policy_decision') {
      const d = decide(args.p_org, args.p_tenant);
      return { data: [{ ...d, policy_version: 'test' }], error: null };
    }
    if (name === 'community_ai_claim_within_limits') return claimWithinLimits(args);
    if (name !== 'claim_community_ai_action_for_execution') return { data: null, error: { message: `unexpected rpc ${name}` } };
    return claim(args);
  };
  const claimWithinLimits = (args: Record<string, any>) => {
    if (args.p_source !== 'evaluation' && args.p_source !== 'scheduler') {
      return { data: null, error: { message: 'community_ai_claim_within_limits: invalid arguments' } };
    }
    const db = getDb();
    const row = (db.tables.community_ai_actions || []).find((r: any) => r.id === args.p_action_id);
    if (!row || row.organization_id !== args.p_org || row.tenant_id !== args.p_tenant || row.status !== 'approved') return claim(args);
    const platform = String(row.platform ?? '').trim().toLowerCase();
    const g = (db.tables.execution_guardrails || []).find((x: any) => x.company_id === args.p_org);
    if (g) {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const tenMin = Date.now() - 10 * 60 * 1000;
      const counted = (extra: (r: any) => boolean, since: number | null) => (db.tables.community_ai_actions || []).filter((r: any) =>
        r.organization_id === args.p_org && r.platform === platform && extra(r)
        && ((r.status === 'executed' && r.executed_at != null && (since == null || Date.parse(r.executed_at) >= since)) || r.status === 'executing')).length;
      let code: string | null = null;
      if (g.auto_execution_enabled === false) code = 'GUARDRAIL_AUTO_DISABLED';
      if (!code && g.daily_platform_limit != null && counted(() => true, dayStart.getTime()) >= g.daily_platform_limit) code = 'GUARDRAIL_DAILY_PLATFORM_LIMIT';
      if (!code && String(row.action_type ?? '').trim().toLowerCase() === 'reply' && g.per_post_reply_limit != null
        && counted((r) => r.target_id === row.target_id && r.action_type === 'reply', null) >= g.per_post_reply_limit) code = 'GUARDRAIL_PER_POST_LIMIT';
      if (!code && args.p_source === 'evaluation' && g.per_evaluation_limit != null && counted(() => true, tenMin) >= g.per_evaluation_limit) code = 'GUARDRAIL_PER_EVALUATION_LIMIT';
      if (code) {
        refusals.push({ action_id: row.id, claim_point: args.p_claim_point, code });
        return { data: [{ claimed: false, code, current_status: row.status }], error: null };
      }
    }
    return claim(args);
  };
  const claim = (args: Record<string, any>) => {
    claims.push(args);
    const db = getDb();
    const row = (db.tables.community_ai_actions || []).find((r: any) => r.id === args.p_action_id);
    const answer = (claimed: boolean, code: string | null, status: string | null) =>
      ({ data: [{ claimed, code, current_status: status }], error: null });
    if (!args.p_org || !args.p_tenant || args.p_org !== args.p_tenant) return answer(false, 'POLICY_SCOPE_INVALID', null);
    if (!row) return answer(false, 'ACTION_NOT_FOUND', null);
    if (row.organization_id !== args.p_org || row.tenant_id !== args.p_tenant) return answer(false, 'TENANT_SCOPE_VIOLATION', null);
    const d = decide(args.p_org, args.p_tenant);
    let code: string | null = null;
    if (!d.allowed) code = d.code ?? 'POLICY_MISSING';
    else if (args.p_claim_point === 'auto' && d.auto_rules_enabled !== true) code = 'POLICY_AUTO_RULES_DISABLED';
    else {
      const ev = evaluateCommunityApprovalEvidence(row as never);
      if (ev.ok !== true) {
        const c = (ev as { code: string }).code;
        code = c === 'HUMAN_APPROVAL_REQUIRED' ? 'APPROVAL_REQUIRED' : c === 'APPROVAL_EXPIRED' ? 'APPROVAL_EXPIRED' : 'APPROVAL_EVIDENCE_REQUIRED';
      }
    }
    if (code) {
      refusals.push({ action_id: row.id, claim_point: args.p_claim_point, code });
      return answer(false, code, row.status);
    }
    if (row.status !== 'approved' || row.cancel_requested_at) return answer(false, 'CLAIM_CONFLICT', row.status);
    row.status = 'executing';
    if (args.p_execution_mode) row.execution_mode = args.p_execution_mode;
    // As the SQL does: a well-formed correlation id is stamped with the claim.
    if (UUID.test(String(args.p_correlation_id ?? ''))) row.execution_correlation_id = args.p_correlation_id;
    return answer(true, null, 'executing');
  };
  return { rpc, refusals, claims };
}
