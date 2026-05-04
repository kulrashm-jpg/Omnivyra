import { Role } from './rbacPrimitives';

/**
 * Canonical scope identifier for admin / super-admin routes.
 *
 * Scopes are the unit of authorization for `pages/api/admin/**` and
 * `pages/api/super-admin/**`. Every protected admin route maps to exactly
 * one scope; the matrix below records which roles satisfy each scope.
 */
export type AdminScope =
  // Credits & grants
  | 'credits:grant'
  | 'credits:view'
  // Pricing
  | 'pricing:apply'
  | 'pricing:update'
  | 'pricing:recommendations'
  // Plans
  | 'plans:list'
  | 'plans:create'
  | 'plans:assign'
  | 'plans:override'
  | 'plans:toggle'
  | 'plans:analytics'
  // Usage / consumption
  | 'consumption:llm'
  | 'consumption:apis'
  | 'consumption:activity-breakdown'
  | 'consumption:org-activity-breakdown'
  | 'consumption:infra-estimate'
  // Org control
  | 'org:control'
  | 'org:economics'
  // Access requests
  | 'access-requests:list'
  | 'access-requests:approve'
  | 'access-requests:reject'
  | 'access-requests:delete'
  // Users
  | 'users:invite'
  | 'users:super-admin-grant'
  | 'users:super-admin-revoke'
  | 'users:list-external'
  // Audit
  | 'audit-logs:view'
  | 'audit-logs:admin'
  // Blog
  | 'blog:generate'
  | 'blog:brief-suggestions'
  | 'blog:rewrite-hook'
  | 'blog:intelligence'
  | 'blog:relationships'
  | 'blog:series-manage'
  // Content
  | 'content:delete'
  | 'campaigns:delete'
  // Health
  | 'health:system'
  | 'health:connection'
  | 'health:engagement-signals'
  | 'health:opportunities'
  | 'health:images'
  | 'health:cron-metrics'
  | 'health:queue-metrics'
  | 'health:redis-metrics'
  // Intelligence
  | 'intelligence:company-health'
  | 'intelligence:execution-insights'
  | 'intelligence:plans'
  | 'intelligence:scheduler-config'
  | 'intelligence:scheduler-boost'
  | 'intelligence:scheduler-overrides'
  | 'intelligence:throttle-status'
  | 'intelligence:api-presets'
  | 'intelligence:categories'
  | 'intelligence:query-templates'
  | 'system-intelligence:view'
  | 'system-trends:view'
  // Platform config
  | 'config:analytics'
  | 'config:oauth'
  | 'config:rate-limit'
  | 'config:queue'
  | 'config:cron'
  | 'config:experiment'
  | 'config:llm'
  | 'config:credit-cost'
  | 'config:rbac'
  | 'config:system'
  // Platform analytics
  | 'analytics:all-orgs'
  | 'analytics:campaign-health'
  | 'analytics:community-ai'
  | 'analytics:community-ai-policy'
  | 'analytics:ga-summary'
  | 'analytics:savings-report'
  | 'analytics:domain-analytics'
  | 'analytics:revenue'
  | 'analytics:railway-costs'
  | 'analytics:railway-efficiency'
  | 'analytics:usage-meter'
  | 'analytics:usage-report'
  | 'analytics:usage-alerts'
  // Autonomous
  | 'autonomous:decisions'
  | 'autonomous:control'
  // Feedback
  | 'feedback:review'
  | 'feedback:list'
  // Misc admin
  | 'admin:create-company'
  | 'admin:cache-management'
  | 'admin:cost-accounting';

/**
 * Allowed-roles matrix keyed by scope. Every scope MUST contain SUPER_ADMIN
 * because platform super-admins bypass all admin restrictions by policy.
 *
 * Scopes that allow non-super-admin roles require an org context (companyId)
 * at the call site so role resolution can happen against `user company roles`.
 */
