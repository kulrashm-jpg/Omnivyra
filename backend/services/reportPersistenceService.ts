import { supabase } from '../db/supabaseClient';
import type { OrchestratedReport } from './ReportOrchestrator';

export type PersistedReportRow = {
  id: string;
  report_id: string | null;
  company_id: string;
  report_type: string;
  created_at: string;
  json_output: unknown;
  data: unknown;
};

function fallbackDomain(): string {
  return 'internal.report.local';
}

function normalizeReportType(reportType: OrchestratedReport['report_type']): string {
  return reportType;
}

export async function getLatestPersistedReport(params: {
  companyId: string;
  reportType: OrchestratedReport['report_type'];
}): Promise<PersistedReportRow | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, report_id, company_id, report_type, created_at, json_output, data')
    .eq('company_id', params.companyId)
    .eq('report_type', normalizeReportType(params.reportType))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest persisted report: ${error.message}`);
  }

  return (data ?? null) as PersistedReportRow | null;
}

export async function persistOrchestratedReport(params: {
  userId: string;
  companyId: string;
  reportType: OrchestratedReport['report_type'];
  report: OrchestratedReport;
}): Promise<PersistedReportRow> {
  const reportType = normalizeReportType(params.reportType);

  const payload = {
    company_id: params.companyId,
    user_id: params.userId,
    domain: fallbackDomain(),
    is_free: false,
    report_type: reportType,
    status: 'completed',
    report_id: `${reportType}_${Date.now()}_${Math.round(Math.random() * 100000)}`,
    json_output: params.report,
    data: params.report,
    completed_at: new Date().toISOString(),
    metadata: {
      source: 'report_execute_api',
      schema: 'decision_orchestrated_v1',
    },
  };

  const { data, error } = await supabase
    .from('reports')
    .insert(payload)
    .select('id, report_id, company_id, report_type, created_at, json_output, data')
    .single();

  if (error) {
    throw new Error(`Failed to persist report (${reportType}): ${error.message}`);
  }

  return data as PersistedReportRow;
}
