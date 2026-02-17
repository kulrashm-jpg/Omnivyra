/**
 * GET /api/governance/campaign-status
 * Campaign Governance Status — read-only visibility. Stage 10 Phase 4.
 * No constraint evaluation. No HorizonConstraintEvaluator.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import { getBlueprintBlockReason } from '../../../backend/services/campaignBlueprintService';

const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  try {
    const [campaignResult, cvResult, blockReason] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, priority_level, is_protected, blueprint_status, duration_weeks, duration_locked, last_preempted_at, execution_status, auto_optimize_enabled')
        .eq('id', campaignId)
        .maybeSingle(),
      getLatestCampaignVersionByCampaignId(campaignId),
      getBlueprintBlockReason(campaignId),
    ]);

    const campaign = (campaignResult as { data?: unknown })?.data;
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const companyId = cvResult?.company_id ?? null;
    if (!companyId) {
      return res.status(404).json({ error: 'Campaign not found' });
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
