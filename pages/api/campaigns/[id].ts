import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient.js';
import { evaluateCampaignReadiness } from '../../../backend/services/campaignReadinessService';
import { ALL_ROLES } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

const resolveCampaignCompanyId = async (campaignId: string) => {
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

  if (req.method === 'DELETE') {
    try {
      // Delete campaign and all related data
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', id);

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
        const companyId = await resolveCampaignCompanyId(id);
        if (!companyId) {
          return res.status(400).json({ error: 'companyId required' });
        }
        const validation = await validatePlaybookReference(resolvedPlaybookId, companyId);
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

      // Update campaign
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

export default withRBAC(handler, ALL_ROLES);