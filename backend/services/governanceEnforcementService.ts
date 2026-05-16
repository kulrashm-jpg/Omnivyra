/**
 * Phase 7 — Runtime governance enforcement.
 *
 * Pure-function decision layer. Given (org, action, context), returns a
 * `GovernanceDecision`. The caller is responsible for halting / warning /
 * proceeding based on `decision.decision`. Every evaluation is recorded
 * to `governance_enforcement_events` so the audit trail is complete.
 *
 * The enforcement service NEVER mutates policies. It only reads the
 * currently-active version per (org, policy_key).
 *
 * Phase 7 wires this as ADVISORY into the listening execution path: the
 * caller logs the decision but the execution still respects pre-existing
 * Phase 0–6 gates (consent, scope, capability, budget). Future phases can
 * tighten to hard-block by changing the caller; the service itself is
 * always strict.
 */

import { ownedDbTable } from '../db/writeOwner';
import { getActivePolicy } from './governancePolicyService';
import type {
  GovernanceEnforcementAction,
  GovernancePolicyKey,
} from '../types/governancePolicy';

export type GovernanceDecision = {
  decision: 'allowed' | 'denied' | 'allowed_with_warning';
  reasons: string[];
  policy_version: number | null;
  policy_key: GovernancePolicyKey;
};

export type EvaluateInput = {
  organizationId: string;
  action: GovernanceEnforcementAction;
  context: Record<string, unknown>;
  actorUserId?: string | null;
};

// Action → policy_key mapping. Some actions are gated by multiple keys;
// callers can opt to evaluate them in sequence.
const ACTION_KEY_PRIMARY: Record<GovernanceEnforcementAction, GovernancePolicyKey> = {
  'execution.create': 'source_execution',
  'opportunity.persist': 'moderation',
  'escalation.create': 'escalations',
  'replay.execute': 'replay',
  'export.generate': 'export',
  'lifecycle.transition': 'escalations', // re-used for now; future phase adds dedicated key
};

async function recordEnforcementEvent(input: {
  organizationId: string;
  policyKey: GovernancePolicyKey;
  policyVersion: number | null;
  action: GovernanceEnforcementAction;
  decision: GovernanceDecision['decision'];
  reasons: string[];
  context: Record<string, unknown>;
  actorUserId: string | null;
}): Promise<void> {
  try {
    await ownedDbTable('governance_enforcement_events').insert({
      organization_id: input.organizationId,
      policy_key: input.policyKey,
      policy_version: input.policyVersion,
      action: input.action,
      decision: input.decision,
      reasons: input.reasons,
      context: input.context,
      actor_user_id: input.actorUserId,
    });
  } catch (err: any) {
    console.warn('[governance] enforcement event insert failed:', err?.message);
  }
}

function evaluateSources(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const restricted = Array.isArray(body?.restricted_sources) ? (body.restricted_sources as string[]) : [];
  const allowed = Array.isArray(body?.allowed_sources) ? (body.allowed_sources as string[]) : [];
  const candidate = typeof ctx.source_identifier === 'string' ? (ctx.source_identifier as string).toLowerCase() : null;
  if (!candidate) return reasons;
  if (restricted.map((s) => s.toLowerCase()).includes(candidate)) {
    reasons.push(`source_restricted:${candidate}`);
  }
  if (allowed.length > 0 && !allowed.map((s) => s.toLowerCase()).includes(candidate)) {
    reasons.push(`source_not_in_allowlist:${candidate}`);
  }
  return reasons;
}

function evaluateKeywords(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const blocked = Array.isArray(body?.blocked_keywords) ? (body.blocked_keywords as string[]) : [];
  const required = Array.isArray(body?.required_keywords) ? (body.required_keywords as string[]) : [];
  const list = Array.isArray(ctx.keywords) ? (ctx.keywords as string[]).map((k) => k.toLowerCase()) : [];
  for (const kw of list) {
    if (blocked.map((b) => b.toLowerCase()).includes(kw)) {
      reasons.push(`keyword_blocked:${kw}`);
    }
  }
  if (required.length > 0) {
    const have = new Set(list);
    for (const req of required.map((r) => r.toLowerCase())) {
      if (!have.has(req)) reasons.push(`required_keyword_missing:${req}`);
    }
  }
  return reasons;
}

function evaluateConnectors(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const allowlist = Array.isArray(body?.connector_allowlist) ? (body.connector_allowlist as string[]) : [];
  const blocklist = Array.isArray(body?.connector_blocklist) ? (body.connector_blocklist as string[]) : [];
  const platform = typeof ctx.platform === 'string' ? (ctx.platform as string).toLowerCase() : null;
  if (!platform) return reasons;
  if (blocklist.map((s) => s.toLowerCase()).includes(platform)) {
    reasons.push(`connector_blocked:${platform}`);
  }
  if (allowlist.length > 0 && !allowlist.map((s) => s.toLowerCase()).includes(platform)) {
    reasons.push(`connector_not_in_allowlist:${platform}`);
  }
  return reasons;
}

