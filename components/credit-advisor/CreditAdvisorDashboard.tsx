'use client';

/**
 * Credit Advisor dashboard (Phase 6). Read-only consumption intelligence.
 * Renders: Credit Overview · Burn Rate · Days Remaining · Top Modules ·
 * Top Activities · Optimization Recommendations · Subscription Health.
 *
 * Pure presentation over the /api/credits/advisor payload — no mutations.
 */

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Wallet,
  Flame,
  CalendarClock,
  Layers,
  Activity,
  Lightbulb,
  HeartPulse,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCreditAdvisor } from '@/hooks/useCreditAdvisor';
import type {
  AttributionRow,
  HealthBand,
  Recommendation,
  RiskLevel,
  TrendDirection,
} from '@/backend/services/creditAdvisor/creditAdvisorTypes';

const fmt = (n: number) => Math.round(n).toLocaleString();

const RISK_STYLES: Record<RiskLevel, string> = {
  Healthy: 'bg-emerald-100 text-emerald-700',
  Monitor: 'bg-amber-100 text-amber-700',
  'At Risk': 'bg-orange-100 text-orange-700',
  Critical: 'bg-red-100 text-red-700',
};

const BAND_STYLES: Record<HealthBand, string> = {
  Excellent: 'text-emerald-600',
  Healthy: 'text-emerald-600',
  Monitor: 'text-amber-600',
  'At Risk': 'text-orange-600',
  Critical: 'text-red-600',
};

