/**
 * Phase 10 — Intelligence trends endpoint.
 *
 *   GET    ?companyId=...&trendKind=...&windowKind=...
 *
 *   POST   { companyId, trendKind, windowKind, dimensions?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listTrends,
  materializeTrend,
} from '../../../backend/services/intelligenceTrendService';
import {
  TREND_KINDS,
  TREND_WINDOW_KINDS,
  type TrendKind,
  type TrendWindowKind,
} from '../../../backend/types/intelligenceTrend';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const items = await listTrends(companyId, {
      trendKind: typeof req.query.trendKind === 'string' && TREND_KINDS.includes(req.query.trendKind as TrendKind) ? (req.query.trendKind as TrendKind) : undefined,
      windowKind: typeof req.query.windowKind === 'string' && TREND_WINDOW_KINDS.includes(req.query.windowKind as TrendWindowKind) ? (req.query.windowKind as TrendWindowKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[intelligence-trends GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load trends' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const trendKind = TREND_KINDS.includes(body.trendKind as TrendKind) ? (body.trendKind as TrendKind) : null;
  const windowKind = TREND_WINDOW_KINDS.includes(body.windowKind as TrendWindowKind) ? (body.windowKind as TrendWindowKind) : null;
  if (!companyId || !trendKind || !windowKind) return res.status(400).json({ error: 'companyId, trendKind, windowKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const trend = await materializeTrend({
      organizationId: companyId,
      trendKind,
      windowKind,
      dimensions: (body.dimensions as Record<string, string | number | null>) ?? {},
      initiatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, trend });
  } catch (err: any) {
    console.error('[intelligence-trends POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'trend_failed' });
  }
}
