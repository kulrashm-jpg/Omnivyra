import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { evaluateCampaignReadiness } from '../../../backend/services/campaignReadinessService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';

/** CAMPAIGN_DELETE holders (backend/security/capabilityRegistry.ts). */
const CAMPAIGN_DELETE_ROLES: Role[] = [Role.COMPANY_ADMIN, Role.SUPER_ADMIN];
/** Campaign authoring roles (rbacService PERMISSIONS.CREATE_CAMPAIGN). */
const CAMPAIGN_EDIT_ROLES: Role[] = [
  Role.COMPANY_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
];

const resolveCampaignCompanyId = async (campaignId: string) => {
  const { data: campRow } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  const direct = (campRow as { company_id?: string | null } | null)?.company_id;
  if (direct) return direct;
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.company_id) {
    return null;
  }
  return data.company_id as string;
};

const validatePlaybookReference = async (playbookId: string, companyId: string) => {
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  // SEC-91A (STEP 3AH-91, A6) — authenticate BEFORE touching the campaign. The
  // owner lookup below used to run first, so an anonymous caller got 404 for an
  // unknown id and 401 for a real one: an existence oracle on campaign ids
  // (the same one ROUTE-AUTH-001 removed from requireCampaignAccess).
  const viewer = await resolveUserContext(req);
  if (viewer.authenticated === false || !viewer.userId) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in again.',
      code: 'UNAUTHENTICATED',
    });
  }

  // SECURITY: derive the campaign's owning company from the resource itself,
  // never trust ?companyId= from query/body. Without this gate, a caller could
  // authenticate against their own company and then operate on another company's
  // campaign by guessing the path id.
  const campaignCompanyId = await resolveCampaignCompanyId(id);
  if (!campaignCompanyId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const tenantContext = await enforceCompanyAccess({
    req,
    res,
    companyId: campaignCompanyId,
  });
  if (!tenantContext) return;

  // SEC-91 W2-A (STEP 3AH-91, W2A-1) — same-company role gate for the writes.
  // Membership alone used to be enough, so a VIEW_ONLY member could rename,
  // pause/cancel/activate or permanently delete any campaign of the company.
  // Both role sets are the ones the repository already defines for the action:
  //   DELETE → CAMPAIGN_DELETE holders (capabilityRegistry: SUPER_ADMIN and
  //            COMPANY_ADMIN only), exactly what /api/admin/delete-campaign —
  //            the route the campaigns page uses to delete — enforces.
  //   PUT    → the campaign authoring roles (PERMISSIONS.CREATE_CAMPAIGN, the
  //            set the sibling POST /api/campaigns checks). VIEW_ONLY holds
  //            CAMPAIGN_VIEW only and has no access to the campaigns work-area
  //            (ROLE_ACCESS_MAP), so it stays read-only; every role that sees the
  //            pause/resume/cancel controls keeps them.
  // GET is unchanged (CAMPAIGN_VIEW is held by every role).
  if (req.method === 'DELETE' || req.method === 'PUT') {
    const roleGate = await enforceRole({
      req,
      res,
      companyId: campaignCompanyId,
      allowedRoles:
        req.method === 'DELETE'
          ? CAMPAIGN_DELETE_ROLES
          : CAMPAIGN_EDIT_ROLES,
    });
    if (!roleGate) return;
  }

  if (req.method === 'GET') {
    try {
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .select('id, name, description, status, current_stage, start_date, end_date, company_id')
        .eq('id', id)
        .maybeSingle();
      if (error || !campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      const out = { ...campaign, company_id: (campaign as any).company_id ?? campaignCompanyId };
      return res.status(200).json({ campaign: out });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch campaign' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { releaseThemeFromCampaign } = await import('../../../backend/services/companyThemeStateService');
      await releaseThemeFromCampaign(id);

      // Clean up ALL campaign-generated data before deleting the campaign.
      // Deletes all statuses — scheduled, draft, pending, published, failed —
      // because these posts were generated by the campaign pipeline.
      // Posts with campaign_id = NULL are user-created and never touched.
      const { error: spErr } = await supabase
        .from('scheduled_posts')
        .delete()
        .eq('campaign_id', id);
      if (spErr) console.warn('[delete-campaign] scheduled_posts cleanup error:', spErr.message);

      // calendar_events_index cleanup removed — the index (and its
      // scheduled_posts triggers) are being torn down; the calendar reads
      // activity-events directly.

      const relatedTables = [
        'daily_content_plans',
        'campaign_versions',
        'campaign_week_plan',
        'bolt_content_jobs',
        'bolt_execution_runs',
        'platform_content_slots',
        'campaign_goals',
        'campaign_metrics',
        'campaign_analytics',
        'campaign_execution_state',
      ];
      for (const table of relatedTables) {
        try {
          await supabase.from(table).delete().eq('campaign_id', id);
        } catch {
          // Table may not exist or have no rows — non-fatal
        }
      }

      // Delete campaign itself (scoped by company for defense-in-depth)
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', id)
        .eq('company_id', campaignCompanyId);

      if (error) {
        console.error('Error deleting campaign:', error);
        return res.status(500).json({ error: 'Failed to delete campaign' });
      }

      res.status(200).json({
        success: true,
        message: 'Campaign deleted successfully'
      });

    } catch (error) {
      console.error('Error in delete campaign API:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else if (req.method === 'PUT') {
    try {
      const {
        name,
        description,
        status,
        current_stage,
        start_date,
        end_date,
        virality_playbook_id,
        viralityPlaybookId,
        playbook,
        api_inputs,
      } = req.body;
      // Ensure playbook is reference-only: ignore any playbook payload fields.
      const playbookFieldProvided =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'virality_playbook_id') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'viralityPlaybookId');
      const resolvedPlaybookId = virality_playbook_id ?? viralityPlaybookId ?? null;
      if (playbookFieldProvided && resolvedPlaybookId) {
        const validation = await validatePlaybookReference(resolvedPlaybookId, campaignCompanyId);
        if (!validation.ok) {
          return res.status(400).json({ error: 'INVALID_PLAYBOOK_REFERENCE' });
        }
      }

      if (status === 'active') {
        const readiness = await evaluateCampaignReadiness(id);
        if (readiness.readiness_state !== 'ready') {
          return res.status(409).json({
            error: 'Campaign is not ready to activate',
            readiness: {
              readiness_percentage: readiness.readiness_percentage,
              readiness_state: readiness.readiness_state,
              blocking_issues: readiness.blocking_issues,
            },
          });
        }
      }

      // Update campaign (scoped by company for defense-in-depth)
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .update({
          name,
          description,
          status,
          current_stage,
          start_date,
          end_date,
          // Playbook reference only. It does NOT affect scheduling, publishing,
          // approvals, or content generation. Campaign behavior remains unchanged.
          ...(playbookFieldProvided && { virality_playbook_id: resolvedPlaybookId }),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('company_id', campaignCompanyId)
        .select()
        .single();

      if (error) {
        console.error('Error updating campaign:', error);
        return res.status(500).json({ error: 'Failed to update campaign' });
      }

      res.status(200).json({ 
        success: true, 
        campaign,
        message: 'Campaign updated successfully' 
      });

    } catch (error) {
      console.error('Error in update campaign API:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

export default __createApiRoute(handler, { route: '/api/campaigns/:id' });