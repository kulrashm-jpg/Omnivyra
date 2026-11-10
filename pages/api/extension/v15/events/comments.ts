import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/v15/events/comments (EXTENSION-1.5.0-CONTRACT.md §5.1).
 * Signed, version >= 1.5.0, and the result of a live li.collect.own_post_comments
 * command dispatched to this session. Only comments on posts authored by the
 * bound member are stored (own content, E-3); everything else is counted and
 * dropped. Writes go through the same canonical-store logic as the 1.4 route.
 * OFF until the owner lifts R-3 for 1.5 (EXTENSION_V15_COMMAND_INGESTION_ENABLED).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { verifyResultCommand, finishCommand } from '@/backend/services/extension15';
import { mapOwnPostComments } from '@/backend/services/extension15/ownContent';
import {
  persistExtensionComments,
  type IncomingComment,
  type IncomingPost,
} from '@/backend/services/extensionCommentIngestion';
import {
  EXTENSION_V15_COMMAND_INGESTION_ENABLED,
  refuseSuspendedIngestion,
} from '@/backend/services/extensionIngestionSuspension';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!EXTENSION_V15_COMMAND_INGESTION_ENABLED) return refuseSuspendedIngestion(res);
  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const gate = checkExtensionVersion(body.extension_version);
  if (gate.ok !== true) return res.status(gate.status).json({ success: false, error: gate.code, minimum: gate.minimum });
  const cmd = await verifyResultCommand(auth.session, body.command_id, 'li.collect.own_post_comments');
  if (cmd.ok !== true) return res.status(cmd.status).json({ success: false, error: cmd.code });
  const mapped = mapOwnPostComments(body.items, cmd.actingMemberUrn, cmd.params);
  if (mapped.ok !== true) return res.status(mapped.status).json({ success: false, error: mapped.code });
  const result = await persistExtensionComments(auth.session.orgId, 'linkedin', {
    platform: 'linkedin',
    posts: mapped.posts as IncomingPost[],
    comments: mapped.comments as IncomingComment[],
  });
  const ok = result.status === 200;
  await finishCommand(auth.session, body.command_id as string, ok ? 'completed' : 'failed', {
    accepted: mapped.comments.length,
    rejected_not_own: mapped.rejectedNotOwn,
    rejected_invalid: mapped.rejectedInvalid,
  });
  return res.status(result.status).json({
    ...result.payload,
    rejected_not_own: mapped.rejectedNotOwn,
    rejected_invalid: mapped.rejectedInvalid,
  });
}

export default __createApiRoute(handler, { route: '/api/extension/v15/events/comments' });
