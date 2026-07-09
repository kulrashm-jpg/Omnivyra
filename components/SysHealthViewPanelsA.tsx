/** SysHealthViewPanelsA — verbatim JSX slice of SysHealthView (babel-verified sibling range). */
/** SysHealthView — thin composition: controller + verbatim JSX. */
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

const SEVERITY_CONFIG: Record<Severity, { bg: string; text: string; dot: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-600',    label: 'CRITICAL' },
  WARNING:  { bg: 'bg-yellow-50', text: 'text-yellow-600', dot: 'bg-yellow-600', label: 'WARNING'  },
  INFO:     { bg: 'bg-blue-50',   text: 'text-blue-600',   dot: 'bg-blue-600',   label: 'INFO'     },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.INFO;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatusDot({ status }: { status: 'ok' | 'degraded' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'ok' ? 'bg-green-600' : 'bg-red-600 animate-pulse'}`} />
      {status === 'ok' ? 'Operational' : 'Degraded'}
    </span>
  );
}

function MetaExpander({ metadata }: { metadata: Record<string, unknown> | null }) {
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

const STATE_CONFIG: Record<SystemStatus, {
  border: string; bg: string; icon: string; label: string; textColor: string;
}> = {
  healthy:  { border: 'border-green-300',  bg: 'bg-green-50',  icon: '✓', label: 'System Healthy',   textColor: 'text-green-600'  },
  degraded: { border: 'border-yellow-300', bg: 'bg-yellow-50', icon: '⚠', label: 'System Degraded',  textColor: 'text-yellow-600' },
  critical: { border: 'border-red-300',    bg: 'bg-red-50',    icon: '✕', label: 'System Critical',  textColor: 'text-red-600'    },
};

function SystemStateBanner({ state }: { state: SystemHealthData['systemState'] }) {
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
const TABS: { key: Tab; label: string }[] = [
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
import { useSysHealthViewController } from './SysHealthViewController';

export default function SysHealthViewPanelsA({ f }: { f: ReturnType<typeof useSysHealthViewController> }) {
  const {
    d,
    _notReady, activeSection, activityData, activityLoading, authResolved, cacheData, cacheLoading, cacheMsg, cookieChecked, data,
    drillMonth, drillYear, drilldown, error, fetchActivityBreakdown, fetchCacheData, fetchData, fetchIntelligence, filtered,
    flushCache, intel, intelLoading, isSuperAdmin, loading, now2, railwayView, router, setActiveSection, setActivityData,
    setActivityLoading, setAuthResolved, setCacheData, setCacheLoading, setCacheMsg, setCookieChecked, setData, setDrillMonth,
    setDrillYear, setDrilldown, setError, setIntel, setIntelLoading, setIsSuperAdmin, setLoading, setRailwayView, setTab, tab
  } = f;
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">System Health</h1>
          <p className="text-sm text-slate-600 mt-0.5">Anomaly detection · Last 24 hours</p>
        </div>
        <button
          onClick={() => void fetchData()}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors shadow-sm"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm shadow-sm">
          {error}
        </div>
      )}

      {/* System State Banner */}
      {data?.systemState && <SystemStateBanner state={data.systemState} />}

      {/* System Status */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Redis */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <p className="text-xs text-slate-600 mb-1.5 font-medium">Redis</p>
            <StatusDot status={data.systemStatus.redis} />
            {data.systemStatus.last_redis_failure && (
              <p className="text-xs text-slate-600 mt-1">
                Last failure: {fmt(data.systemStatus.last_redis_failure)}
              </p>
            )}
          </div>
          {/* Critical */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <p className="text-xs text-slate-600 mb-1.5 font-medium">Critical (24 h)</p>
            <p className={`text-2xl font-bold ${data.summary.critical_24h > 0 ? 'text-red-600' : 'text-slate-700'}`}>
              {data.summary.critical_24h}
            </p>
            {data.summary.last_critical_at && (
              <p className="text-xs text-slate-600 mt-1">
                Last: {fmt(data.summary.last_critical_at)}
              </p>
            )}
          </div>
          {/* Warning */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <p className="text-xs text-slate-600 mb-1.5 font-medium">Warnings (24 h)</p>
            <p className={`text-2xl font-bold ${data.summary.warning_24h > 0 ? 'text-yellow-600' : 'text-slate-700'}`}>
              {data.summary.warning_24h}
            </p>
          </div>
          {/* Auth events */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <p className="text-xs text-slate-600 mb-2 font-medium">Auth Events (24 h)</p>
            <div className="space-y-0.5">
              {Object.entries(data.authEventCounts).slice(0, 3).map(([evt, cnt]) => (
                <div key={evt} className="flex items-center justify-between">
                  <span className="text-xs text-slate-600 truncate">{evt.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-medium text-slate-900 ml-2">{cnt}</span>
                </div>
              ))}
              {Object.keys(data.authEventCounts).length === 0 && (
                <span className="text-xs text-slate-600">No events</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 pb-0">
        {TABS.map(t => {
          let borderColor = 'border-slate-300';
          if (t.key === 'all') borderColor = 'border-blue-600';
          else if (t.key === 'user') borderColor = 'border-slate-400';
          else if (t.key === 'company') borderColor = 'border-slate-400';
          else if (t.key === 'system') borderColor = 'border-red-600';
          else if (t.key === 'railway') borderColor = 'border-purple-600';
          
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-all ${
                tab === t.key
                  ? `text-white bg-blue-600 border-b-2 ${borderColor}`
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
              {data && t.key !== 'all' && (
                <span className="ml-1.5 text-xs text-slate-500">
                  ({(data.anomalies ?? []).filter(a => a.entity_type === t.key).length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Anomaly Table, Railway Efficiency, or Cache Management */}
      {tab === 'cache' ? (
        <div className="space-y-4">
          {cacheMsg && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
              {cacheMsg}
            </div>
          )}

          {cacheLoading && !cacheData ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm">Loading cache stats…</div>
          ) : cacheData ? (
            <>
              {/* Redis overview */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-800">Redis</h2>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cacheData.redis.available ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                    {cacheData.redis.available ? 'Connected' : 'Unavailable'}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: 'Memory Used',    value: cacheData.redis.used_memory },
                    { label: 'Peak Memory',    value: cacheData.redis.peak_memory },
                    { label: 'Max Memory',     value: cacheData.redis.max_memory },
                    { label: 'Eviction Policy', value: cacheData.redis.eviction_policy },
                    { label: 'Evicted Keys',   value: cacheData.redis.evicted_keys.toLocaleString() },
                    { label: 'Expired Keys',   value: cacheData.redis.expired_keys.toLocaleString() },
                    { label: 'Clients',        value: cacheData.redis.connected_clients.toString() },
                    { label: 'Uptime',         value: `${cacheData.redis.uptime_days}d` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 rounded-md p-3">
                      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-slate-800 font-mono">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Key counts per layer */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-medium text-slate-600 mb-2">Keys by Layer</p>
                  <div className="space-y-1.5">
                    {cacheData.key_counts.map(({ prefix, count }) => (
                      <div key={prefix} className="flex items-center justify-between">
                        <span className="text-xs text-slate-600 font-mono">{prefix}</span>
                        <span className={`text-xs font-semibold ${count === -1 ? 'text-slate-400' : 'text-slate-800'}`}>
                          {count === -1 ? 'scan error' : count.toLocaleString()} keys
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cache layers + flush controls */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-800 mb-4">Cache Layers</h2>
                <div className="space-y-3">
                  {cacheData.layers.map((layer) => (
                    <div key={layer.prefix} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{layer.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">TTL: {layer.ttl} · {layer.auto_evict ? 'Auto-evict enabled' : 'Manual eviction'}</p>
                      </div>
                      {layer.prefix === 'ai_cache' && (
                        <button
                          onClick={() => void flushCache('flush_ai')}
                          className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors font-medium"
                        >
                          Flush
                        </button>
                      )}
                      {layer.prefix === 'ext_api' && (
                        <button
                          onClick={() => void flushCache('flush_ext_api')}
                          className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors font-medium"
                        >
                          Flush
                        </button>
                      )}
                      {layer.prefix === 'intelligence' && (
                        <button
                          onClick={() => void flushCache('flush_intelligence')}
                          className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors font-medium"
                        >
                          Flush
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* External API cache hit rate */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-800 mb-4">External API Cache (current process)</h2>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-green-50 rounded-md p-3">
                    <p className="text-xs text-slate-500 mb-0.5">Hits</p>
                    <p className="text-xl font-bold text-green-700">{cacheData.ext_api_cache.hits.toLocaleString()}</p>
                  </div>
                  <div className="bg-orange-50 rounded-md p-3">
                    <p className="text-xs text-slate-500 mb-0.5">Misses</p>
                    <p className="text-xl font-bold text-orange-600">{cacheData.ext_api_cache.misses.toLocaleString()}</p>
                  </div>
                  <div className="bg-blue-50 rounded-md p-3">
                    <p className="text-xs text-slate-500 mb-0.5">Hit Rate</p>
                    <p className="text-xl font-bold text-blue-700">
                      {cacheData.ext_api_cache.hit_rate !== null ? `${cacheData.ext_api_cache.hit_rate}%` : '—'}
                    </p>
                  </div>
                </div>
                {Object.keys(cacheData.ext_api_cache.per_api_hits).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-600 mb-2">Per API</p>
                    <div className="space-y-1">
                      {Object.entries(cacheData.ext_api_cache.per_api_hits).map(([api, hits]) => {
                        const misses = cacheData.ext_api_cache.per_api_misses[api] ?? 0;
                        const total = hits + misses;
                        const rate = total > 0 ? Math.round((hits / total) * 100) : 0;
                        return (
                          <div key={api} className="flex items-center gap-3">
                            <span className="text-xs text-slate-600 font-mono w-32 truncate">{api}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-green-500 h-full rounded-full" style={{ width: `${rate}%` }} />
                            </div>
                            <span className="text-xs text-slate-600 w-10 text-right">{rate}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-400 text-right">Collected {new Date(cacheData.collected_at).toLocaleTimeString()} · Auto-refreshes every 60s</p>
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">Cache data unavailable</div>
          )}
        </div>
      ) : tab === 'railway' ? (
        <div className="space-y-4">
          {/* Railway sub-tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-0">
            <button
              onClick={() => setRailwayView('company-costs')}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-all ${
                railwayView === 'company-costs'
                  ? 'text-white bg-blue-600 border-b-2 border-purple-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              💰 Company & Activity Breakdown
            </button>
            <button
              onClick={() => setRailwayView('efficiency')}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-all ${
                railwayView === 'efficiency'
                  ? 'text-white bg-blue-600 border-b-2 border-amber-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚡ Feature Efficiency
            </button>
          </div>

          {/* Railway view content */}
          {railwayView === 'company-costs' ? (
            <RailwayCompanyCostsPanel />
          ) : (
            <RailwayEfficiencyPanel />
          )}
        </div>
      ) : loading && !data ? (
        <div className="flex items-center justify-center h-32 text-slate-600 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
          No anomalies in the last 24 hours 🎉
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-600 uppercase tracking-wide bg-slate-50">
                <th className="text-left px-4 py-3 w-24">Severity</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Entity</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Value / Threshold</th>
                <th className="text-left px-4 py-3 hidden xl:table-cell">Details</th>
                <th className="text-left px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map(anomaly => (
                <tr key={anomaly.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <SeverityBadge severity={anomaly.severity} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-700">{anomaly.type}</span>
                    {anomaly.alerted_at && (
                      <span className="ml-2 text-xs text-blue-600">notified</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-slate-600">
                      {anomaly.entity_type}
                      {anomaly.entity_id && (
                        <span className="text-slate-500"> / {anomaly.entity_id.slice(0, 12)}…</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {anomaly.metric_value != null ? (
                      <span className="text-xs text-slate-600">
                        <span className="text-slate-900 font-medium">{anomaly.metric_value}</span>
                        {anomaly.threshold != null && (
                          <span className="text-slate-500"> / {anomaly.threshold.toFixed(1)}</span>
                        )}
                        {anomaly.baseline != null && (
                          <span className="text-slate-600"> (base {anomaly.baseline.toFixed(1)}/h)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <MetaExpander metadata={anomaly.metadata} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-600">{fmt(anomaly.created_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Baseline reference */}
      {data && Object.keys(data.baselines).length > 0 && (
        <details className="mt-6">
          <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-800 select-none font-medium">
            Current baselines (hourly averages over last 24 h)
          </summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(data.baselines).map(([type, avg]) => (
              <div key={type} className="bg-white border border-slate-200 rounded p-2 shadow-sm">
                <p className="text-xs font-mono text-slate-600 truncate">{type}</p>
                <p className="text-sm font-medium text-slate-900">
                  {avg.toFixed(2)}<span className="text-xs text-slate-600 ml-0.5">/h</span>
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
