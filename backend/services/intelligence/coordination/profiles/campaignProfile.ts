/**
 * Campaign Profile (WS-2D Phase 4) — campaign-centric communication intelligence.
 * GENERIC: `campaignId` is a parameter; no Campaign-module import. Composes
 * `getHistory`; aggregates (not traversal) locally.
 */
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import { distribution, type DistributionBucket } from './profileModels';

export interface CampaignProfileRequest {
  /** Restrict to one campaign; omit for all campaigns' summaries. */
  campaignId?: string | null;
}

export interface CampaignSummary {
  campaignId: string;
  communicationCount: number;
  reusedIntents: DistributionBucket[];
  platformDistribution: DistributionBucket[];
  lifecycleDistribution: DistributionBucket[];
  semanticRootIds: string[];
  /** Roots also used by OTHER campaigns — cross-campaign semantic reuse. */
  crossCampaignRoots: string[];
  derivedAssetCount: number;
  publicationCoverage: { published: number; total: number; ratio: number };
}

export interface CampaignProfileData {
  campaigns: CampaignSummary[];
}

const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));
const DERIVED_ARTIFACTS = new Set(['visual_brief', 'image', 'image_text', 'platform_adaptation', 'published_asset']);

export const campaignProfile: QueryProfile<CampaignProfileRequest, CampaignProfileData> = {
  type: 'campaign',
  async run(deps: ProfileDeps, companyId, req) {
    const all = must(await deps.intel.getHistory(companyId, {}));

    // root → set of campaigns that used it (for cross-campaign reuse).
    const campaignsByRoot = new Map<string, Set<string>>();
    for (const r of all) {
      if (!r.campaignId) continue;
      const s = campaignsByRoot.get(r.semanticRootId) ?? new Set<string>();
      s.add(r.campaignId);
      campaignsByRoot.set(r.semanticRootId, s);
    }

    const target = req.campaignId
      ? [req.campaignId]
      : uniq(all.map((r) => r.campaignId).filter((c): c is string => !!c));

    const campaigns: CampaignSummary[] = target.map((cid) => {
      const recs = all.filter((r) => r.campaignId === cid);
      const semanticRootIds = uniq(recs.map((r) => r.semanticRootId));
      const crossCampaignRoots = semanticRootIds.filter((rid) => (campaignsByRoot.get(rid)?.size ?? 0) > 1);
      const published = recs.filter((r) => r.publicationStatus === 'published' || r.artifactType === 'published_asset').length;
      return {
        campaignId: cid,
        communicationCount: recs.length,
        reusedIntents: distribution(recs.map((r) => r.communicationIntent)),
        platformDistribution: distribution(recs.map((r) => r.platform)),
        lifecycleDistribution: distribution(recs.map((r) => r.publicationStatus)),
        semanticRootIds,
        crossCampaignRoots,
        derivedAssetCount: recs.filter((r) => r.artifactType && DERIVED_ARTIFACTS.has(r.artifactType)).length,
        publicationCoverage: { published, total: recs.length, ratio: recs.length ? published / recs.length : 0 },
      };
    });

    return { campaigns };
  },
  resultCount: (d) => d.campaigns.length,
};
