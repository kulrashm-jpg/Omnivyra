/**
 * Phase 9 — Analytics warehouse endpoint.
 *
 *   POST { companyId, factKind, windowStart?, windowEnd? }
 *     Materialise a fact kind for an explicit window.
 *
 *   GET  ?companyId=...&factKind=...&bucketStart=...&bucketEnd=...
 *     Read materialised facts.
 *
 *   GET  ?companyId=...&materializations=1
 *     Recent materialization runs.
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listMaterializations,
  listWarehouseFacts,
  materializeFact,
} from '../../../backend/services/analyticsWarehouseService';
import {
  WAREHOUSE_FACT_KINDS,
  type WarehouseFactKind,
} from '../../../backend/types/analyticsWarehouse';

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
    if (req.query.materializations) {
      const items = await listMaterializations(companyId, {
        factKind: typeof req.query.factKind === 'string' && WAREHOUSE_FACT_KINDS.includes(req.query.factKind as WarehouseFactKind) ? (req.query.factKind as WarehouseFactKind) : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const factKind = typeof req.query.factKind === 'string' && WAREHOUSE_FACT_KINDS.includes(req.query.factKind as WarehouseFactKind) ? (req.query.factKind as WarehouseFactKind) : undefined;
    const items = await listWarehouseFacts(companyId, {
      factKind,
      bucketStart: typeof req.query.bucketStart === 'string' ? req.query.bucketStart : undefined,
      bucketEnd: typeof req.query.bucketEnd === 'string' ? req.query.bucketEnd : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[analytics-warehouse GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load warehouse facts' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; factKind?: string; windowStart?: string; windowEnd?: string };
  const companyId = body.companyId || '';
  const factKind = body.factKind || '';
  if (!companyId || !WAREHOUSE_FACT_KINDS.includes(factKind as WarehouseFactKind)) {
    return res.status(400).json({ error: 'companyId and valid factKind required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await materializeFact({
      organizationId: companyId,
      factKind: factKind as WarehouseFactKind,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      initiatedBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, materialization: result.materialization, rows: result.facts.length });
  } catch (err: any) {
    console.error('[analytics-warehouse POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'materialization_failed' });
  }
}
