import { normalizePermissionRole, Role } from '../rbacService';

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
  EXECUTE_ACTIONS: [Role.CONTENT_PUBLISHER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  SCHEDULE_ACTIONS: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  MANAGE_PLAYBOOKS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  MANAGE_CONNECTORS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_DISCOVERED_USERS: [
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
  const allowedRoles = COMMUNITY_AI_CAPABILITIES[capability] || [];
  const normalizedRole = normalizePermissionRole(role);
  return allowedRoles.includes(normalizedRole as Role);
};
