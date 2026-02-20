// Handle GET requests to /api/campaigns
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  DEFAULT_BUILD_MODE_SCRATCH,
  BUILD_MODES,
  normalizeCampaignTypes,
  normalizeCampaignWeights,
  validateCampaignWeights,
} from '../../../backend/services/campaignContextConfig';
import {
  Role,
  getUserRole,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../backend/services/rbacService';

const requireCompanyRole = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string,
  userId: string,
  allowedRoles: Role[] = []
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const platformAdmin = await isPlatformSuperAdmin(userId);
  if (platformAdmin && allowedRoles.includes(Role.SUPER_ADMIN)) {
    return { userId, role: Role.SUPER_ADMIN };
  }
  const legacyAdmin = await isSuperAdmin(userId);
  if (legacyAdmin && allowedRoles.includes(Role.SUPER_ADMIN)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId, role: Role.SUPER_ADMIN };
  }
  const { role, error } = await getUserRole(userId, companyId);
  if (error === 'COMPANY_ACCESS_DENIED') {
    res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
    return null;
  }
  if (error || !role) {
    res.status(403).json({ error: 'NOT_ALLOWED' });
    return null;
  }
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId, role };
};

// Use service role key for server-side operations (bypasses RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create Supabase client - will be validated in each handler
let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
} else {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey,
    url: supabaseUrl ? 'set' : 'missing',
    key: supabaseKey ? 'set' : 'missing'
  });
}

const validatePlaybookReference = async (playbookId: string, companyId: string) => {
  if (!supabase) {
    return { ok: false, error: 'Server configuration error' };
  }
  const { data, error } = await supabase
    .from('virality_playbooks')
    .select('id, company_id, status')
    .eq('id', playbookId)
    .single();
  if (error || !data) {
    return { ok: false, error: 'INVALID_PLAYBOOK_REFERENCE' };
  }
  const playbook = data as { id: string; company_id: string; status: string };
  if (playbook.company_id !== companyId) {
    return { ok: false, error: 'INVALID_PLAYBOOK_REFERENCE' };
  }
  return { ok: true, error: null };
};

