/**
 * Phase 2 — Credit estimate + guidance preview.
 *
 *   POST /api/active-leads/credit-estimate
 *     Body: { companyId, mode, platforms[], keywordCount, industryCategory?,
 *             industryVolatility?, sourceCount? }
 *     Returns: { estimate, guidance, readiness_warnings[] }
 *
 * Read-only. Computes a deterministic estimate + heuristic guidance for the
 * confirmation dialog. The activation endpoint requires the client to echo
 * back `estimate.estimate_hash` exactly, so this endpoint also produces the
 * hash that gates `POST /api/active-leads/configuration`.
 *
 * Does NOT activate monitoring. Does NOT write any rows.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { estimateCredits } from '../../../backend/services/creditEstimationService';
import {
  getListeningGuidance,
  inferIndustryVolatility,
  type SourceReadinessLevel,
} from '../../../backend/services/industryGuidanceService';
import { isListeningMode, type IndustryVolatility } from '../../../backend/types/listeningConfiguration';
import { getCachedCapabilityAggregate } from '../../../backend/services/capabilityCacheService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as {
    companyId?: string;
    mode?: string;
    platforms?: string[];
    keywordCount?: number;
    industryCategory?: string | null;
    industryVolatility?: IndustryVolatility | null;
    sourceCount?: number;
  };

  const companyId = body.companyId || '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  if (!isListeningMode(body.mode)) {
    return res.status(400).json({ error: `mode must be one of manual_only|daily|alternate_days|weekly` });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p) => typeof p === 'string') : [];
  const keywordCount = typeof body.keywordCount === 'number' ? body.keywordCount : 0;

  const volatility =
    body.industryVolatility
    ?? inferIndustryVolatility(body.industryCategory ?? null);

  const estimate = estimateCredits({
    mode: body.mode,
    platforms,
    keywordCount,
    industryVolatility: volatility,
    sourceCount: body.sourceCount ?? 0,
  });

  // Source readiness derived from the (cached) aggregate so the UI can warn
  // before activation rather than after.
  let readiness: SourceReadinessLevel = 'moderate';
  const readinessWarnings: string[] = [];
  try {
    const aggregate = await getCachedCapabilityAggregate(companyId);
    const eligible = aggregate.platforms.filter((p) => p.monitoring_ready).length;
    const connected = aggregate.platforms.filter((p) => p.is_connected).length;
    if (connected === 0) {
      readiness = 'none';
      readinessWarnings.push('No platforms connected — credit estimate is hypothetical.');
    } else if (eligible === 0) {
      readiness = 'low';
      readinessWarnings.push('No platforms are listening-ready — activation will block.');
    } else if (eligible < connected) {
      readiness = 'moderate';
      readinessWarnings.push(`${connected - eligible} connected platform(s) are not yet listening-ready.`);
    } else {
      readiness = 'strong';
    }
    if (aggregate.health.stale_consents > 0) {
      readinessWarnings.push(`${aggregate.health.stale_consents} stale consent(s) — refresh before scheduling.`);
    }
    if (aggregate.health.revoked_scope_warnings > 0) {
      readinessWarnings.push(`${aggregate.health.revoked_scope_warnings} scope warning(s) — monitoring may surface fewer signals.`);
    }
  } catch (err) {
    // Readiness derivation is advisory; estimate still returned on failure.
    console.warn('[credit-estimate] readiness derivation failed:', (err as Error)?.message);
  }

  const guidance = getListeningGuidance({
    industryCategory: body.industryCategory ?? null,
    industryVolatility: volatility,
    platformCount: platforms.length,
    sourceReadiness: readiness,
  });

  return res.status(200).json({
    estimate,
    guidance,
    readiness_warnings: readinessWarnings,
  });
}
