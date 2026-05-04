import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  composePerformanceIntelligenceReport,
  type PerformanceIntelligenceReportResponse,
} from '../../../backend/services/performanceReportService';
import { resolveAnalyticsReportInput } from '../../../backend/services/analyticsInputResolver';

type PerformanceReportApiResponse = PerformanceIntelligenceReportResponse | {
  error?: string;
  code?: string;
};

async function resolveCompanyId(userId: string, requestedCompanyId?: string): Promise<string | null> {
  if (requestedCompanyId) {
    const { data } = await supabase
      .from('user_company_' + 'roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', requestedCompanyId)
      .eq('status', 'active')
      .maybeSingle();

    return data?.company_id ?? null;
  }

  const { data } = await supabase
    .from('user_company_' + 'roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return data?.company_id ?? null;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PerformanceReportApiResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const companyId = await resolveCompanyId(
      user.id,
      req.query.company_id as string | undefined,
    );

    if (!companyId) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED',
      });
    }

    const sinceDaysParam = Array.isArray(req.query.since_days)
      ? req.query.since_days[0]
      : req.query.since_days;
    const sinceDays = sinceDaysParam ? Number.parseInt(sinceDaysParam, 10) : undefined;

    const resolvedInput = await resolveAnalyticsReportInput({
      companyId,
      reportCategory: 'performance',
    });
    const performanceReport = await composePerformanceIntelligenceReport(companyId, {
      sinceDays: Number.isFinite(sinceDays) && sinceDays && sinceDays > 0 ? sinceDays : undefined,
      resolvedInput,
    });
    return res.status(200).json(performanceReport);
  } catch (error) {
    console.error('[reports/performance] error:', error);
    return res.status(500).json({
      error: 'Failed to compose performance report',
      code: 'SERVER_ERROR',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

