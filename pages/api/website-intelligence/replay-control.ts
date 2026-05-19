import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  executeReplay,
  listDeadLetters,
  type ReplayTarget,
} from '../../../backend/services/intelligence/replayOrchestrationService';
import {
  listReplayPayloads,
  listQuarantine,
} from '../../../backend/services/intelligence/rawReplayCaptureService';
import { listLeadReplayReceipts } from '../../../backend/services/intelligence/leadReplayReceiptService';

const TARGETS: ReplayTarget[] = ['api_base_rediscovery', 'connection_revalidate', 'normalization'];

/**
 * Replay & recovery control.
 *   GET  → list dead-letter records (append-only audit-backed).
 *   POST → execute an idempotent, lock-throttled, deduped replay.
 * RBAC-gated, tenant-scoped. Never mutates live ingestion paths.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'GET') {
    const [deadLetters, replayPayloads, quarantine, receipts] = await Promise.all([
      listDeadLetters(companyId),
      listReplayPayloads(companyId),
      listQuarantine(companyId),
      listLeadReplayReceipts(companyId),
    ]);
    return res.status(200).json({ deadLetters, replayPayloads, quarantine, receipts });
  }

  if (req.method === 'POST') {
    const target = req.body?.target as ReplayTarget | undefined;
    const dedupeKey = typeof req.body?.dedupe_key === 'string' ? req.body.dedupe_key : null;
    if (!target || !TARGETS.includes(target)) {
      return res.status(400).json({ error: `target must be one of: ${TARGETS.join(', ')}` });
    }
    if (!dedupeKey) return res.status(400).json({ error: 'dedupe_key is required' });
    const result = await executeReplay({
      companyId,
      target,
      dedupeKey,
      payload: typeof req.body?.payload === 'object' && req.body.payload !== null ? req.body.payload : {},
    });
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
