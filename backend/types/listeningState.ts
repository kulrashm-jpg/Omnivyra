import type {
  IntegrationCapability,
  CapabilityStatus,
} from './integrationCapabilities';
import type { MonitoringMode, ListeningSourceStatus } from './listeningSource';

// Explicit four-state model. Separates OAuth-connected from listening-approved
// from actively monitored, so downstream code never confuses them.
export const PLATFORM_LISTENING_STATES = [
  'connected',
  'available_for_listening',
  'listening_approved',
  'listening_active',
] as const;
export type PlatformListeningState = (typeof PLATFORM_LISTENING_STATES)[number];

export const SOURCE_HEALTH_STATES = [
  'unknown',
  'healthy',
  'degraded',
  'failing',
  'silenced',
] as const;
export type SourceHealth = (typeof SOURCE_HEALTH_STATES)[number];

export type PlatformListeningStatus = {
  platform: string;
  state: PlatformListeningState;
  capabilities: Array<{
    capability: IntegrationCapability;
    enabled: boolean;
    status: CapabilityStatus;
    granted_at: string | null;
  }>;
  active_monitoring_modes: MonitoringMode[];
};

export type ListeningSourceState = {
  source_id: string;
  status: ListeningSourceStatus;
  monitoring_modes: MonitoringMode[];
  source_health: SourceHealth;
};
