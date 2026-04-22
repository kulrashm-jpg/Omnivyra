import {
  persistResolvedReportInputs,
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

export async function persistSnapshotReportInputs(input: ResolvedReportInput): Promise<void> {
  await persistResolvedReportInputs(input);
}

export type { ReportRequestPayload, ResolvedReportInput } from './reportInputResolver';
