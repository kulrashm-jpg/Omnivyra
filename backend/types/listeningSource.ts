export const LISTENING_SOURCE_TYPES = [
  'subreddit',
  'telegram_group',
  'discord_server',
  'github_repo',
  'keyword_stream',
  'competitor_domain',
  'rss_feed',
  'youtube_channel',
  'linkedin_topic',
  'x_list',
  'custom',
] as const;

export type ListeningSourceType = (typeof LISTENING_SOURCE_TYPES)[number];

export const MONITORING_MODES = ['on_demand', 'scheduled', 'persistent'] as const;
export type MonitoringMode = (typeof MONITORING_MODES)[number];

export const LISTENING_SOURCE_STATUSES = [
  'inactive',
  'approved',
  'active',
  'paused',
  'revoked',
] as const;
export type ListeningSourceStatus = (typeof LISTENING_SOURCE_STATUSES)[number];

export type ListeningSource = {
  id: string;
  organization_id: string;
  integration_id: string | null;
  source_type: ListeningSourceType;
  source_identifier: string;
  display_name: string;
  monitoring_modes: MonitoringMode[];
  status: ListeningSourceStatus;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function isListeningSourceType(value: unknown): value is ListeningSourceType {
  return typeof value === 'string'
    && (LISTENING_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isMonitoringMode(value: unknown): value is MonitoringMode {
  return typeof value === 'string'
    && (MONITORING_MODES as readonly string[]).includes(value);
}
