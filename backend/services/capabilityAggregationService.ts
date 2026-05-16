/**
 * Phase 1 — Capability aggregation service.
 *
 * Single deterministic snapshot of the Active Leads listening state for a
 * tenant, joining six previously-independent reads:
 *
 *   1. OAuth connections           (social_accounts: company, platform, is_active)
 *   2. Granted scopes              (social_accounts.granted_scopes + scope_version_hash)
 *   3. Latest active consent       (consent_records, non-revoked, ordered by granted_at DESC)
 *   4. Capability state            (integration_capabilities: enabled, status)
 *   5. Listening sources           (listening_sources: status, monitoring_modes[])
 *   6. Monitoring readiness        (pure derivation — no transport invocation)
 *
 * Read-only. Tenant-scoped on `organization_id`. Service-role queries via
 * `ownedDbTable` — never carries through arbitrary user-supplied filters.
 *
 * Returns one CapabilityAggregate per organization. Callers should hit
 * `capabilityCacheService.getCapabilityAggregate(orgId)` which wraps this
 * with a short TTL cache; this module is the cache miss path.
 *
 * Performance posture: fixed 4 queries (social_accounts, consent_records,
 * integration_capabilities, listening_sources). No N+1: scopes already live
 * on social_accounts; per-platform derivations are pure JS over the four
 * result sets. New composite indexes from 20260515 keep each query at a
 * single index scan.
 */

import { ownedDbTable } from '../db/writeOwner';
import { normalizePlatform } from '../constants/platforms';
import type {
  IntegrationCapability,
  IntegrationCapabilityRecord,
} from '../types/integrationCapabilities';
import type { ConsentRecord } from '../types/consent';
import type {
  ListeningSource,
  MonitoringMode,
} from '../types/listeningSource';
import type {
  PlatformListeningState,
  SourceHealth,
} from '../types/listeningState';

export type PlatformCapabilitySnapshot = {
  capability: IntegrationCapability;
  enabled: boolean;
  status: 'active' | 'revoked' | 'pending';
  granted_at: string | null;
  consent_record_id: string | null;
  consent_record_age_days: number | null;
};

export type PlatformAggregate = {
  platform: string;
  is_connected: boolean;
  granted_scopes: string[];
  scope_version_hash: string | null;
  granted_scopes_recorded_at: string | null;
  capabilities: PlatformCapabilitySnapshot[];
  active_consents: Array<{
    consent_record_id: string;
    capability: IntegrationCapability;
    granted_at: string;
    age_days: number;
  }>;
  state: PlatformListeningState;
  source_health: SourceHealth;
  monitoring_ready: boolean;
  monitoring_blockers: string[];
  readiness_snapshot: {
    consent_freshness_score: number;
    scope_sufficiency: 'sufficient' | 'insufficient' | 'not_required';
    source_ready: boolean;
    orchestration_eligible: boolean;
  };
};

export type ListeningSourceAggregate = Pick<
  ListeningSource,
  | 'id'
  | 'integration_id'
  | 'source_type'
  | 'source_identifier'
  | 'display_name'
  | 'status'
> & {
  monitoring_modes: MonitoringMode[];
  metadata?: Record<string, unknown> | null;
};

export type CapabilityAggregate = {
  organization_id: string;
  generated_at: string;
  platforms: PlatformAggregate[];
  listening_sources: ListeningSourceAggregate[];
  health: {
    stale_consents: number;
    revoked_scope_warnings: number;
    orphan_capabilities: number;
    invalid_sources: number;
  };
};

// Scope requirements to consider a platform "listening-ready" at the scope
// level. Intentionally conservative — sufficient to start a Phase-2 listener.
// Aggregator is read-only; if the granted scope set lacks any of these,
// the platform's monitoring_ready flag flips to false and a blocker reason
// is surfaced. Missing entries (e.g. for not-yet-supported platforms) mean
// the aggregator only checks the OAuth + capability prerequisites.
export const LISTENING_SCOPE_REQUIREMENTS: Record<string, string[]> = {
  linkedin: [],
  x: ['tweet.read'],
  twitter: ['tweet.read'],
  reddit: ['read'],
  facebook: [],
  instagram: [],
  threads: [],
};

const CONSENT_FRESHNESS_DAYS = 180;

function daysBetween(fromIso: string, nowIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(nowIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}

function deriveState(
  isConnected: boolean,
  capabilities: PlatformCapabilitySnapshot[],
): PlatformListeningState {
  const listenRow = capabilities.find((c) => c.capability === 'listen');
  if (listenRow?.enabled && listenRow?.status === 'active') return 'listening_active';
  if (listenRow?.status === 'active' && !listenRow.enabled) return 'listening_approved';
  if (isConnected) return 'available_for_listening';
  return 'connected';
}

function evaluateMonitoringReady(args: {
  isConnected: boolean;
  grantedScopes: string[];
  capabilities: PlatformCapabilitySnapshot[];
  platform: string;
  activeConsentAgeDays: number | null;
  hasReadySource: boolean;
}): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!args.isConnected) blockers.push('oauth_not_connected');

  const listenRow = args.capabilities.find((c) => c.capability === 'listen');
  if (!listenRow || !listenRow.enabled || listenRow.status !== 'active') {
    blockers.push('listen_capability_not_enabled');
  }

  if (args.activeConsentAgeDays == null) {
    blockers.push('no_active_consent');
  } else if (args.activeConsentAgeDays > CONSENT_FRESHNESS_DAYS) {
    blockers.push('consent_stale');
  }

  const required = LISTENING_SCOPE_REQUIREMENTS[args.platform] ?? [];
  const missing = required.filter((s) => !args.grantedScopes.includes(s));
  if (missing.length > 0) {
    blockers.push(`scope_insufficient:${missing.join(',')}`);
  }

  if (!args.hasReadySource && args.isConnected) {
    blockers.push('no_ready_source');
  }

  return { ready: blockers.length === 0, blockers };
}

