'use client';

/**
 * Consumption Optimization panel (Phase 18). Read-only.
 * Widgets: 8 Automation Consumption · 9 Optimization Opportunities ·
 * 10 Consumption Drivers · 11 Runway Optimizer · 12 What-If Simulator ·
 * plus the Upgrade Advisor (Phase 19).
 */

import React, { useState } from 'react';
import {
  Bot,
  Sparkles,
  BarChart3,
  Gauge,
  FlaskConical,
  ArrowUpCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCreditOptimization } from '@/hooks/useCreditOptimization';
import type {
  ConsumptionClass,
  Priority,
  TrendDirection,
  UpgradeCategory,
} from '@/backend/services/creditAdvisor/creditAdvisorTypes';

const fmt = (n: number) => Math.round(n).toLocaleString();

const CLASS_STYLE: Record<ConsumptionClass, string> = {
  Low: 'bg-slate-100 text-slate-600',
  Medium: 'bg-sky-100 text-sky-700',
  High: 'bg-amber-100 text-amber-700',
  'Very High': 'bg-red-100 text-red-700',
};

const PRIORITY_STYLE: Record<Priority, string> = {
  Low: 'bg-slate-100 text-slate-600',
  Medium: 'bg-amber-100 text-amber-700',
  High: 'bg-emerald-100 text-emerald-700',
};

const UPGRADE_STYLE: Record<UpgradeCategory, string> = {
  'No Upgrade Needed': 'bg-emerald-100 text-emerald-700',
  'Optimization Recommended': 'bg-sky-100 text-sky-700',
  'Upgrade Recommended': 'bg-amber-100 text-amber-700',
  'Immediate Upgrade Recommended': 'bg-red-100 text-red-700',
};

function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === 'up') return <TrendingUp className="h-3.5 w-3.5 text-red-500" />;
  if (trend === 'down') return <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

export default function OptimizationPanel({ orgId }: { orgId: string | null | undefined }) {
  const { status, report, error, refresh } = useCreditOptimization(orgId, 30);
  const [scenarioId, setScenarioId] = useState<string | null>(null);

  if (!orgId || status === 'loading') {
    return <div className="py-12 text-center text-slate-400">Loading optimization intelligence…</div>;
  }
  if (status === 'error' || !report) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        Couldn’t load optimization intelligence. {error}
        <button onClick={refresh} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  const { automations, opportunities, drivers, runway, upgrade, scenarios } = report;
  const activeScenario = scenarios.find((s) => s.scenario === scenarioId) ?? scenarios[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Upgrade advisor banner (Phase 19) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpCircle className="h-4 w-4 text-indigo-500" /> Upgrade advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${UPGRADE_STYLE[upgrade.category]}`}>
              {upgrade.category}
            </span>
            <span className="text-sm text-slate-500">Plan: {upgrade.current_plan}</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">{upgrade.reasoning}</p>
        </CardContent>
      </Card>

      {/* Widget 11 — Runway optimizer */}
      <div id="runway" className="scroll-mt-24" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-emerald-500" /> Runway optimizer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-2xl font-semibold text-slate-800">
                {runway.current_runway_days ?? '∞'}
              </div>
              <div className="text-xs text-slate-500">Current runway (days)</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-2xl font-semibold text-emerald-700">
                {runway.optimized_runway_days ?? '∞'}
              </div>
              <div className="text-xs text-slate-500">Optimized runway (days)</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-2xl font-semibold text-indigo-600">
                {runway.additional_days_gained === null ? '—' : `+${runway.additional_days_gained}`}
              </div>
              <div className="text-xs text-slate-500">Days gained</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Applying detected optimizations saves ~<strong>{fmt(runway.monthly_credits_saved)}</strong>{' '}
            credits/mo (burn {runway.current_daily_burn} → {runway.optimized_daily_burn}/day).
          </p>
        </CardContent>
      </Card>

      {/* Widget 9 — Optimization opportunities */}
      <div id="opportunities" className="scroll-mt-24" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" /> Optimization opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <p className="text-sm text-slate-400">No optimization opportunities detected in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-400">
                    <th className="py-2">Opportunity</th>
                    <th className="py-2 text-right">Monthly savings</th>
                    <th className="py-2 text-right">Annual savings</th>
                    <th className="py-2 text-right">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((o) => (
                    <tr key={o.rule} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-800">{o.category}</div>
                        <div className="text-xs text-slate-500">{o.recommendation}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">
                        {fmt(o.savings.potential_monthly_savings_credits)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-600">
                        {fmt(o.savings.potential_annual_savings_credits)}
                      </td>
                      <td className="py-2 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[o.priority]}`}>
                          {o.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div id="automation" className="scroll-mt-24" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Widget 8 — Automation consumption */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-indigo-500" /> Automation consumption
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-400">
                    <th className="py-2">Automation</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Monthly</th>
                    <th className="py-2 text-right">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.rows.slice(0, 10).map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-slate-700">{a.name}</div>
                        <div className="text-xs text-slate-400">{a.cadence_label}</div>
                      </td>
                      <td className="py-2 text-xs capitalize text-slate-500">
                        {a.status.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-600">
                        {fmt(a.estimated_monthly_credits)}
                      </td>
                      <td className="py-2 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASS_STYLE[a.classification]}`}>
                          {a.classification}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Total automated: ~{fmt(automations.total_monthly_credits)} credits/mo
            </p>
          </CardContent>
        </Card>

        {/* Widget 10 — Consumption drivers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-indigo-500" /> Consumption drivers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {drivers.length === 0 ? (
              <p className="text-sm text-slate-400">No consumption in this window.</p>
            ) : (
              <ul className="space-y-3">
                {drivers.slice(0, 7).map((d) => (
                  <li key={d.module} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      {d.module} <TrendIcon trend={d.trend} />
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {d.percentage}% · ~{fmt(d.projected_monthly_credits)}/mo
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Widget 12 — What-if simulator */}
      <div id="simulator" className="scroll-mt-24" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-purple-500" /> What-if simulator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {scenarios.map((s) => (
              <button
                key={s.scenario}
                onClick={() => setScenarioId(s.scenario)}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  activeScenario?.scenario === s.scenario
                    ? 'border-purple-400 bg-purple-50 text-purple-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {activeScenario && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xl font-semibold text-emerald-700">
                  {fmt(activeScenario.projected_credits_saved_monthly)}
                </div>
                <div className="text-xs text-slate-500">Credits saved / mo</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xl font-semibold text-indigo-600">
                  {activeScenario.runway_increase_days === null
                    ? '—'
                    : `+${activeScenario.runway_increase_days}`}
                </div>
                <div className="text-xs text-slate-500">Runway days gained</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xl font-semibold text-slate-800">
                  {fmt(activeScenario.projected_month_end_balance)}
                </div>
                <div className="text-xs text-slate-500">Proj. month-end balance</div>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Simulation only — selecting a scenario changes nothing in your account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
