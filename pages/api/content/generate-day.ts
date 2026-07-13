import type { NextApiRequest, NextApiResponse } from 'next';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  formatForcedContextForPrompt,
} from '../../../backend/services/companyContextService';
import {
  getResolvedCampaignPlanContext,
  PrePlanningRequiredError,
} from '../../../backend/services/campaignBlueprintService';
import { getLatestPlatformExecutionPlan } from '../../../backend/db/platformExecutionStore';
import { generateContentForDay } from '../../../backend/services/contentGenerationService';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';
import { createContentAsset } from '../../../backend/services/contentAssetService';
import { getContentAssetByKey } from '../../../backend/db/contentAssetStore';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateTrackingLink } from '../../../backend/services/trackingLinkService';
import { resolveCampaignVariant } from '../../../backend/services/creator/campaignVariantBridge';
import { randomUUID } from 'crypto';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber, day } = req.body || {};
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;
    if (!companyId || !campaignId || !weekNumber || !day) {
      return res.status(400).json({ error: 'companyId, campaignId, weekNumber, day are required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const resolved = await getResolvedCampaignPlanContext(companyId, campaignId);
    if (!resolved) {
      return res.status(404).json({ error: 'Campaign plan not found' });
    }
    const weekPlan = resolved.weekly_plan.find(
      (week: any) => week.week_number === Number(weekNumber)
    );
    if (!weekPlan) {
      return res.status(404).json({ error: 'Week plan not found' });
    }

    const execution = await getLatestPlatformExecutionPlan({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
    });
    const dayPlan = execution?.plan_json?.days?.find((entry: any) => entry.date === day);
    if (!dayPlan) {
      return res.status(404).json({ error: 'Day plan not found' });
    }

    let forcedContext: string | null = null;
    if (profile.forced_context_fields && Object.keys(profile.forced_context_fields).length > 0) {
      const canonical = buildCompanyContext(profile);
      const { forced_context } = buildForcedCompanyContext(canonical, profile.forced_context_fields);
      if (Object.keys(forced_context).length > 0) {
        forcedContext = formatForcedContextForPrompt(forced_context);
      }
    }

    const content = await generateContentForDay({
      companyProfile: profile,
      campaign: resolved.campaign,
      weekPlan,
      dayPlan,
      trend: dayPlan.trendUsed ?? null,
      platform: dayPlan.platform,
      forcedContext,
      campaignMemory: await getCampaignMemory({ companyId, campaignId }),
    });

    const contentType = dayPlan.content_type || dayPlan.contentType || 'content';
    const derivedDayNumber = Number(
      dayPlan.day_number ?? dayPlan.dayNumber ?? dayPlan.dayIndex ?? dayPlan.day ?? 0
    );
    // Creator identifiers, captured best-effort from whatever the resolved
    // campaign / day plan already carries. These are optional: when absent
    // the link is minted exactly as before (no omn_* params appended).
    // NOTE: omn_asset_id is intentionally not sourced here — the asset row is
    // created AFTER the link is embedded into its content (see createContentAsset
    // below), so the asset id does not yet exist at mint time. The service
    // supports omn_asset_id for callers that already hold one.
    let strategyId =
      resolved.campaign?.strategy_id ??
      resolved.campaign?.creator_strategy_id ??
      dayPlan.creator_strategy_id ??
      dayPlan.creatorStrategyId ??
      dayPlan.strategy_id ??
      null;
    let variantId = dayPlan.variant_id ?? dayPlan.variantId ?? null;

    // ── Creator Variant Bridge ─────────────────────────────────────────────
    // The plan lane is variant-agnostic, so when the day carries no variant we
    // fall back to the creator lane's already-durable selection (read-only;
    // selects nothing). On experiment ambiguity the bridge returns no variant
    // and we SKIP attribution rather than guess. Best-effort — never blocks
    // generation, and never overrides a variant the plan already carried.
    if (!variantId) {
      try {
        const bridged = await resolveCampaignVariant(campaignId, dayPlan.platform);
        if (bridged.status === 'resolved') {
          variantId = bridged.variant_id;
          strategyId = strategyId ?? bridged.strategy_id;
        } else if (bridged.status === 'ambiguous') {
          console.warn('CREATOR VARIANT BRIDGE ambiguous — skipping variant attribution', {
            campaignId,
            platform: dayPlan.platform,
            distinct_variant_ids: bridged.distinct_variant_ids,
          });
        }
      } catch {
        // Bridge is best-effort; content generation must never depend on it.
      }
    }

    // ── Asset-id timing fix ────────────────────────────────────────────────
    // The link is embedded INTO the asset content, so historically the asset
    // id did not exist yet at mint time. The (campaign, week, day, platform)
    // key is deterministic, so we resolve the id up front: reuse the existing
    // asset_id on a regeneration, else pre-generate a UUID and hand it to
    // createContentAsset as the primary key. No reorder of version writes, no
    // behaviour change — the link simply now carries the correct omn_asset_id.
    const existingAsset = await getContentAssetByKey({
      campaignId,
      weekNumber: Number(weekNumber),
      day,
      platform: dayPlan.platform,
    });
    const assetId = existingAsset?.asset_id ?? randomUUID();

    const tracking = await generateTrackingLink({
      companyId,
      campaignId,
      platform: dayPlan.platform,
      contentType,
      weekNumber: Number(weekNumber),
      dayNumber: Number.isFinite(derivedDayNumber) ? derivedDayNumber : 0,
      assetId,
      strategyId,
      variantId,
    });
    const enrichedContent = {
      ...content,
      primary_cta_url: tracking.url,
      tracking_link: tracking.url,
      // Durable, in-content record of the creator identifiers carried by the
      // link. Lives in content_asset_versions.content_json, so attribution can
      // be recovered from the asset without relying on any in-memory tracker.
      creator_attribution: {
        asset_id: assetId,
        variant_id: variantId,
        creator_strategy_id: strategyId,
      },
    };

    const asset = await createContentAsset({
      campaignId,
      weekNumber: Number(weekNumber),
      day,
      platform: dayPlan.platform,
      content: enrichedContent,
      assetId,
    });

    return res.status(200).json(asset);
  } catch (error: any) {
    if (error instanceof PrePlanningRequiredError || error?.code === 'PRE_PLANNING_REQUIRED') {
      return res.status(412).json({ code: 'PRE_PLANNING_REQUIRED', message: error?.message });
    }
    return res.status(500).json({ error: error?.message || 'Failed to generate content' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_MANAGER]);
