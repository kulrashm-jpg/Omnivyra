import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { buildAllOrchestratedReports, type OrchestratedReport } from '../../../backend/services/ReportOrchestrator';
import { compareReportDelta, toOrchestratedReportFromStorage } from '../../../backend/services/ReportDeltaService';
import { getLatestPersistedReport, persistOrchestratedReport } from '../../../backend/services/reportPersistenceService';
import {
  ActionPayloadSchema,
  ReportExecuteResponseSchema,
  confidenceLabelFromScore,
  type ActionPayload,
  type ApiReport,
  type ReportExecuteResponse,
} from '../../../backend/contracts/actionApiContract';

type ExecuteReportsErrorResponse = {
  api_version?: 'v1';
  company_id?: string;
  error?: string;
  code?: string;
};

function mapOwner(owner: 'cmo' | 'marketing_ops' | 'content_lead' | 'analytics'): 'marketing' | 'content' | 'growth' {
  if (owner === 'content_lead') return 'content';
  if (owner === 'marketing_ops') return 'marketing';
  return 'growth';
}

function deriveEffortLevel(timelineDays: number): 'low' | 'medium' | 'high' {
  if (timelineDays <= 10) return 'low';
  if (timelineDays <= 21) return 'medium';
  return 'high';
}

function mapExpectedScoreGain(params: {
  category: 'content' | 'seo' | 'conversion' | 'distribution' | 'trust';
  score: number;
}): { seo?: number; aeo?: number; conversion?: number; authority?: number } {
  const value = Math.max(0, Math.round(params.score));
  if (params.category === 'seo') return { seo: value, authority: Math.max(1, Math.round(value * 0.6)) };
  if (params.category === 'content') return { aeo: value, authority: Math.max(1, Math.round(value * 0.5)) };
  if (params.category === 'conversion') return { conversion: value };
  if (params.category === 'distribution') {
    return {
      seo: Math.max(1, Math.round(value * 0.4)),
      conversion: Math.max(1, Math.round(value * 0.5)),
    };
  }
  return { authority: value };
}

function stableActionId(params: {
  companyId: string;
  bundle: OrchestratedReport['narratives'][number];
}): string {
  const action = params.bundle.action;
  const payload = action.payload ?? {};
  const entity =
    action.target_block_id ||
    (typeof payload.entity_id === 'string' ? payload.entity_id : null) ||
    (typeof payload.campaign_id === 'string' ? payload.campaign_id : null) ||
    (typeof payload.dominant_issue_type === 'string' ? payload.dominant_issue_type : null) ||
    params.bundle.cluster_id;

  const key = [
    params.companyId,
    action.instruction_code,
    action.target_block_id || 'global',
    String(entity),
  ].join('|');

  const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `act_${digest}`;
}

function toActionPayload(params: {
  companyId: string;
  reportType: OrchestratedReport['report_type'];
  bundle: OrchestratedReport['narratives'][number];
}): ActionPayload {
  const action = params.bundle.action;

  return ActionPayloadSchema.parse({
    id: stableActionId({ companyId: params.companyId, bundle: params.bundle }),
    instruction_code: action.instruction_code,
    action_category: action.action_category,
    target_block_id: action.target_block_id,
    impact: action.impact,
    impact_explanation: `${params.bundle.narrative.what_is_happening} ${params.bundle.narrative.why_it_matters}`,
    priority_score: action.priority_score,
    expected_score_gain: mapExpectedScoreGain({
      category: action.action_category,
      score: action.expected_score_gain,
    }),
    confidence: action.confidence,
    confidence_label: confidenceLabelFromScore(action.confidence),
    confidence_per_action: action.confidence_per_action,
    title: params.bundle.narrative.title,
    description: params.bundle.narrative.what_to_do,
    steps: action.steps.map((step) => step.instruction),
    owner: mapOwner(action.owner),
    effort_level: deriveEffortLevel(action.timeline_days),
    timeline_days: action.timeline_days,
    dependencies: action.dependencies,
    action_type: action.action_type,
    payload: action.payload,
    status: 'pending',
    status_source: 'system',
    explainability: {
      source_signals: params.bundle.trust.evidence.key_signals,
      reasoning: params.bundle.narrative.why_it_matters,
    },
  });
}

function toApiReport(report: OrchestratedReport): ApiReport {
  return {
    ...report,
    narratives: report.narratives.map((bundle) => ({
      ...bundle,
      action: toActionPayload({ companyId: report.company_id, reportType: report.report_type, bundle }),
    })),
  };
}

