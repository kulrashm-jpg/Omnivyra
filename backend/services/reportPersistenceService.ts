import { supabase } from '../db/supabaseClient';
import type { OrchestratedReport } from './ReportOrchestrator';
import { ownedDbTable } from '../db/writeOwner';
import { assertNotGeneratingOnInsert } from './reportCardService';

/**
 * LIFECYCLE EXCEPTION — POST-ORCHESTRATION SHORTCUT
 *
 * This module persists orchestrated reports as already-completed rows for
 * the /api/reports/execute path. It is the ONLY approved write site for
 * the `reports` table outside reportCardService.ts and the requeue helper.
 * It is permitted because:
 *   - it never inserts a `generating` row (asserted at runtime), so it
 *     does not bypass dedupe / heartbeat / retry-containment semantics;
 *   - it uses a synthetic `internal.report.local` domain to avoid colliding
 *     with the per-(company, domain) partial unique index used by the
 *     user-initiated generation lifecycle.
 *
 * If you need to alter this insert: keep the `assertNotGeneratingOnInsert`
 * guard in place. Routing this through createReport instead would force
 * dedupe / retry semantics that do not match the post-orchestration use
 * case (the orchestrator has already produced final output).
 */

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
  const { data, error } = await ownedDbTable('reports')
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

  // Guardrail: this path must never originate a generating row (would
  // bypass dedupe + retry containment). See file header for rationale.
  assertNotGeneratingOnInsert(payload);

  const { data, error } = await ownedDbTable('reports')
    .insert(payload)
    .select('id, report_id, company_id, report_type, created_at, json_output, data')
    .single();

  if (error) {
    throw new Error(`Failed to persist report (${reportType}): ${error.message}`);
  }

  return data as PersistedReportRow;
}
