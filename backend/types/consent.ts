import type {
  CapabilitySource,
  IntegrationCapability,
} from './integrationCapabilities';

export const CONSENT_VERSION_V1 = 'consent_v1' as const;
export type ConsentVersion = typeof CONSENT_VERSION_V1 | string;

export type ConsentRecord = {
  id: string;
  organization_id: string;
  integration_id: string | null;
  platform: string;
  capability: IntegrationCapability;
  consent_version: ConsentVersion;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  scope_snapshot: string[];
  metadata: Record<string, unknown>;
  source: CapabilitySource;
  created_at: string;
  updated_at: string;
};
