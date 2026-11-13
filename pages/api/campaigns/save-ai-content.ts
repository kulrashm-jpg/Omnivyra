import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignTenantAccess } from '../../../backend/security/TenantGuard';
import { tenantChildTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, aiContent, timestamp, provider } = req.body;

    if (!campaignId || !aiContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const access = await requireCampaignTenantAccess(req, res, campaignId);
    if (!access) return;

    const threadId = `save_${campaignId}_${Date.now()}`;
    const messagesPayload = [
      {
        role: 'assistant',
        content: aiContent,
        timestamp: timestamp || new Date().toISOString(),
        provider: provider || 'unknown'
      }
    ];

    // Save AI content to database.
    // Some environments have extended columns (thread_type/status), others do not.
    const baseInsertPayload: Record<string, unknown> = {
      id: threadId,
      campaign_id: campaignId,
      messages: messagesPayload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const extendedInsertPayload: Record<string, unknown> = {
      ...baseInsertPayload,
      thread_type: 'content_planning',
      status: 'saved_for_planning',
    };
    // S2 tenant seam: ai_threads is a child of campaigns. The handle is built from the company
    // requireCampaignTenantAccess resolved and authorized (access.organizationId) and the campaign it checked; it is
    // made (proving the campaign is in that tenant) before the first write, so a refusal writes nothing.
    const threadsTable = await tenantChildTable(
      'ai_threads',
      tenantContextFor({ userId: access.userId }, access.organizationId),
      campaignId,
    );
    let { data, error } = await threadsTable
      .insert(extendedInsertPayload as any)
      .select();

    const message = String(error?.message || '');
    const details = String(error?.details || '');
    const isMissingColumnError =
      !!error &&
      (message.toLowerCase().includes('column') || details.toLowerCase().includes('column')) &&
      (message.includes('thread_type') ||
        message.includes('saved_for_planning') ||
        details.includes('thread_type') ||
        details.includes('saved_for_planning'));

    if (isMissingColumnError) {
      const retry = await threadsTable
        .insert(baseInsertPayload as any)
        .select();
      data = retry.data as any;
      error = retry.error as any;
    }

    if (error) {
      console.error('Error saving AI content:', error);
      return res.status(500).json({
        error: 'Failed to save AI content',
        message: error.message,
        details: error.details,
      });
    }

    // Also save to content_plans table for easy access (platform required by base schema)
    const { error: contentError } = await supabase
      .from('content_plans')
      .insert({
        campaign_id: campaignId,
        platform: 'multi',
        content_type: 'ai_generated_plan',
        description: aiContent,
        status: 'planned',
        ai_generated: true,
        created_at: new Date().toISOString()
      } as Record<string, unknown>);

    if (contentError) {
      console.error('Error saving to content_plans:', contentError);
      // Don't fail the request, just log the error
    }

    res.status(200).json({ 
      success: true, 
      message: 'AI content saved successfully',
      data: data?.[0]
    });

  } catch (error) {
    if (error instanceof TenantSeamError) {
      return res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    }
    console.error('Error in save-ai-content API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/save-ai-content' });
