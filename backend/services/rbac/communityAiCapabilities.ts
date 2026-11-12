import { normalizePermissionRole, Role, roleSatisfies } from '../rbacService';

export const COMMUNITY_AI_CAPABILITIES = {
  VIEW_ACTIONS: [
    Role.VIEW_ONLY,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.COMPANY_ADMIN,
    Role.SUPER_ADMIN,
  ],
  APPROVE_ACTIONS: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  // CONTENT_ENGAGER = VIEW_ONLY + engagement (e9 2026-11-12): it EXECUTES actions.
  EXECUTE_ACTIONS: [Role.CONTENT_PUBLISHER, Role.CONTENT_ENGAGER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  SCHEDULE_ACTIONS: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  MANAGE_PLAYBOOKS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  MANAGE_CONNECTORS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN, Role.CONTENT_PUBLISHER, Role.CONTENT_REVIEWER],
  // Phase 0 — gates explicit enable/disable of social-listening capabilities
  // on an integration. Narrower than MANAGE_CONNECTORS: connecting a platform
  // for publishing should not implicitly authorise listening enablement.
  MANAGE_LISTENING_CAPABILITIES: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_DISCOVERED_USERS: [
    Role.CONTENT_ENGAGER, // engagement (e9 2026-11-12)
    Role.CONTENT_CREATOR,
    Role.CONTENT_PUBLISHER,
    Role.CONTENT_REVIEWER,
    Role.COMPANY_ADMIN,
    Role.SUPER_ADMIN,
  ],
  CLASSIFY_DISCOVERED_USERS: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
} as const;

export const hasCommunityAiCapability = (
  role: string | null,
  capability: keyof typeof COMMUNITY_AI_CAPABILITIES
): boolean => {
  if (!role) return false;
  const allowedRoles: Role[] = (COMMUNITY_AI_CAPABILITIES[capability] || []) as Role[];
  // Approach A: the role OR one of its base tiers.
  return roleSatisfies(normalizePermissionRole(role), allowedRoles);
};
