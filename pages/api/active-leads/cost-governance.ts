/**
 * Phase 8 — Cost governance endpoint.
 *
 *   GET  ?companyId=...&snapshot=1    — rolling snapshot
 *   GET  ?companyId=...               — list budgets
 *   POST { companyId, action: 'upsert_budget'|'evaluate'|'record' }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  evaluateCost,
  getCostSnapshot,
  listBudgets,
  recordCost,
  upsertBudget,
} from '../../../backend/services/costGovernanceService';
import { COST_CATEGORIES, type CostCategory } from '../../../backend/types/costGovernance';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

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
    if (req.query.snapshot === '1' || req.query.snapshot === 'true') {
      const snapshot = await getCostSnapshot(companyId);
      return res.status(200).json(snapshot);
    }
    const items = await listBudgets(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[cost-governance GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load cost governance' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_budget', 'evaluate', 'record'].includes(action)) {
    return res.status(400).json({ error: 'companyId, action ∈ upsert_budget|evaluate|record required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  if (action === 'upsert_budget') {
    const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
    if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
    if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }
  try {
    const category = body.category as CostCategory;
    if (!COST_CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
    if (action === 'upsert_budget') {
      const result = await upsertBudget({
        organizationId: companyId,
        category,
        monthlySoftCeiling: Number(body.monthlySoftCeiling ?? 0),
        monthlyHardCeiling: Number(body.monthlyHardCeiling ?? 0),
        alertThresholdPercent: Number(body.alertThresholdPercent ?? 80),
        enabled: body.enabled !== false,
        createdBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, budget: result });
    }
    if (action === 'evaluate') {
      const result = await evaluateCost({ organizationId: companyId, category, units: Number(body.units ?? 0) });
      if (result.alert_triggered) {
        void publishRealtime({
          organizationId: companyId,
          topic: 'cost_governance',
          eventName: 'cost.threshold_reached',
          payload: { category, projected_spend: result.projected_spend, threshold_percent: result.budget?.alert_threshold_percent ?? null },
        });
      }
      return res.status(200).json(result);
    }
    const ev = await recordCost({
      organizationId: companyId,
      category,
      units: Number(body.units ?? 0),
      decision: 'allowed',
      attributionKind: typeof body.attributionKind === 'string' ? body.attributionKind : null,
      attributionRef: typeof body.attributionRef === 'string' ? body.attributionRef : null,
    });
    return res.status(200).json({ ok: true, event: ev });
  } catch (err: any) {
    console.error('[cost-governance POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Cost governance action failed' });
  }
}
