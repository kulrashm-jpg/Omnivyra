
// Handle GET/POST requests to /api/campaigns
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { insertActivity, updateActivity, deleteActivity } from '../../../backend/services/executionPlannerService';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';
import { withApiObservability } from '../../../backend/observability';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { isContentArchitectSession } from '../../../backend/services/contentArchitectService';
import {
  DEFAULT_BUILD_MODE_SCRATCH,
  BUILD_MODES,
  normalizeCampaignTypes,
  normalizeCampaignWeights,
  validateCampaignWeights,
} from '../../../backend/services/campaignContextConfig';
import { buildHierarchicalPayload, type PrimaryCampaignTypeId } from '../../../lib/campaignTypeHierarchy';
import {
  getStoredStrategicThemeTitle,
  normalizeStoredStrategicTheme,
} from '../../../lib/recommendationStrategicCard';
import {
  Role,
  getCompanyRoleIncludingInvited,
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
  if (userId === 'content_architect') {
    return { userId, role: Role.COMPANY_ADMIN };
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
  let { role, error } = await getUserRole(userId, companyId);
  if (!role) {
    const fallbackRole = await getCompanyRoleIncludingInvited(userId, companyId);
    if (
      fallbackRole &&
      (fallbackRole === Role.COMPANY_ADMIN ||
        fallbackRole === Role.ADMIN ||
        fallbackRole === Role.SUPER_ADMIN) &&
      allowedRoles.includes(fallbackRole)
    ) {
      return { userId, role: fallbackRole };
    }
  }
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

// supabase singleton imported from shared client — no local re-creation

const validatePlaybookReference = async (playbookId: string, companyId: string) => {
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

// Marker written into daily_content_plans.format_notes so the FormatSelectionPage
// list reads back exactly the plans it created (and not week-structured planner
// rows for the same campaign), preserving the existing panel contract.
const CONTENT_PLAN_MARKER = 'content_plan_panel:true';
const CONTENT_PLAN_DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function contentPlanDateFor(day: unknown): string {
  const now = new Date();
  const target = CONTENT_PLAN_DAY_NAMES.indexOf(String(day ?? '').toLowerCase());
  if (target < 0) return now.toISOString().split('T')[0];
  const d = new Date(now);
  d.setDate(now.getDate() + ((target - now.getDay() + 7) % 7));
  return d.toISOString().split('T')[0];
}

function mapRowToContentPlan(row: Record<string, unknown>) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    dayOfWeek: row.day_of_week,
    date: row.date,
    platform: row.platform,
    contentType: row.content_type,
    topic: row.topic ?? undefined,
    content: row.content ?? '',
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    status: row.status ?? 'planned',
    aiGenerated: Boolean(row.ai_generated),
  };
}

async function handleContentPlan(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const method = req.method || 'GET';
  const data: Record<string, unknown> =
    req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};

  let campaignId =
    method === 'GET'
      ? String(req.query.campaignId ?? '').trim()
      : String(data.campaignId ?? '').trim();
  const existingRowId =
    method === 'DELETE'
      ? String(req.body?.id ?? '').trim()
      : String(data.id ?? '').trim();

  // Row-keyed ops (update/delete) may omit campaignId — resolve it from the row.
  if (!campaignId && existingRowId) {
    const { data: row } = await supabase
      .from('daily_content_plans')
      .select('campaign_id')
      .eq('id', existingRowId)
      .maybeSingle();
    campaignId = row?.campaign_id ? String(row.campaign_id) : '';
  }
  if (!campaignId) {
    res.status(400).json({ error: 'campaignId required' });
    return;
  }

  // Resolve the owning company from the campaign and enforce access server-side.
  const { data: companyRow } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  const company_id = companyRow?.company_id ? String(companyRow.company_id) : '';
  if (!company_id) {
    res.status(404).json({ error: 'Campaign company not found' });
    return;
  }
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  if (method === 'GET') {
    const { data: rows, error } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .ilike('format_notes', `%${CONTENT_PLAN_MARKER}%`)
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ error: 'Failed to load content plans' });
      return;
    }
    res.status(200).json({ plans: (rows || []).map((r) => mapRowToContentPlan(r as Record<string, unknown>)) });
    return;
  }

  if (method === 'DELETE') {
    if (!existingRowId) {
      res.status(400).json({ error: 'id required' });
      return;
    }
    await deleteActivity(existingRowId);
    res.status(200).json({ ok: true });
    return;
  }

  if (method === 'PUT') {
    if (!existingRowId) {
      res.status(400).json({ error: 'id required' });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (data.content != null) updates.content = String(data.content);
    if (data.topic != null) {
      updates.topic = String(data.topic);
      updates.title = String(data.topic);
    }
    if (data.platform != null) updates.platform = String(data.platform);
    if (data.contentType != null) updates.content_type = String(data.contentType);
    if (Array.isArray(data.hashtags)) updates.hashtags = data.hashtags;
    if (data.status != null) updates.status = String(data.status);
    if (data.dayOfWeek != null) updates.day_of_week = String(data.dayOfWeek);
    await updateActivity(existingRowId, updates, 'board');
    res.status(200).json({ ok: true });
    return;
  }

  // POST — create a new content plan via the canonical single-row writer.
  const dayOfWeek = String(data.dayOfWeek ?? 'monday');
  const row = {
    campaign_id: campaignId,
    week_number: 1,
    day_of_week: dayOfWeek,
    date: contentPlanDateFor(dayOfWeek),
    platform: String(data.platform ?? 'linkedin'),
    content_type: String(data.contentType ?? 'post'),
    title: String(data.topic ?? `${dayOfWeek} content`),
    content: String(data.content ?? ''),
    topic: data.topic != null ? String(data.topic) : null,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    status: String(data.status ?? 'planned'),
    ai_generated: Boolean(data.aiGenerated),
    format_notes: CONTENT_PLAN_MARKER,
  };
  const { id } = await insertActivity(row, 'AI');
  res.status(200).json({ plan: mapRowToContentPlan({ ...row, id }) });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Campaign content-plan CRUD (FormatSelectionPage). Campaign-scoped; the
    // owning company is resolved server-side so the caller carries no company
    // context, and all writes go through the canonical daily_content_plans
    // writer (executionPlannerService).
    const requestType =
      (req.query.type as string | undefined) ?? (req.body?.type as string | undefined);
    if (requestType === 'content-plan') {
      return await handleContentPlan(req, res);
    }

    const companyIdRaw =
      (req.query.companyId as string | undefined) ||
      (req.body?.companyId as string | undefined) ||
      (req.body?.company_id as string | undefined);
    const companyId = typeof companyIdRaw === 'string' ? companyIdRaw.trim() : companyIdRaw;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    let requester: { id: string; role: string } | null = null;
    if (isContentArchitectSession(req)) {
      requester = { id: 'content_architect', role: Role.COMPANY_ADMIN };
    } else {
      const auth = await getSupabaseUserFromRequest(req);
      if (auth.error || !auth.user) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      // Single RBAC resolution — checks platform admin, legacy admin, then company role
      const userId = auth.user.id;
      if (await isPlatformSuperAdmin(userId)) {
        requester = { id: userId, role: Role.SUPER_ADMIN };
      } else if (await isSuperAdmin(userId)) {
        requester = { id: userId, role: Role.SUPER_ADMIN };
      } else {
        let { role } = await getUserRole(userId, companyId);
        if (!role) {
          role = await getCompanyRoleIncludingInvited(userId, companyId);
        }
        if (!role) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
        const action = req.method === 'POST' ? 'CREATE_CAMPAIGN' : 'VIEW_CAMPAIGNS';
        if (!(await hasPermission(role, action))) {
          return res.status(403).json({ error: 'NOT_ALLOWED' });
        }
        requester = { id: userId, role };
      }
    }

    const fetchCampaignIdsForCompany = async () => {
      const { data, error } = await supabase
        .from('campaign_versions')
        .select('campaign_id')
        .eq('company_id', companyId);
      if (error) return { ids: [], error };
      const ids = Array.from(new Set((data || []).map((row: any) => row.campaign_id).filter(Boolean)));
      return { ids, error: null };
    };

    const campaignBelongsToCompany = async (campaignId: string) => {
      const { data, error } = await supabase
        .from('campaign_versions')
        .select('campaign_id')
        .eq('company_id', companyId)
        .eq('campaign_id', campaignId);
      if (error) return { ok: false, error };
      return { ok: (data || []).length > 0, error: null };
    };

    if (req.method === 'POST') {
      const campaignData = req.body;

      // Hybrid context mode + campaign types (scratch default: no_context)
      const buildModeRaw =
        campaignData.build_mode ?? campaignData.buildMode ?? DEFAULT_BUILD_MODE_SCRATCH;
      const build_mode = BUILD_MODES.includes(buildModeRaw)
        ? buildModeRaw
        : DEFAULT_BUILD_MODE_SCRATCH;
      const context_scope = Array.isArray(campaignData.context_scope ?? campaignData.contextScope)
        ? (campaignData.context_scope ?? campaignData.contextScope).filter((s: unknown) => typeof s === 'string')
        : null;
      const planningContext = campaignData.planning_context ?? campaignData.planningContext;
      const primaryFromPayload = planningContext?.primary_campaign_type ?? campaignData.primary_campaign_type;
      const secondaryFromPayload = planningContext?.secondary_campaign_types ?? campaignData.secondary_campaign_types;
      let campaign_types: string[];
      let campaign_weights: Record<string, number>;
      if (primaryFromPayload && typeof primaryFromPayload === 'string') {
        const secondary = Array.isArray(secondaryFromPayload) ? secondaryFromPayload : [];
        const payload = buildHierarchicalPayload(primaryFromPayload as PrimaryCampaignTypeId, secondary);
        campaign_types = payload.campaign_types;
        campaign_weights = payload.campaign_weights;
      } else {
        campaign_types = normalizeCampaignTypes(campaignData.campaign_types ?? campaignData.campaignTypes);
        campaign_weights = normalizeCampaignWeights(
          campaign_types,
          campaignData.campaign_weights ?? campaignData.campaignWeights
        );
      }
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


      // Insert campaign into database
      const { data: campaign, error } = await (supabase as any)
        .from('campaigns')
        .insert([campaignDataWithUser])
        .select()
        .single();

      if (error) {
        console.error('[campaigns] create failed', error.code, error.message);
        return res.status(500).json({ error: 'Failed to create campaign', details: error.message });
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
        const trimmedRecId = recommendation_id.trim();
        snapshotPayload.source_recommendation_id = trimmedRecId;
        snapshotPayload.metadata = {
          ...((snapshotPayload.metadata as Record<string, unknown>) ?? {}),
          recommendation_id: trimmedRecId,
        };
      }
      const source_strategic_theme = campaignData.source_strategic_theme ?? campaignData.sourceStrategicTheme;
      if (source_strategic_theme && typeof source_strategic_theme === 'object') {
        snapshotPayload.source_strategic_theme = source_strategic_theme;
      }
      const execution_config = campaignData.execution_config ?? campaignData.executionConfig;
      if (execution_config != null && typeof execution_config === 'object' && !Array.isArray(execution_config)) {
        snapshotPayload.execution_config = execution_config;
      }
      if (campaignData.mode != null && typeof campaignData.mode === 'string') {
        snapshotPayload.mode = campaignData.mode;
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

      const themeTopic =
        source_strategic_theme && typeof source_strategic_theme === 'object'
          ? ((source_strategic_theme as { topic?: string; title?: string; polished_title?: string }).topic ??
            (source_strategic_theme as { topic?: string; title?: string; polished_title?: string }).title ??
            (source_strategic_theme as { topic?: string; title?: string; polished_title?: string }).polished_title ??
            '')
          : '';
      if (themeTopic && typeof themeTopic === 'string' && themeTopic.trim()) {
        const { markThemeInUse } = await import('../../../backend/services/companyThemeStateService');
        markThemeInUse(companyId, (campaign as { id: string }).id, themeTopic).catch((err) =>
          console.warn('Campaign creation: markThemeInUse failed', err)
        );
      }

      console.log('CAMPAIGN_CREATED', { companyId, campaignId: campaign.id });
      // Canonical telemetry (append-only, fail-soft): a campaign was created.
      trackEvent({
        type: 'campaign.created',
        organizationId: companyId,
        actorId: UUID_RE.test(requester.id) ? requester.id : null,
        entityId: (campaign as { id: string }).id,
        metadata: typeof campaignData.mode === 'string' ? { mode: campaignData.mode } : {},
      });
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
        .select('*')
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
        const snap = (vRow.campaign_snapshot ?? {}) as { planning_context?: { content_capacity?: Record<string, { perWeek?: number; creationMethod?: string }> }; target_regions?: string[]; context_payload?: { formats?: string[]; platforms?: string[] }; execution_config?: Record<string, unknown> };
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
        if (snap.execution_config != null && typeof snap.execution_config === 'object' && !Array.isArray(snap.execution_config)) {
          pre.execution_config = snap.execution_config;
          const ec = snap.execution_config as Record<string, unknown>;
          // Promote tentative_start from execution_config when not already set (avoid re-asking)
          if (!pre.tentative_start && ec.tentative_start != null && String(ec.tentative_start).trim()) {
            pre.tentative_start = ec.tentative_start;
          }
          // Legacy: promote content_capacity when present (old Trend campaigns)
          if (!pre.content_capacity && ec.content_capacity != null && String(ec.content_capacity).trim()) {
            pre.content_capacity = ec.content_capacity;
            pre.weekly_capacity = ec.content_capacity;
          }
          if (!pre.available_content && ec.available_content != null && (typeof ec.available_content === 'string' ? String(ec.available_content).trim() : true)) {
            pre.available_content = ec.available_content;
          }
          // Promote additional GATHER_ORDER-keyed fields from execution_config
          if (!pre.action_expectation && ec.action_expectation != null && String(ec.action_expectation).trim()) {
            pre.action_expectation = ec.action_expectation;
          }
          if (!pre.key_messages && ec.key_messages != null && String(ec.key_messages).trim()) {
            pre.key_messages = ec.key_messages;
          }
          if (!pre.exclusive_campaigns && ec.exclusive_campaigns != null && String(ec.exclusive_campaigns).trim()) {
            pre.exclusive_campaigns = ec.exclusive_campaigns;
          }
          if (!pre.campaign_duration && ec.campaign_duration != null && Number(ec.campaign_duration) > 0) {
            pre.campaign_duration = ec.campaign_duration;
          }
          if (!pre.platforms && ec.platforms != null && String(ec.platforms).trim()) {
            pre.platforms = ec.platforms;
          }
        }
        const snapAny = snap as Record<string, unknown>;
        const wizardWs = snapAny.wizard_state as { cross_platform_sharing_enabled?: boolean } | undefined;
        if (!pre.cross_platform_sharing) {
          const cps = snapAny.cross_platform_sharing as { enabled?: boolean; mode?: string } | undefined;
          if (cps && typeof cps === 'object' && !Array.isArray(cps)) {
            pre.cross_platform_sharing = { enabled: cps.enabled !== false, mode: cps.mode === 'unique' ? 'unique' : 'shared' };
          } else if (wizardWs && 'cross_platform_sharing_enabled' in wizardWs) {
            const enabled = wizardWs.cross_platform_sharing_enabled !== false;
            pre.cross_platform_sharing = { enabled, mode: enabled ? 'shared' : 'unique' };
          }
        }
        if (Object.keys(pre).length > 0) prefilledPlanning = pre;
      }

      const snapshot = (versionRow ? (versionRow as { campaign_snapshot?: unknown }).campaign_snapshot : null) as {
        campaign?: Record<string, unknown>;
        target_regions?: string[] | null;
        context_payload?: Record<string, unknown> | null;
        metadata?: { source_opportunity_id?: string | null };
        source_opportunity_id?: string | null;
        source_recommendation_id?: string | null;
        source_strategic_theme?: Record<string, unknown> | null;
        wizard_state?: {
          wizard_state_version?: number;
          step?: number;
          questionnaire_answers?: Record<string, unknown>;
          planned_start_date?: string;
          pre_planning_result?: Record<string, unknown> | null;
          updated_at?: string;
        } | null;
      } | null;

      if (snapshot) {
        const theme =
          snapshot.source_strategic_theme && typeof snapshot.source_strategic_theme === 'object'
            ? snapshot.source_strategic_theme
            : null;
        const normalizedTheme = normalizeStoredStrategicTheme(theme);
        const topicFromCard = getStoredStrategicThemeTitle(theme);
        // Merge source_strategic_theme into context_payload so plan API receives full theme (progression, themes, duration) for week plan generation
        const basePayload = (snapshot.context_payload && typeof snapshot.context_payload === 'object') ? { ...snapshot.context_payload } : {};
        const mergedPayload = snapshot.source_strategic_theme && typeof snapshot.source_strategic_theme === 'object'
          ? { ...basePayload, ...snapshot.source_strategic_theme }
          : basePayload;
        if (normalizedTheme) {
          mergedPayload.primary_recommendations = normalizedTheme.blueprint.primary_recommendations;
          mergedPayload.supporting_recommendations = normalizedTheme.blueprint.supporting_recommendations;
          mergedPayload.progression_summary = normalizedTheme.blueprint.progression_summary;
          mergedPayload.duration_weeks = normalizedTheme.blueprint.duration_weeks;
        }
        recommendationContext = {
          target_regions: snapshot.target_regions ?? null,
          context_payload: Object.keys(mergedPayload).length > 0 ? mergedPayload : null,
          source_opportunity_id: snapshot.source_opportunity_id ?? snapshot.metadata?.source_opportunity_id ?? null,
          ...(topicFromCard ? { topic_from_card: topicFromCard } : {}),
        };
      }

      // Stored recommendation card (from Build Campaign Blueprint) — for Content Architect and campaign detail views
      const sourceRecommendationCard =
        snapshot?.source_recommendation_id || snapshot?.source_strategic_theme
          ? {
              source_recommendation_id: snapshot?.source_recommendation_id ?? null,
              source_strategic_theme: snapshot?.source_strategic_theme ?? null,
            }
          : undefined;

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
        sourceRecommendationCard: sourceRecommendationCard || undefined,
        mode: (snapshot as { mode?: string } | null)?.mode ?? undefined,
        wizardState: snapshot?.wizard_state ?? undefined,
      });
    } else if (type === 'goals' && campaignId) {
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
      // List campaigns for company — paginated
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const offset = (page - 1) * limit;

      let campaigns, error;
      let ids: string[] = [];
      try {
        const mappingResult = await fetchCampaignIdsForCompany();
        const { ids: fetchedIds, error: mappingError } = mappingResult;
        if (mappingError) {
          return res.status(500).json({ error: 'Failed to fetch campaign mappings', details: mappingError.message });
        }
        ids = fetchedIds ?? [];
        if (ids.length === 0) {
          return res.status(200).json({ success: true, campaigns: [], total: 0, page, limit });
        }
        const result = await supabase
          .from('campaigns')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        campaigns = result.data;
        error = result.error;
      } catch (fetchError) {
        console.error('[campaigns] list query error', fetchError instanceof Error ? fetchError.message : fetchError);
        return res.status(500).json({ error: 'Failed to fetch campaigns' });
      }

      if (error) {
        console.error('[campaigns] list supabase error', error.code, error.message);
        return res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
      }

      // Enrich name from theme when campaign name is generic "Campaign from themes" (so dashboard shows topic of the theme)
      // HARDEN-002: this used to fetch EVERY version's FULL campaign_snapshot
      // (a large JSONB: wizard state, week plans, …) for EVERY campaign, only
      // to read one theme title from the latest version of the handful of
      // campaigns with the generic name. Now it (a) runs only when a listed
      // campaign actually has the generic name, and (b) selects just the
      // snapshot's source_strategic_theme fragment. Response is identical.
      let themeNameByCampaignId: Record<string, string> = {};
      const genericNameIds = (campaigns || [])
        .filter((c: any) => String(c?.name || '').trim() === 'Campaign from themes')
        .map((c: any) => c.id)
        .filter(Boolean);
      if (genericNameIds.length > 0) {
        const { data: versionRows } = await supabase
          .from('campaign_versions')
          .select('campaign_id, version, source_strategic_theme:campaign_snapshot->source_strategic_theme')
          .eq('company_id', companyId)
          .in('campaign_id', genericNameIds)
          .order('version', { ascending: false });
        const latestByCampaign = new Map<string, unknown>();
        for (const row of versionRows || []) {
          const cid = (row as { campaign_id: string }).campaign_id;
          if (!cid || latestByCampaign.has(cid)) continue;
          latestByCampaign.set(cid, (row as { source_strategic_theme?: unknown }).source_strategic_theme ?? null);
        }
        for (const [cid, theme] of latestByCampaign) {
          const name = getStoredStrategicThemeTitle((theme ?? undefined) as Record<string, unknown> | undefined);
          if (name) themeNameByCampaignId[cid] = name;
        }
      }

      const campaignsWithThemeName = (campaigns || []).map((c: any) => {
        const base = mapCampaignPlaybook(c);
        const genericName = (base.name || '').trim() === 'Campaign from themes';
        const themeName = themeNameByCampaignId[c.id];
        if (genericName && themeName) {
          return { ...base, name: themeName };
        }
        return base;
      });

      return res.status(200).json({
        success: true,
        campaigns: campaignsWithThemeName,
        total: ids.length,
        page,
        limit,
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

// HARDEN-002: measurement only — HARDEN-001 API metrics (latency, payload,
// per-request DB stats). No caching here: this route is mutated from many
// pages, so even a short-lived private cache could serve a stale list.
export default withApiObservability(handler, '/api/campaigns');