const mapCampaignPlaybook = (campaign: any) => ({
  ...campaign,
  // Playbooks are informational only:
  // - Do NOT drive scheduling
  // - Do NOT alter publishing logic
  // - Do NOT affect approvals
  // - Do NOT affect content generation
  playbook: campaign.virality_playbooks
    ? {
        id: campaign.virality_playbooks.id,
        name: campaign.virality_playbooks.name,
        objective: campaign.virality_playbooks.objective,
        platforms: campaign.virality_playbooks.platforms,
        content_types: campaign.virality_playbooks.content_types,
      }
    : null,
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const companyId =
      (req.query.companyId as string | undefined) ||
      (req.body?.companyId as string | undefined);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const { user: requester, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !requester) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const { data: roleData, error: roleRowError } = await supabase
      .from('user_company_roles')
      .select('role, status')
      .eq('user_id', requester.id)
      .eq('company_id', companyId)
      .maybeSingle();
    const roleRow = roleData as { role: string; status: string } | null;
    console.log('RBAC_CHECK', {
      userId: requester.id,
      companyId,
      role: roleRow?.role ?? null,
      status: roleRow?.status ?? null,
    });
    if (roleRowError) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    if (!roleRow) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    if (roleRow.status !== 'active') return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    const role = roleRow;
    const action = req.method === 'POST' ? 'CREATE_CAMPAIGN' : 'VIEW_CAMPAIGNS';
    if (!(await hasPermission(role.role, action))) {
      return res.status(403).json({ error: 'NOT_ALLOWED' });
    }

    const access = await requireCompanyRole(req, res, companyId, requester.id, [
      Role.SUPER_ADMIN,
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
    ]);
    if (!access) return;

    const fetchCampaignIdsForCompany = async () => {
      if (!supabase) {
        return { ids: [] as string[], error: { message: 'Missing Supabase configuration' } };
      }
      const { data, error } = await supabase
        .from('campaign_versions')
        .select('campaign_id')
        .eq('company_id', companyId);
      if (error) return { ids: [], error };
      const ids = Array.from(new Set((data || []).map((row: any) => row.campaign_id).filter(Boolean)));
      return { ids, error: null };
    };

    const campaignBelongsToCompany = async (campaignId: string) => {
      if (!supabase) {
        return { ok: false, error: { message: 'Missing Supabase configuration' } };
      }
      const { data, error } = await supabase
        .from('campaign_versions')
        .select('campaign_id')
        .eq('company_id', companyId)
        .eq('campaign_id', campaignId);
      if (error) return { ok: false, error };
      return { ok: (data || []).length > 0, error: null };
    };

    if (req.method === 'POST') {
      // Handle campaign creation
      // Validate Supabase configuration
      if (!supabase) {
        console.error('Missing Supabase configuration for POST:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseKey
        });
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        });
      }

      const campaignData = req.body;
      console.log('Received campaign data:', campaignData);

      // Hybrid context mode + campaign types (scratch default: no_context)
      const buildModeRaw =
        campaignData.build_mode ?? campaignData.buildMode ?? DEFAULT_BUILD_MODE_SCRATCH;
      const build_mode = BUILD_MODES.includes(buildModeRaw)
        ? buildModeRaw
        : DEFAULT_BUILD_MODE_SCRATCH;
      const context_scope = Array.isArray(campaignData.context_scope ?? campaignData.contextScope)
        ? (campaignData.context_scope ?? campaignData.contextScope).filter((s: unknown) => typeof s === 'string')
        : null;
      const campaign_types = normalizeCampaignTypes(campaignData.campaign_types ?? campaignData.campaignTypes);
      const campaign_weights = normalizeCampaignWeights(
        campaign_types,
        campaignData.campaign_weights ?? campaignData.campaignWeights
      );
      const weightValidation = validateCampaignWeights(campaign_types, campaign_weights);
      if (!weightValidation.valid) {
        return res.status(400).json({ error: weightValidation.error });
      }
      const MARKET_SCOPES = ['niche', 'regional', 'national', 'global'] as const;
      const market_scope_raw = campaignData.market_scope ?? campaignData.marketScope ?? 'niche';
      const market_scope = MARKET_SCOPES.includes(market_scope_raw) ? market_scope_raw : 'niche';
      const COMPANY_STAGES = ['early_stage', 'growth_stage', 'established'] as const;
      const company_stage_raw = campaignData.company_stage ?? campaignData.companyStage ?? 'early_stage';
      const company_stage = COMPANY_STAGES.includes(company_stage_raw) ? company_stage_raw : 'early_stage';
      const baseline_override = campaignData.baseline_override ?? campaignData.baselineOverride ?? null;
      
      // Add required user_id field for development and map field names
      const {
        startDate,
        endDate,
        goals,
        virality_playbook_id,
        viralityPlaybookId,
        playbook,
        api_inputs,
        buildMode,
        campaignTypes,
        campaignWeights,
        ...campaignDataWithoutCamelCase
      } = campaignData;
      // Ensure playbook is reference-only: ignore any playbook payload fields.
      const resolvedPlaybookId = virality_playbook_id || viralityPlaybookId || null;
      if (resolvedPlaybookId) {
        const validation = await validatePlaybookReference(resolvedPlaybookId, companyId);
        if (!validation.ok) {
          return res.status(400).json({ error: 'INVALID_PLAYBOOK_REFERENCE' });
        }
      }
      // campaigns table: only insert columns that exist (no companyId, build_mode, context_scope, etc.)
      const campaignDataWithUser: Record<string, unknown> = {
        id: campaignData.id ?? campaignDataWithoutCamelCase.id,
        name: campaignData.name ?? campaignDataWithoutCamelCase.name,
        description: campaignData.description ?? campaignDataWithoutCamelCase.description ?? null,
        user_id: requester.id,
        start_date: startDate ?? null,
        end_date: endDate ?? null,
        status: 'planning',
        current_stage: campaignData.current_stage ?? campaignDataWithoutCamelCase.current_stage ?? 'planning',
        virality_playbook_id: resolvedPlaybookId,
        duration_weeks: null,
        duration_locked: false,
        blueprint_status: null,
      };

      console.log('Processed campaign data for database:', campaignDataWithUser);

      // Insert campaign into database
      const { data: campaign, error } = await (supabase as any)
        .from('campaigns')
        .insert([campaignDataWithUser])
        .select()
        .single();

      if (error) {
        console.error('Error creating campaign:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return res.status(500).json({ 
          error: 'Failed to create campaign', 
          details: error.message,
          code: error.code,
          hint: error.hint
        });
      }

      if (!campaign) {
        return res.status(500).json({ error: 'Campaign creation did not return data' });
      }
      const planning_context = campaignData.planning_context ?? campaignData.planningContext ?? null;
      const source_opportunity_id =
        campaignData.source_opportunity_id ?? campaignData.sourceOpportunityId ?? null;
      const target_regions_raw = campaignData.target_regions ?? campaignData.targetRegions ?? null;
      const context_payload_raw = campaignData.context_payload ?? campaignData.contextPayload ?? null;
      const recommendation_id = campaignData.recommendation_id ?? campaignData.recommendationId ?? null;
      const snapshotPayload: Record<string, unknown> = { campaign };
      if (planning_context && typeof planning_context === 'object') {
        snapshotPayload.planning_context = planning_context;
      }
      if (typeof source_opportunity_id === 'string' && source_opportunity_id.trim()) {
        snapshotPayload.source_opportunity_id = source_opportunity_id.trim();
      }
      if (Array.isArray(target_regions_raw)) {
        const targetRegions = target_regions_raw
          .map((value: unknown) => String(value || '').trim().toUpperCase())
          .filter(Boolean);
        if (targetRegions.length > 0) {
          snapshotPayload.target_regions = targetRegions;
        }
      }
      if (context_payload_raw && typeof context_payload_raw === 'object') {
        snapshotPayload.context_payload = context_payload_raw;
      }
      if (typeof recommendation_id === 'string' && recommendation_id.trim()) {
        snapshotPayload.metadata = {
          recommendation_id: recommendation_id.trim(),
        };
      }
      const { error: versionError } = await (supabase as any)
        .from('campaign_versions')
        .insert({
          company_id: companyId,
          campaign_id: (campaign as { id: string }).id,
          campaign_snapshot: snapshotPayload,
          status: (campaign as { status?: string }).status ?? 'draft',
          version: 1,
          created_at: new Date().toISOString(),
          build_mode,
          context_scope: context_scope && context_scope.length > 0 ? context_scope : null,
          campaign_types,
          campaign_weights: campaign_weights,
          company_stage,
          market_scope,
          baseline_override: baseline_override && typeof baseline_override === 'object' ? baseline_override : null,
        });

      if (versionError) {
        console.error('Error creating campaign version mapping:', versionError);
        return res.status(500).json({
          error: 'Failed to create campaign mapping',
          details: versionError.message,
        });
      }

      console.log('CAMPAIGN_CREATED', { companyId, campaignId: campaign.id });
      return res.status(201).json({ 
        success: true,
        campaign,
        message: 'Campaign created successfully'
      });
    }
    
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { type, campaignId } = req.query;

    if (type === 'campaign' && campaignId) {
      // Validate Supabase configuration
      if (!supabase) {
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables.'
        });
      }
      
      // Get specific campaign
      const ownership = await campaignBelongsToCompany(campaignId as string);
      if (ownership.error) {
        return res.status(500).json({ error: 'Failed to verify campaign ownership' });
      }
      if (!ownership.ok) {
        return res.status(403).json({
          error: 'CAMPAIGN_NOT_IN_COMPANY',
          code: 'CAMPAIGN_NOT_IN_COMPANY',
        });
      }

      let campaign: any = null;
      const { data: campaignRow, error } = await supabase
        .from('campaigns')
        .select(
          `*,
           virality_playbooks(id, name, objective, platforms, content_types, company_id)`
        )
        .eq('id', campaignId)
        .maybeSingle();

      if (error) {
        console.warn('Campaigns table fetch failed, trying campaign_versions fallback:', error.message);
      } else if (campaignRow) {
        campaign = campaignRow;
      }

      // Always fetch campaign_versions for recommendation context and prefilled planning
      let recommendationContext: { target_regions?: string[] | null; context_payload?: Record<string, unknown> | null; source_opportunity_id?: string | null } | null = null;
      let prefilledPlanning: Record<string, unknown> | null = null;
      const { data: versionRow } = await supabase
        .from('campaign_versions')
        .select('campaign_snapshot, campaign_types, campaign_weights')
        .eq('company_id', companyId)
        .eq('campaign_id', campaignId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const vRow = versionRow as { campaign_snapshot?: unknown; campaign_types?: string[]; campaign_weights?: Record<string, number> } | null;
      if (campaign && vRow) {
        const snap = (vRow.campaign_snapshot ?? {}) as { planning_context?: { content_capacity?: Record<string, { perWeek?: number; creationMethod?: string }> }; target_regions?: string[]; context_payload?: { formats?: string[]; platforms?: string[] } };
        const pre: Record<string, unknown> = {};
        if (campaign.start_date) pre.tentative_start = campaign.start_date;
        if (campaign.duration_weeks != null) pre.campaign_duration = campaign.duration_weeks;
        if (vRow.campaign_types?.length) pre.campaign_types = vRow.campaign_types.map((t) => t.replace(/_/g, ' ')).join(', ');
        if (snap.planning_context?.content_capacity) {
          const cap = snap.planning_context.content_capacity;
          const parts: string[] = [];
          for (const [fmt, val] of Object.entries(cap)) {
            if (val && typeof val === 'object' && 'perWeek' in val) {
              const p = val as { perWeek?: number; creationMethod?: string };
              parts.push(`${fmt}: ${p.perWeek ?? 0}/week`);
            }
          }
          if (parts.length) pre.content_capacity = parts.join('; ');
        }
        const payload = snap.context_payload;
        if (payload?.platforms?.length) pre.platforms = payload.platforms.join(', ');
        if (snap.target_regions?.length) pre.target_regions = snap.target_regions.join(', ');
        if (campaign.description) pre.theme_or_description = String(campaign.description).slice(0, 300);
        if (Object.keys(pre).length > 0) prefilledPlanning = pre;
      }

      const snapshot = (versionRow ? (versionRow as { campaign_snapshot?: unknown }).campaign_snapshot : null) as {
        campaign?: Record<string, unknown>;
        target_regions?: string[] | null;
        context_payload?: Record<string, unknown> | null;
        metadata?: { source_opportunity_id?: string | null };
        source_opportunity_id?: string | null;
      } | null;

      if (snapshot) {
        recommendationContext = {
          target_regions: snapshot.target_regions ?? null,
          context_payload: snapshot.context_payload ?? null,
          source_opportunity_id: snapshot.source_opportunity_id ?? snapshot.metadata?.source_opportunity_id ?? null,
        };
      }

      // Fallback for promoted-from-opportunity campaigns: get campaign from campaign_versions.campaign_snapshot
      if (!campaign && ownership.ok && snapshot?.campaign) {
        campaign = {
          ...snapshot.campaign,
          id: campaignId,
          weekly_themes: (snapshot.campaign as any).weekly_themes ?? [],
        };
      }

      if (!campaign) {
        return res.status(200).json({ campaign: null });
      }
      return res.status(200).json({
        campaign: mapCampaignPlaybook(campaign),
        recommendationContext: recommendationContext || undefined,
        prefilledPlanning: prefilledPlanning || undefined,
      });
    } else if (type === 'goals' && campaignId) {
      // Validate Supabase configuration
      if (!supabase) {
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables.'
        });
      }
      
      // Get campaign goals
      const ownership = await campaignBelongsToCompany(campaignId as string);
      if (ownership.error) {
        return res.status(500).json({ error: 'Failed to verify campaign ownership' });
      }
      if (!ownership.ok) {
        return res.status(403).json({
          error: 'CAMPAIGN_NOT_IN_COMPANY',
          code: 'CAMPAIGN_NOT_IN_COMPANY',
        });
      }

      const { data: goals, error } = await supabase
        .from('campaign_goals')
        .select('*')
        .eq('campaign_id', campaignId);

      if (error) {
        console.log('Goals not found, returning empty array:', campaignId);
        return res.status(200).json({ goals: [] });
      }

      return res.status(200).json({ goals });
    } else {
      // Validate Supabase configuration
      if (!supabase) {
        console.error('Missing Supabase configuration:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseKey
        });
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        });
      }

      // GetAll campaigns for company
      let campaigns, error;
      try {
        const { ids, error: mappingError } = await fetchCampaignIdsForCompany();
        if (mappingError) {
          return res.status(500).json({
            error: 'Failed to fetch campaign mappings',
            details: mappingError.message,
          });
        }
        if (ids.length === 0) {
          return res.status(200).json({
            success: true,
            campaigns: [],
          });
        }
        const result = await supabase
          .from('campaigns')
          .select(
            `*,
             virality_playbooks(id, name, objective, platforms, content_types, company_id)`
          )
          .in('id', ids)
          .order('created_at', { ascending: false });
        campaigns = result.data;
        error = result.error;
      } catch (fetchError) {
        console.error('Supabase query failed with exception:', {
          error: fetchError,
          message: fetchError instanceof Error ? fetchError.message : String(fetchError),
          stack: fetchError instanceof Error ? fetchError.stack : undefined
        });
        return res.status(500).json({ 
          error: 'Failed to fetch campaigns',
          details: fetchError instanceof Error ? fetchError.message : 'Unknown error during database query',
          type: 'query_exception'
        });
      }

      if (error) {
        console.error('Error fetching campaigns:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return res.status(500).json({ 
          error: 'Failed to fetch campaigns',
          details: error.message,
          code: error.code
        });
      }

      console.log(`API: Found ${campaigns?.length || 0} campaigns:`, campaigns?.map(c => ({ id: c.id, name: c.name, status: c.status })));
      
      return res.status(200).json({ 
        success: true,
        campaigns: (campaigns || []).map(mapCampaignPlaybook)
      });
    }
  } catch (error) {
    console.error('Error in campaigns API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: errorStack })
    });
  }
}

export default handler;