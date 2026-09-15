import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/enterprise-governance/approvals/comment
 *
 * Cross-team collaboration surface. Adds an audit-attached comment to
 * a review record without advancing state.
 *
 * Body: { assetId: string, text: string, pinnedTo?: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC, type RbacContext } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import {
  addReviewComment,
  getReviewRecord,
  ReviewTransitionError,
} from '../../../../backend/services/creator/creativeReviewStateMachine';
import type { CreativeReviewRole } from '../../../../backend/services/creator/creativeReviewRoles';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.CONTENT_CREATOR,
];

function rbacRoleToReviewRole(role: string | null): CreativeReviewRole {
  switch (role) {
    case Role.SUPER_ADMIN: return 'executive_reviewer';
    case Role.COMPANY_ADMIN: return 'campaign_manager';
    case Role.CONTENT_REVIEWER: return 'compliance_reviewer';
    case Role.CONTENT_PUBLISHER: return 'campaign_manager';
    case Role.CONTENT_CREATOR: return 'creative_operator';
    default: return 'creative_operator';
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // SEC-91 W2-A (STEP 3AH-91, W2A-5) — bind to the company withRBAC
    // authorized and use the role it resolved there (same defects as
    // approvals/decide: requireCompanyContext had no companyId → always 400, and
    // resolveUserContext().role ('admin' | 'user') never matched the mapping).
    const rbac = (req as NextApiRequest & { rbac?: RbacContext }).rbac;
    if (!rbac) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    const ctx = await requireCompanyContext({ req, res, companyId: rbac.companyId });
    if (!ctx) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetId = String(body.assetId ?? '').trim();
    const text = String(body.text ?? '').slice(0, 1000).trim();
    const pinnedTo = body.pinnedTo ? String(body.pinnedTo).slice(0, 100) : null;

    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    if (!text) return res.status(400).json({ error: 'text required' });

    const existing = getReviewRecord(assetId);
    if (existing && existing.companyId !== ctx.companyId) {
      return res.status(404).json({ error: 'Asset not found in this company context' });
    }
    if (!existing) return res.status(404).json({ error: 'Review record not found' });

    const updated = addReviewComment({
      assetId,
      authorUserId: rbac.userId,
      authorRole: rbacRoleToReviewRole(rbac.role),
      text,
      pinnedTo,
    });

    return res.status(200).json({
      ok: true,
      commentsCount: updated.comments.length,
      lastComment: updated.comments[updated.comments.length - 1] ?? null,
    });
  } catch (err) {
    if (err instanceof ReviewTransitionError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('[enterprise-governance/comment]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to add comment',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/approvals/comment' });
