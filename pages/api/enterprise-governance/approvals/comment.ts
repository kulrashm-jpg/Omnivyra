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
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
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
    const ctx = await requireCompanyContext({ req, res });
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

    const user = await resolveUserContext(req);
    const updated = addReviewComment({
      assetId,
      authorUserId: user.userId ?? 'unknown',
      authorRole: rbacRoleToReviewRole(user.role ?? null),
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
