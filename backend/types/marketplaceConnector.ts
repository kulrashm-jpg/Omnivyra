export const MARKETPLACE_CERTIFICATION_STATES = [
  'uncertified',
  'review',
  'certified',
  'rejected',
  'revoked',
] as const;
export type MarketplaceCertificationState = (typeof MARKETPLACE_CERTIFICATION_STATES)[number];

export const MARKETPLACE_ROLLOUT_STATES = ['inactive', 'staged', 'active', 'retired'] as const;
export type MarketplaceRolloutState = (typeof MARKETPLACE_ROLLOUT_STATES)[number];

export type MarketplaceConnectorDefinition = {
  id: string;
  organization_id: string;
  connector_slug: string;
  display_name: string;
  vendor: string;
  version: string;
  capability_tags: string[];
  dependency_metadata: Record<string, unknown>;
  signed_metadata: Record<string, unknown>;
  signature_hash: string;
  certification_state: MarketplaceCertificationState;
  rollout_state: MarketplaceRolloutState;
  activated_by: string | null;
  activated_at: string | null;
  retired_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MarketplaceConnectorCertification = {
  id: string;
  organization_id: string;
  marketplace_connector_id: string;
  previous_state: MarketplaceCertificationState | null;
  new_state: MarketplaceCertificationState;
  reason: string | null;
  evidence: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
};
