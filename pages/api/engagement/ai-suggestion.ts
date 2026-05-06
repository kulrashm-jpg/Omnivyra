import { withContract } from '@/lib/api/withContract';
/**
 * POST /api/engagement/ai-suggestion
 *
 * Thin transport over backend/services/aiSuggestionTrackingService so the
 * inbox UI can record suggestion lifecycle events directly.
 *
 * Body shape (discriminated by `event`):
 *   { event: 'shown',    organization_id, platform, action_type, content, model, target_id?, metadata?, correlation_id? }
 *   { event: 'accepted', suggestion_id?, correlation_id?, action_id? }
 *   { event: 'rejected', suggestion_id?, correlation_id?, reason? }
 *
 * On `shown` returns the created { suggestion_id, correlation_id, ai_draft_id }
 * so the caller can pass ai_draft_id + ai_generated=true into
 * /api/engagement/reply. ai_draft_id is created when a thread can be
 * resolved from target_id (engagement signal); otherwise null.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  recordSuggestionShown,
  recordSuggestionAccepted,
  recordSuggestionRejected,
} from '../../../backend/services/aiSuggestionTrackingService';

// NOTE: ai_message_drafts row creation moved to /api/engagement/generate-response
// (the generation endpoint, where the text is produced). This endpoint is now
// analytics-only — it records suggestion_shown / accepted / rejected events
// but does NOT create drafts. Closing the bypass at the generation source
// guarantees AI text always has a draft attached before it can reach the UI.

type Body =
  | {
      event: 'shown';
      organization_id?: string;
      platform?: string;
      action_type?: string;
      content?: string;
      model?: string;
      target_id?: string;
      correlation_id?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      event: 'accepted';
      suggestion_id?: string;
      correlation_id?: string;
      action_id?: string | null;
    }
  | {
      event: 'rejected';
      suggestion_id?: string;
      correlation_id?: string;
      reason?: string;
    };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;

    if (body.event === 'shown') {
      const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
      if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
      if (!body.platform) return res.status(400).json({ error: 'platform required' });
      if (!body.action_type) return res.status(400).json({ error: 'action_type required' });

      const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
      if (!access) return;

      const record = await recordSuggestionShown({
        organization_id: organizationId,
        platform: body.platform,
        action_type: body.action_type,
        content: body.content ?? null,
        model: body.model ?? null,
        target_id: body.target_id ?? null,
        metadata: body.metadata ?? null,
        execution_correlation_id: body.correlation_id ?? null,
      });

      if (!record) {
        return res.status(500).json({ error: 'SUGGESTION_SHOWN_INSERT_FAILED' });
      }

      return res.status(200).json({
        success: true,
        suggestion_id: record.id,
        correlation_id: record.execution_correlation_id,
      });
    }

    if (body.event === 'accepted' || body.event === 'rejected') {
      if (!body.suggestion_id && !body.correlation_id) {
        return res.status(400).json({ error: 'suggestion_id or correlation_id required' });
      }
      // No separate enforceCompanyAccess here: we resolve by suggestion id
      // and the DB RLS policy restricts to service_role. The service
      // helpers never return the row itself, just a boolean — keeping
      // this endpoint a pure write with no tenant leak.
      const ok = body.event === 'accepted'
        ? await recordSuggestionAccepted({
            suggestion_id: body.suggestion_id,
            correlation_id: body.correlation_id,
            action_id: body.action_id ?? null,
          })
        : await recordSuggestionRejected({
            suggestion_id: body.suggestion_id,
            correlation_id: body.correlation_id,
            reason: body.reason,
          });
      return res.status(200).json({ success: ok });
    }

    return res.status(400).json({ error: 'invalid event; expected shown | accepted | rejected' });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to record suggestion';
    console.error('[engagement/ai-suggestion]', msg);
    return res.status(500).json({ error: msg });
  }
}

export default withContract(handler);
