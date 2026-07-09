/** useSysHealthViewController — state/handlers of SysHealthView, verbatim. */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import OrgServiceDrilldown, { type ServiceKey } from './super-admin/OrgServiceDrilldown';
import RailwayEfficiencyPanel from './super-admin/RailwayEfficiencyPanel';
import RailwayCompanyCostsPanel from './super-admin/RailwayCompanyCostsPanel';

// ── Activity Breakdown type ────────────────────────────────────────────────────
interface ActivityBreakdown {
  period: { year: number; month: number };
  system_costs: {
    llm_calls: number; llm_cost_usd: number;
    api_calls: number; api_cost_usd: number;
    total_cost_usd: number;
  };
  by_feature_area: { feature_area: string; call_count: number; total_tokens: number; total_cost_usd: number }[];
  by_process_type: { process_type: string; call_count: number; total_cost_usd: number }[];
  by_platform:     { platform: string; post_count: number; published_count: number }[];
  by_platform_content: { platform: string; content_type: string; post_count: number; published_count: number }[];
}

// ── Intelligence types ────────────────────────────────────────────────────────

interface ServiceCost { service: string; estimatedMonthly: number; breakdown: Record<string,number>; notes: string[]; hasData: boolean }
interface CostEstimate {
  totalMonthlyEstimate: number;
  currency: 'USD';
  confidence: 'low' | 'medium' | 'high';
  breakdown: Record<string, ServiceCost>;
  warnings: string[];
}
interface IntelligenceData {
  metrics: {
    redis?:    { totalOps: number; opsPerMin: number; peakOpsPerMin: number; storageBytesUsed: number; topFeatures: {feature:string;total:number;pct:number}[]; topCommands:{command:string;total:number;pct:number}[] } | null;
    supabase?: { reads: number; writes: number; errors: number; queriesPerMin: number; avgReadLatency: number|null; avgWriteLatency: number|null; available: boolean } | null;
    firebase?: { tokenVerifications: number; revokedChecks: number; authErrors: number; signIns: number; verificationsPerMin: number; avgVerifyLatencyMs: number|null } | null;
    api?:      { totalCalls: number; callsPerMin: number; errors4xx: number; errors5xx: number; errorRate: number; avgLatencyMs: number|null; p95LatencyMs: number|null; topEndpoints:{endpoint:string;calls:number;avgLatencyMs:number|null}[] } | null;
    external?: { totalExternalCalls: number; topServices:{service:string;calls:number;errors:number;avgLatencyMs:number|null}[] } | null;
  };
  cost: CostEstimate | null;
  trends: Record<string, Record<string, unknown>>;
  errors?: Record<string, string>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';

interface Anomaly {
  id:           string;
  type:         string;
  severity:     Severity;
  entity_type:  string;
  entity_id:    string | null;
  metric_value: number | null;
  threshold:    number | null;
  baseline:     number | null;
  metadata:     Record<string, unknown> | null;
  alerted_at:   string | null;
  created_at:   string;
}

type SystemStatus = 'healthy' | 'degraded' | 'critical';

interface SystemHealthData {
  summary: {
    critical_24h:    number;
    warning_24h:     number;
    info_24h:        number;
    last_critical_at: string | null;
  };
  anomalies:       Anomaly[];
  authEventCounts: Record<string, number>;
  systemStatus: {
    redis:              'ok' | 'degraded';
    last_redis_failure: string | null;
  };
  systemState: {
    status:  SystemStatus;
    reasons: string[];
  };
  baselines: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<Severity, { bg: string; text: string; dot: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-600',    label: 'CRITICAL' },
  WARNING:  { bg: 'bg-yellow-50', text: 'text-yellow-600', dot: 'bg-yellow-600', label: 'WARNING'  },
  INFO:     { bg: 'bg-blue-50',   text: 'text-blue-600',   dot: 'bg-blue-600',   label: 'INFO'     },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.INFO;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export function StatusDot({ status }: { status: 'ok' | 'degraded' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'ok' ? 'bg-green-600' : 'bg-red-600 animate-pulse'}`} />
      {status === 'ok' ? 'Operational' : 'Degraded'}
    </span>
  );
}

export function MetaExpander({ metadata }: { metadata: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!metadata || Object.keys(metadata).length === 0) return <span className="text-slate-500 text-xs">—</span>;
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
      >
        {open ? 'hide' : 'view details'}
      </button>
      {open && (
        <pre className="mt-1.5 p-2 bg-slate-100 rounded text-xs text-slate-700 overflow-auto max-h-32 whitespace-pre-wrap break-all border border-slate-200">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export const STATE_CONFIG: Record<SystemStatus, {
  border: string; bg: string; icon: string; label: string; textColor: string;
}> = {
  healthy:  { border: 'border-green-300',  bg: 'bg-green-50',  icon: '✓', label: 'System Healthy',   textColor: 'text-green-600'  },
  degraded: { border: 'border-yellow-300', bg: 'bg-yellow-50', icon: '⚠', label: 'System Degraded',  textColor: 'text-yellow-600' },
  critical: { border: 'border-red-300',    bg: 'bg-red-50',    icon: '✕', label: 'System Critical',  textColor: 'text-red-600'    },
};

export function SystemStateBanner({ state }: { state: SystemHealthData['systemState'] }) {
  const cfg = STATE_CONFIG[state.status];
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${cfg.bg} ${cfg.border} mb-6 shadow-sm`}>
      <span className={`text-lg font-bold mt-0.5 ${cfg.textColor}`}>{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${cfg.textColor}`}>{cfg.label}</p>
        {state.reasons.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {state.reasons.map((r, i) => (
              <li key={i} className="text-xs text-slate-600">{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">No active alerts · All systems operational</p>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.textColor} border ${cfg.border} whitespace-nowrap`}>
        {state.status.toUpperCase()}
      </span>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'user' | 'company' | 'system' | 'railway' | 'cache';
export const TABS: { key: Tab; label: string }[] = [
  { key: 'all',     label: 'All'     },
  { key: 'user',    label: 'User'    },
  { key: 'company', label: 'Company' },
  { key: 'system',  label: 'System'  },
  { key: 'railway', label: '🚂 Railway Efficiency' },
  { key: 'cache',   label: '🗄 Cache' },
];

// ── Cache types ───────────────────────────────────────────────────────────────

interface CacheData {
  redis: {
    available: boolean;
    used_memory: string;
    peak_memory: string;
    max_memory: string;
    eviction_policy: string;
    evicted_keys: number;
    expired_keys: number;
    connected_clients: number;
    uptime_days: number;
  };
  key_counts: { prefix: string; count: number }[];
  ext_api_cache: {
    hits: number;
    misses: number;
    hit_rate: number | null;
    per_api_hits: Record<string, number>;
    per_api_misses: Record<string, number>;
  };
  layers: { name: string; prefix: string; ttl: string; auto_evict: boolean }[];
  collected_at: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

import type { useSysHealth } from '../hooks/useSysHealth';
type S = ReturnType<typeof useSysHealth>;

export function useSysHealthViewController({ d }: { d: S }) {
  const {
    _notReady,
    activeSection,
    activityData,
    activityLoading,
    authResolved,
    cacheData,
    cacheLoading,
    cacheMsg,
    cookieChecked,
    data,
    drillMonth,
    drillYear,
    drilldown,
    error,
    fetchActivityBreakdown,
    fetchCacheData,
    fetchData,
    fetchIntelligence,
    filtered,
    flushCache,
    intel,
    intelLoading,
    isSuperAdmin,
    loading,
    now2,
    railwayView,
    router,
    setActiveSection,
    setActivityData,
    setActivityLoading,
    setAuthResolved,
    setCacheData,
    setCacheLoading,
    setCacheMsg,
    setCookieChecked,
    setData,
    setDrillMonth,
    setDrillYear,
    setDrilldown,
    setError,
    setIntel,
    setIntelLoading,
    setIsSuperAdmin,
    setLoading,
    setRailwayView,
    setTab,
    tab,
  } = d;

  return {
    d,
    _notReady, activeSection, activityData, activityLoading, authResolved, cacheData, cacheLoading, cacheMsg, cookieChecked, data,
    drillMonth, drillYear, drilldown, error, fetchActivityBreakdown, fetchCacheData, fetchData, fetchIntelligence, filtered,
    flushCache, intel, intelLoading, isSuperAdmin, loading, now2, railwayView, router, setActiveSection, setActivityData,
    setActivityLoading, setAuthResolved, setCacheData, setCacheLoading, setCacheMsg, setCookieChecked, setData, setDrillMonth,
    setDrillYear, setDrilldown, setError, setIntel, setIntelLoading, setIsSuperAdmin, setLoading, setRailwayView, setTab, tab
  };
}
// ── ServiceCostCard ────────────────────────────────────────────────────────────
// Reusable card showing cost broken down by process/activity for one infra service.

export interface ProcessRow {
  label: string;
  value: number | null;   // null = no dollar estimate, show sub only
  sub?: string;
}

export function ServiceCostCard({
  title, subtitle, svc, color, borderColor,
  processRows = [], subRows = [], hideTotalBadge = false, extraNote, onClick,
}: {
  title: string;
  subtitle?: string;
  svc?: ServiceCost;
  color: string;
  borderColor: string;
  processRows?: ProcessRow[];
  subRows?: ProcessRow[];
  hideTotalBadge?: boolean;
  extraNote?: string;
  onClick?: () => void;
}) {
  const total = svc?.estimatedMonthly ?? 0;
  const maxVal = Math.max(1, ...processRows.filter(r => r.value != null).map(r => r.value as number));

  return (
    <div
      className={`bg-gray-900 border ${borderColor} rounded-lg p-4 ${onClick ? 'cursor-pointer hover:border-opacity-60 hover:bg-gray-800/50 transition-colors' : ''}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          {subtitle && <p className="text-xs text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {!hideTotalBadge && (
            <span className={`text-sm font-bold ${color}`}>
              ${total.toFixed(2)}<span className="text-xs font-normal text-gray-600">/mo</span>
            </span>
          )}
          {onClick && <span className="text-xs text-gray-600 hover:text-gray-400">↗ orgs</span>}
        </div>
      </div>

      {/* No data state */}
      {!svc?.hasData && svc && (
        <p className="text-xs text-gray-600 mb-2 italic">{svc.notes?.[0] ?? 'No activity data yet'}</p>
      )}

      {/* Cost breakdown bars */}
      {processRows.length > 0 && (
        <div className="space-y-2 mb-3">
          {processRows.map((row, i) => (
            <div key={i}>
              <div className="flex items-start justify-between text-xs mb-0.5 gap-2">
                <span className="text-gray-300 truncate">{row.label}</span>
                <span className={`shrink-0 ${row.value != null ? color : 'text-gray-600'}`}>
                  {row.value != null ? `$${Math.abs(row.value).toFixed(4)}${row.value < 0 ? ' cr' : ''}` : '—'}
                </span>
              </div>
              {row.sub && <p className="text-xs text-gray-600 mb-0.5">{row.sub}</p>}
              {row.value != null && row.value > 0 && (
                <div className="w-full bg-gray-800 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full ${color.replace('text-', 'bg-')}`}
                    style={{ width: `${Math.max(2, (row.value / maxVal) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Activity metrics (no cost estimate — contextual) */}
      {subRows.length > 0 && (
        <div className="border-t border-gray-800 pt-2 mt-2 space-y-1">
          {subRows.map((row, i) => (
            <div key={i} className="flex items-start justify-between text-xs gap-2">
              <span className="text-gray-500 truncate">{row.label}</span>
              <span className="text-gray-400 shrink-0 text-right max-w-[60%]">{row.sub ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Notes from cost engine */}
      {svc?.notes && svc.notes.length > 0 && (
        <p className="text-xs text-gray-600 mt-2 border-t border-gray-800 pt-2">
          {svc.notes[0]}
        </p>
      )}

      {extraNote && (
        <p className="text-xs text-gray-600 mt-1 italic">{extraNote}</p>
      )}
    </div>
  );
}

// ── Intelligence sub-components ───────────────────────────────────────────────

export function IntelCard({
  title, subtitle, children, active, onToggle, highlight,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  active: boolean;
  onToggle: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-gray-900 border rounded-lg p-4 cursor-pointer transition-colors ${
        active
          ? 'border-indigo-500/40 bg-indigo-500/5'
          : highlight
            ? 'border-yellow-500/20 hover:border-yellow-500/40'
            : 'border-gray-800 hover:border-gray-700'
      }`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          {subtitle && <p className="text-xs text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-xs text-gray-600">{active ? '▲' : '▼'}</span>
      </div>
      {children}
    </div>
  );
}

export function MetricRow({
  label, value, sub, highlight,
}: {
  label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium ml-2 ${highlight ? 'text-red-400' : 'text-gray-300'}`}>
        {value}
        {sub && <span className="text-gray-600 ml-1">{sub}</span>}
      </span>
    </div>
  );
}

export function CostLine({ cost }: { cost?: ServiceCost }) {
  if (!cost) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">Est. monthly</span>
      <span className="text-xs font-medium text-yellow-400">${cost.estimatedMonthly.toFixed(2)} [est]</span>
    </div>
  );
}

export function ConfidencePill({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const cfg = {
    low:    'bg-gray-700 text-gray-400',
    medium: 'bg-yellow-500/10 text-yellow-400',
    high:   'bg-green-500/10 text-green-400',
  }[confidence];
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 ${cfg}`}>
      {confidence} confidence
    </span>
  );
}

export function UnavailableNote({ label }: { label: string }) {
  return (
    <p className="text-xs text-gray-700 mt-1 italic">{label} metrics unavailable in this window</p>
  );
}

