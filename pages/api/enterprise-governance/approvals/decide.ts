import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/enterprise-governance/approvals/decide
 *
 * Operator-facing approval / rejection / override surface. Routes to the
 * governance integration facade so all state transitions go through the
 * distributed-lock-guarded path.
 *
 * Body:
 *   { assetId: string, decision: 'approve' | 'reject' | 'archive' | 'override',
 *     reason?: string, bypass?: boolean }
 *
 * Returns the updated review record on success or a structured error
 * envelope (matching the facade's `GovernanceIntegrationResult`).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { onApprovalDecision } from '../../../../backend/services/creator/enterpriseGovernanceIntegration';
import { getReviewRecord } from '../../../../backend/services/creator/creativeReviewStateMachine';
import type { ReviewState } from '../../../../backend/services/creator/creativeReviewStateMachine';
import type { CreativeReviewRole } from '../../../../backend/services/creator/creativeReviewRoles';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
];

const DECISION_TO_STATE: Record<string, ReviewState> = {
  approve: 'approved',
  reject: 'rejected',
  archive: 'archived',
};

function rbacRoleToReviewRole(role: string | null): CreativeReviewRole {
  switch (role) {
    case Role.SUPER_ADMIN: return 'executive_reviewer';
    case Role.COMPANY_ADMIN: return 'campaign_manager';
    case Role.CONTENT_REVIEWER: return 'compliance_reviewer';
    case Role.CONTENT_PUBLISHER: return 'campaign_manager';
    default: return 'compliance_reviewer';
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ctx = await requireCompanyContext({ req, res });
    if (!ctx) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetId = String(body.assetId ?? '').trim();
    const decision = String(body.decision ?? '').trim();
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    const bypass = body.bypass === true;

    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    if (!decision) return res.status(400).json({ error: 'decision required' });

    const targetState = DECISION_TO_STATE[decision];
    if (!targetState) return res.status(400).json({ error: `unknown decision: ${decision}` });

    // Cross-tenant isolation — confirm the record belongs to this company.
    const existing = getReviewRecord(assetId);
    if (existing && existing.companyId !== ctx.companyId) {
      return res.status(404).json({ error: 'Asset not found in this company context' });
    }

    const user = await resolveUserContext(req);
    const result = await onApprovalDecision({
      assetId,
      to: targetState,
      actorUserId: user.userId ?? 'unknown',
      actorRole: rbacRoleToReviewRole(user.role ?? null),
      reason,
      bypass,
    });

    if (result.skipped) {
      return res.status(result.reason === 'flag_off' ? 503 : 400).json({
        skipped: true,
        reason: result.reason,
        error: result.errorMessage ?? 'transition rejected',
      });
    }

    return res.status(200).json({ ok: true, record: result.result });
  } catch (err) {
    console.error('[enterprise-governance/decide]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to record decision',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/approvals/decide' });
