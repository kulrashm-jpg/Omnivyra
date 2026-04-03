import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { composeSnapshotReport } from '../../../backend/services/snapshotReportService';

type SnapshotReportApiResponse = {
  report_type?: 'snapshot';
  score?: {
    available: true;
    value: number;
    label: string;
    dimensions?: unknown[];
    weakest_dimensions?: unknown[];
    limiting_factors?: string[];
    growth_path?: unknown;
  };
  diagnosis?: string;
  summary?: string;
  primary_problem?: string;
  secondary_problems?: string[];
  competitor_intelligence?: {
    summary?: string;
    detected_competitors?: unknown[];
    comparison?: unknown;
    generated_gaps?: unknown[];
  };
  sections?: Array<{
    section_name: string;
    IU_ids: string[];
    insights: unknown[];
    opportunities: unknown[];
    actions: unknown[];
  }>;
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
  res: NextApiResponse<SnapshotReportApiResponse>,
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

    const snapshotReport = await composeSnapshotReport(companyId);
    return res.status(200).json(snapshotReport);
  } catch (error) {
    console.error('[reports/snapshot] error:', error);
    return res.status(500).json({
      error: 'Failed to compose snapshot report',
      code: 'SERVER_ERROR',
    });
  }
}
