/**
 * Phase 10 — Connector sandbox: policy + bounded execution audit.
 *
 * `connector_sandbox_policies` declares per-(org, connector) ceilings:
 *   • capability_restrictions — allow-list of capability strings
 *   • max_execution_seconds   — wall-clock timeout (bounded 1..600)
 *   • max_ingestion_items     — ingestion ceiling
 *   • max_cost_units          — credit ceiling
 *   • network_allowlist       — descriptive only at this layer
 *
 * `connector_sandbox_executions` is the audit trail. Every execution
 * recorded here carries the enforcement decisions evaluated against the
 * policy at execution time. Phase 10 does NOT execute the connector
 * itself; it provides the policy + auditing surface. Actual execution
 * happens in the connector worker layer (out of scope) and reports
 * back via `recordSandboxExecution`.
 *
 * Hard guarantees:
 *   • Deterministic enforcement: ceilings are integers, comparisons are
 *     >=, no floating point.
 *   • No autonomous policy mutation.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  SANDBOX_DEFAULT_COST_CEILING,
  SANDBOX_DEFAULT_EXECUTION_SECONDS,
  SANDBOX_DEFAULT_INGESTION_CEILING,
  type ConnectorSandboxExecution,
  type ConnectorSandboxPolicy,
  type SandboxEnforcementDecision,
  type SandboxExecutionStatus,
} from '../types/connectorSandbox';

export type UpsertSandboxPolicyInput = {
  organizationId: string;
  marketplaceConnectorId: string;
  capabilityRestrictions?: string[];
  maxExecutionSeconds?: number;
  maxIngestionItems?: number;
  maxCostUnits?: number;
  networkAllowlist?: string[];
  metadata?: Record<string, unknown>;
  updatedBy: string | null;
};

export async function upsertSandboxPolicy(input: UpsertSandboxPolicyInput): Promise<ConnectorSandboxPolicy> {
  const existing = await ownedDbTable('connector_sandbox_policies')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('marketplace_connector_id', input.marketplaceConnectorId)
    .maybeSingle();
  const payload = {
    capability_restrictions: input.capabilityRestrictions ?? (existing.data as ConnectorSandboxPolicy | null)?.capability_restrictions ?? [],
    max_execution_seconds: input.maxExecutionSeconds ?? (existing.data as ConnectorSandboxPolicy | null)?.max_execution_seconds ?? SANDBOX_DEFAULT_EXECUTION_SECONDS,
    max_ingestion_items: input.maxIngestionItems ?? (existing.data as ConnectorSandboxPolicy | null)?.max_ingestion_items ?? SANDBOX_DEFAULT_INGESTION_CEILING,
    max_cost_units: input.maxCostUnits ?? (existing.data as ConnectorSandboxPolicy | null)?.max_cost_units ?? SANDBOX_DEFAULT_COST_CEILING,
    network_allowlist: input.networkAllowlist ?? (existing.data as ConnectorSandboxPolicy | null)?.network_allowlist ?? [],
    metadata: input.metadata ?? (existing.data as ConnectorSandboxPolicy | null)?.metadata ?? {},
    updated_by: input.updatedBy,
  };

  if (existing.data) {
    const upd = await ownedDbTable('connector_sandbox_policies')
      .update(payload)
      .eq('id', (existing.data as ConnectorSandboxPolicy).id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`sandbox_policy_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as ConnectorSandboxPolicy;
  }

  const ins = await ownedDbTable('connector_sandbox_policies')
    .insert({ organization_id: input.organizationId, marketplace_connector_id: input.marketplaceConnectorId, ...payload })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`sandbox_policy_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as ConnectorSandboxPolicy;
}

export async function getSandboxPolicy(
  organizationId: string,
  marketplaceConnectorId: string,
): Promise<ConnectorSandboxPolicy | null> {
  const { data } = await ownedDbTable('connector_sandbox_policies')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('marketplace_connector_id', marketplaceConnectorId)
    .maybeSingle();
  return (data as ConnectorSandboxPolicy | null) ?? null;
}

export type EvaluateSandboxInput = {
  policy: ConnectorSandboxPolicy;
  capability: string;
  observedDurationSeconds: number;
  observedItems: number;
  observedCostUnits: number;
};

export type EvaluateSandboxResult = {
  passed: boolean;
  status: SandboxExecutionStatus;
  decisions: SandboxEnforcementDecision[];
  failureReason: string | null;
};

/**
 * Evaluate observed values against a policy. Pure function. Returns the
 * deterministic verdict + per-rule decisions for audit.
 */
