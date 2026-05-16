export const ALERT_TYPES = [
  'high_intent_detected',
  'competitor_spike',
  'migration_cluster_detected',
  'execution_failure',
  'moderation_spike',
  'source_degradation',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type AlertRule = {
  id: string;
  organization_id: string;
  alert_type: AlertType;
  enabled: boolean;
  min_severity: AlertSeverity;
  rate_limit_minutes: number;
  scope: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Alert = {
  id: string;
  organization_id: string;
  alert_rule_id: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  dedup_key: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  delivered_channels: string[];
  created_at: string;
};

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
