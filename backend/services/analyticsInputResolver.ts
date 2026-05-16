import { getGoogleAnalyticsCapabilityReadiness, getGoogleSearchConsoleReadiness } from './googleProviderReadinessService';
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

  const googleAnalyticsReadiness = await getGoogleAnalyticsCapabilityReadiness(params.companyId);
  const googleAnalyticsAvailable = googleAnalyticsReadiness.connected && googleAnalyticsReadiness.capability_ready;
  if (googleAnalyticsAvailable) {
    resolved.integrations.google_analytics = {
      ...resolved.integrations.google_analytics,
      connected: true,
      source: 'system',
    };
  }

  const googleSearchConsoleReadiness = await getGoogleSearchConsoleReadiness(params.companyId);
  const googleSearchConsoleAvailable = googleSearchConsoleReadiness.capability_ready;
  if (googleSearchConsoleAvailable) {
    resolved.integrations.google_search_console = {
      ...resolved.integrations.google_search_console,
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
