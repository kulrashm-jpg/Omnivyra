export const GOVERNANCE_POLICY_KEYS = [
  'sources',
  'keywords',
  'connectors',
  'escalations',
  'moderation',
  'retention',
  'replay',
  'export',
  'source_execution',
] as const;
export type GovernancePolicyKey = (typeof GOVERNANCE_POLICY_KEYS)[number];

export const GOVERNANCE_POLICY_STATUSES = [
  'draft',
  'active',
  'superseded',
  'archived',
] as const;
export type GovernancePolicyStatus = (typeof GOVERNANCE_POLICY_STATUSES)[number];

export type GovernancePolicyBody = {
  /** Sources policy: lists of source_identifier values forbidden / required. */
  restricted_sources?: string[];
  allowed_sources?: string[];
  /** Keywords policy: regex/string lists. Stored as strings; service treats as case-insensitive substrings. */
  blocked_keywords?: string[];
  required_keywords?: string[];
  /** Connector restrictions: enable/disable specific platforms. */
  connector_allowlist?: string[];
  connector_blocklist?: string[];
  /** Escalation rules: enabled types, severity floors. */
  escalation_types_allowed?: string[];
  escalation_min_severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Moderation thresholds (bounds tightening the Phase 3 gate). */
  moderation_max_block_rate?: number;
  moderation_extra_blocklist?: string[];
  /** Replay permissions: who can run replays of which kinds. */
  replay_permitted_kinds?: string[];
  replay_max_batch_size?: number;
  /** Export permissions. */
  export_permitted_kinds?: string[];
  export_max_rows?: number;
  /** Source execution ceilings — extends the per-org listening_configurations cap. */
  source_max_executions_per_day?: number;
  source_max_credits_per_day?: number;
};

export type GovernancePolicyRecord = {
  id: string;
  organization_id: string;
  policy_key: GovernancePolicyKey;
  version: number;
  status: GovernancePolicyStatus;
  body: GovernancePolicyBody;
  rationale: string | null;
  activated_by: string | null;
  activated_at: string | null;
  superseded_at: string | null;
  superseded_by_version: number | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export const GOVERNANCE_ENFORCEMENT_ACTIONS = [
  'execution.create',
  'opportunity.persist',
  'escalation.create',
  'replay.execute',
  'export.generate',
  'lifecycle.transition',
] as const;
export type GovernanceEnforcementAction = (typeof GOVERNANCE_ENFORCEMENT_ACTIONS)[number];

export type GovernanceEnforcementEvent = {
  id: string;
  organization_id: string;
  policy_key: GovernancePolicyKey;
  policy_version: number | null;
  action: GovernanceEnforcementAction;
  decision: 'allowed' | 'denied' | 'allowed_with_warning';
  reasons: string[];
  context: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
};

export function isGovernancePolicyKey(value: unknown): value is GovernancePolicyKey {
  return typeof value === 'string'
    && (GOVERNANCE_POLICY_KEYS as readonly string[]).includes(value);
}
