import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  createFreeReport,
  createPaidReport,
  ReportCategory,
  ReportRequestError,
  startAsyncReportGeneration,
} from '../../../backend/services/reportCardService';
import { hasEnoughCredits } from '../../../backend/services/creditDeductionService';
import { persistResolvedReportInputs, resolveReportInput } from '../../../backend/services/reportInputResolver';
import { evaluateResolvedReportReadiness } from '../../../backend/services/reportReadinessService';
import { ensureAutomationConfig } from '../../../backend/services/reportAutomationService';

type GenerateReportRequest = {
  companyId?: string;
  domain?: string;
  type?: 'free' | 'premium';
  reportCategory?: ReportCategory;
  formData?: Record<string, unknown>;
  generationContext?: Record<string, unknown>;
};

function getCreditAction(reportCategory: ReportCategory): 'website_audit' | 'deep_analysis' | 'full_strategy' {
  if (reportCategory === 'growth') return 'full_strategy';
  if (reportCategory === 'performance') return 'deep_analysis';
  return 'website_audit';
}

type GenerateReportResponse = {
  success?: boolean;
  reportId?: string;
  status?: 'generating';
  message?: string;
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
  res: NextApiResponse<GenerateReportResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const body = (req.body || {}) as GenerateReportRequest;
    const type = body.type === 'premium' ? 'premium' : 'free';
    const reportCategory: ReportCategory =
      body.reportCategory === 'growth' ||
      body.reportCategory === 'performance' ||
      body.reportCategory === 'snapshot'
        ? body.reportCategory
        : type === 'free'
          ? 'snapshot'
          : 'performance';
    const companyId = await resolveCompanyId(user.id, body.companyId);

    if (!companyId) {
      return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const requestPayload = {
      formData: {
        ...(body.formData || {}),
        ...(body.domain ? { domain: body.domain } : {}),
      },
      generationContext: body.generationContext || null,
    };
    const resolvedInput = await resolveReportInput({
      companyId,
      reportCategory,
      requestPayload,
    });
    const readiness = evaluateResolvedReportReadiness(resolvedInput);

    if (!readiness.ready) {
      return res.status(400).json({
        error: `Report is not ready: ${readiness.missing_requirements.join('; ')}`,
        code: 'REPORT_NOT_READY',
      });
    }

    await persistResolvedReportInputs(resolvedInput);

    if (type === 'premium') {
      const creditCheck = await hasEnoughCredits(companyId, getCreditAction(reportCategory));
      if (!creditCheck.sufficient) {
        return res.status(402).json({
          error: 'Insufficient credits to generate this report',
          code: 'INSUFFICIENT_CREDITS',
        });
      }
    }

    const report =
      type === 'free'
        ? await createFreeReport(user.id, companyId, body.domain, {
          reportCategory,
          requestPayload,
          resolvedInput: resolvedInput as unknown as Record<string, unknown>,
          readiness,
        })
        : await createPaidReport(user.id, companyId, body.domain, {
          reportCategory,
          requestPayload,
          resolvedInput: resolvedInput as unknown as Record<string, unknown>,
          readiness,
        });

    startAsyncReportGeneration(report);

    if (reportCategory === 'snapshot') {
      await ensureAutomationConfig({
        userId: user.id,
        companyId,
        domain: report.domain,
      });
    }

    return res.status(202).json({
      success: true,
      reportId: report.id,
      status: 'generating',
      message: 'Report generation started',
    });
  } catch (error) {
    if (error instanceof ReportRequestError) {
      return res.status(error.httpStatus).json({
        error: error.message,
        code: error.code,
      });
    }

    console.error('[reports/generate] error:', error);
    return res.status(500).json({
      error: 'Failed to generate report',
      code: 'SERVER_ERROR',
    });
  }
}
