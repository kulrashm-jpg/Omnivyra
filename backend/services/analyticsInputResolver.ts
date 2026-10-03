import { getGoogleAnalyticsCapabilityReadiness, getGoogleSearchConsoleReadiness } from './googleProviderReadinessService';
import {
  resolveReportInput,
  persistReportInputsWithoutProfileMutation,
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

/**
 * WP-C (pre-T3) — THE Reports 2/3 input persist, closing the path WP-11 left open for Report 1.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG
 * This delegated to `persistResolvedReportInputs`, which wrote the report's resolved inputs back
 * onto `company_profiles` through `saveProfile(..., { source: 'user' })`. That is the identical
 * write WP-11 removed from Report 1, reached from the identical resolver: `resolveAnalyticsReportInput`
 * calls `resolveReportInput` — the very function the snapshot resolver calls — and then adjusts two
 * integration flags IN MEMORY only. Nothing about the resolved values is category-specific, so
 * nothing about the write was category-specific either. It carried the same five mutations:
 * durable identity columns overwritten; `shouldRefreshClassification` firing on `category` and
 * replacing `industry` / `industry_list` / `category` / `category_list` (`industry_list` is the ICP
 * generator's input, d99cf962); `getFinalCompetitors({ useNetwork: true })` re-running as a report
 * side effect; `{ source: 'user' }` letting a report run add `competitors` to `user_locked_fields`
 * and stamp `last_edited_by = 'user'`; and `buildSavePayload` re-asserting every unsupplied column.
 *
 * WHY THE SWAP IS SAFE — i.e. this write was never Report 2/3's legitimate refinement
 * Report 2 DOES refine the Company Profile by design, but through a DIFFERENT chain:
 * `composePerformanceIntelligenceReport` → `getAnalyticsEnterpriseSnapshot` →
 * `discoverAndPersistCompetitorDomains` / `bootstrapCompetitorDataset` → `getProfile(companyId)`
 * with NO options, so `autoRefine` defaults ON → `refineProfileWithAI` →
 * `saveProfile(..., { source: 'ai_refined' })`. That chain is documented in
 * `intelligence/reportDeadlineContext.ts`, is attributed as a machine refinement, honours
 * `user_locked_fields` and preserves `last_edited_by`. It is untouched here.
 *
 * `persistResolvedReportInputs` performed NO inference at all — it echoed the report form straight
 * back onto the profile as though a human had typed it there. That is the harm, and it is gone.
 *
 * Report continuity is unaffected: `buildReportSettingsForRun` still writes `default_inputs`,
 * `integrations`, `last_report_source` and `last_uploaded_file_name`, and `getDefaultInputs` reads
 * `default_inputs` in preference to the durable columns.
 */
export async function persistAnalyticsReportInputs(input: ResolvedReportInput): Promise<void> {
  await persistReportInputsWithoutProfileMutation(input);
}

export type { ReportRequestPayload, ResolvedReportInput } from './reportInputResolver';
