/**
 * Primitive UI building blocks used across every planner-control dashboard
 * tile. Plain Tailwind, no external UI dependencies, no state.
 */

import React from 'react';

export type StatusTone = 'ok' | 'warn' | 'critical' | 'neutral' | 'info';

const TONE_BG: Record<StatusTone, string> = {
  ok:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  info:     'bg-sky-50 text-sky-700 border-sky-200',
  warn:     'bg-amber-50 text-amber-800 border-amber-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  neutral:  'bg-slate-50 text-slate-700 border-slate-200',
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${TONE_BG[tone]}`}>
      {children}
    </span>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatusTone;
}) {
  return (
    <div className={`rounded-lg border p-3 ${TONE_BG[tone]}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint != null && <div className="mt-0.5 text-[11px] opacity-70">{hint}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm p-4 ${className}`}>
      {children}
    </div>
  );
}

export function TableCompact<T>({
  rows,
  columns,
  empty = 'No data',
}: {
  rows: T[];
  columns: Array<{
    key: string;
    label: string;
    render: (row: T) => React.ReactNode;
    className?: string;
  }>;
  empty?: string;
}) {
  if (rows.length === 0) {
    return <div className="text-xs text-slate-500 px-2 py-3">{empty}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-600">
            {columns.map((c) => (
              <th key={c.key} className={`px-2 py-1.5 font-medium ${c.className ?? ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-1.5 align-top ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function relativeTimeMs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const d = Date.now() - ms;
  if (d < 0) return 'in future';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

export function formatNumber(n: number | null | undefined, opts: { suffix?: string; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = opts.digits ?? 0;
  return `${n.toFixed(digits)}${opts.suffix ?? ''}`;
}
