/**
 * Role-based visibility helpers for UI sections only.
 * No backend enforcement; default unknown role → ADMIN behavior.
 */

export type UserRole =
  | 'ADMIN'
  | 'CREATOR'
  | 'CONTENT_MANAGER'
  | 'CMO'
  | 'SYSTEM';

/** CMO strip (Execution Risk, Capacity Fit, Momentum): ADMIN, CMO, CONTENT_MANAGER, SYSTEM = true; CREATOR = false. */
export function canViewCMOLayer(role: UserRole | string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'ADMIN' || r === 'CMO' || r === 'CONTENT_MANAGER' || r === 'SYSTEM';
}

/** Creator Brief block: ADMIN, CREATOR, CONTENT_MANAGER, SYSTEM = true; CMO = false. */
export function canViewCreatorBrief(role: UserRole | string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'ADMIN' || r === 'CREATOR' || r === 'CONTENT_MANAGER' || r === 'SYSTEM';
}

/** System/raw execution intelligence: CONTENT_MANAGER, SYSTEM = true; others = false. */
export function canViewSystemFields(role: UserRole | string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'CONTENT_MANAGER' || r === 'SYSTEM';
}

function normalizeRole(role: UserRole | string | null | undefined): UserRole {
  if (role == null || typeof role !== 'string' || !role.trim()) return 'ADMIN';
  const r = role.trim().toUpperCase() as UserRole;
  const valid: UserRole[] = ['ADMIN', 'CREATOR', 'CONTENT_MANAGER', 'CMO', 'SYSTEM'];
  return valid.includes(r) ? r : 'ADMIN';
}
