/**
 * Phase 8 — Enterprise intelligence RBAC.
 *
 * Granular per-org roles independent from the Phase 0 `MANAGE_LISTENING_CAPABILITIES`
 * gate. Designed to be SSO-targetable: each role carries an optional
 * `sso_external_id` so an IdP can grant the role by sending the same id.
 *
 * Hard guarantees:
 *   • Tenant-scoped (UNIQUE on (org, role_key)).
 *   • Role assignments are revocable (set `revoked_at`); the active-row
 *     unique constraint prevents double-active assignments.
 *   • Capability evaluation is deterministic — a user has capability X
 *     iff at least one of their unrevoked roles lists X in `capabilities`.
 *   • No autonomous role grant. Every assignment row carries `assigned_by`.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  IntelligenceCapability,
  IntelligenceRole,
  IntelligenceRoleAssignment,
} from '../types/intelligenceRbac';
import {
  INTELLIGENCE_CAPABILITIES,
  SEED_INTELLIGENCE_ROLES,
} from '../types/intelligenceRbac';

export async function upsertIntelligenceRole(input: {
  organizationId: string;
  roleKey: string;
  displayName: string;
  capabilities: IntelligenceCapability[];
  ssoExternalId?: string | null;
  createdBy: string | null;
}): Promise<IntelligenceRole> {
  const caps = [...new Set(input.capabilities)].filter((c): c is IntelligenceCapability =>
    (INTELLIGENCE_CAPABILITIES as readonly string[]).includes(c),
  );
  const payload = {
    organization_id: input.organizationId,
    role_key: input.roleKey,
    display_name: input.displayName,
    capabilities: caps,
    sso_external_id: input.ssoExternalId ?? null,
    created_by: input.createdBy,
  };
  const { data: existing } = await ownedDbTable('intelligence_roles')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('role_key', input.roleKey)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('intelligence_roles')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`intelligence_role_update_failed:${error?.message ?? 'unknown'}`);
    return data as IntelligenceRole;
  }
  const { data, error } = await ownedDbTable('intelligence_roles')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`intelligence_role_insert_failed:${error?.message ?? 'unknown'}`);
  return data as IntelligenceRole;
}

export async function listIntelligenceRoles(
  organizationId: string,
): Promise<IntelligenceRole[]> {
  const { data, error } = await ownedDbTable('intelligence_roles')
    .select('*')
    .eq('organization_id', organizationId)
    .order('role_key', { ascending: true });
  if (error) throw new Error(`intelligence_role_list_failed:${error.message}`);
  return (data as IntelligenceRole[]) ?? [];
}

export async function seedIntelligenceRoles(args: {
  organizationId: string;
  createdBy: string | null;
}): Promise<IntelligenceRole[]> {
  const results: IntelligenceRole[] = [];
  for (const seed of SEED_INTELLIGENCE_ROLES) {
    const role = await upsertIntelligenceRole({
      organizationId: args.organizationId,
      roleKey: seed.role_key,
      displayName: seed.display_name,
      capabilities: seed.capabilities,
      createdBy: args.createdBy,
    });
    results.push(role);
  }
  return results;
}

export async function assignIntelligenceRole(input: {
  organizationId: string;
  userId: string;
  roleId: string;
  assignedBy: string | null;
  expiresAt?: string | null;
}): Promise<IntelligenceRoleAssignment> {
  // Revoke any previous active assignment for this triple.
  await ownedDbTable('intelligence_role_assignments')
    .update({ revoked_at: new Date().toISOString() })
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('role_id', input.roleId)
    .is('revoked_at', null);

  const { data, error } = await ownedDbTable('intelligence_role_assignments')
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      role_id: input.roleId,
      assigned_by: input.assignedBy,
      expires_at: input.expiresAt ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`intelligence_role_assign_failed:${error?.message ?? 'unknown'}`);
  return data as IntelligenceRoleAssignment;
}

export async function revokeIntelligenceRoleAssignment(args: {
  organizationId: string;
  assignmentId: string;
}): Promise<IntelligenceRoleAssignment | null> {
  const { data, error } = await ownedDbTable('intelligence_role_assignments')
    .update({ revoked_at: new Date().toISOString() })
    .eq('organization_id', args.organizationId)
    .eq('id', args.assignmentId)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`intelligence_role_revoke_failed:${error.message}`);
  return (data as IntelligenceRoleAssignment | null) ?? null;
}

export async function hasIntelligenceCapability(args: {
  organizationId: string;
  userId: string;
  capability: IntelligenceCapability;
}): Promise<boolean> {
  const { data: assignments } = await ownedDbTable('intelligence_role_assignments')
    .select('role_id, expires_at')
    .eq('organization_id', args.organizationId)
    .eq('user_id', args.userId)
    .is('revoked_at', null);
  const valid = ((assignments ?? []) as Array<{ role_id: string; expires_at: string | null }>)
    .filter((a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now());
  if (valid.length === 0) return false;
  const roleIds = valid.map((a) => a.role_id);
  const { data: roles } = await ownedDbTable('intelligence_roles')
    .select('capabilities')
    .eq('organization_id', args.organizationId)
    .in('id', roleIds);
  for (const r of (roles ?? []) as Array<{ capabilities: string[] }>) {
    if (r.capabilities.includes(args.capability)) return true;
  }
  return false;
}

export async function listAssignmentsForUser(
  organizationId: string,
  userId: string,
): Promise<IntelligenceRoleAssignment[]> {
  const { data, error } = await ownedDbTable('intelligence_role_assignments')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) throw new Error(`intelligence_role_user_assignments_failed:${error.message}`);
  return (data as IntelligenceRoleAssignment[]) ?? [];
}