function evaluateReplay(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const permitted = Array.isArray(body?.replay_permitted_kinds) ? (body.replay_permitted_kinds as string[]) : null;
  const maxBatch = typeof body?.replay_max_batch_size === 'number' ? body.replay_max_batch_size : null;
  const kind = typeof ctx.target_kind === 'string' ? (ctx.target_kind as string) : null;
  const batch = typeof ctx.batch_size === 'number' ? (ctx.batch_size as number) : null;
  if (permitted && kind && !permitted.includes(kind)) {
    reasons.push(`replay_kind_not_permitted:${kind}`);
  }
  if (maxBatch != null && batch != null && batch > maxBatch) {
    reasons.push(`replay_batch_too_large:${batch}>${maxBatch}`);
  }
  return reasons;
}

function evaluateExport(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const permitted = Array.isArray(body?.export_permitted_kinds) ? (body.export_permitted_kinds as string[]) : null;
  const maxRows = typeof body?.export_max_rows === 'number' ? body.export_max_rows : null;
  const kind = typeof ctx.export_type === 'string' ? (ctx.export_type as string) : null;
  const expectedRows = typeof ctx.expected_rows === 'number' ? (ctx.expected_rows as number) : null;
  if (permitted && kind && !permitted.includes(kind)) {
    reasons.push(`export_kind_not_permitted:${kind}`);
  }
  if (maxRows != null && expectedRows != null && expectedRows > maxRows) {
    reasons.push(`export_too_many_rows:${expectedRows}>${maxRows}`);
  }
  return reasons;
}

function evaluateEscalations(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const allowed = Array.isArray(body?.escalation_types_allowed) ? (body.escalation_types_allowed as string[]) : null;
  const floor = body?.escalation_min_severity as 'low' | 'medium' | 'high' | 'critical' | undefined;
  const type = typeof ctx.escalation_type === 'string' ? (ctx.escalation_type as string) : null;
  const severity = typeof ctx.severity === 'string' ? (ctx.severity as string) : null;
  if (allowed && type && !allowed.includes(type)) {
    reasons.push(`escalation_type_not_permitted:${type}`);
  }
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  if (floor && severity && (rank[severity] ?? 0) < (rank[floor] ?? 0)) {
    reasons.push(`escalation_severity_below_floor:${severity}<${floor}`);
  }
  return reasons;
}

function evaluateSourceExecution(body: any, ctx: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const maxExec = typeof body?.source_max_executions_per_day === 'number' ? body.source_max_executions_per_day : null;
  const maxCredits = typeof body?.source_max_credits_per_day === 'number' ? body.source_max_credits_per_day : null;
  const todayExecCount = typeof ctx.today_execution_count === 'number' ? (ctx.today_execution_count as number) : null;
  const todayCredits = typeof ctx.today_credit_spend === 'number' ? (ctx.today_credit_spend as number) : null;
  if (maxExec != null && todayExecCount != null && todayExecCount >= maxExec) {
    reasons.push(`source_executions_daily_cap_reached:${todayExecCount}>=${maxExec}`);
  }
  if (maxCredits != null && todayCredits != null && todayCredits >= maxCredits) {
    reasons.push(`source_credits_daily_cap_reached:${todayCredits}>=${maxCredits}`);
  }
  return reasons;
}

function dispatchEvaluator(
  policyKey: GovernancePolicyKey,
  body: any,
  ctx: Record<string, unknown>,
): string[] {
  switch (policyKey) {
    case 'sources': return evaluateSources(body, ctx);
    case 'keywords': return evaluateKeywords(body, ctx);
    case 'connectors': return evaluateConnectors(body, ctx);
    case 'escalations': return evaluateEscalations(body, ctx);
    case 'replay': return evaluateReplay(body, ctx);
    case 'export': return evaluateExport(body, ctx);
    case 'source_execution': return evaluateSourceExecution(body, ctx);
    default: return [];
  }
}

export async function evaluateGovernance(input: EvaluateInput): Promise<GovernanceDecision> {
  const policyKey = ACTION_KEY_PRIMARY[input.action];
  const active = await getActivePolicy(input.organizationId, policyKey);
  if (!active) {
    const decision: GovernanceDecision = {
      decision: 'allowed',
      reasons: [],
      policy_version: null,
      policy_key: policyKey,
    };
    void recordEnforcementEvent({
      organizationId: input.organizationId,
      policyKey,
      policyVersion: null,
      action: input.action,
      decision: decision.decision,
      reasons: decision.reasons,
      context: input.context,
      actorUserId: input.actorUserId ?? null,
    });
    return decision;
  }
  const reasons = dispatchEvaluator(policyKey, active.body, input.context);
  const decision: GovernanceDecision = {
    decision: reasons.length === 0 ? 'allowed' : 'denied',
    reasons,
    policy_version: active.version,
    policy_key: policyKey,
  };
  void recordEnforcementEvent({
    organizationId: input.organizationId,
    policyKey,
    policyVersion: active.version,
    action: input.action,
    decision: decision.decision,
    reasons: decision.reasons,
    context: input.context,
    actorUserId: input.actorUserId ?? null,
  });
  return decision;
}

export async function listEnforcementEvents(
  organizationId: string,
  options?: { policyKey?: GovernancePolicyKey; action?: GovernanceEnforcementAction; limit?: number },
) {
  let q = ownedDbTable('governance_enforcement_events')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.policyKey) q = q.eq('policy_key', options.policyKey);
  if (options?.action) q = q.eq('action', options.action);
  const { data, error } = await q;
  if (error) throw new Error(`governance_events_list_failed:${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}
