/**
 * Design Attribution Service — resolves the immutable attribution stamp for an
 * asset generated inside a campaign, so analytics roll back up to the Template,
 * Collection, and Campaign Design System. Additive: `stampAssetAttribution` is
 * called at the existing asset-metadata assembly seam (it does NOT change
 * generation or rendering — it only adds a frozen metadata key).
 */

import {
  type DesignAttribution,
  buildDesignAttribution,
  stampDesignAttribution,
} from '../../../lib/creator-templates/designAttribution';
import { getCampaignDesignSystem } from './campaignDesignSystemService';

/** Resolve the full attribution for a (campaign, template) pair. */
export async function resolveCampaignAttribution(input: {
  campaignId: string;
  templateId?: string | null;
  templateVersion?: number | null;
}): Promise<DesignAttribution> {
  const ds = await getCampaignDesignSystem(input.campaignId);
  return buildDesignAttribution({
    campaignId: input.campaignId,
    // Stable surrogate id for the campaign's design-system row (one per campaign).
    campaignDesignSystemId: ds ? `cds:${ds.campaignId}` : null,
    collectionId: ds?.collectionId ?? null,
    collectionVersion: ds?.pinnedVersion ?? null,
    templateId: input.templateId ?? null,
    templateVersion: typeof input.templateVersion === 'number' ? input.templateVersion : null,
  });
}

/**
 * Resolve + stamp in one step. Returns the metadata with the frozen attribution
 * key added (immutable once set). No-op-safe when campaignId is absent.
 */
export async function stampAssetAttribution(
  metadata: Record<string, unknown> | null | undefined,
  input: { campaignId?: string | null; templateId?: string | null; templateVersion?: number | null },
): Promise<Record<string, unknown>> {
  const base = metadata && typeof metadata === 'object' ? metadata : {};
  if (!input.campaignId) return base as Record<string, unknown>;
  const attribution = await resolveCampaignAttribution({ campaignId: input.campaignId, templateId: input.templateId, templateVersion: input.templateVersion });
  return stampDesignAttribution(base, attribution);
}

export { stampDesignAttribution, buildDesignAttribution };
