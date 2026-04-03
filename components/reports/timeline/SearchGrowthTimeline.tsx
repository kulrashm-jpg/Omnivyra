'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { MarketPulseConfidenceBadge, MarketPulseSignalBox, MarketPulseTrendPill } from '../shared/MarketPulseVisualPrimitives';

type Props = {
  data: {
    snapshots: Array<{
      report_id: string;
      created_at: string;
      unified_score: number | null;
      competitor: {
        domain: string;
        score: number;
      } | null;
      delta_from_previous: number | null;
    }>;
    meta: {
      trend: 'improving' | 'declining' | 'stable';
      total_change: number | null;
      data_points: number;
      data_status: 'complete' | 'partial' | 'insufficient';
    };
  } | null;
};

function fmtDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type TimelineRow = {
  date: string;
  user: number | null;
  competitor: number | null;
  delta: number | null;
  competitorDomain: string | null;
  gap: number | null;
};

function buildAnnotations(rows: TimelineRow[]): string[] {
  const notes: string[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    if (current.delta != null && current.delta >= 5) {
      notes.push(`${current.date}: Significant improvement`);
    } else if (current.delta != null && current.delta <= -5) {
      notes.push(`${current.date}: Performance drop`);
    }

    if (current.gap != null && previous.gap != null) {
      const gapChange = current.gap - previous.gap;
      if (gapChange <= -2) {
        notes.push(`${current.date}: Closing gap`);
      } else if (gapChange >= 2) {
        notes.push(`${current.date}: Falling behind`);
      }
    }
  }
  return notes.slice(0, 4);
}

export default function SearchGrowthTimeline({ data }: Props) {
  if (!data || data.snapshots.length < 2 || data.meta.data_status === 'insufficient') {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><LineChartIcon size={14} />Search Growth Timeline</p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Not enough data to show growth yet
        </div>
      </section>
    );
  }

  const rows: TimelineRow[] = data.snapshots.map((item) => ({
    date: fmtDate(item.created_at),
    user: item.unified_score,
    competitor: item.competitor?.score ?? null,
    competitorDomain: item.competitor?.domain ?? null,
    delta: item.delta_from_previous,
    gap: item.competitor && item.unified_score != null
      ? Number((item.competitor.score - item.unified_score).toFixed(2))
      : null,
  }));

  const competitorDomain =
    data.snapshots.find((item) => item.competitor?.domain)?.competitor?.domain ?? 'Competitor';
  const annotations = buildAnnotations(rows);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><LineChartIcon size={14} />Search Growth Timeline</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">User vs Competitor Movement</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MarketPulseTrendPill trend={data.meta.trend} />
            <MarketPulseConfidenceBadge value={data.meta.data_status === 'complete' ? 'high' : data.meta.data_status === 'partial' ? 'medium' : 'low'} />
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-700">
          Trend: {data.meta.trend} ({data.meta.total_change == null ? 'Signal coverage is currently insufficient' : `${data.meta.total_change >= 0 ? '+' : ''}${Number(data.meta.total_change.toFixed(1))}`})
        </div>
      </div>

      <div className="mt-5 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 6, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1' }}
              formatter={(value: number | null, name: string, item: any) => {
                if (name === 'user') return [value ?? 'NA', 'User score'];
                if (name === 'competitor') return [value ?? 'NA', `${item?.payload?.competitorDomain ?? competitorDomain} score`];
                return [value ?? 'NA', name];
              }}
              labelFormatter={(label: string, payload: any) => {
                const row = payload?.[0]?.payload;
                const competitor = row?.competitor != null ? row.competitor : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.';
                const delta = row?.delta != null ? `${row.delta >= 0 ? '+' : ''}${row.delta}` : 'Insufficient';
                return `${label} | User ${row?.user ?? 'NA'} | Competitor ${competitor} | Delta ${delta}`;
              }}
            />
            <Line type="monotone" dataKey="user" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
            <Line type="monotone" dataKey="competitor" stroke="#94a3b8" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">User</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{competitorDomain}</span>
      </div>

      {annotations.length > 0 ? (
        <div className="mt-4 space-y-2">
          {annotations.map((note) => (
            <MarketPulseSignalBox key={note} title="Timeline Signal" text={note} tone="slate" />
          ))}
        </div>
      ) : null}
    </section>
  );
}

