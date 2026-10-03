import {
  persistReportInputsWithoutProfileMutation,
  resolveReportInput,
  type ReportRequestPayload,
  type ResolvedReportInput,
} from './reportInputResolver';

export async function resolveSnapshotReportInput(params: {
  companyId: string;
  requestPayload?: ReportRequestPayload | null;
}): Promise<ResolvedReportInput> {
  return resolveReportInput({
    companyId: params.companyId,
    reportCategory: 'snapshot',
    requestPayload: params.requestPayload,
  });
}

/**
 * WP-11 (Track J) — THE Report 1 input persist, and the one place the guarantee is enforced.
 *
 * Every Report 1 generation entry point reaches here: `pages/api/reports/generate.ts` (snapshot
 * branch), `reportCardServiceAssembly.ts` and the `reportAutomationService` cron. It writes the
 * report's own `report_settings` namespace and no durable Company Profile field — in particular it
 * never triggers `saveProfile`'s classification recompute, which used to replace `industry_list`,
 * the field ICP generation reads.
 *
 * This deliberately does NOT call `persistResolvedReportInputs`: that mutating function is retained
 * for the analytics categories only.
 */
export async function persistSnapshotReportInputs(input: ResolvedReportInput): Promise<void> {
  await persistReportInputsWithoutProfileMutation(input);
}

export type { ReportRequestPayload, ResolvedReportInput } from './reportInputResolver';
