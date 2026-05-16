/**
 * Phase 10 — Connector marketplace registry + certification.
 *
 * Tenant-scoped registry of marketplace connector definitions. Each row
 * carries a deterministic `signature_hash` over (slug, version, vendor,
 * capability_tags, dependency_metadata, signed_metadata) so consumers
 * can verify the definition has not been mutated since registration.
 *
 * Certification transitions are append-only via
 * `marketplace_connector_certifications` (DB-level trigger blocks
 * UPDATE/DELETE). The current `certification_state` on the definition
 * row is the latest-applied state; the append-only log is the audit
 * trail.
 *
 * Hard guarantees:
 *   • No autonomous registration. Every register/certify call requires
 *     an explicit operator user id.
 *   • No dynamic runtime code loading. `signed_metadata` is descriptive
 *     JSON only; this service NEVER eval()s or imports it.
 *   • Activation is operator-driven; activated_by + activated_at are
 *     persisted on the definition row for traceability.
 *   • Tenant-first reads; FK CASCADE on org delete.
 *   • Replay-safe: re-registering the same (slug, version) is rejected
 *     by the UNIQUE constraint (no silent overwrites).
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  type MarketplaceCertificationState,
  type MarketplaceConnectorCertification,
  type MarketplaceConnectorDefinition,
  type MarketplaceRolloutState,
} from '../types/marketplaceConnector';
import { publishRealtime } from './realtimePublisherService';
import {
  publishConnectorCertificationUpdated,
  publishConnectorMarketplaceRegistered,
} from '../events/listeningEvents';

function computeSignatureHash(args: {
  slug: string;
  version: string;
  vendor: string;
  capabilityTags: string[];
  dependencyMetadata: Record<string, unknown>;
  signedMetadata: Record<string, unknown>;
}): string {
  const canonical = JSON.stringify({
    slug: args.slug,
    version: args.version,
    vendor: args.vendor,
    capability_tags: [...args.capabilityTags].sort(),
    dependency_metadata: args.dependencyMetadata,
    signed_metadata: args.signedMetadata,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export type RegisterMarketplaceConnectorInput = {
  organizationId: string;
  connectorSlug: string;
  displayName: string;
  vendor: string;
  version: string;
  capabilityTags: string[];
  dependencyMetadata?: Record<string, unknown>;
  signedMetadata?: Record<string, unknown>;
  activatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function registerMarketplaceConnector(
  input: RegisterMarketplaceConnectorInput,
): Promise<MarketplaceConnectorDefinition> {
  const dependencyMetadata = input.dependencyMetadata ?? {};
  const signedMetadata = input.signedMetadata ?? {};
  const signatureHash = computeSignatureHash({
    slug: input.connectorSlug,
    version: input.version,
    vendor: input.vendor,
    capabilityTags: input.capabilityTags,
    dependencyMetadata,
    signedMetadata,
  });

  const ins = await ownedDbTable('marketplace_connector_definitions')
    .insert({
      organization_id: input.organizationId,
      connector_slug: input.connectorSlug,
      display_name: input.displayName,
      vendor: input.vendor,
      version: input.version,
      capability_tags: input.capabilityTags,
      dependency_metadata: dependencyMetadata,
      signed_metadata: signedMetadata,
      signature_hash: signatureHash,
      certification_state: 'uncertified',
      rollout_state: 'inactive',
      activated_by: null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`marketplace_register_failed:${ins.error?.message ?? 'unknown'}`);
  const def = ins.data as MarketplaceConnectorDefinition;

  try {
    await publishConnectorMarketplaceRegistered({
      organizationId: input.organizationId,
      marketplaceConnectorId: def.id,
      connectorSlug: def.connector_slug,
      version: def.version,
      signatureHash: def.signature_hash,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'marketplace',
      eventName: 'connector.marketplace_registered',
      payload: { connector_id: def.id, slug: def.connector_slug, version: def.version },
    });
  } catch { /* best effort */ }

  return def;
}

