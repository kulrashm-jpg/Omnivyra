import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/engagement/crm-export
 *
 * Records an operator's intent to export an engagement signal to the
 * organization's CRM. This endpoint is intentionally minimal: it
 * validates access, writes an audit row, and returns a queued
 * acknowledgement. Downstream CRM integrations consume the audit trail;
 * there is no inline CRM push here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { logAuditEvent } from '../../../backend/services/auditLoggingService';
import { resolveCampaignOwnership } from '../../../backend/services/campaignOwnershipService';

type CrmExportBody = {
  organization_id?: string;
  signal_id?: string;
  platform?: string;
  author?: string | null;
  content?: string | null;
  conversation_url?: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as CrmExportBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const signalId = (body.signal_id ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!signalId) {
      return res.status(400).json({ error: 'signal_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Tenant-scoped existence check: the signal must belong to a campaign
    // whose company is the caller's authorized organization.
    const { data: signal } = await supabase
      .from('campaign_activity_engagement_signals')
      .select('id, campaign_id, platform, author, content, conversation_url')
      .eq('id', signalId)
      .maybeSingle();

    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    // 3AH-117 (WS-E) — the campaign's owner is the canonical resolver's answer
    // over EVERY owner record (never one version row). Only a campaign OWNED by
    // the authorized organization may be exported; a signal without a campaign,
    // an unowned, conflicting or missing campaign all get the existing 403.
    const ownership = await resolveCampaignOwnership(signal.campaign_id);
    if (ownership.status === 'LOOKUP_FAILED') {
      return res.status(503).json({
        error: 'Campaign ownership check is temporarily unavailable. Please try again.',
        code: 'CAMPAIGN_LOOKUP_ERROR',
        retryable: true,
      });
    }
    if (ownership.status !== 'OWNED' || ownership.companyId !== String(organizationId)) {
      return res.status(403).json({ error: 'Signal does not belong to caller organization' });
    }

    await logAuditEvent({
      operation: 'INSERT',
      table: 'engagement_crm_export',
      companyId: organizationId,
      userId: (user as { userId?: string })?.userId ?? 'unknown',
      success: true,
      metadata: {
        signal_id: signalId,
        platform: signal.platform ?? body.platform ?? null,
        author: signal.author ?? body.author ?? null,
        conversation_url: signal.conversation_url ?? body.conversation_url ?? null,
        content_preview: (signal.content ?? body.content ?? '')?.toString().slice(0, 280),
      },
    }).catch((err) => {
      console.warn('[engagement/crm-export] audit failed:', (err as Error)?.message);
    });

    return res.status(200).json({
      success: true,
      status: 'queued',
      message: 'Export queued. Available in audit_logs for downstream CRM integrations.',
      signal_id: signalId,
    });
  } catch (err) {
    console.error('[engagement/crm-export]', (err as Error)?.name ?? 'error');
    return res.status(500).json({ error: 'Failed to export to CRM' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/crm-export' });
