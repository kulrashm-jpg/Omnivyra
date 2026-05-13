import { ownedDbTable } from '../db/writeOwner';
import type { ConsentRecord, ConsentVersion } from '../types/consent';
import { CONSENT_VERSION_V1 } from '../types/consent';
import type {
  CapabilitySource,
  IntegrationCapability,
} from '../types/integrationCapabilities';
import { normalizePlatform } from '../constants/platforms';

export type RecordConsentInput = {
  organizationId: string;
  platform: string;
  capability: IntegrationCapability;
  grantedBy: string | null;
  grantedAt?: string;
  scopeSnapshot: string[];
  source?: CapabilitySource;
  integrationId?: string | null;
  consentVersion?: ConsentVersion;
  metadata?: Record<string, unknown>;
};

export type RevokeConsentInput = {
  consentRecordId: string;
  organizationId: string;
  revokedBy: string | null;
};

export async function recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
  const platform = normalizePlatform(input.platform);
  const grantedAt = input.grantedAt ?? new Date().toISOString();

  const { data, error } = await ownedDbTable('consent_records')
    .insert({
      organization_id: input.organizationId,
      integration_id: input.integrationId ?? null,
      platform,
      capability: input.capability,
      consent_version: input.consentVersion ?? CONSENT_VERSION_V1,
      granted_by: input.grantedBy,
      granted_at: grantedAt,
      scope_snapshot: input.scopeSnapshot ?? [],
      source: input.source ?? 'ui',
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to record consent: ${error?.message ?? 'unknown error'}`);
  }
  return data as ConsentRecord;
}

export async function revokeConsent(input: RevokeConsentInput): Promise<ConsentRecord | null> {
  const revokedAt = new Date().toISOString();

  const { data, error } = await ownedDbTable('consent_records')
    .update({
      revoked_at: revokedAt,
      revoked_by: input.revokedBy,
    })
    .eq('id', input.consentRecordId)
    .eq('organization_id', input.organizationId)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to revoke consent: ${error.message}`);
  }
  return (data as ConsentRecord | null) ?? null;
}

export async function getActiveConsent(
  organizationId: string,
  platform: string,
  capability: IntegrationCapability,
): Promise<ConsentRecord | null> {
  const normalized = normalizePlatform(platform);

  const { data, error } = await ownedDbTable('consent_records')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('platform', normalized)
    .eq('capability', capability)
    .is('revoked_at', null)
    .order('granted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active consent: ${error.message}`);
  }
  return (data as ConsentRecord | null) ?? null;
}

export async function listConsentHistory(
  organizationId: string,
  platform?: string,
  capability?: IntegrationCapability,
): Promise<ConsentRecord[]> {
  let query = ownedDbTable('consent_records')
    .select('*')
    .eq('organization_id', organizationId)
    .order('granted_at', { ascending: false });

  if (platform) {
    query = query.eq('platform', normalizePlatform(platform));
  }
  if (capability) {
    query = query.eq('capability', capability);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list consent history: ${error.message}`);
  }
  return (data as ConsentRecord[]) ?? [];
}
