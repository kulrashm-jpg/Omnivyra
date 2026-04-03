import type { OrchestratedReport } from './ReportOrchestrator';

export type ReportDelta = {
  new_insights: Array<{
    cluster_id: string;
    title: string;
    priority_score: number;
  }>;
  resolved_issues: Array<{
    cluster_id: string;
    title: string;
    previous_priority_score: number;
  }>;
  priority_shifts: Array<{
    cluster_id: string;
    title: string;
    previous_priority_score: number;
    current_priority_score: number;
    delta: number;
  }>;
};

function emptyDelta(): ReportDelta {
  return {
    new_insights: [],
    resolved_issues: [],
    priority_shifts: [],
  };
}

function bundleMap(report: OrchestratedReport | null): Map<string, OrchestratedReport['narratives'][number]> {
  if (!report) return new Map();
  return new Map(report.narratives.map((bundle) => [bundle.cluster_id, bundle]));
}

export function compareReportDelta(params: {
  current: OrchestratedReport;
  previous: OrchestratedReport | null;
}): ReportDelta {
  if (!params.previous) {
    return {
      new_insights: params.current.narratives.slice(0, 10).map((bundle) => ({
        cluster_id: bundle.cluster_id,
        title: bundle.narrative.title,
        priority_score: bundle.narrative.priority_score,
      })),
      resolved_issues: [],
      priority_shifts: [],
    };
  }

  const currentMap = bundleMap(params.current);
  const previousMap = bundleMap(params.previous);
  const delta = emptyDelta();

  for (const [clusterId, currentBundle] of currentMap.entries()) {
    const previousBundle = previousMap.get(clusterId);
    if (!previousBundle) {
      delta.new_insights.push({
        cluster_id: clusterId,
        title: currentBundle.narrative.title,
        priority_score: currentBundle.narrative.priority_score,
      });
      continue;
    }

    const previousPriority = previousBundle.narrative.priority_score;
    const currentPriority = currentBundle.narrative.priority_score;
    if (previousPriority !== currentPriority) {
      delta.priority_shifts.push({
        cluster_id: clusterId,
        title: currentBundle.narrative.title,
        previous_priority_score: previousPriority,
        current_priority_score: currentPriority,
        delta: currentPriority - previousPriority,
      });
    }
  }

  for (const [clusterId, previousBundle] of previousMap.entries()) {
    if (currentMap.has(clusterId)) continue;
    delta.resolved_issues.push({
      cluster_id: clusterId,
      title: previousBundle.narrative.title,
      previous_priority_score: previousBundle.narrative.priority_score,
    });
  }

  delta.new_insights = delta.new_insights.slice(0, 10);
  delta.resolved_issues = delta.resolved_issues.slice(0, 10);
  delta.priority_shifts = delta.priority_shifts
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

  return delta;
}

export function toOrchestratedReportFromStorage(stored: unknown): OrchestratedReport | null {
  if (!stored || typeof stored !== 'object') return null;
  const candidate = stored as Partial<OrchestratedReport>;
  if (!candidate.company_id || !candidate.report_type || !Array.isArray(candidate.narratives)) return null;
  if (!candidate.generated_at || !candidate.diagnosis) return null;
  return candidate as OrchestratedReport;
}
