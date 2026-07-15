import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/threads/[threadId]/resume
 *
 * Operator-driven resume of a partially-published multi-row thread.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { logger } from '../../../../../backend/services/logger';
import { requireAdminRateLimit } from '../../../../../backend/services/requestAccessService';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { CONTENT_PUBLISH } from '../../../../../shared/contracts/security/SecurityCapabilities';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../../../backend/services/auditActorService';
import { resumeThreadPublish } from '../../../../../backend/services/threadRuntime/threadPublishOrchestrator';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:threads:resume', 20, 60))) return;

  const rootId = String(req.query.threadId || '').trim();
  if (!rootId) {
    return res.status(400).json({ error: 'MISSING_ROOT_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: `operator resumes thread ${rootId}`,
    resourceId: rootId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as {
    reason?: string;
  };
  const reasonRaw = String(body.reason ?? '').trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 500) : 'resume (no reason provided)';

  let result;
  try {
    result = await resumeThreadPublish({ root_scheduled_post_id: rootId });
  } catch (err) {
    logger.error('super_admin_thread_resume_failed', {
      rootId,
      message: (err as Error).message,
    });
    return res.status(500).json({ error: 'RESUME_FAILED', details: (err as Error).message });
  }

  if (result.status === 'NOT_FOUND') {
    return res.status(404).json({ error: 'THREAD_NOT_FOUND', details: result.message });
  }

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_THREAD_RESUME',
    targetUserId: null,
    companyId: null,
    metadata: {
      capability: CONTENT_PUBLISH,
      reason,
      root_id: rootId,
      outcome: result.status,
      total_nodes: 'total_nodes' in result ? result.total_nodes : null,
      published_count: 'published_count' in result ? result.published_count : null,
      failed_count: 'failed_count' in result ? result.failed_count : null,
      blocked_count: 'blocked_count' in result ? result.blocked_count : null,
      failed_at_position: 'failed_at_position' in result ? result.failed_at_position ?? null : null,
    },
  });

  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/threads/:threadId/resume' });
