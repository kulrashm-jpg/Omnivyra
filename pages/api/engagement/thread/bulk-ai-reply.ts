import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/engagement/thread/bulk-ai-reply
 * Generate AI suggestion and send top reply to selected threads.
 * Body: thread_ids, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getControls } from '../../../../backend/services/engagementGovernanceService';
import { bulkReplyThreads } from '../../../../backend/services/bulkEngagementService';
import { generateReplySuggestions } from '../../../../backend/services/engagementAiAssistantService';
import { getThreadActionability } from '../../../../backend/services/engagementThreadService';

const MAX_BATCH = 20;

type Body = {
  thread_ids?: string[];
  organization_id?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const rawThreadIds = Array.isArray(body.thread_ids) ? body.thread_ids : [];
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (rawThreadIds.length === 0) {
      return res.status(400).json({ error: 'thread_ids required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    const controls = await getControls(organizationId);
    if (!controls.bulk_reply_enabled) {
      return res.status(403).json({ error: 'Bulk reply is disabled for this organization' });
    }

    const batch = rawThreadIds.slice(0, MAX_BATCH);

    // ── F5: actionability pre-filter ────────────────────────────────────────
    //    A bulk operation multiplies a correctness error by the batch size, so
    //    non-actionable threads are removed BEFORE any AI call rather than
    //    being caught downstream. Two things follow from this:
    //      1. we never spend tokens drafting a reply to our own last message;
    //      2. `skipped` stays deterministic — a thread the client selected from
    //         a stale list is reported, not silently dropped.
    //
    //    The client's selection is advisory. This resolves ownership server-side
    //    from the canonical thread service, so a stale or hand-crafted
    //    thread_ids array cannot widen what the batch is allowed to touch.
    //    Cross-company ids resolve to no row and land in the same skip bucket.
    const actionabilityByThread = await getThreadActionability(organizationId, batch);
    const actionableIds = batch.filter((id) => actionabilityByThread.get(id) === true);
    const nonActionableIds = batch.filter((id) => actionabilityByThread.get(id) !== true);

    const getReplyText = async (
      _threadId: string,
      messageId: string,
      _platform: string
    ): Promise<string | null> => {
      try {
        // Second line of defence. The pre-filter above closes the window as far
        // as it can, but generation and dispatch are not atomic: a company reply
        // can land in between. generateReplySuggestions re-checks canonical
        // actionability and throws ThreadNotActionableError, which surfaces here
        // as a null reply and is counted as a skip by bulkReplyThreads.
        const result = await generateReplySuggestions(messageId, organizationId);
        const replies = result.suggested_replies ?? [];
        const top = replies[0]?.text?.trim();
        return top ?? null;
      } catch {
        return null;
      }
    };

    const { sent, skipped, errors, outcomes } = await bulkReplyThreads(
      organizationId,
      actionableIds,
      getReplyText,
      roleGate?.userId
    );

    return res.status(200).json({
      success: true,
      sent,
      // Existing shape preserved: `skipped` remains the single total the UI
      // already renders. Threads rejected for actionability are additive to it.
      skipped: skipped + nonActionableIds.length,
      // Pre-filter rejections PLUS any thread that turned non-actionable between
      // selection and dispatch — the send-time gate inside bulkReplyThreads.
      skipped_not_actionable: nonActionableIds.length + (outcomes?.skipped_not_actionable ?? 0),
      // §11: every attempted dispatch has an explainable terminal outcome.
      outcomes,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/bulk-ai-reply]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/thread/bulk-ai-reply' });
