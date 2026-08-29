import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/governance/campaign-status
 * Campaign Governance Status — read-only visibility. Stage 10 Phase 4.
 * No constraint evaluation. No HorizonConstraintEvaluator.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import { getBlueprintBlockReason } from '../../../backend/services/campaignBlueprintService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';

const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  /*
   * GOVERNANCE-SEC-001 — this route had NO authentication and NO authorization,
   * and selected the campaign BY ID ALONE.
   *
   * An anonymous caller supplying any campaignId received that campaign's
   * governance state — priority, protection, blueprint status, duration lock,
   * preemption/cooldown — plus the latest governance event's raw `metadata`,
   * and the response even disclosed the owning companyId.
   *
   * Worse, the owning company was resolved as
   * `cvResult?.company_id ?? companyIdQuery`, so a CALLER-SUPPLIED companyId
   * could stand in as the campaign's tenant whenever no campaign_version
   * existed. A caller-supplied identifier is something to authorize, never
   * proof of authority, so that fallback is gone: ownership is now derived
   * only from server-owned data (campaign_versions.company_id, else
   * campaigns.company_id) and then authorized with requireCompanyAccess.
   *
   * Membership — not COMPANY_ADMIN — is the right boundary: ordinary members
   * read this on the campaign-details page. The 404 for an unresolvable
   * campaign is unchanged, preserving the existing no-existence-oracle shape.
   */
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Ownership resolution only — no governance data is read or returned
    // before requireCompanyAccess below has passed.
    const [campaignResult, cvResult] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, company_id, priority_level, is_protected, blueprint_status, duration_weeks, duration_locked, last_preempted_at, execution_status, auto_optimize_enabled')
        .eq('id', campaignId)
        .maybeSingle(),
      getLatestCampaignVersionByCampaignId(campaignId),
    ]);

    const campaign = (campaignResult as { data?: unknown })?.data as Record<string, unknown> | null;
    const companyId = cvResult?.company_id ?? ((campaign as any)?.company_id as string | undefined) ?? null;

    if (!companyId) {
      return res.status(404).json({ error: 'Campaign not found (no company mapping; include companyId query param if known)' });
    }

    if (!(await requireCompanyAccess(user.id, companyId, res))) return;

    const blockReason = await getBlueprintBlockReason(campaignId);

    // Campaign may exist only in campaign_versions (e.g. promoted-from-opportunity); return minimal governance so UI does not 404
    if (!campaign) {
      const { data: latestEvent } = await supabase
        .from('campaign_governance_events')
        .select('id, event_type, event_status, metadata, created_at')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const metadata = (latestEvent?.metadata as Record<string, any>) ?? {};
      const tradeOffFromMetadata = metadata.trade_off_options as any[] | undefined;
      const snapshot = cvResult?.campaign_snapshot as { campaign?: { duration_weeks?: number } } | undefined;
      const durationWeeks = snapshot?.campaign?.duration_weeks ?? null;
      return res.status(200).json({
        campaignId,
        companyId,
        governance: {
          priorityLevel: 'NORMAL',
          isProtected: false,
          blueprintStatus: 'ACTIVE',
          durationWeeks,
          durationLocked: false,
          lastPreemptedAt: null,
          cooldownActive: false,
          blueprintImmutable: blockReason === 'IMMUTABLE',
          blueprintFrozen: blockReason === 'FROZEN',
          autoOptimizeEnabled: false,
        },
        latestGovernanceEvent: latestEvent
          ? {
              eventType: latestEvent.event_type,
              eventStatus: latestEvent.event_status,
              createdAt: latestEvent.created_at,
              metadata,
            }
          : null,
        trade_off_options: Array.isArray(tradeOffFromMetadata) ? tradeOffFromMetadata : undefined,
      });
    }

    const lastPreemptedAt = (campaign as any).last_preempted_at
      ? String((campaign as any).last_preempted_at)
      : null;
    const cooldownActive = lastPreemptedAt
      ? Date.now() < new Date(lastPreemptedAt).getTime() + COOLDOWN_MS
      : false;

    const bpStatus = String((campaign as any).blueprint_status || 'ACTIVE').toUpperCase();
    const blueprintStatus =
      bpStatus === 'ACTIVE' || bpStatus === 'INVALIDATED' ? bpStatus : 'INVALIDATED';

    const { data: latestEvent } = await supabase
      .from('campaign_governance_events')
      .select('id, event_type, event_status, metadata, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const priorityLevel = String((campaign as any).priority_level || 'NORMAL').toUpperCase();
    const validPriority =
      ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(priorityLevel)
        ? priorityLevel
        : 'NORMAL';

    const metadata = (latestEvent?.metadata as Record<string, any>) ?? {};
    const tradeOffFromMetadata = metadata.trade_off_options as any[] | undefined;

    const response = {
      campaignId,
      companyId,
      governance: {
        priorityLevel: validPriority,
        isProtected: !!(campaign as any).is_protected,
        blueprintStatus,
        durationWeeks: (campaign as any).duration_weeks ?? null,
        durationLocked: !!(campaign as any).duration_locked,
        lastPreemptedAt,
        cooldownActive,
        blueprintImmutable: blockReason === 'IMMUTABLE',
        blueprintFrozen: blockReason === 'FROZEN',
        autoOptimizeEnabled: !!(campaign as any).auto_optimize_enabled,
      },
      latestGovernanceEvent: latestEvent
        ? {
            eventType: latestEvent.event_type,
            eventStatus: latestEvent.event_status,
            createdAt: latestEvent.created_at,
            metadata,
          }
        : null,
      trade_off_options: Array.isArray(tradeOffFromMetadata) ? tradeOffFromMetadata : undefined,
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('[governance/campaign-status]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/governance/campaign-status' });
