/**
 * POST /api/super-admin/threads/[threadId]/reconcile
 *
 * Trigger a single-row provider reconciliation pass.
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
import { reconcileRow } from '../../../../../backend/services/providerReconciliation/reconcileRow';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:threads:reconcile', 30, 60))) return;

  const rowId = String(req.query.threadId || '').trim();
  if (!rowId) {
    return res.status(400).json({ error: 'MISSING_ROW_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: `operator triggers reconciliation for row ${rowId}`,
    resourceId: rowId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  let result;
  try {
    result = await reconcileRow({ rowId });
  } catch (err) {
    logger.error('super_admin_reconcile_failed', {
      rowId,
      message: (err as Error).message,
    });
    return res.status(500).json({ error: 'RECONCILE_FAILED', details: (err as Error).message });
  }

  if (!result.ran) {
    return res.status(409).json({
      error: 'RECONCILE_SKIPPED',
      reason: result.reason ?? 'unknown',
      details: 'Row could not be reconciled (missing platform_post_id, missing social_account, or row not found).',
    });
  }

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_THREAD_RECONCILE',
    targetUserId: null,
    companyId: null,
    metadata: {
      capability: CONTENT_PUBLISH,
      row_id: rowId,
      platform: result.analysis?.platform ?? null,
      kind: result.analysis?.kind ?? null,
      lookup_confidence: result.analysis?.lookup?.confidence ?? null,
    },
  });

  return res.status(200).json({
    row_id: rowId,
    analysis: result.analysis,
  });
}
