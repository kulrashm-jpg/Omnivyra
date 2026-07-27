/**
 * LC-501 (W5.1) — C7 Execution RBAC capabilities (extends the platform capability model).
 *
 * Explicit execution capabilities with role separation. No user may bypass approval:
 * the Executor cannot approve; the Approver cannot execute; the Auditor is read-only.
 * Pure definitions — the API binds these to the platform's existing RBAC/org-role grants.
 */

export const EXECUTION_CAPABILITIES = ['campaign.execute', 'campaign.approve', 'campaign.cancel', 'campaign.override'] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export type ExecutionRole = 'creator' | 'approver' | 'executor' | 'auditor';

/** Role → capabilities. Separation of duties is enforced by these disjoint grants. */
export const ROLE_CAPABILITIES: Record<ExecutionRole, ExecutionCapability[]> = {
  creator: [],                                   // authors campaigns; cannot approve/execute
  approver: ['campaign.approve', 'campaign.cancel'],
  executor: ['campaign.execute', 'campaign.cancel'],
  auditor: [],                                   // read-only
};

export function roleHasCapability(roles: ExecutionRole[] | undefined, cap: ExecutionCapability): boolean {
  return (roles ?? []).some((r) => ROLE_CAPABILITIES[r]?.includes(cap));
}

/** Default-deny: an action requires its capability among the caller's granted capabilities. */
export function hasExecutionCapability(grantedCapabilities: string[] | undefined, cap: ExecutionCapability): boolean {
  return Array.isArray(grantedCapabilities) && grantedCapabilities.includes(cap);
}
