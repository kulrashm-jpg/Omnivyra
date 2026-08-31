import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { appendServerTiming, createTimingSink, flushTimingSink, timeStage } from '../../../lib/platform/serverTiming';
import { setPrivateCache, CACHE_TTL } from '../../../lib/platform/httpCache';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveCompanyId } from '../../../backend/services/reportsCompanyAccessService';
import {
  getCompanyReportsForCard,
  ReportCardAvailabilityState,
  ReportRequestError,
} from '../../../backend/services/reportCardService';

type GetReportsResponse = {
  success?: boolean;
  reports?: unknown[];
  domain?: string;
  hasFreeReportUsed?: boolean;
  hasGeneratingReport?: boolean;
  reportState?: ReportCardAvailabilityState;
  canGenerateFreeReport?: boolean;
  error?: string;
  code?: string;
};


async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetReportsResponse>,
) {
  const handlerStart = Date.now();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await timeStage(res, 'auth', () => getSupabaseUserFromRequest(req));
  if (authError || !user) {
    appendServerTiming(res, 'total', Date.now() - handlerStart);
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const companyId = await timeStage(res, 'company', () => resolveCompanyId(user.id, req.query.company_id as string | undefined));
    if (!companyId) {
      appendServerTiming(res, 'total', Date.now() - handlerStart);
      return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const leafTiming = createTimingSink();
    const result = await timeStage(res, 'service', () => getCompanyReportsForCard(
      user.id,
      companyId,
      req.query.domain as string | undefined,
      leafTiming,
    ));
    flushTimingSink(res, leafTiming);

    // OPT-002: P3 private, NEAR_LIVE (30 s) — response carries the
    // progress-adjacent hasGeneratingReport flag; duplicate generation is
    // guarded server-side in reports/generate (credit reservation 402/409).
    setPrivateCache(res, CACHE_TTL.NEAR_LIVE);
    appendServerTiming(res, 'total', Date.now() - handlerStart);
    return res.status(200).json({
      success: true,
      reports: result.reports,
      domain: result.domain,
      hasFreeReportUsed: result.hasFreeReportUsed,
      hasGeneratingReport: result.hasGeneratingReport,
      reportState: result.reportState,
      canGenerateFreeReport: result.canGenerateFreeReport,
    });
  } catch (error) {
    if (error instanceof ReportRequestError) {
      appendServerTiming(res, 'total', Date.now() - handlerStart);
      return res.status(error.httpStatus).json({
        error: error.message,
        code: error.code,
      });
    }

    console.error('[reports/index] error:', error);
    appendServerTiming(res, 'total', Date.now() - handlerStart);
    return res.status(500).json({
      error: 'Failed to load reports',
      code: 'SERVER_ERROR',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/reports' });
