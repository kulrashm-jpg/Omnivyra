// Handle GET requests to /api/campaigns
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
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
  if (data.company_id !== companyId) {
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
    const { data: roleRow, error: roleRowError } = await supabase
      .from('user_company_roles')
      .select('role, status')
      .eq('user_id', requester.id)
      .eq('company_id', companyId)
      .maybeSingle();
    console.log('RBAC_CHECK', {
      userId: requester.id,
      companyId,
      role: roleRow?.role || null,
      status: roleRow?.status || null,
    });
    if (roleRowError || !roleRow || roleRow.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const action = req.method === 'POST' ? 'CREATE_CAMPAIGN' : 'VIEW_CAMPAIGNS';
    if (!(await hasPermission(roleRow.role, action))) {
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
      
      // Add required user_id field for development and map field names
      const {
        startDate,
        endDate,
        goals,
        virality_playbook_id,
        viralityPlaybookId,
        playbook,
        api_inputs,
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
      const campaignDataWithUser = {
        ...campaignDataWithoutCamelCase,
        user_id: requester.id,
        start_date: startDate, // Map camelCase to snake_case
        end_date: endDate, // Map camelCase to snake_case
        status: 'pending_approval',
        // Playbook reference only. It does NOT affect scheduling, publishing,
        // approvals, or content generation. Campaign behavior remains unchanged.
        virality_playbook_id: resolvedPlaybookId,
      };

      console.log('Processed campaign data for database:', campaignDataWithUser);

      // Insert campaign into database
      const { data: campaign, error } = await supabase
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

      const { error: versionError } = await supabase
        .from('campaign_versions')
        .insert({
          company_id: companyId,
          campaign_id: campaign.id,
          campaign_snapshot: { campaign },
          status: campaign.status ?? 'draft',
          version: 1,
          created_at: new Date().toISOString(),
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

      const { data: campaign, error } = await supabase
        .from('campaigns')
        .select(
          `*,
           virality_playbooks(id, name, objective, platforms, content_types, company_id)`
        )
        .eq('id', campaignId)
        .or(`virality_playbook_id.is.null,virality_playbooks.company_id.eq.${companyId}`)
        .single();

      if (error) {
        return res.status(200).json({ campaign: null });
      }
      return res.status(200).json({ campaign: mapCampaignPlaybook(campaign) });
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
          .or(`virality_playbook_id.is.null,virality_playbooks.company_id.eq.${companyId}`)
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