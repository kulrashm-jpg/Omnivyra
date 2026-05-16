/**
 * Phase 8 — Granular intelligence-domain capabilities. Independent from the
 * Phase 0–7 `MANAGE_LISTENING_CAPABILITIES` capability — these are finer
 * roles for enterprise rollout. Capability set chosen to map cleanly to
 * the existing API surfaces, so SSO providers can target individual roles
 * via `sso_external_id`.
 */

export const INTELLIGENCE_CAPABILITIES = [
  'view_opportunities',
  'manage_listening_capabilities',
  'manage_executions',
  'manage_investigations',
  'manage_workspace',
  'approve_replays',
  'execute_replays',
  'request_exports',
  'manage_governance_policies',
  'manage_retention',
  'manage_rbac',
  'view_costs',
  'manage_costs',
  'manage_feature_flags',
  'view_dashboards',
  'pause_connectors',
  'resume_connectors',
  'throttle_orgs',
  'recover_partitions',
] as const;
export type IntelligenceCapability = (typeof INTELLIGENCE_CAPABILITIES)[number];

export type IntelligenceRole = {
  id: string;
  organization_id: string;
  role_key: string;
  display_name: string;
  capabilities: IntelligenceCapability[];
  sso_external_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type IntelligenceRoleAssignment = {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  assigned_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Seed roles for new orgs (created on demand; never auto-installed).
export const SEED_INTELLIGENCE_ROLES: Array<{ role_key: string; display_name: string; capabilities: IntelligenceCapability[] }> = [
  {
    role_key: 'analyst',
    display_name: 'Intelligence Analyst',
    capabilities: ['view_opportunities', 'manage_investigations', 'manage_workspace', 'view_dashboards'],
  },
  {
    role_key: 'reviewer',
    display_name: 'Intelligence Reviewer',
    capabilities: ['view_opportunities', 'manage_workspace', 'approve_replays', 'view_dashboards'],
  },
  {
    role_key: 'operator',
    display_name: 'Intelligence Operator',
    capabilities: [
      'manage_executions', 'execute_replays', 'pause_connectors', 'resume_connectors',
      'throttle_orgs', 'recover_partitions', 'view_dashboards',
    ],
  },
  {
    role_key: 'governance_admin',
    display_name: 'Governance Admin',
    capabilities: [
      'manage_governance_policies', 'manage_retention', 'manage_rbac',
      'manage_feature_flags', 'request_exports', 'view_dashboards',
    ],
  },
  {
    role_key: 'finance_admin',
    display_name: 'Finance Admin',
    capabilities: ['view_costs', 'manage_costs', 'view_dashboards'],
  },
];