function aggregateDeltaStrings(input: {
  snapshot: ReturnType<typeof compareReportDelta>;
  performance: ReturnType<typeof compareReportDelta>;
  growth: ReturnType<typeof compareReportDelta>;
  strategic: ReturnType<typeof compareReportDelta>;
}): ReportExecuteResponse['delta'] {
  const all = [
    { reportType: 'snapshot', delta: input.snapshot },
    { reportType: 'performance', delta: input.performance },
    { reportType: 'growth', delta: input.growth },
    { reportType: 'strategic', delta: input.strategic },
  ] as const;

  return {
    new_insights: all.flatMap((entry) =>
      entry.delta.new_insights.map((item) => `${entry.reportType}: ${item.title} (priority=${item.priority_score})`)
    ),
    resolved_issues: all.flatMap((entry) =>
      entry.delta.resolved_issues.map((item) => `${entry.reportType}: ${item.title} resolved (prev=${item.previous_priority_score})`)
    ),
    priority_shifts: all.flatMap((entry) =>
      entry.delta.priority_shifts.map((item) => `${entry.reportType}: ${item.title} shifted ${item.delta > 0 ? '+' : ''}${item.delta}`)
    ),
  };
}

function extractTopPrioritiesFromApiReports(reports: {
  snapshot: ApiReport;
  performance: ApiReport;
  growth: ApiReport;
  strategic: ApiReport;
}): ActionPayload[] {
  return [
    ...reports.snapshot.narratives.map((narrative) => narrative.action),
    ...reports.performance.narratives.map((narrative) => narrative.action),
    ...reports.growth.narratives.map((narrative) => narrative.action),
    ...reports.strategic.narratives.map((narrative) => narrative.action),
  ]
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return b.impact - a.impact;
    })
    .slice(0, 5)
    .map((action) => ActionPayloadSchema.parse(action));
}

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

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReportExecuteResponse | ExecuteReportsErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ api_version: 'v1', error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ api_version: 'v1', error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const companyId = await resolveCompanyId(user.id, req.query.company_id as string | undefined);
    if (!companyId) {
      return res.status(403).json({ api_version: 'v1', error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const reports = await buildAllOrchestratedReports(companyId);

    const [prevSnapshot, prevPerformance, prevGrowth, prevStrategic] = await Promise.all([
      getLatestPersistedReport({ companyId, reportType: 'snapshot' }),
      getLatestPersistedReport({ companyId, reportType: 'performance' }),
      getLatestPersistedReport({ companyId, reportType: 'growth' }),
      getLatestPersistedReport({ companyId, reportType: 'strategic' }),
    ]);

    const deltas = {
      snapshot: compareReportDelta({
        current: reports.snapshot,
        previous: toOrchestratedReportFromStorage(prevSnapshot?.json_output ?? prevSnapshot?.data ?? null),
      }),
      performance: compareReportDelta({
        current: reports.performance,
        previous: toOrchestratedReportFromStorage(prevPerformance?.json_output ?? prevPerformance?.data ?? null),
      }),
      growth: compareReportDelta({
        current: reports.growth,
        previous: toOrchestratedReportFromStorage(prevGrowth?.json_output ?? prevGrowth?.data ?? null),
      }),
      strategic: compareReportDelta({
        current: reports.strategic,
        previous: toOrchestratedReportFromStorage(prevStrategic?.json_output ?? prevStrategic?.data ?? null),
      }),
    };

    await Promise.all([
      persistOrchestratedReport({ userId: user.id, companyId, reportType: 'snapshot', report: reports.snapshot }),
      persistOrchestratedReport({ userId: user.id, companyId, reportType: 'performance', report: reports.performance }),
      persistOrchestratedReport({ userId: user.id, companyId, reportType: 'growth', report: reports.growth }),
      persistOrchestratedReport({ userId: user.id, companyId, reportType: 'strategic', report: reports.strategic }),
    ]);

    const apiReports = {
      snapshot: toApiReport(reports.snapshot),
      performance: toApiReport(reports.performance),
      growth: toApiReport(reports.growth),
      strategic: toApiReport(reports.strategic),
    };

    const response: ReportExecuteResponse = {
      api_version: 'v1',
      company_id: companyId,
      snapshot_report: apiReports.snapshot,
      performance_report: apiReports.performance,
      growth_report: apiReports.growth,
      strategic_report: apiReports.strategic,
      top_priorities: extractTopPrioritiesFromApiReports(apiReports),
      delta: aggregateDeltaStrings(deltas),
    };

    return res.status(200).json(ReportExecuteResponseSchema.parse(response));
  } catch (error) {
    console.error('[reports/execute] error:', error);
    return res.status(500).json({
      api_version: 'v1',
      error: 'Failed to execute orchestrated reports',
      code: 'SERVER_ERROR',
    });
  }
}

export default handler;