export const ADMIN_SCOPE_ALLOWED_ROLES: Record<AdminScope, readonly Role[]> = {
  'credits:grant': [Role.SUPER_ADMIN],
  'credits:view': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],

  'pricing:apply': [Role.SUPER_ADMIN],
  'pricing:update': [Role.SUPER_ADMIN],
  'pricing:recommendations': [Role.SUPER_ADMIN],

  'plans:list': [Role.SUPER_ADMIN],
  'plans:create': [Role.SUPER_ADMIN],
  'plans:assign': [Role.SUPER_ADMIN],
  'plans:override': [Role.SUPER_ADMIN],
  'plans:toggle': [Role.SUPER_ADMIN],
  'plans:analytics': [Role.SUPER_ADMIN],

  // Multi-tier reads: any company role may attempt; the route's tier resolution
  // gates visibility of cost data (super_admin → full, company_admin → org cost,
  // user → counts only).
  'consumption:llm': [
    Role.SUPER_ADMIN,
    Role.COMPANY_ADMIN,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.CONTENT_CREATOR,
    Role.VIEW_ONLY,
  ],
  'consumption:apis': [
    Role.SUPER_ADMIN,
    Role.COMPANY_ADMIN,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.CONTENT_CREATOR,
    Role.VIEW_ONLY,
  ],
  'consumption:activity-breakdown': [Role.SUPER_ADMIN],
  'consumption:org-activity-breakdown': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  'consumption:infra-estimate': [Role.SUPER_ADMIN],

  'org:control': [Role.SUPER_ADMIN],
  'org:economics': [Role.SUPER_ADMIN],

  'access-requests:list': [Role.SUPER_ADMIN],
  'access-requests:approve': [Role.SUPER_ADMIN],
  'access-requests:reject': [Role.SUPER_ADMIN],
  'access-requests:delete': [Role.SUPER_ADMIN],

  'users:invite': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  'users:super-admin-grant': [Role.SUPER_ADMIN],
  'users:super-admin-revoke': [Role.SUPER_ADMIN],
  'users:list-external': [Role.SUPER_ADMIN],

  'audit-logs:view': [Role.SUPER_ADMIN],
  'audit-logs:admin': [Role.SUPER_ADMIN],

  'blog:generate': [Role.SUPER_ADMIN],
  'blog:brief-suggestions': [Role.SUPER_ADMIN],
  'blog:rewrite-hook': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  'blog:intelligence': [Role.SUPER_ADMIN],
  'blog:relationships': [Role.SUPER_ADMIN],
  'blog:series-manage': [Role.SUPER_ADMIN],

  'content:delete': [Role.SUPER_ADMIN],
  'campaigns:delete': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],

  'health:system': [Role.SUPER_ADMIN],
  'health:connection': [Role.SUPER_ADMIN],
  'health:engagement-signals': [Role.SUPER_ADMIN],
  'health:opportunities': [Role.SUPER_ADMIN],
  'health:images': [Role.SUPER_ADMIN],
  'health:cron-metrics': [Role.SUPER_ADMIN],
  'health:queue-metrics': [Role.SUPER_ADMIN],
  'health:redis-metrics': [Role.SUPER_ADMIN],

  'intelligence:company-health': [Role.SUPER_ADMIN],
  'intelligence:execution-insights': [Role.SUPER_ADMIN],
  'intelligence:plans': [Role.SUPER_ADMIN],
  'intelligence:scheduler-config': [Role.SUPER_ADMIN],
  'intelligence:scheduler-boost': [Role.SUPER_ADMIN],
  'intelligence:scheduler-overrides': [Role.SUPER_ADMIN],
  'intelligence:throttle-status': [Role.SUPER_ADMIN],
  'intelligence:api-presets': [Role.SUPER_ADMIN],
  'intelligence:categories': [Role.SUPER_ADMIN],
  'intelligence:query-templates': [Role.SUPER_ADMIN],
  'system-intelligence:view': [Role.SUPER_ADMIN],
  'system-trends:view': [Role.SUPER_ADMIN],

  'config:analytics': [Role.SUPER_ADMIN],
  'config:oauth': [Role.SUPER_ADMIN],
  'config:rate-limit': [Role.SUPER_ADMIN],
  'config:queue': [Role.SUPER_ADMIN],
  'config:cron': [Role.SUPER_ADMIN],
  'config:experiment': [Role.SUPER_ADMIN],
  'config:llm': [Role.SUPER_ADMIN],
  'config:credit-cost': [Role.SUPER_ADMIN],
  'config:rbac': [Role.SUPER_ADMIN],
  'config:system': [Role.SUPER_ADMIN],

  'analytics:all-orgs': [Role.SUPER_ADMIN],
  'analytics:campaign-health': [Role.SUPER_ADMIN],
  'analytics:community-ai': [Role.SUPER_ADMIN],
  'analytics:community-ai-policy': [Role.SUPER_ADMIN],
  'analytics:ga-summary': [Role.SUPER_ADMIN],
  'analytics:savings-report': [Role.SUPER_ADMIN],
  'analytics:domain-analytics': [Role.SUPER_ADMIN],
  'analytics:revenue': [Role.SUPER_ADMIN],
  'analytics:railway-costs': [Role.SUPER_ADMIN],
  'analytics:railway-efficiency': [Role.SUPER_ADMIN],
  // Multi-tier reads: scope passes for any company role; the route enforces
  // hasUsageAccess() and tier-based cost masking.
  'analytics:usage-meter': [
    Role.SUPER_ADMIN,
    Role.COMPANY_ADMIN,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.CONTENT_CREATOR,
    Role.VIEW_ONLY,
  ],
  'analytics:usage-report': [
    Role.SUPER_ADMIN,
    Role.COMPANY_ADMIN,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.CONTENT_CREATOR,
    Role.VIEW_ONLY,
  ],
  'analytics:usage-alerts': [Role.SUPER_ADMIN],

  'autonomous:decisions': [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  'autonomous:control': [Role.SUPER_ADMIN],

  'feedback:review': [Role.SUPER_ADMIN],
  'feedback:list': [Role.SUPER_ADMIN],

  'admin:create-company': [Role.SUPER_ADMIN],
  'admin:cache-management': [Role.SUPER_ADMIN],
  'admin:cost-accounting': [Role.SUPER_ADMIN],
};

export const ALL_ADMIN_SCOPES: readonly AdminScope[] =
  Object.keys(ADMIN_SCOPE_ALLOWED_ROLES) as AdminScope[];

export function isAdminScope(value: unknown): value is AdminScope {
  return typeof value === 'string' && value in ADMIN_SCOPE_ALLOWED_ROLES;
}

export function scopeAllowedRoles(scope: AdminScope): readonly Role[] {
  return ADMIN_SCOPE_ALLOWED_ROLES[scope];
}

export function scopeRequiresOnlySuperAdmin(scope: AdminScope): boolean {
  const roles = ADMIN_SCOPE_ALLOWED_ROLES[scope];
  return roles.length === 1 && roles[0] === Role.SUPER_ADMIN;
}
