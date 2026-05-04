// AUTH EXEMPT: non-route API helper module without default handler
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { buildProgressComparison } from '../../../backend/services/reportComparisonHelpers';
import {
  buildCompetitorMovementComparison,
  buildTimelineComparison,
} from '../../../backend/services/reportTrendComparisonHelpers';
import { buildStrategicScoreWithDelta } from '../../../backend/services/reportStrategicScoreHelpers';
import type { ReportViewPayload } from './reportViewPayloadTypes';

type TimelineReportRow = {
  id: string;
  company_id: string;
  domain: string;
  report_type: string;
  status: string;
  created_at: string;
  data: unknown;
  metadata: unknown;
};

export function isSnapshotCategoryRow(row: {
  report_type: string;
  metadata: unknown;
}): boolean {
  if (row.report_type === 'snapshot') return true;
  if (row.report_type !== 'content_readiness') return false;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return String(metadata.requested_report_category ?? 'snapshot') === 'snapshot';
}

export function attachProgressComparison(params: {
  currentPayload: ReportViewPayload;
  type: 'snapshot' | 'performance' | 'growth';
  timelineReports: TimelineReportRow[];
  mapStoredReportToPayload: (row: TimelineReportRow) => ReportViewPayload | null;
}): ReportViewPayload {
  if (params.type !== 'snapshot') return params.currentPayload;

  const filteredTimelineReports = params.timelineReports.filter(isSnapshotCategoryRow).slice(0, 6);

  if (filteredTimelineReports.length === 0) {
    const enrichedBase = {
      ...params.currentPayload,
      progressComparison: null,
      competitorMovementComparison: null,
      timelineComparison: null,
    };
    return {
      ...enrichedBase,
      strategicScore: buildStrategicScoreWithDelta({
        current: enrichedBase,
        previous: null,
      }),
    };
  }

  const mappedTimeline = filteredTimelineReports
    .map((row) => {
      if (row.id === params.currentPayload.reportId) return params.currentPayload;
      return params.mapStoredReportToPayload(row);
    })
    .filter((item): item is ReportViewPayload => Boolean(item))
    .sort((left, right) => new Date(right.generated_at).getTime() - new Date(left.generated_at).getTime());

  if (!mappedTimeline.some((item) => item.reportId === params.currentPayload.reportId)) {
    mappedTimeline.unshift(params.currentPayload);
  }

  const previousPayload = mappedTimeline.find((item) => item.reportId !== params.currentPayload.reportId) ?? null;

  if (!previousPayload) {
    const enrichedBase = {
      ...params.currentPayload,
      progressComparison: null,
      competitorMovementComparison: null,
      timelineComparison: buildTimelineComparison({
        snapshots: mappedTimeline.length > 0 ? mappedTimeline : [params.currentPayload],
      }),
    };
    return {
      ...enrichedBase,
      strategicScore: buildStrategicScoreWithDelta({
        current: enrichedBase,
        previous: null,
      }),
    };
  }

  const enrichedBase = {
    ...params.currentPayload,
    progressComparison: buildProgressComparison({
      current: params.currentPayload,
      previous: previousPayload,
    }),
    competitorMovementComparison: buildCompetitorMovementComparison({
      current: params.currentPayload,
      previous: previousPayload,
    }),
    timelineComparison: buildTimelineComparison({
      snapshots: mappedTimeline,
    }),
  };
  return {
    ...enrichedBase,
    strategicScore: buildStrategicScoreWithDelta({
      current: enrichedBase,
      previous: previousPayload,
    }),
  };
}

