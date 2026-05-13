export const INTEGRATION_CAPABILITIES = [
  'publish',
  'listen',
  'monitor_competitors',
  'ingest_dms',
  'ingest_comments',
  'ingest_mentions',
  'ingest_communities',
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const CAPABILITY_STATUSES = ['active', 'revoked', 'pending'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_SOURCES = ['ui', 'api', 'system'] as const;
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number];

export type IntegrationCapabilityRecord = {
  id: string;
  organization_id: string;
  integration_id: string | null;
  platform: string;
  capability: IntegrationCapability;
  enabled: boolean;
  granted_at: string | null;
  granted_by: string | null;
  scope_snapshot: string[];
  source: CapabilitySource;
  status: CapabilityStatus;
  consent_record_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function isIntegrationCapability(value: unknown): value is IntegrationCapability {
  return typeof value === 'string'
    && (INTEGRATION_CAPABILITIES as readonly string[]).includes(value);
}
