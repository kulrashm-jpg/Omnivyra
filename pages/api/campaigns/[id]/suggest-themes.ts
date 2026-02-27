/**
 * POST /api/campaigns/[id]/suggest-themes
 * Generate recommended topics/themes for a campaign based on its context (like Trend flow).
 * Uses campaign name, description, types, planning context to build strategic payload.
 * Does NOT persist to opportunity_items.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { generateTrendOpportunities } from '../../../../backend/services/opportunityGenerators';
import type { StrategicPayload } from '../../../../backend/services/opportunityGenerators';
import type { FocusModule } from '../../../../backend/services/contextResolver';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getProfile } from '../../../../backend/services/companyProfileService';
import { getLatestCampaignVersionByCampaignId } from '../../../../backend/db/campaignVersionStore';

const FOCUS_MODULE_SET = new Set<FocusModule>([
  'TARGET_CUSTOMER',
  'PROBLEM_DOMAIN',
  'CAMPAIGN_PURPOSE',
  'OFFERINGS',
  'GEOGRAPHY',
  'PRICING',
]);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  try {
    const companyId = req.body?.companyId as string | undefined;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: id,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, name, description')
      .eq('id', id)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const version = await getLatestCampaignVersionByCampaignId(id);
    const snapshot = version?.campaign_snapshot ?? {};
    const planningContext = (snapshot?.planning_context ?? snapshot) as Record<string, unknown>;
    const ctx = planningContext as {
      context_mode?: string;
      target_regions?: string[];
      focused_modules?: string[];
      additional_direction?: string;
    };
    const buildMode = (version?.build_mode ?? (planningContext?.context_mode as string) ?? 'full_context') as string;
    const contextMode =
      buildMode === 'full_context'
        ? 'FULL'
        : buildMode === 'focused_context'
          ? 'FOCUSED'
          : 'NONE';
    const targetRegions =
      ctx?.target_regions ?? (planningContext?.target_regions as string[] | undefined) ?? [];
    const focusedModules = ctx?.focused_modules ?? [];
    const normalizedFocusedModules: FocusModule[] = Array.isArray(focusedModules)
      ? focusedModules
          .map((m) => String(m ?? '').trim().toUpperCase())
          .filter((m): m is FocusModule => FOCUS_MODULE_SET.has(m as FocusModule))
      : [];
    const additionalDirection = ctx?.additional_direction ?? (campaign.description as string) ?? '';

    const profile = await getProfile(companyId, { autoRefine: false });
    const companyContext: Record<string, unknown> = {};
    if (profile) {
      companyContext.brand_voice = (profile as any).brand_voice;
      companyContext.icp = (profile as any).ideal_customer_profile;
      companyContext.positioning = (profile as any).brand_positioning;
      companyContext.themes = (profile as any).content_themes ?? (profile as any).content_themes_list;
      companyContext.geography = (profile as any).geography;
    }

    const campaignTypes = (version?.campaign_types ?? (planningContext?.campaign_types as string[]) ?? ['brand_awareness']) as string[];
    const strategicText = [
      `Campaign: ${(campaign.name ?? '').trim() || 'Untitled campaign'}`,
      campaign.description ? `Focus: ${String(campaign.description).slice(0, 300)}` : '',
      campaignTypes.length ? `Campaign types: ${campaignTypes.join(', ')}` : '',
      additionalDirection ? `Additional direction: ${additionalDirection.slice(0, 200)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const payload: StrategicPayload = {
      context_mode: contextMode,
      company_context: companyContext,
      selected_offerings: [],
      selected_aspect: null,
      strategic_text: strategicText,
      regions: targetRegions.length > 0 ? targetRegions : undefined,
      focused_modules: normalizedFocusedModules.length > 0 ? normalizedFocusedModules : undefined,
      additional_direction: additionalDirection || undefined,
    };

    const themes = await generateTrendOpportunities(companyId, payload);

    return res.status(200).json({
      themes: themes.map((t, i) => ({
        id: `theme-${i}-${(t.title ?? '').replace(/\s+/g, '-').toLowerCase() || i}`,
        title: t.title ?? 'Strategic theme',
        summary: t.summary ?? null,
        payload: t.payload ?? {},
      })),
    });
  } catch (err: any) {
    console.error('[suggest-themes]', err);
    return res.status(500).json({
      error: err?.message ?? 'Failed to suggest themes',
    });
  }
}

export default handler;
