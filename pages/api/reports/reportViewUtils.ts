import {
  comparePriorityType,
  type PriorityType,
} from '../../../backend/services/actionPriorityService';

type ReportSectionsShape = {
  sections?: Array<{
    section_name?: string;
    insights?: unknown[];
    opportunities?: unknown[];
    actions?: unknown[];
  }>;
};

type ComposedDelta = {
  content_depth?: number;
  authority_score?: number;
  publishing_frequency?: number;
  engagement_score?: number;
  seo_coverage?: number;
  geo_presence?: number;
  aeo_readiness?: number;
};

type ComposedSection = {
  section_name?: string;
  insights?: unknown[];
  opportunities?: unknown[];
  actions?: unknown[];
};

export function flattenComposedSections(report: ReportSectionsShape): {
  insights: unknown[];
  opportunities: unknown[];
  actions: unknown[];
} {
  const sections = Array.isArray(report.sections) ? report.sections : [];

  return {
    insights: sections.flatMap((section) => Array.isArray(section.insights) ? section.insights : []),
    opportunities: sections.flatMap((section) => Array.isArray(section.opportunities) ? section.opportunities : []),
    actions: sections.flatMap((section) => Array.isArray(section.actions) ? section.actions : []),
  };
}

export function normalizeImpact(impactScore?: number): 'high' | 'medium' | 'low' {
  const value = Number(impactScore ?? 0);
  if (value >= 75) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
}

export function buildPriorityImpactLabel(impactScore?: number, confidenceScore?: number): string {
  const impact = Number(impactScore ?? 0);
  const confidence = Number(confidenceScore ?? 0);
  if (impact >= 80 || confidence >= 0.8) return 'High impact';
  if (impact >= 55 || confidence >= 0.6) return 'Medium impact';
  return 'Emerging impact';
}

export function buildPriorityTimeToImpact(
  effortLevel?: 'low' | 'medium' | 'high',
  confidenceScore?: number,
): string {
  const confidence = Number(confidenceScore ?? 0);
  if (effortLevel === 'low' && confidence >= 0.65) return '1-2 weeks';
  if (effortLevel === 'medium' || confidence >= 0.45) return '2-4 weeks';
  return '4-8 weeks';
}

export function sortReportActions<T extends { priorityType: PriorityType; impactScore: number }>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => comparePriorityType(left, right));
}

export function buildCompetitorStanding(delta?: ComposedDelta): 'Behind' | 'At Par' | 'Ahead' {
  if (!delta) return 'At Par';
  const values = [
    Number(delta.content_depth ?? 0),
    Number(delta.authority_score ?? 0),
    Number(delta.publishing_frequency ?? 0),
    Number(delta.engagement_score ?? 0),
    Number(delta.seo_coverage ?? 0),
    Number(delta.geo_presence ?? 0),
    Number(delta.aeo_readiness ?? 0),
  ];
  const averageDelta = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (averageDelta >= 8) return 'Behind';
  if (averageDelta <= -6) return 'Ahead';
  return 'At Par';
}

export function buildComposedMetrics(
  reportType: 'snapshot' | 'performance' | 'growth',
  sections: ComposedSection[],
): Array<{ label: string; score: number; color: string }> {
  return sections.slice(0, 4).map((section, index) => {
    const insightCount = Array.isArray(section.insights) ? section.insights.length : 0;
    const opportunityCount = Array.isArray(section.opportunities) ? section.opportunities.length : 0;
    const actionCount = Array.isArray(section.actions) ? section.actions.length : 0;
    const totalSignals = insightCount + opportunityCount + actionCount;
    const score = Math.min(totalSignals * 12 + (opportunityCount > 0 ? 8 : 0), 100);

    const color =
      reportType === 'growth'
        ? 'from-emerald-400 to-teal-600'
        : reportType === 'performance'
          ? 'from-blue-500 to-indigo-700'
          : index % 2 === 0
            ? 'from-blue-400 to-blue-600'
            : 'from-green-400 to-green-600';

    return {
      label: section.section_name || `Section ${index + 1}`,
      score,
      color,
    };
  });
}
