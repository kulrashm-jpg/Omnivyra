export const ESCALATION_TYPES = [
  'executive_review',
  'compliance_review',
  'sales_review',
  'moderation_review',
  'strategic_review',
] as const;
export type EscalationType = (typeof ESCALATION_TYPES)[number];

export const ESCALATION_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const ESCALATION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];

export type EscalationHistoryEntry = {
  at: string;
  by: string | null;
  action: 'created' | 'assigned' | 'status_changed' | 'severity_changed' | 'resolved' | 'dismissed' | 'reopened' | 'note';
  detail?: string | null;
};

export type Escalation = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string | null;
  escalation_type: EscalationType;
  status: EscalationStatus;
  severity: EscalationSeverity;
  requested_by: string | null;
  assigned_to_user_id: string | null;
  title: string;
  body: string | null;
  sla_due_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  history: EscalationHistoryEntry[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// Default SLA windows (hours). Used to compute sla_due_at when a caller
// does not supply one. Bounded; never auto-extended.
export const ESCALATION_SLA_HOURS: Record<EscalationType, number> = {
  executive_review: 24,
  compliance_review: 48,
  sales_review: 24,
  moderation_review: 12,
  strategic_review: 72,
};
