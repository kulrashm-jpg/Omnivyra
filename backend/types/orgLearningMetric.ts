export const LEARNING_METRIC_KEYS = [
  'recommendation_acceptance_rate',
  'recommendation_dismissal_rate',
  'source_signal_yield',
  'source_moderation_block_rate',
  'opportunity_conversion_rate',
  'execution_partial_rate',
  'execution_failure_rate',
] as const;
export type LearningMetricKey = (typeof LEARNING_METRIC_KEYS)[number];

export type OrgLearningMetric = {
  id: string;
  organization_id: string;
  metric_key: LearningMetricKey;
  /** Optional subject — e.g. a listening_sources.id or a source_identifier. */
  metric_subject: string | null;
  window_start: string;
  window_end: string;
  metric_value: number;
  sample_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
