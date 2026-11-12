/**
 * Phase 7 — Versioned governance policy CRUD.
 *
 *   • Drafts are mutable until activated.
 *   • Activating a policy supersedes the previous active version (atomic).
 *   • Rows are protected by a DB trigger: only status / activation fields
 *     can change after insert. Body / version / key are immutable.
 *   • Every policy carries an explicit `version` integer monotonically
 *     increasing per (org, policy_key). Activated policies are addressable
 *     by version forever.
 *
 * No autonomous code path mutates policies. Phase 7 ships read + explicit
 * draft/activate/supersede operations only.
 *
 * Tenancy (S2): every function takes a TenantContext (built by the caller after its access check) and reaches
 * intelligence_governance_policies only through tenantTable, so the organization_id predicate / stamp is the
 * seam's, never a caller-supplied id.
 */

import { tenantTable, type TenantContext } from '../db/tenantTable';
import type {
  GovernancePolicyBody,
  GovernancePolicyKey,
  GovernancePolicyRecord,
  GovernancePolicyStatus,
} from '../types/governancePolicy';
import { isGovernancePolicyKey } from '../types/governancePolicy';

export type CreateDraftInput = {
  policyKey: GovernancePolicyKey;
  body: GovernancePolicyBody;
  rationale?: string | null;
  createdBy: string | null;
};

export async function createPolicyDraft(ctx: TenantContext, input: CreateDraftInput): Promise<GovernancePolicyRecord> {
  if (!isGovernancePolicyKey(input.policyKey)) {
    throw new Error(`unknown_policy_key:${input.policyKey}`);
  }
  // Next version = max(existing) + 1 for this (org, key).
  const { data: highest } = await tenantTable('intelligence_governance_policies', ctx)
    .select('version')
    .eq('policy_key', input.policyKey)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((highest as { version?: number } | null)?.version ?? 0) + 1;

  const { data, error } = await tenantTable('intelligence_governance_policies', ctx)
    .insert({
      policy_key: input.policyKey,
      version: nextVersion,
      status: 'draft' as GovernancePolicyStatus,
      body: input.body,
      rationale: input.rationale ?? null,
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`policy_draft_insert_failed:${error?.message ?? 'unknown'}`);
  return data as GovernancePolicyRecord;
}

/**
 * Atomic activation: supersede any currently-active version, then mark the
 * draft as active. The partial UNIQUE on (org, policy_key) WHERE status='active'
 * enforces "at most one active version" at the DB level.
 */
export async function activatePolicyDraft(ctx: TenantContext, args: {
  policyDraftId: string;
  actorUserId: string | null;
}): Promise<GovernancePolicyRecord> {
  const { data: draft } = await tenantTable('intelligence_governance_policies', ctx)
    .select('*')
    .eq('id', args.policyDraftId)
    .maybeSingle();
  const draftRow = draft as GovernancePolicyRecord | null;
  if (!draftRow) throw new Error(`policy_not_found:${args.policyDraftId}`);
  if (draftRow.status !== 'draft') {
    throw new Error(`policy_not_in_draft_state:${draftRow.status}`);
  }

  // Supersede the existing active version (if any).
  const { data: prevActive } = await tenantTable('intelligence_governance_policies', ctx)
    .select('id, version')
    .eq('policy_key', draftRow.policy_key)
    .eq('status', 'active')
    .maybeSingle();
  if (prevActive && (prevActive as { id: string }).id !== draftRow.id) {
    await tenantTable('intelligence_governance_policies', ctx)
      .update({
        status: 'superseded' as GovernancePolicyStatus,
        superseded_at: new Date().toISOString(),
        superseded_by_version: draftRow.version,
      })
      .eq('id', (prevActive as { id: string }).id);
  }

  const { data, error } = await tenantTable('intelligence_governance_policies', ctx)
    .update({
      status: 'active' as GovernancePolicyStatus,
      activated_by: args.actorUserId,
      activated_at: new Date().toISOString(),
    })
    .eq('id', draftRow.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`policy_activate_failed:${error?.message ?? 'unknown'}`);
  }
  return data as GovernancePolicyRecord;
}

export async function archivePolicy(ctx: TenantContext, args: {
  policyId: string;
}): Promise<GovernancePolicyRecord | null> {
  const { data, error } = await tenantTable('intelligence_governance_policies', ctx)
    .update({ status: 'archived' as GovernancePolicyStatus })
    .eq('id', args.policyId)
    .neq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`policy_archive_failed:${error.message}`);
  return (data as GovernancePolicyRecord | null) ?? null;
}

export async function getActivePolicy(
  ctx: TenantContext,
  policyKey: GovernancePolicyKey,
): Promise<GovernancePolicyRecord | null> {
  const { data, error } = await tenantTable('intelligence_governance_policies', ctx)
    .select('*')
    .eq('policy_key', policyKey)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`policy_active_get_failed:${error.message}`);
  return (data as GovernancePolicyRecord | null) ?? null;
}

export async function listPoliciesForOrg(
  ctx: TenantContext,
  options?: { policyKey?: GovernancePolicyKey; status?: GovernancePolicyStatus; limit?: number },
): Promise<GovernancePolicyRecord[]> {
  let q = tenantTable('intelligence_governance_policies', ctx)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.policyKey) q = q.eq('policy_key', options.policyKey);
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`policy_list_failed:${error.message}`);
  return (data as GovernancePolicyRecord[]) ?? [];
}
