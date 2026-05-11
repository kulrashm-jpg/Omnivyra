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
import { resolveAnalyticsReportInput, persistAnalyticsReportInputs } from '../../../backend/services/analyticsInputResolver';
import { getCreditCost } from '../../../backend/services/creditDeductionService';
import { evaluateResolvedReportReadiness } from '../../../backend/services/reportReadinessService';
import { ensureAutomationConfig } from '../../../backend/services/reportAutomationService';
import { resolveSnapshotReportInput, persistSnapshotReportInputs } from '../../../backend/services/snapshotInputResolver';
import { keepAliveAfterResponse } from '../../../lib/runtime/keepAlive';
import { logger } from '../../../backend/services/logger';
import {
  getRequestContext,
  seedRequestContextFromRequest,
} from '../../../backend/services/requestContext';
import { getReportChargingIdentity } from '../../../shared/monetization/featureRegistry';
import {
  makeIdempotencyKey,
  releaseCreditReservation,
  reserveCreditsForWork,
} from '../../../backend/services/creditExecutionService';
import { assertMonetizationBetaAccess } from '../../../backend/services/monetizationBetaAccessService';

type GenerateReportRequest = {
  companyId?: string;
  domain?: string;
  type?: 'free' | 'premium';
  reportCategory?: ReportCategory;
  formData?: Record<string, unknown>;
  generationContext?: Record<string, unknown>;
};

