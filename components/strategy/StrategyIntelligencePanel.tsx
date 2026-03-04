/**
 * Strategy Intelligence Panel — read-only surface for awareness, drift, trend, bias, AI pressure.
 * No buttons, no auto-actions, no conditional hiding. Enterprise minimal.
 */

import React from 'react';

export type StrategyStatusPayload = {
  status?: string;
  strategy_awareness?: {
    awareness_level?: 'LOW' | 'MEDIUM' | 'HIGH';
    awareness_summary?: string[];
  };
  strategic_drift?: {
    drift_detected?: boolean;
    drift_type?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH';
    summary?: string[];
  };
  strategic_memory_trend?: {
    trend?: 'IMPROVING' | 'DECLINING' | 'STABLE';
    summary?: string[];
  };
  strategy_bias?: {
    bias_weight?: number;
    bias_level?: 'LOW' | 'MODERATE' | 'HIGH';
    bias_reasoning?: string[];
  };
  weekly_strategy_intelligence?: {
    intelligence_level?: 'LOW' | 'MEDIUM' | 'HIGH';
    ai_pressure?: {
      high_priority_actions?: number;
      medium_priority_actions?: number;
      low_priority_actions?: number;
    };
  };
};

function levelColor(level: string): string {
  const l = (level || '').toUpperCase();
  if (l === 'HIGH') return 'text-red-700 bg-red-50';
  if (l === 'MEDIUM' || l === 'MODERATE') return 'text-amber-700 bg-amber-50';
  return 'text-slate-600 bg-slate-50';
}

function trendColor(trend: string): string {
  const t = (trend || '').toUpperCase();
  if (t === 'IMPROVING') return 'text-emerald-700 bg-emerald-50';
  if (t === 'DECLINING') return 'text-red-700 bg-red-50';
  return 'text-slate-600 bg-slate-50';
}

const NO_DATA = 'No data yet';

export default function StrategyIntelligencePanel(props: { data?: StrategyStatusPayload | null }) {
  const d = props.data;
  const awareness = d?.strategy_awareness;
  const drift = d?.strategic_drift;
  const trend = d?.strategic_memory_trend;
  const bias = d?.strategy_bias;
  const intelligence = d?.weekly_strategy_intelligence;
  const pressure = intelligence?.ai_pressure;

  return (
    <div
      className="mt-4 pt-4 border-t border-slate-200"
      role="region"
      aria-label="Strategy intelligence"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        Strategy Intelligence
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* A) Awareness */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500 mb-1">Awareness</p>
          <p className={`text-sm font-medium inline-block px-1.5 py-0.5 rounded ${levelColor(awareness?.awareness_level ?? '')}`}>
            {awareness?.awareness_level ?? NO_DATA}
          </p>
          {Array.isArray(awareness?.awareness_summary) && awareness.awareness_summary.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 list-disc list-inside">
              {awareness.awareness_summary.slice(0, 3).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-slate-400">{NO_DATA}</p>
          )}
        </div>

        {/* B) Drift */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500 mb-1">Drift</p>
          <p className="text-sm font-medium text-slate-700">
            {drift?.drift_type ?? NO_DATA}
          </p>
          {drift?.severity != null && (
            <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${levelColor(drift.severity)}`}>
              {drift.severity}
            </span>
          )}
          {Array.isArray(drift?.summary) && drift.summary.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 list-disc list-inside">
              {drift.summary.slice(0, 2).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : drift == null && (
            <p className="mt-1 text-xs text-slate-400">{NO_DATA}</p>
          )}
        </div>

        {/* C) Trend */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500 mb-1">Engagement trend</p>
          <span className={`inline-block px-1.5 py-0.5 rounded text-sm font-medium ${trendColor(trend?.trend ?? '')}`}>
            {trend?.trend ?? NO_DATA}
          </span>
          {Array.isArray(trend?.summary) && trend.summary.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">{trend.summary[0]}</p>
          )}
          {trend == null && <p className="mt-1 text-xs text-slate-400">{NO_DATA}</p>}
        </div>

        {/* D) Bias */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500 mb-1">Bias</p>
          <p className={`text-sm font-medium inline-block px-1.5 py-0.5 rounded ${levelColor(bias?.bias_level ?? '')}`}>
            {bias?.bias_level ?? NO_DATA}
          </p>
          {typeof bias?.bias_weight === 'number' && (
            <div className="mt-1.5">
              <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-400 rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, bias.bias_weight * 100))}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{bias.bias_weight.toFixed(2)}</p>
            </div>
          )}
          {bias == null && <p className="mt-1 text-xs text-slate-400">{NO_DATA}</p>}
        </div>

        {/* E) AI Pressure */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-slate-500 mb-1">AI pressure</p>
          {pressure != null ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                High: {pressure.high_priority_actions ?? 0}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                Medium: {pressure.medium_priority_actions ?? 0}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                Low: {pressure.low_priority_actions ?? 0}
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-400">{NO_DATA}</p>
          )}
          {intelligence?.intelligence_level != null && (
            <p className={`mt-1 inline-block px-1.5 py-0.5 rounded text-xs ${levelColor(intelligence.intelligence_level)}`}>
              Level: {intelligence.intelligence_level}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
