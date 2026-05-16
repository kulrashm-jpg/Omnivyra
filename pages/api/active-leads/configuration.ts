/**
 * Phase 2 — Listening configuration endpoint.
 *
 *   GET  /api/active-leads/configuration?companyId=...
 *     Returns the current config + a fresh monitoring-status snapshot.
 *
 *   POST /api/active-leads/configuration
 *     Activates / updates a configuration. Requires:
 *       - matching estimate_hash from /credit-estimate
 *       - acknowledgeCreditEstimate: true
 *       - acknowledgeConsentRequirement: true
 *     Validates eligibility / consent / scope / budget ceiling before
 *     persisting. Returns the persisted row or a structured refusal.
 *
 *   DELETE /api/active-leads/configuration?companyId=...
 *     Suspends the configuration to manual_only. Does NOT delete the row,
 *     so the historical estimate / confirmation trail is preserved.
 *
 * RBAC: MANAGE_LISTENING_CAPABILITIES on mutations.
 *
 * Does NOT start a listener; only persists configuration + computes
 * next_planned_run_at. A future Phase 3 scheduler reads next_planned_run_at
 * and consults the orchestration service before firing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  activateListeningConfiguration,
  getListeningConfiguration,
  suspendListeningConfiguration,
  type ConfigurationDraft,
} from '../../../backend/services/listeningConfigurationService';
import { getMonitoringStatusSnapshot } from '../../../backend/services/monitoringOrchestrationService';
import {
  isIndustryVolatility,
  isListeningMode,
} from '../../../backend/types/listeningConfiguration';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  try {
    const [configuration, monitoringStatus] = await Promise.all([
      getListeningConfiguration(companyId),
      getMonitoringStatusSnapshot(companyId),
    ]);
    return res.status(200).json({ configuration, monitoring_status: monitoringStatus });
  } catch (err: any) {
    console.error('[configuration GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load configuration' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Partial<ConfigurationDraft> & {
    companyId?: string;
    estimateHash?: string;
    acknowledgeCreditEstimate?: boolean;
    acknowledgeConsentRequirement?: boolean;
  };

  const companyId = body.companyId || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  if (!isListeningMode(body.mode)) {
    return res.status(400).json({ error: 'invalid mode' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p) => typeof p === 'string') : [];
  const keywordCount = typeof body.keywordCount === 'number' ? body.keywordCount : 0;
  const monthlyCreditCeiling = typeof body.monthlyCreditCeiling === 'number' ? Math.max(0, body.monthlyCreditCeiling) : 0;
  const dailyRunCeiling = typeof body.dailyRunCeiling === 'number' ? Math.max(0, body.dailyRunCeiling) : 1;
  const cooldownMinutes = typeof body.cooldownMinutes === 'number' ? Math.max(0, body.cooldownMinutes) : 60;
  const industryVolatility = isIndustryVolatility(body.industryVolatility ?? undefined)
    ? (body.industryVolatility as 'high' | 'moderate' | 'low')
    : null;

  try {
    const result = await activateListeningConfiguration({
      organizationId: companyId,
      mode: body.mode,
      platforms,
      keywordCount,
      industryCategory: body.industryCategory ?? null,
      industryVolatility,
      monthlyCreditCeiling,
      dailyRunCeiling,
      cooldownMinutes,
      confirmedBy: ctx.userId,
      estimateHash: body.estimateHash ?? '',
      acknowledgeCreditEstimate: Boolean(body.acknowledgeCreditEstimate),
      acknowledgeConsentRequirement: Boolean(body.acknowledgeConsentRequirement),
    });

    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      return res.status(409).json({
        ok: false,
        reason: failure.reason,
        detail: failure.detail,
        ineligible_platforms: failure.ineligible_platforms,
      });
    }
    const success = result as Extract<typeof result, { ok: true }>;
    return res.status(200).json({ ok: true, configuration: success.configuration });
  } catch (err: any) {
    console.error('[configuration POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Activation failed' });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const configuration = await suspendListeningConfiguration(companyId);
    return res.status(200).json({ ok: true, configuration });
  } catch (err: any) {
    console.error('[configuration DELETE] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Suspend failed' });
  }
}