function readinessSnapshot(args: {
  blockers: string[];
  activeConsentAgeDays: number | null;
  requiredScopes: string[];
  missingScopes: string[];
  hasReadySource: boolean;
}): PlatformAggregate['readiness_snapshot'] {
  const consentFreshnessScore = args.activeConsentAgeDays == null
    ? 0
    : Math.max(0, Math.min(100, Math.round(100 - (args.activeConsentAgeDays / CONSENT_FRESHNESS_DAYS) * 100)));
  return {
    consent_freshness_score: consentFreshnessScore,
    scope_sufficiency: args.requiredScopes.length === 0
      ? 'not_required'
      : args.missingScopes.length === 0 ? 'sufficient' : 'insufficient',
    source_ready: args.hasReadySource,
    orchestration_eligible: args.blockers.length === 0,
  };
}

function sourceHealthFromStatuses(statuses: Array<ListeningSource['status']>): SourceHealth {
  if (statuses.length === 0) return 'unknown';
  if (statuses.some((s) => s === 'revoked')) return 'failing';
  if (statuses.some((s) => s === 'paused')) return 'degraded';
  if (statuses.some((s) => s === 'active' || s === 'ready' as any)) return 'healthy';
  return 'unknown';
}

/**
 * Cache-miss data path. Read four tables, derive everything else in memory.
 */
