import { getGoogleAnalyticsStatus } from './analyticsIntegrationService';
import {
  resolveReportInput,
  persistResolvedReportInputs,
  type ReportRequestPayload,
  type ResolvedReportInput,
} from './reportInputResolver';
import { resolveSnapshotReportInput } from './snapshotInputResolver';

export async function resolveAnalyticsReportInput(params: {
  companyId: string;
  reportCategory: 'performance' | 'growth' | 'snapshot';
  requestPayload?: ReportRequestPayload | null;
}): Promise<ResolvedReportInput> {
  if (params.reportCategory === 'snapshot') {
    return resolveSnapshotReportInput({
      companyId: params.companyId,
      requestPayload: params.requestPayload,
    });
  }

  const resolved = await resolveReportInput({
    companyId: params.companyId,
    reportCategory: params.reportCategory,
    requestPayload: params.requestPayload,
  });

  const googleAnalyticsStatus = await getGoogleAnalyticsStatus(params.companyId);
  if (googleAnalyticsStatus?.ready) {
    resolved.integrations.google_analytics = {
      ...resolved.integrations.google_analytics,
      connected: true,
      source: 'system',
    };
  }

  return resolved;
}

export async function persistAnalyticsReportInputs(input: ResolvedReportInput): Promise<void> {
  await persistResolvedReportInputs(input);
}

export type { ReportRequestPayload, ResolvedReportInput } from './reportInputResolver';