export type UpdateCertificationInput = {
  organizationId: string;
  marketplaceConnectorId: string;
  newState: MarketplaceCertificationState;
  reason?: string | null;
  evidence?: Record<string, unknown>;
  actorUserId: string | null;
};

export async function updateConnectorCertification(
  input: UpdateCertificationInput,
): Promise<MarketplaceConnectorDefinition> {
  const { data: row } = await ownedDbTable('marketplace_connector_definitions')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('id', input.marketplaceConnectorId)
    .maybeSingle();
  const current = row as MarketplaceConnectorDefinition | null;
  if (!current) throw new Error(`marketplace_connector_not_found:${input.marketplaceConnectorId}`);

  const previous = current.certification_state;

  await ownedDbTable('marketplace_connector_certifications').insert({
    organization_id: input.organizationId,
    marketplace_connector_id: current.id,
    previous_state: previous,
    new_state: input.newState,
    reason: input.reason ?? null,
    evidence: input.evidence ?? {},
    actor_user_id: input.actorUserId,
  });

  const upd = await ownedDbTable('marketplace_connector_definitions')
    .update({ certification_state: input.newState })
    .eq('id', current.id)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`marketplace_certify_failed:${upd.error?.message ?? 'unknown'}`);

  try {
    await publishConnectorCertificationUpdated({
      organizationId: input.organizationId,
      marketplaceConnectorId: current.id,
      previousState: previous,
      newState: input.newState,
      actorUserId: input.actorUserId,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'marketplace',
      eventName: 'connector.certification_updated',
      payload: { connector_id: current.id, previous_state: previous, new_state: input.newState },
    });
  } catch { /* best effort */ }

  return upd.data as MarketplaceConnectorDefinition;
}

export type SetRolloutStateInput = {
  organizationId: string;
  marketplaceConnectorId: string;
  rolloutState: MarketplaceRolloutState;
  actorUserId: string | null;
};

export async function setConnectorRolloutState(
  input: SetRolloutStateInput,
): Promise<MarketplaceConnectorDefinition> {
  const { data: row } = await ownedDbTable('marketplace_connector_definitions')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('id', input.marketplaceConnectorId)
    .maybeSingle();
  const current = row as MarketplaceConnectorDefinition | null;
  if (!current) throw new Error(`marketplace_connector_not_found:${input.marketplaceConnectorId}`);

  // Refuse to activate non-certified connectors.
  if (input.rolloutState === 'active' && current.certification_state !== 'certified') {
    throw new Error(`marketplace_activate_requires_certified:${current.certification_state}`);
  }

  const patch: Record<string, unknown> = { rollout_state: input.rolloutState };
  if (input.rolloutState === 'active') {
    patch.activated_by = input.actorUserId;
    patch.activated_at = new Date().toISOString();
  }
  if (input.rolloutState === 'retired') {
    patch.retired_at = new Date().toISOString();
  }

  const upd = await ownedDbTable('marketplace_connector_definitions')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`marketplace_rollout_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as MarketplaceConnectorDefinition;
}

export async function listMarketplaceConnectors(
  organizationId: string,
  options?: { rolloutState?: MarketplaceRolloutState; certificationState?: MarketplaceCertificationState; limit?: number },
): Promise<MarketplaceConnectorDefinition[]> {
  let q = ownedDbTable('marketplace_connector_definitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.rolloutState) q = q.eq('rollout_state', options.rolloutState);
  if (options?.certificationState) q = q.eq('certification_state', options.certificationState);
  const { data } = await q;
  return (data as MarketplaceConnectorDefinition[]) ?? [];
}

export async function listCertificationHistory(
  organizationId: string,
  marketplaceConnectorId: string,
): Promise<MarketplaceConnectorCertification[]> {
  const { data } = await ownedDbTable('marketplace_connector_certifications')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('marketplace_connector_id', marketplaceConnectorId)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data as MarketplaceConnectorCertification[]) ?? [];
}
