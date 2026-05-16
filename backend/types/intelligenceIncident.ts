export const INCIDENT_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'open',
  'triaging',
  'mitigating',
  'resolved',
  'postmortem',
  'closed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_CATEGORIES = [
  'execution_failure',
  'semantic_indexing_failure',
  'replay_failure',
  'projection_drift',
  'moderation_outage',
  'cost_breach',
  'sla_breach',
  'connector_outage',
  'governance_violation',
  'other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_TIMELINE_KINDS = [
  'created',
  'status_changed',
  'severity_changed',
  'owner_changed',
  'note',
  'mitigation_applied',
  'replay_linked',
  'escalation_linked',
  'resolved',
  'reopened',
] as const;
export type IncidentTimelineKind = (typeof INCIDENT_TIMELINE_KINDS)[number];

export type IntelligenceIncident = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  category: IncidentCategory;
  owner_user_id: string | null;
  linked_escalation_id: string | null;
  linked_replay_id: string | null;
  metadata: Record<string, unknown>;
  resolved_at: string | null;
  resolved_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type IncidentTimelineEntry = {
  id: string;
  organization_id: string;
  incident_id: string;
  entry_kind: IncidentTimelineKind;
  body: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