export async function buildCapabilityAggregate(
  organizationId: string,
): Promise<CapabilityAggregate> {
  const generatedAt = new Date().toISOString();

  type SocialAccountRow = {
    id: string;
    platform: string;
    is_active: boolean;
    granted_scopes: string[] | null;
    granted_scopes_recorded_at: string | null;
    scope_version_hash: string | null;
  };

  const [socialAccountsResp, capabilitiesResp, consentsResp, sourcesResp] = await Promise.all([
    ownedDbTable('social_accounts')
      .select('id, platform, is_active, granted_scopes, granted_scopes_recorded_at, scope_version_hash')
      .eq('company_id', organizationId)
      .eq('is_active', true),
    ownedDbTable('integration_capabilities')
      .select('id, integration_id, platform, capability, enabled, status, granted_at, granted_by, scope_snapshot, source, consent_record_id, metadata, created_at, updated_at, organization_id')
      .eq('organization_id', organizationId),
    ownedDbTable('consent_records')
      .select('id, integration_id, platform, capability, consent_version, granted_by, granted_at, revoked_at, revoked_by, scope_snapshot, metadata, source, organization_id, created_at, updated_at')
      .eq('organization_id', organizationId)
      .is('revoked_at', null)
      .order('granted_at', { ascending: false }),
    ownedDbTable('listening_sources')
      .select('id, integration_id, source_type, source_identifier, display_name, monitoring_modes, status, metadata, created_by, created_at, updated_at, organization_id')
      .eq('organization_id', organizationId),
  ]);

  const socialAccounts = (socialAccountsResp.data ?? []) as SocialAccountRow[];
  const capabilities = (capabilitiesResp.data ?? []) as IntegrationCapabilityRecord[];
  const consents = (consentsResp.data ?? []) as ConsentRecord[];
  const sources = (sourcesResp.data ?? []) as ListeningSource[];

  const platformSet = new Set<string>([
    ...socialAccounts.map((r) => normalizePlatform(r.platform)),
    ...capabilities.map((r) => normalizePlatform(r.platform)),
  ]);
  const socialByPlatform = new Map<string, SocialAccountRow>();
  for (const row of socialAccounts) {
    socialByPlatform.set(normalizePlatform(row.platform), row);
  }
  const capabilitiesByPlatform = new Map<string, IntegrationCapabilityRecord[]>();
  for (const row of capabilities) {
    const platform = normalizePlatform(row.platform);
    const list = capabilitiesByPlatform.get(platform) ?? [];
    list.push(row);
    capabilitiesByPlatform.set(platform, list);
  }
  const consentsByPlatform = new Map<string, ConsentRecord[]>();
  for (const row of consents) {
    const platform = normalizePlatform(row.platform);
    const list = consentsByPlatform.get(platform) ?? [];
    list.push(row);
    consentsByPlatform.set(platform, list);
  }
  const sourcesByPlatform = new Map<string, ListeningSource[]>();
  for (const source of sources) {
    const meta = (source.metadata as { platform?: string }) ?? {};
    if (!meta.platform) continue;
    const platform = normalizePlatform(meta.platform);
    const list = sourcesByPlatform.get(platform) ?? [];
    list.push(source);
    sourcesByPlatform.set(platform, list);
  }

  const platforms: PlatformAggregate[] = [];
  let staleConsents = 0;

  for (const platform of platformSet) {
    const sa = socialByPlatform.get(platform) ?? null;
    const isConnected = sa !== null;
    const grantedScopes = Array.isArray(sa?.granted_scopes) ? (sa!.granted_scopes as string[]) : [];

    const platformCaps = capabilitiesByPlatform.get(platform) ?? [];
    const platformConsents = consentsByPlatform.get(platform) ?? [];

    const caps: PlatformCapabilitySnapshot[] = platformCaps.map((c) => {
      const age = c.granted_at ? daysBetween(c.granted_at, generatedAt) : null;
      if (age != null && age > CONSENT_FRESHNESS_DAYS && c.enabled) {
        staleConsents += 1;
      }
      return {
        capability: c.capability,
        enabled: c.enabled,
        status: c.status,
        granted_at: c.granted_at,
        consent_record_id: c.consent_record_id,
        consent_record_age_days: age,
      };
    });

    const activeConsents = platformConsents.map((cr) => ({
      consent_record_id: cr.id,
      capability: cr.capability,
      granted_at: cr.granted_at,
      age_days: daysBetween(cr.granted_at, generatedAt),
    }));

    const listenRowAge = caps.find((c) => c.capability === 'listen')?.consent_record_age_days ?? null;

    const platformSources = sourcesByPlatform.get(platform) ?? [];

    const hasReadySource = platformSources.some(
      (s) => s.status === 'active' || s.status === 'approved',
    );
    const requiredScopes = LISTENING_SCOPE_REQUIREMENTS[platform] ?? [];
    const missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));

    const eligibility = evaluateMonitoringReady({
      isConnected,
      grantedScopes,
      capabilities: caps,
      platform,
      activeConsentAgeDays: listenRowAge,
      hasReadySource,
    });
    const readiness = readinessSnapshot({
      blockers: eligibility.blockers,
      activeConsentAgeDays: listenRowAge,
      requiredScopes,
      missingScopes,
      hasReadySource,
    });

    platforms.push({
      platform,
      is_connected: isConnected,
      granted_scopes: grantedScopes,
      scope_version_hash: sa?.scope_version_hash ?? null,
      granted_scopes_recorded_at: sa?.granted_scopes_recorded_at ?? null,
      capabilities: caps,
      active_consents: activeConsents,
      state: deriveState(isConnected, caps),
      source_health: sourceHealthFromStatuses(platformSources.map((s) => s.status)),
      monitoring_ready: eligibility.ready,
      monitoring_blockers: eligibility.blockers,
      readiness_snapshot: readiness,
    });
  }

  // Health roll-ups.
  // Orphan capability: capability row exists for an org+platform with no
  // active social_accounts row (i.e., the integration was disconnected but
  // the capability state was not cleaned up).
  const connectedPlatformSet = new Set(
    socialAccounts.map((r) => normalizePlatform(r.platform)),
  );
  const orphanCapabilities = capabilities.filter(
    (c) => c.enabled && !connectedPlatformSet.has(normalizePlatform(c.platform)),
  ).length;

  // Revoked scope warning: a capability requires a scope that's missing from
  // the latest granted_scopes for its platform.
  let revokedScopeWarnings = 0;
  for (const platformRow of platforms) {
    const listenRow = platformRow.capabilities.find((c) => c.capability === 'listen');
    if (!listenRow || !listenRow.enabled) continue;
    const required = LISTENING_SCOPE_REQUIREMENTS[platformRow.platform] ?? [];
    const missing = required.filter((s) => !platformRow.granted_scopes.includes(s));
    if (missing.length > 0) revokedScopeWarnings += 1;
  }

  // Invalid source: status is 'active' but underlying integration is gone.
  const invalidSources = sources.filter((s) => {
    if (s.status !== 'active') return false;
    const meta = (s.metadata as { platform?: string }) ?? {};
    if (!meta.platform) return false;
    return !connectedPlatformSet.has(normalizePlatform(meta.platform));
  }).length;

  const listeningSourceAggregates: ListeningSourceAggregate[] = sources.map((s) => ({
    id: s.id,
    integration_id: s.integration_id,
    source_type: s.source_type,
    source_identifier: s.source_identifier,
    display_name: s.display_name,
    status: s.status,
    monitoring_modes: s.monitoring_modes,
    metadata: (s.metadata as Record<string, unknown> | null) ?? null,
  }));

  return {
    organization_id: organizationId,
    generated_at: generatedAt,
    platforms,
    listening_sources: listeningSourceAggregates,
    health: {
      stale_consents: staleConsents,
      revoked_scope_warnings: revokedScopeWarnings,
      orphan_capabilities: orphanCapabilities,
      invalid_sources: invalidSources,
    },
  };
}