function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === 'up') return <TrendingUp className="h-3.5 w-3.5 text-red-500" aria-label="rising" />;
  if (trend === 'down') return <TrendingDown className="h-3.5 w-3.5 text-emerald-500" aria-label="falling" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" aria-label="flat" />;
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function AttributionList({ rows }: { rows: AttributionRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-400">No consumption in this window.</p>;
  const max = Math.max(...rows.map((r) => r.percentage), 1);
  return (
    <ul className="space-y-3">
      {rows.slice(0, 6).map((r) => (
        <li key={r.key}>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              {r.label} <TrendIcon trend={r.trend} />
            </span>
            <span className="tabular-nums text-slate-500">
              {fmt(r.credits)} · {r.percentage}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${(r.percentage / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CreditAdvisorDashboard({ orgId }: { orgId: string | null | undefined }) {
  const { status, report, error, refresh } = useCreditAdvisor(orgId, 30);

  if (!orgId || status === 'loading') {
    return <div className="py-20 text-center text-slate-400">Loading credit advisor…</div>;
  }
  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-500" />
        <p className="text-sm text-red-700">Couldn’t load the credit advisor. {error}</p>
        <button onClick={refresh} className="mt-3 text-sm font-medium text-red-700 underline">
          Retry
        </button>
      </div>
    );
  }
  if (status === 'unavailable' || !report) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        No credit account is set up for this organization yet.
      </div>
    );
  }

  const { overview, metrics, forecast, attribution, recommendations, health, forecast_strategy, confidence, spike, coverage } = report;

  const CONF_STYLE: Record<string, string> = {
    'Very High': 'bg-emerald-100 text-emerald-700',
    High: 'bg-emerald-100 text-emerald-700',
    Medium: 'bg-amber-100 text-amber-700',
    Low: 'bg-orange-100 text-orange-700',
    'Very Low': 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
      {/* Widget 1 — Credit Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={<Wallet className="h-4 w-4" />}
          label="Remaining"
          value={fmt(overview.remaining)}
          sub={`${fmt(overview.free)} free · ${fmt(overview.paid)} paid · ${fmt(overview.incentive)} incentive`}
        />
        <StatTile
          icon={<Layers className="h-4 w-4" />}
          label="Consumed (lifetime)"
          value={fmt(overview.consumed_lifetime)}
          sub={`${fmt(metrics.credits_used_30d)} in last 30d`}
        />
        <StatTile
          icon={<Wallet className="h-4 w-4" />}
          label="Allocated (lifetime)"
          value={fmt(overview.allocated)}
          sub={overview.reserved > 0 ? `${fmt(overview.reserved)} reserved` : 'no holds'}
        />
      </div>

      {/* Widgets 2 & 3 — Burn Rate + Days Remaining + Health */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Flame className="h-4 w-4" />}
          label="Daily burn"
          value={fmt(metrics.daily_burn_rate)}
          sub={`${fmt(metrics.weekly_burn_rate)}/wk · ${fmt(metrics.monthly_burn_rate)}/mo`}
        />
        <StatTile
          icon={<Activity className="h-4 w-4" />}
          label="Used today / 7d"
          value={`${fmt(metrics.credits_used_today)} / ${fmt(metrics.credits_used_7d)}`}
          sub={`trend ${metrics.burn_trend}`}
        />
        <StatTile
          icon={<CalendarClock className="h-4 w-4" />}
          label="Days remaining"
          value={forecast.days_remaining === null ? '∞' : `${forecast.days_remaining}`}
          sub={
            forecast.projected_exhaustion_date
              ? `~exhausts ${forecast.projected_exhaustion_date}`
              : 'no exhaustion projected'
          }
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <HeartPulse className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Health</span>
          </div>
          <div className={`mt-2 text-2xl font-semibold ${BAND_STYLES[health.band]}`}>
            {health.score}
            <span className="ml-1 text-sm font-normal">/100</span>
          </div>
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
              RISK_STYLES[forecast.subscription_exhaustion_risk]
            }`}
          >
            {health.band}
          </span>
        </div>
      </div>

      {/* Burn-rate chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-4 w-4 text-orange-500" /> Daily credit consumption (30d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.daily} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="credits" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Forecast & Confidence (hardening) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-indigo-500" /> Forecast &amp; confidence
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${CONF_STYLE[confidence.level] ?? 'bg-slate-100 text-slate-600'}`}>
              {confidence.level} confidence
            </span>
            {confidence.limited_data && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Limited data</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Multi-runway (Phase 4) */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-xl font-semibold text-red-700">{forecast_strategy.runways.conservative.days ?? '∞'}</div>
              <div className="text-xs text-slate-500">Conservative (days)</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-xl font-semibold text-amber-700">{forecast_strategy.runways.balanced.days ?? '∞'}</div>
              <div className="text-xs text-slate-500">Balanced (days)</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xl font-semibold text-emerald-700">{forecast_strategy.runways.aggressive.days ?? '∞'}</div>
              <div className="text-xs text-slate-500">Aggressive (days)</div>
            </div>
          </div>

          {/* Explainability (Phase 6) */}
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <div><strong>{forecast_strategy.explanation.headline_days ?? '∞'} days</strong> — {forecast_strategy.explanation.headline_basis}</div>
            <div className="mt-0.5">Recent usage suggests <strong>{forecast_strategy.explanation.recent_days ?? '∞'} days</strong> — {forecast_strategy.explanation.recent_basis}</div>
            <div className="mt-1 text-xs text-slate-500">{forecast_strategy.explanation.note}</div>
          </div>

          {/* Attribution coverage (Phase 2) */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Attribution coverage</span>
            <span className="font-semibold text-slate-800">{coverage.coverage_pct}%
              {coverage.other_pct > 0 && <span className="ml-1 text-xs font-normal text-slate-400">({coverage.other_pct}% unattributed)</span>}
            </span>
          </div>
          {coverage.top_gaps.length > 0 && (
            <div className="text-xs text-slate-400">
              Top gaps: {coverage.top_gaps.map((g) => `${g.action} (${g.percentage}%)`).join(', ')}
            </div>
          )}

          {/* Spike intelligence (Phase 5) */}
          {spike.detected && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
              <div className="flex items-center gap-1.5 font-semibold text-orange-800">
                <AlertTriangle className="h-4 w-4" /> Consumption spike — {spike.magnitude}× baseline over {spike.duration_days} day(s)
              </div>
              <div className="mt-1 text-xs text-orange-700">
                Recent {fmt(spike.recent_daily)}/day vs {fmt(spike.baseline_daily)}/day baseline
                {spike.estimated_impact_days != null && ` · ~${spike.estimated_impact_days} fewer runway days than the optimistic view`}
              </div>
              {spike.primary_drivers.length > 0 && (
                <div className="mt-1 text-xs text-orange-700">
                  Drivers: {spike.primary_drivers.map((d) => `${d.label} ${d.percentage}%`).join(', ')}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">{confidence.message}</p>
        </CardContent>
      </Card>

      {/* Widgets 4 & 5 — Top Modules + Top Activities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-indigo-500" /> Top consumption drivers — by module
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttributionList rows={attribution.by_module} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-indigo-500" /> Top activities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttributionList rows={attribution.by_activity} />
          </CardContent>
        </Card>
      </div>

      {/* Widget 6 — Optimization Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Optimization recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recommendations.length === 0 ? (
            <p className="text-sm text-slate-400">
              No recommendations — consumption looks healthy and well-distributed.
            </p>
          ) : (
            <ul className="space-y-3">
              {recommendations.map((rec: Recommendation) => (
                <li
                  key={rec.rule}
                  className={`rounded-lg border p-3 ${
                    rec.severity === 'critical'
                      ? 'border-red-200 bg-red-50'
                      : rec.severity === 'warn'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{rec.title}</span>
                    <Badge variant="outline">{rec.category}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{rec.detail}</p>
                  {rec.impact && (
                    <p className="mt-1 text-xs font-medium text-slate-500">{rec.impact}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Widget 7 — Subscription Health detail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-rose-500" /> Subscription health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(health.factors).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-3 text-center">
                <div className="text-lg font-semibold text-slate-800">{v}</div>
                <div className="text-xs capitalize text-slate-500">{k}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Projected month-end balance: <strong>{fmt(forecast.projected_month_end_balance)}</strong>{' '}
            credits · projected month-end consumption:{' '}
            <strong>{fmt(forecast.projected_month_end_consumption)}</strong> ·{' '}
            {forecast.days_left_in_month} days left in month.
          </p>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        Read-only consumption intelligence · generated {new Date(report.generated_at).toLocaleString()}
      </p>
    </div>
  );
}
