import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
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

async function resolveCompanyId(userId: string, requestedCompanyId?: string): Promise<string | null> {
  if (requestedCompanyId) {
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', requestedCompanyId)
      .eq('status', 'active')
      .maybeSingle();

    return data?.company_id ?? null;
  }

  const { data } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return data?.company_id ?? null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetReportsResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const companyId = await resolveCompanyId(user.id, req.query.company_id as string | undefined);
    if (!companyId) {
      return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const result = await getCompanyReportsForCard(
      user.id,
      companyId,
      req.query.domain as string | undefined,
    );

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
      return res.status(error.httpStatus).json({
        error: error.message,
        code: error.code,
      });
    }

    console.error('[reports/index] error:', error);
    return res.status(500).json({
      error: 'Failed to load reports',
      code: 'SERVER_ERROR',
    });
  }
}
