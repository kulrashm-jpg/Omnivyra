/**
 * Phase 5 — Alert center API.
 *
 *   GET    /api/active-leads/alerts?companyId=...&onlyUnacknowledged=1
 *   POST   /api/active-leads/alerts  { companyId, alertId, action: 'acknowledge' }
 *   PUT    /api/active-leads/alerts  { companyId, rule: {...} }   — upsert rule
 *   GET    /api/active-leads/alerts?companyId=...&rules=1          — list rules
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  acknowledgeAlert,
  listAlertRules,
  listAlerts,
  upsertAlertRule,
} from '../../../backend/services/alertRoutingService';
import type { AlertSeverity, AlertType } from '../../../backend/types/alert';
import { ALERT_SEVERITIES, ALERT_TYPES } from '../../../backend/types/alert';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handleAck(req, res);
  if (req.method === 'PUT') return handleUpsertRule(req, res);
  res.setHeader('Allow', 'GET, POST, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.rules === '1' || req.query.rules === 'true') {
      const rules = await listAlertRules(companyId);
      return res.status(200).json({ rules });
    }
    const onlyUnack = req.query.onlyUnacknowledged === '1' || req.query.onlyUnacknowledged === 'true';
    const items = await listAlerts(companyId, { onlyUnacknowledged: onlyUnack });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[alerts GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
}

async function handleAck(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; alertId?: string; action?: string };
  const companyId = body.companyId || '';
  const alertId = body.alertId || '';
  if (!companyId || !alertId) return res.status(400).json({ error: 'companyId and alertId required' });
  if (body.action !== 'acknowledge') return res.status(400).json({ error: 'action must be acknowledge' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const alert = await acknowledgeAlert(companyId, alertId, ctx.userId);
    return res.status(200).json({ ok: true, alert });
  } catch (err: any) {
    console.error('[alerts POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Acknowledge failed' });
  }
}

async function handleUpsertRule(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    rule?: {
      alertType?: string;
      enabled?: boolean;
      minSeverity?: string;
      rateLimitMinutes?: number;
      scope?: Record<string, unknown>;
    };
  };
  const companyId = body.companyId || '';
  if (!companyId || !body.rule?.alertType) {
    return res.status(400).json({ error: 'companyId and rule.alertType required' });
  }
  if (!ALERT_TYPES.includes(body.rule.alertType as AlertType)) {
    return res.status(400).json({ error: `unknown alertType: ${body.rule.alertType}` });
  }
  const minSeverity = (body.rule.minSeverity ?? 'medium') as AlertSeverity;
  if (!ALERT_SEVERITIES.includes(minSeverity)) {
    return res.status(400).json({ error: `unknown minSeverity: ${minSeverity}` });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const rule = await upsertAlertRule({
      organizationId: companyId,
      alertType: body.rule.alertType as AlertType,
      enabled: body.rule.enabled !== false,
      minSeverity,
      rateLimitMinutes: typeof body.rule.rateLimitMinutes === 'number' ? body.rule.rateLimitMinutes : 60,
      scope: body.rule.scope ?? {},
      createdBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, rule });
  } catch (err: any) {
    console.error('[alerts PUT] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Rule upsert failed' });
  }
}
