/**
 * The progress-comparison timeline used to select 18 rows with full
 * `reports.data` (~0.7 MB each). loadSnapshotTimelineRows must return exactly
 * the rows attachProgressComparison used before, in the same order, while
 * fetching `data` only for those rows (minus the one being viewed).
 */
import {
  loadSnapshotTimelineRows,
  TIMELINE_CANDIDATE_ROWS,
} from '../../apiHandlers/reports/reportTimelineRows';
import { isSnapshotCategoryRow } from '../../../pages/api/reports/reportComparisonAttachment';

type Row = {
  id: string; company_id: string; domain: string; report_type: string; status: string;
  created_at: string; metadata: unknown; data: unknown;
};

function makeRows(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 20; i += 1) {
    // Mix in growth/performance content_readiness rows the category filter drops.
    const category = i % 3 === 1 ? 'growth' : 'snapshot';
    rows.push({
      id: `r${i}`,
      company_id: 'c1',
      domain: 'acme.com',
      report_type: i % 5 === 0 ? 'snapshot' : 'content_readiness',
      status: 'completed',
      created_at: new Date(Date.UTC(2026, 9, 24, 12) - i * 3_600_000).toISOString(),
      metadata: { requested_report_category: category },
      data: { composed_report: { marker: `r${i}` } },
    });
  }
  return rows;
}

type Call = { select: string; filters: Array<[string, string, unknown]>; limit?: number };

function fakeDb(rows: Row[], calls: Call[], opts: { failData?: boolean } = {}) {
  return {
    from: (_table: string) => {
      const call: Call = { select: '', filters: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {
        select: (c: string) => { call.select = c; return chain; },
        eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return chain; },
        in: (k: string, v: unknown) => { call.filters.push(['in', k, v]); return chain; },
        lte: (k: string, v: unknown) => { call.filters.push(['lte', k, v]); return chain; },
        order: () => chain,
        limit: (n: number) => { call.limit = n; return chain; },
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
          let out = rows.filter((r) => call.filters.every(([op, k, v]) => {
            const val = (r as Record<string, unknown>)[k];
            if (op === 'eq') return val === v;
            if (op === 'in') return (v as unknown[]).includes(val);
            if (op === 'lte') return String(val) <= String(v);
            return true;
          }));
          out = [...out].sort((a, b) => b.created_at.localeCompare(a.created_at));
          if (call.limit) out = out.slice(0, call.limit);
          const cols = call.select.split(',').map((c) => c.trim());
          if (call.select === 'id, data' && opts.failData) {
            return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok, err);
          }
          const projected = out.map((r) => Object.fromEntries(cols.map((c) => [c, (r as Record<string, unknown>)[c]])));
          return Promise.resolve({ data: projected, error: null }).then(ok, err);
        },
      };
      return chain;
    },
  };
}

/** The old route behaviour: 18 full rows, then attachProgressComparison's filter + slice(0, 6). */
function legacySelection(rows: Row[], createdAt: string): Row[] {
  return rows
    .filter((r) => r.company_id === 'c1' && r.domain === 'acme.com' && r.status === 'completed')
    .filter((r) => ['snapshot', 'content_readiness'].includes(r.report_type))
    .filter((r) => r.created_at <= createdAt)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, TIMELINE_CANDIDATE_ROWS)
    .filter(isSnapshotCategoryRow)
    .slice(0, 6);
}

describe('loadSnapshotTimelineRows', () => {
  const rows = makeRows();
  const current = rows[2];
  const params = { companyId: 'c1', domain: 'acme.com', createdAt: current.created_at, currentReportId: current.id };

  it('returns the same rows, in the same order, as the old 18-row query + comparison slice', async () => {
    const calls: Call[] = [];
    const got = await loadSnapshotTimelineRows(fakeDb(rows, calls), params);
    const expected = legacySelection(rows, current.created_at);
    expect(got.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    for (const r of got) {
      if (r.id === current.id) expect(r.data).toBeNull(); // replaced by the mapped payload
      else expect(r.data).toEqual(rows.find((x) => x.id === r.id)!.data);
    }
  });

  it('never selects `data` on the 18-row scan, and fetches it only for the used rows minus the current one', async () => {
    const calls: Call[] = [];
    const got = await loadSnapshotTimelineRows(fakeDb(rows, calls), params);
    expect(calls).toHaveLength(2);
    expect(calls[0].select).not.toMatch(/\bdata\b/);
    expect(calls[0].limit).toBe(TIMELINE_CANDIDATE_ROWS);
    expect(calls[1].select).toBe('id, data');
    const idFilter = calls[1].filters.find(([op, k]) => op === 'in' && k === 'id')![2] as string[];
    expect(idFilter).toEqual(got.map((r) => r.id).filter((id) => id !== current.id));
    expect(idFilter.length).toBeLessThanOrEqual(6);
    expect(calls[1].filters).toContainEqual(['eq', 'company_id', 'c1']);
  });

  it('skips the data query when the only timeline row is the current report', async () => {
    const calls: Call[] = [];
    const only = [rows[0]];
    const got = await loadSnapshotTimelineRows(fakeDb(only, calls), {
      ...params, createdAt: rows[0].created_at, currentReportId: rows[0].id,
    });
    expect(got.map((r) => r.id)).toEqual([rows[0].id]);
    expect(calls).toHaveLength(1);
  });

  it('a failed data query degrades to rows without data (they map to null and are skipped)', async () => {
    const calls: Call[] = [];
    const got = await loadSnapshotTimelineRows(fakeDb(rows, calls, { failData: true }), params);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.data === null)).toBe(true);
  });
});
