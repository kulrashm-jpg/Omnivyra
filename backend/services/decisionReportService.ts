import { listDecisionObjects, type DecisionReportTier, type PersistedDecisionObject } from './decisionObjectService';

export interface DecisionReportView {
  company_id: string;
  report_tier: DecisionReportTier;
  entity_scope: {
    entity_type: PersistedDecisionObject['entity_type'] | 'mixed';
    entity_id: string | null;
  };
  summary: {
    total: number;
    open: number;
    resolved: number;
    ignored: number;
    avg_confidence: number;
    top_issue_types: Array<{ issue_type: string; count: number }>;
    top_action_types: Array<{ action_type: string; count: number }>;
  };
  decisions: PersistedDecisionObject[];
}

function averageConfidence(decisions: PersistedDecisionObject[]): number {
  if (decisions.length === 0) return 0;
  const total = decisions.reduce((sum, item) => sum + Number(item.confidence_score ?? 0), 0);
  return Math.round((total / decisions.length) * 1000) / 1000;
}

function topCounts<T extends 'issue_type' | 'action_type'>(
  decisions: PersistedDecisionObject[],
  key: T
): Array<{ [K in T]: string } & { count: number }> {
  const counts = new Map<string, number>();
  for (const item of decisions) {
    const value = String(item[key] ?? '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ [key]: value, count } as Array<{ [K in T]: string } & { count: number }>[number]))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function getDecisionReportView(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  entityType?: PersistedDecisionObject['entity_type'];
  entityId?: string | null;
  sourceService?: string;
  status?: Array<'open' | 'resolved' | 'ignored'>;
}): Promise<DecisionReportView> {
  const viewName =
    params.reportTier === 'snapshot' ? 'snapshot_view' :
    params.reportTier === 'growth' ? 'growth_view' :
    'deep_view';

  const decisions = await listDecisionObjects({
    viewName,
    companyId: params.companyId,
    entityType: params.entityType,
    entityId: params.entityId,
    sourceService: params.sourceService,
    status: params.status ?? ['open'],
    limit: 200,
  });

  return {
    company_id: params.companyId,
    report_tier: params.reportTier,
    entity_scope: {
      entity_type: params.entityType ?? 'mixed',
      entity_id: params.entityId ?? null,
    },
    summary: {
      total: decisions.length,
      open: decisions.filter((item) => item.status === 'open').length,
      resolved: decisions.filter((item) => item.status === 'resolved').length,
      ignored: decisions.filter((item) => item.status === 'ignored').length,
      avg_confidence: averageConfidence(decisions),
      top_issue_types: topCounts(decisions, 'issue_type'),
      top_action_types: topCounts(decisions, 'action_type'),
    },
    decisions,
  };
}
