/**
 * LC-501 (W5.1) — C7 Execution RBAC capabilities (extends the platform capability model).
 *
 * Explicit execution capabilities with role separation. No user may bypass approval:
 * the Executor cannot approve; the Approver cannot execute; the Auditor is read-only.
 * Pure definitions — the API binds these to the platform's existing RBAC/org-role grants.
 */

export const EXECUTION_CAPABILITIES = ['campaign.execute', 'campaign.approve', 'campaign.cancel', 'campaign.override'] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export type ExecutionRole = 'creator' | 'approver' | 'executor' | 'auditor' | 'operator';

/** Role → capabilities. Separation of duties is enforced by these disjoint grants. */
export const ROLE_CAPABILITIES: Record<ExecutionRole, ExecutionCapability[]> = {
  creator: [],                                   // authors campaigns; cannot approve/execute
  approver: ['campaign.approve', 'campaign.cancel'],
  executor: ['campaign.execute', 'campaign.cancel'],
  auditor: [],                                   // read-only
  // ES-104 — operator/security role holds the break-glass control capability (kill-switch /
  // set-control / suppression release). Distinct from execute + approve (no implicit override).
  operator: ['campaign.override', 'campaign.cancel'],
};

export function roleHasCapability(roles: ExecutionRole[] | undefined, cap: ExecutionCapability): boolean {
  return (roles ?? []).some((r) => ROLE_CAPABILITIES[r]?.includes(cap));
}

/** Default-deny: an action requires its capability among the caller's granted capabilities. */
export function hasExecutionCapability(grantedCapabilities: string[] | undefined, cap: ExecutionCapability): boolean {
  return Array.isArray(grantedCapabilities) && grantedCapabilities.includes(cap);
}

/**
 * ES-104 — CENTRALIZED authorization: derive execution roles from the platform user context,
 * then resolve capabilities. Conservative + default-deny: only company admins hold the
 * operator (override) + approver capabilities; NO ONE is granted `campaign.execute` by this
 * mapping — the executor grant is an explicit operator decision (M5-D), kept out of code so
 * the default-OFF posture is never widened implicitly. Pure + deterministic (testable).
 */
export function resolveExecutionRoles(user: { role?: string | null } | null | undefined): ExecutionRole[] {
  const roles: ExecutionRole[] = ['auditor'];               // authenticated tenant member: read-only baseline
  if (user?.role === 'admin') { roles.push('operator', 'approver'); }
  return roles;
}

export function resolveExecutionCapabilities(user: { role?: string | null } | null | undefined): ExecutionCapability[] {
  const roles = resolveExecutionRoles(user);
  const caps = new Set<ExecutionCapability>();
  for (const r of roles) for (const c of ROLE_CAPABILITIES[r]) caps.add(c);
  return [...caps];
}