type GenerateReportResponse = {
  success?: boolean;
  reportId?: string;
  status?: 'generating';
  message?: string;
  error?: string;
  code?: string;
  requestId?: string;
  correlationId?: string;
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
  const initialContext = seedRequestContextFromRequest(req);
  res.setHeader('x-request-id', initialContext.requestId || '');
  res.setHeader('x-correlation-id', initialContext.correlationId || initialContext.requestId || '');

  const withTrace = (payload: GenerateReportResponse): GenerateReportResponse => {
    const ctx = getRequestContext();
    return {
      ...payload,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
    };
  };

  if (req.method !== 'POST') {
    logger.warn('report_generate_method_not_allowed', { method: req.method });
    return res.status(405).json(withTrace({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }));
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    const normalizedAuthError: unknown = authError ?? 'missing user';
    logger.warn('report_generate_unauthorized', {
      message:
        typeof normalizedAuthError === 'object' && normalizedAuthError !== null && 'message' in normalizedAuthError
          ? String((normalizedAuthError as { message?: unknown }).message)
          : String(normalizedAuthError),
    });
    return res.status(401).json(withTrace({ error: 'Unauthorized', code: 'UNAUTHORIZED' }));
  }

  let pendingReportCreditReservation: Extract<Awaited<ReturnType<typeof reserveCreditsForWork>>, { status: 'reserved' | 'already_reserved' }> | null = null;
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
    seedRequestContextFromRequest(req, { userId: user.id, orgId: companyId ?? undefined });

    logger.info('report_generate_request_received', {
      endpoint: '/api/reports/generate',
      userId: user.id,
      requestedCompanyId: body.companyId ?? null,
      resolvedCompanyId: companyId,
      type,
      reportCategory,
      domain: body.domain ?? null,
      payload: {
        domain: body.domain ?? null,
        type: body.type ?? null,
        reportCategory: body.reportCategory ?? null,
        formData: body.formData ?? null,
        generationContext: body.generationContext ?? null,
      },
    });

    if (!companyId) {
      logger.warn('report_generate_access_denied', {
        userId: user.id,
        requestedCompanyId: body.companyId ?? null,
      });
      return res.status(403).json(withTrace({ error: 'Access denied', code: 'ACCESS_DENIED' }));
    }

    const requestPayload = {
      formData: {
        ...(body.formData || {}),
        ...(body.domain ? { domain: body.domain } : {}),
      },
      generationContext: body.generationContext || null,
    };
    const resolvedInput =
      reportCategory === 'snapshot'
        ? await resolveSnapshotReportInput({
          companyId,
          requestPayload,
        })
        : await resolveAnalyticsReportInput({
          companyId,
          reportCategory,
          requestPayload,
        });
    const readiness = await evaluateResolvedReportReadiness(resolvedInput);
    logger.info('report_generate_readiness_evaluated', {
      companyId,
      reportCategory,
      ready: readiness.ready,
      missingRequirements: readiness.missing_requirements,
    });

    if (!readiness.ready) {
      logger.warn('report_generate_not_ready', {
        companyId,
        reportCategory,
        missingRequirements: readiness.missing_requirements,
      });
      return res.status(400).json(withTrace({
        error: `Report is not ready: ${readiness.missing_requirements.join('; ')}`,
        code: 'REPORT_NOT_READY',
      }));
    }

    if (reportCategory === 'snapshot') {
      await persistSnapshotReportInputs(resolvedInput);
    } else {
      await persistAnalyticsReportInputs(resolvedInput);
    }

    let reportChargingIdentity: ReturnType<typeof getReportChargingIdentity> | null = null;

    if (type === 'premium') {
      const betaAccess = await assertMonetizationBetaAccess({
        organizationId: companyId,
        userId: user.id,
        surface: 'paid_report_generation',
      });
      const chargingIdentity = getReportChargingIdentity({
        requested_type: type,
        report_category: reportCategory,
        usage_context: {
          endpoint: '/api/reports/generate',
          user_id: user.id,
          company_id: companyId,
        },
      });
      reportChargingIdentity = chargingIdentity;
      const requiredCredits = await getCreditCost(chargingIdentity.action_key);
      const holdIdempotencyKey = makeIdempotencyKey(
        user.id,
        chargingIdentity.action_key,
        initialContext.requestId,
        'report-generation',
      );
      const reservation = await reserveCreditsForWork({
        userId: user.id,
        orgId: companyId,
        action: chargingIdentity.action_key,
        referenceType: chargingIdentity.feature_key,
        referenceId: initialContext.requestId,
        idempotencyKey: holdIdempotencyKey,
        amountOverride: requiredCredits,
        note: `${chargingIdentity.feature_key} report generation`,
      });
      logger.info('report_generate_credit_check', {
        companyId,
        reportCategory,
        monetization: {
          featureKey: chargingIdentity.feature_key,
          pricingKey: chargingIdentity.pricing_key,
          actionKey: chargingIdentity.action_key,
          planTier: chargingIdentity.plan_tier,
          betaCohort: betaAccess.beta_cohort,
          betaAccessLevel: betaAccess.access_level,
        },
        reservationStatus: reservation.status,
        required: requiredCredits,
      });

      if (reservation.status === 'insufficient_credits') {
        return res.status(402).json(withTrace({
          error: 'Insufficient credits to generate this report',
          code: 'INSUFFICIENT_CREDITS',
        }));
      }
      if (reservation.status !== 'reserved' && reservation.status !== 'already_reserved') {
        const statusCode = reservation.status === 'no_credit_account' ? 402 : 409;
        return res.status(statusCode).json(withTrace({
          error: reservation.status === 'no_credit_account'
            ? 'No credit account is available for this organization'
            : `Report generation cannot start: ${reservation.status}`,
          code: reservation.status.toUpperCase(),
        }));
      }

      pendingReportCreditReservation = reservation;
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
          creditReservation: pendingReportCreditReservation && reportChargingIdentity
            ? {
              ...pendingReportCreditReservation,
              feature_key: reportChargingIdentity.feature_key,
              pricing_key: reportChargingIdentity.pricing_key,
              plan_tier: reportChargingIdentity.plan_tier,
              usage_context: reportChargingIdentity.usage_context,
              pricing_snapshot: {
                pricing_key: reportChargingIdentity.pricing_key,
                required_credits: pendingReportCreditReservation.creditsReserved,
                strategy: reportChargingIdentity.pricing_key,
              },
              registry_snapshot: reportChargingIdentity,
              generation_context: {
                request_id: initialContext.requestId,
                correlation_id: initialContext.correlationId,
                endpoint: '/api/reports/generate',
              },
            }
            : undefined,
        });

    logger.info('report_generate_report_created', {
      companyId,
      userId: user.id,
      reportId: report.id,
      reportCategory,
      reportType: report.report_type,
      domain: report.domain,
    });
    pendingReportCreditReservation = null;

    // Phase 3: hand the lifecycle Promise to a Vercel-aware keep-alive so the
    // background work survives HTTP response flush. Falls back to awaiting
    // when not running on Vercel. The recover-stale-reports cron is the
    // safety net if either path is interrupted (e.g. lambda hard kill).
    await keepAliveAfterResponse(startAsyncReportGeneration(report));

    if (reportCategory === 'snapshot') {
      await ensureAutomationConfig({
        userId: user.id,
        companyId,
        domain: report.domain,
      });
    }

    const generationMessage =
      reportCategory === 'performance'
        ? 'Lead & Growth Intelligence report generation started'
        : 'Report generation started';

    logger.info('report_generate_response_sent', {
      companyId,
      userId: user.id,
      reportId: report.id,
      status: 202,
      reportCategory,
    });

    return res.status(202).json(withTrace({
      success: true,
      reportId: report.id,
      status: 'generating',
      message: generationMessage,
    }));
  } catch (error) {
    if (error instanceof ReportRequestError) {
      if (pendingReportCreditReservation) {
        await releaseCreditReservation({
          ...pendingReportCreditReservation,
          note: `Report request failed before generation: ${error.code}`,
        }).catch((releaseError) => {
          logger.error('report_generate_pre_creation_release_failed', {
            message: releaseError instanceof Error ? releaseError.message : String(releaseError),
            holdTransactionId: pendingReportCreditReservation?.holdTransactionId,
          });
        });
      }
      logger.warn('report_generate_request_error', {
        status: error.httpStatus,
        code: error.code,
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      });
      return res.status(error.httpStatus).json(withTrace({
        error: error.message,
        code: error.code,
      }));
    }

    const message = error instanceof Error ? error.message : String(error);
    if (pendingReportCreditReservation) {
      await releaseCreditReservation({
        ...pendingReportCreditReservation,
        note: `Report request failed before generation: ${message}`,
      }).catch((releaseError) => {
        logger.error('report_generate_pre_creation_release_failed', {
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
          holdTransactionId: pendingReportCreditReservation?.holdTransactionId,
        });
      });
    }
    logger.error('report_generate_unhandled_error', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json(withTrace({
      error: process.env.NODE_ENV !== 'production' ? message : 'Failed to generate report',
      code: 'SERVER_ERROR',
    }));
  }
}
