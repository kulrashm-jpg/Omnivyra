import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/publish/reconcile
 *
 * Operator reconciliation of a post (or thread node) whose publish outcome is
 * uncertain — see backend/services/publishOutcomeReconciliation.ts. Body:
 *   { scheduled_post_id, resolution: 'published' | 'not_published',
 *     platform_post_id?, post_url?, note }
 * 'published' requires the platform post id seen on the platform. Nothing is
 * published here; a retry (scheduler retry) or thread resume is a separate,
 * deliberate step after 'not_published'.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { logger } from '../../../../backend/services/logger';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { requirePlatformWriteAuthority } from '../../../../backend/security/platformWriteAuthority';
import { PUBLISH_RECOVERY_MANAGE } from '../../../../shared/contracts/security/SecurityCapabilities';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../../backend/services/auditActorService';
import {
  reconcileUncertainPublish,
  type PublishReconciliationResolution,
} from '../../../../backend/services/publishOutcomeReconciliation';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:publish:reconcile', 20, 60))) return;

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as {
    scheduled_post_id?: string;
    resolution?: string;
    platform_post_id?: string;
    post_url?: string;
    note?: string;
  };
  const scheduledPostId = String(body.scheduled_post_id ?? '').trim();
  if (!scheduledPostId) {
    return res.status(400).json({ error: 'MISSING_SCHEDULED_POST_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: PUBLISH_RECOVERY_MANAGE,
    reason: `operator reconciles uncertain publish ${scheduledPostId}`,
    resourceId: scheduledPostId,
  });
  if (guard.ok !== true) return;
  // A WRITE: the dashboard-view capability alone (also held by bridge
  // principals and by direct view grants) is not enough — see
  // backend/security/platformWriteAuthority.ts. Nothing below runs otherwise.
  if (!requirePlatformWriteAuthority(res, guard.principal, 'publish.reconcile')) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  let result;
  try {
    result = await reconcileUncertainPublish({
      scheduledPostId,
      resolution: body.resolution as PublishReconciliationResolution,
      platformPostId: body.platform_post_id ?? null,
      postUrl: body.post_url ?? null,
      actor: guard.principal,
      note: String(body.note ?? ''),
    });
  } catch (err) {
    logger.error('super_admin_publish_reconcile_failed', { scheduledPostId, message: (err as Error).message });
    return res.status(500).json({ error: 'RECONCILE_FAILED', details: (err as Error).message });
  }

  switch (result.status) {
    case 'forbidden':
      return res.status(403).json({ error: 'Forbidden', code: 'PLATFORM_SUPER_ADMIN_REQUIRED', operation: 'publish.reconcile' });
    case 'invalid':
      return res.status(400).json({ error: 'INVALID_RECONCILIATION', details: result.reason });
    case 'not_found':
      return res.status(404).json({ error: 'POST_NOT_FOUND' });
    case 'not_uncertain':
      return res.status(409).json({
        error: 'OUTCOME_NOT_UNCERTAIN',
        current_status: result.current_status,
        current_error_code: result.current_error_code,
      });
    case 'changed':
      return res.status(409).json({ error: 'POST_CHANGED_CONCURRENTLY' });
    default:
      break;
  }

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_PUBLISH_RECONCILE',
    targetUserId: null,
    companyId: null,
    metadata: {
      capability: PUBLISH_RECOVERY_MANAGE,
      scheduled_post_id: scheduledPostId,
      resolution: result.resolution,
      previous_error_code: result.previous_error_code,
      platform_post_id: result.resolution === 'published' ? String(body.platform_post_id ?? '').trim() : null,
      note: String(body.note ?? '').trim().slice(0, 500),
    },
  });

  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/publish/reconcile' });
