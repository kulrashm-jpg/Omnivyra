import { ownedDbTable } from '../db/writeOwner';
import type {
  CapabilitySource,
  CapabilityStatus,
  IntegrationCapability,
  IntegrationCapabilityRecord,
} from '../types/integrationCapabilities';
import { normalizePlatform } from '../constants/platforms';
import { recordConsent, revokeConsent, getActiveConsent } from './consentLedgerService';
import {
  publishCapabilityChangedEvent,
} from '../events/listeningEvents';
import { invalidateCapabilityAggregate } from './capabilityCacheService';

export type EnableCapabilityInput = {
  organizationId: string;
  platform: string;
  capability: IntegrationCapability;
  grantedBy: string | null;
  scopeSnapshot: string[];
  source?: CapabilitySource;
  integrationId?: string | null;
  metadata?: Record<string, unknown>;
};

export type DisableCapabilityInput = {
  organizationId: string;
  platform: string;
  capability: IntegrationCapability;
  revokedBy: string | null;
  source?: CapabilitySource;
};

async function fetchCapabilityRow(
  organizationId: string,
  platform: string,
  capability: IntegrationCapability,
): Promise<IntegrationCapabilityRecord | null> {
  const { data, error } = await ownedDbTable('integration_capabilities')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform', platform)
    .eq('capability', capability)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load capability row: ${error.message}`);
  }
  return (data as IntegrationCapabilityRecord | null) ?? null;
}

/**
 * Enable a capability for an org+platform. Always records a fresh consent
 * record before flipping `enabled = true` so the consent trail and capability
 * state cannot drift.
 */
export async function enableCapability(
  input: EnableCapabilityInput,
): Promise<IntegrationCapabilityRecord> {
  const platform = normalizePlatform(input.platform);
  const now = new Date().toISOString();

  const consent = await recordConsent({
    organizationId: input.organizationId,
    integrationId: input.integrationId ?? null,
    platform,
    capability: input.capability,
    grantedBy: input.grantedBy,
    grantedAt: now,
    scopeSnapshot: input.scopeSnapshot,
    source: input.source ?? 'ui',
    metadata: input.metadata ?? {},
  });

  const existing = await fetchCapabilityRow(input.organizationId, platform, input.capability);

  const payload = {
    organization_id: input.organizationId,
    integration_id: input.integrationId ?? null,
    platform,
    capability: input.capability,
    enabled: true,
    granted_at: now,
    granted_by: input.grantedBy,
    scope_snapshot: input.scopeSnapshot,
    source: input.source ?? 'ui',
    status: 'active' as CapabilityStatus,
    consent_record_id: consent.id,
    metadata: input.metadata ?? {},
  };

  let row: IntegrationCapabilityRecord;
  if (existing) {
    const { data, error } = await ownedDbTable('integration_capabilities')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Failed to enable capability: ${error?.message ?? 'unknown error'}`);
    }
    row = data as IntegrationCapabilityRecord;
  } else {
    const { data, error } = await ownedDbTable('integration_capabilities')
      .insert(payload)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Failed to enable capability: ${error?.message ?? 'unknown error'}`);
    }
    row = data as IntegrationCapabilityRecord;
  }

  invalidateCapabilityAggregate(row.organization_id);

  await publishCapabilityChangedEvent({
    organization_id: row.organization_id,
    platform: row.platform,
    capability: row.capability,
    previous_state: existing?.enabled ? 'enabled' : 'disabled',
    new_state: 'enabled',
    actor_user_id: input.grantedBy,
    occurred_at: now,
  });

  return row;
}

/**
 * Disable a capability. Revokes the latest active consent record (if any) and
 * flips `enabled = false`, `status = 'revoked'`. Preserves history.
 */
export async function disableCapability(
  input: DisableCapabilityInput,
): Promise<IntegrationCapabilityRecord | null> {
  const platform = normalizePlatform(input.platform);
  const now = new Date().toISOString();

  const existing = await fetchCapabilityRow(input.organizationId, platform, input.capability);
  if (!existing) return null;

  const consent = await getActiveConsent(input.organizationId, platform, input.capability);
  if (consent) {
    await revokeConsent({
      consentRecordId: consent.id,
      organizationId: input.organizationId,
      revokedBy: input.revokedBy,
    });
  }

  const { data, error } = await ownedDbTable('integration_capabilities')
    .update({
      enabled: false,
      status: 'revoked' as CapabilityStatus,
      consent_record_id: null,
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to disable capability: ${error?.message ?? 'unknown error'}`);
  }

  const row = data as IntegrationCapabilityRecord;

  invalidateCapabilityAggregate(row.organization_id);

  await publishCapabilityChangedEvent({
    organization_id: row.organization_id,
    platform: row.platform,
    capability: row.capability,
    previous_state: existing.enabled ? 'enabled' : 'disabled',
    new_state: 'disabled',
    actor_user_id: input.revokedBy,
    occurred_at: now,
  });

  return row;
}

export async function listCapabilitiesForOrg(
  organizationId: string,
): Promise<IntegrationCapabilityRecord[]> {
  const { data, error } = await ownedDbTable('integration_capabilities')
    .select('*')
    .eq('organization_id', organizationId)
    .order('platform', { ascending: true })
    .order('capability', { ascending: true });

  if (error) {
    throw new Error(`Failed to list capabilities: ${error.message}`);
  }
  return (data as IntegrationCapabilityRecord[]) ?? [];
}

export async function getCapability(
  organizationId: string,
  platform: string,
  capability: IntegrationCapability,
): Promise<IntegrationCapabilityRecord | null> {
  return fetchCapabilityRow(organizationId, normalizePlatform(platform), capability);
}

export async function isCapabilityEnabled(
  organizationId: string,
  platform: string,
  capability: IntegrationCapability,
): Promise<boolean> {
  const row = await fetchCapabilityRow(
    organizationId,
    normalizePlatform(platform),
    capability,
  );
  return Boolean(row && row.enabled && row.status === 'active');
}