export function evaluateSandbox(input: EvaluateSandboxInput): EvaluateSandboxResult {
  const decisions: SandboxEnforcementDecision[] = [];
  let passed = true;
  let status: SandboxExecutionStatus = 'complete';
  let failureReason: string | null = null;

  const capabilityRestricted = input.policy.capability_restrictions.length > 0
    && !input.policy.capability_restrictions.includes(input.capability);
  decisions.push({
    rule: 'capability_allowlist',
    observed: capabilityRestricted ? 0 : 1,
    ceiling: 1,
    passed: !capabilityRestricted,
    note: capabilityRestricted ? `capability ${input.capability} not in allow-list` : 'capability allowed',
  });
  if (capabilityRestricted) { passed = false; status = 'failed'; failureReason = 'capability_not_permitted'; }

  decisions.push({
    rule: 'max_execution_seconds',
    observed: input.observedDurationSeconds,
    ceiling: input.policy.max_execution_seconds,
    passed: input.observedDurationSeconds <= input.policy.max_execution_seconds,
    note: 'wall clock',
  });
  if (input.observedDurationSeconds > input.policy.max_execution_seconds) {
    passed = false; status = 'timed_out'; failureReason ??= 'execution_timeout';
  }

  decisions.push({
    rule: 'max_ingestion_items',
    observed: input.observedItems,
    ceiling: input.policy.max_ingestion_items,
    passed: input.observedItems <= input.policy.max_ingestion_items,
    note: 'item count',
  });
  if (input.observedItems > input.policy.max_ingestion_items) {
    passed = false; status = 'quota_exceeded'; failureReason ??= 'ingestion_quota_exceeded';
  }

  decisions.push({
    rule: 'max_cost_units',
    observed: input.observedCostUnits,
    ceiling: input.policy.max_cost_units,
    passed: input.observedCostUnits <= input.policy.max_cost_units,
    note: 'cost units',
  });
  if (input.observedCostUnits > input.policy.max_cost_units) {
    passed = false; status = 'quota_exceeded'; failureReason ??= 'cost_quota_exceeded';
  }

  return { passed, status, decisions, failureReason };
}

export type RecordSandboxExecutionInput = {
  organizationId: string;
  marketplaceConnectorId: string;
  capabilityInvoked: string;
  observedDurationSeconds: number;
  observedItems: number;
  observedCostUnits: number;
  initiatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordSandboxExecution(
  input: RecordSandboxExecutionInput,
): Promise<ConnectorSandboxExecution> {
  const policy = await getSandboxPolicy(input.organizationId, input.marketplaceConnectorId);
  let verdict: EvaluateSandboxResult;
  if (!policy) {
    verdict = {
      passed: false,
      status: 'failed',
      decisions: [{ rule: 'policy_required', observed: 0, ceiling: 1, passed: false, note: 'no sandbox policy configured' }],
      failureReason: 'no_sandbox_policy',
    };
  } else {
    verdict = evaluateSandbox({
      policy,
      capability: input.capabilityInvoked,
      observedDurationSeconds: input.observedDurationSeconds,
      observedItems: input.observedItems,
      observedCostUnits: input.observedCostUnits,
    });
  }
  const now = new Date().toISOString();
  const ins = await ownedDbTable('connector_sandbox_executions')
    .insert({
      organization_id: input.organizationId,
      marketplace_connector_id: input.marketplaceConnectorId,
      capability_invoked: input.capabilityInvoked,
      status: verdict.status,
      duration_ms: Math.round(input.observedDurationSeconds * 1000),
      items_ingested: input.observedItems,
      cost_units: input.observedCostUnits,
      enforcement_decisions: verdict.decisions,
      initiated_by: input.initiatedBy,
      started_at: now,
      completed_at: now,
      failure_reason: verdict.failureReason,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`sandbox_execution_record_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as ConnectorSandboxExecution;
}

export async function listSandboxExecutions(
  organizationId: string,
  options?: { marketplaceConnectorId?: string; status?: SandboxExecutionStatus; limit?: number },
): Promise<ConnectorSandboxExecution[]> {
  let q = ownedDbTable('connector_sandbox_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.marketplaceConnectorId) q = q.eq('marketplace_connector_id', options.marketplaceConnectorId);
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as ConnectorSandboxExecution[]) ?? [];
}
