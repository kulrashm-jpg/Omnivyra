/**
 * Timeline rows for the snapshot progress comparison (GET /api/reports/[reportId]).
 *
 * `attachProgressComparison` uses at most the 6 newest snapshot-category rows,
 * and for the row being viewed it uses the payload it already has. The route
 * used to select 18 rows WITH `reports.data` (about 0.7 MB each in prod), so
 * every JSON and HTML view pulled roughly 12 MB from PostgREST before it could
 * respond. This runs the same filter in two steps:
 *   1. the same query over the light columns only (no `data`), limit 18;
 *   2. `data` for just the rows the comparison will use, minus the current row.
 * The rows, their order and the comparison result are the same as before.
 */
import { isSnapshotCategoryRow } from '../../../pages/api/reports/reportComparisonAttachment';

export type TimelineReportRow = {
  id: string;
  company_id: string;
  domain: string;
  report_type: string;
  status: string;
  created_at: string;
  data: unknown;
  metadata: unknown;
};

/** Same window the comparison applies (attachProgressComparison slices to 6). */
export const TIMELINE_COMPARISON_ROWS = 6;
/** Candidate rows scanned before the snapshot-category filter (unchanged from the old query). */
export const TIMELINE_CANDIDATE_ROWS = 18;

const LIGHT_COLUMNS = 'id, company_id, domain, report_type, status, created_at, metadata';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export async function loadSnapshotTimelineRows(
  db: Db,
  params: { companyId: string; domain: string; createdAt: string; currentReportId: string },
): Promise<TimelineReportRow[]> {
  const { data: candidates } = await db
    .from('reports')
    .select(LIGHT_COLUMNS)
    .eq('company_id', params.companyId)
    .eq('domain', params.domain)
    .in('report_type', ['snapshot', 'content_readiness'])
    .eq('status', 'completed')
    .lte('created_at', params.createdAt)
    .order('created_at', { ascending: false })
    .limit(TIMELINE_CANDIDATE_ROWS);

  const selected = ((candidates ?? []) as Array<Omit<TimelineReportRow, 'data'>>)
    .filter(isSnapshotCategoryRow)
    .slice(0, TIMELINE_COMPARISON_ROWS);

  // The current row is replaced by the already-mapped payload; its data is never read.
  const needData = selected.map((row) => row.id).filter((id) => id !== params.currentReportId);
  const dataById = new Map<string, unknown>();
  if (needData.length > 0) {
    const { data: withData } = await db
      .from('reports')
      .select('id, data')
      .in('id', needData)
      .eq('company_id', params.companyId);
    for (const row of (withData ?? []) as Array<{ id: string; data: unknown }>) {
      dataById.set(row.id, row.data);
    }
  }

  return selected.map((row) => ({ ...row, data: dataById.get(row.id) ?? null }));
}
