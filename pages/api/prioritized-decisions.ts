import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../backend/services/userContextService';
import { requireCompanyContext } from '../../backend/services/companyContextGuardService';
import {
  listPrioritizedDecisions,
  PRIORITIZATION_MODEL_VERSION,
  type PrioritizationMode,
  recomputePrioritiesForCompany,
} from '../../backend/services/prioritizationService';
import { runInApiReadContext } from '../../backend/services/intelligenceExecutionContext';

type PrioritizedDecisionApiResponse = {
  company_id?: string;
  report_tier?: 'snapshot' | 'growth' | 'deep';
  prioritization_mode?: PrioritizationMode;
  model_version?: string;
  generated_at?: string;
  total?: number;
  decisions?: unknown[];
  error?: string;
};

function parseReportTier(value: string | string[] | undefined): 'snapshot' | 'growth' | 'deep' | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  if (raw === 'snapshot' || raw === 'growth' || raw === 'deep') return raw;
  return undefined;
}

function parsePrioritizationMode(value: string | string[] | undefined): PrioritizationMode | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  if (raw === 'growth' || raw === 'efficiency' || raw === 'risk') return raw;
  return undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PrioritizedDecisionApiResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const reportTier = parseReportTier(req.query.reportTier as string | string[] | undefined);
    if ((req.query.reportTier as string | undefined) && !reportTier) {
      return res.status(400).json({ error: 'Invalid reportTier. Use snapshot, growth, or deep.' });
    }

    const mode = parsePrioritizationMode(req.query.mode as string | string[] | undefined) ?? 'growth';
    if ((req.query.mode as string | undefined) && !parsePrioritizationMode(req.query.mode as string | string[] | undefined)) {
      return res.status(400).json({ error: 'Invalid mode. Use growth, efficiency, or risk.' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    const refresh = String(req.query.refresh ?? '').toLowerCase();
    const shouldRefresh = refresh === '1' || refresh === 'true' || refresh === 'yes';

    if (shouldRefresh || mode !== 'growth') {
      await recomputePrioritiesForCompany({
        companyId: companyContext.companyId,
        reportTier,
        mode,
        limit: 500,
      });
    }

    const decisions = await runInApiReadContext('prioritizedDecisionsApi', async () =>
      listPrioritizedDecisions({
        companyId: companyContext.companyId,
        reportTier,
        mode,
        limit,
      })
    );

    // Backward compatible fallback: if queue rows don't exist for this mode yet, compute once and retry.
    let resolvedDecisions = decisions;
    if (resolvedDecisions.length === 0) {
      await recomputePrioritiesForCompany({
        companyId: companyContext.companyId,
        reportTier,
        mode,
        limit: 500,
      });

      resolvedDecisions = await runInApiReadContext('prioritizedDecisionsApi:retry', async () =>
        listPrioritizedDecisions({
          companyId: companyContext.companyId,
          reportTier,
          mode,
          limit,
        })
      );
    }

    return res.status(200).json({
      company_id: companyContext.companyId,
      report_tier: reportTier,
      prioritization_mode: mode,
      model_version: resolvedDecisions[0]?.model_version ?? PRIORITIZATION_MODEL_VERSION,
      generated_at: new Date().toISOString(),
      total: resolvedDecisions.length,
      decisions: resolvedDecisions,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch prioritized decisions';
    console.error('[prioritized-decisions] error:', message);
    return res.status(500).json({ error: message });
  }
}
