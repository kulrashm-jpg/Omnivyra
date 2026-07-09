/** SysHealthViewPanelsB — verbatim JSX slice of SysHealthView (babel-verified sibling range). */
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
import { useSysHealthViewController, ServiceCostCard, IntelCard, MetricRow, UnavailableNote, CostLine, type ProcessRow, ConfidencePill } from './SysHealthViewController';

export default function SysHealthViewPanelsB({ f }: { f: ReturnType<typeof useSysHealthViewController> }) {
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
      <div className="mt-10 border-t border-slate-200 pt-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">System Intelligence</h2>
            <p className="text-xs text-slate-600 mt-0.5">Multi-service metrics · Cost estimates</p>
          </div>
          {intelLoading && <span className="text-xs text-slate-600 animate-pulse">Refreshing…</span>}
          {intel?.errors && Object.keys(intel.errors).length > 0 && (
            <span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-200">
              Partial data — {Object.keys(intel.errors).join(', ')} unavailable
            </span>
          )}
        </div>

        {/* Intelligence grid: 3 columns on wide screens */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

          {/* §2 — Database (Supabase) */}
          <IntelCard
            title="Database"
            subtitle="Supabase"
            active={activeSection === 'supabase'}
            onToggle={() => setActiveSection(s => s === 'supabase' ? null : 'supabase')}
          >
            {intel?.metrics?.supabase ? (
              <>
                <MetricRow label="Reads"        value={intel.metrics.supabase.reads.toLocaleString()} />
                <MetricRow label="Writes"       value={intel.metrics.supabase.writes.toLocaleString()} />
                <MetricRow label="Errors"       value={intel.metrics.supabase.errors.toLocaleString()} highlight={intel.metrics.supabase.errors > 0} />
                <MetricRow label="Queries/min"  value={intel.metrics.supabase.queriesPerMin.toString()} />
                {intel.metrics.supabase.avgReadLatency != null && (
                  <MetricRow label="Avg read"   value={`${intel.metrics.supabase.avgReadLatency.toFixed(0)} ms`} />
                )}
                {activeSection === 'supabase' && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-600 mb-1">Cost contribution</p>
                    <CostLine cost={intel.cost?.breakdown?.['Supabase']} />
                  </div>
                )}
              </>
            ) : <UnavailableNote label="Supabase" />}
          </IntelCard>

          {/* §3 — Auth (Firebase) */}
          <IntelCard
            title="Auth"
            subtitle="Firebase"
            active={activeSection === 'firebase'}
            onToggle={() => setActiveSection(s => s === 'firebase' ? null : 'firebase')}
          >
            {intel?.metrics?.firebase ? (
              <>
                <MetricRow label="Verifications/min" value={intel.metrics.firebase.verificationsPerMin.toString()} />
                <MetricRow label="Total verified"    value={intel.metrics.firebase.tokenVerifications.toLocaleString()} />
                <MetricRow label="Revoked checks"    value={intel.metrics.firebase.revokedChecks.toLocaleString()} />
                <MetricRow label="Auth errors"       value={intel.metrics.firebase.authErrors.toLocaleString()} highlight={intel.metrics.firebase.authErrors > 0} />
                {intel.metrics.firebase.avgVerifyLatencyMs != null && (
                  <MetricRow label="Avg verify"      value={`${intel.metrics.firebase.avgVerifyLatencyMs} ms`} />
                )}
                {activeSection === 'firebase' && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-600 mb-1">Cost contribution</p>
                    <CostLine cost={intel.cost?.breakdown?.['Firebase Auth']} />
                  </div>
                )}
              </>
            ) : <UnavailableNote label="Firebase" />}
          </IntelCard>

          {/* §4 — API Usage */}
          <IntelCard
            title="API Usage"
            subtitle="Vercel / Next.js"
            active={activeSection === 'api'}
            onToggle={() => setActiveSection(s => s === 'api' ? null : 'api')}
          >
            {intel?.metrics?.api ? (
              <>
                <MetricRow label="Calls/min"   value={intel.metrics.api.callsPerMin.toString()} />
                <MetricRow label="Total calls"  value={intel.metrics.api.totalCalls.toLocaleString()} />
                <MetricRow label="4xx errors"   value={intel.metrics.api.errors4xx.toLocaleString()} highlight={intel.metrics.api.errors4xx > 0} />
                <MetricRow label="5xx errors"   value={intel.metrics.api.errors5xx.toLocaleString()} highlight={intel.metrics.api.errors5xx > 0} />
                {intel.metrics.api.avgLatencyMs != null && (
                  <MetricRow label="Avg latency" value={`${intel.metrics.api.avgLatencyMs} ms`} />
                )}
                {intel.metrics.api.p95LatencyMs != null && (
                  <MetricRow label="p95 latency" value={`${intel.metrics.api.p95LatencyMs} ms`} />
                )}
                {activeSection === 'api' && intel.metrics.api.topEndpoints.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
                    <p className="text-xs text-slate-600 mb-1">Top endpoints</p>
                    {intel.metrics.api.topEndpoints.slice(0, 5).map(ep => (
                      <div key={ep.endpoint} className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-600 truncate max-w-[160px]">{ep.endpoint}</span>
                        <span className="text-xs text-slate-600 ml-2">{ep.calls}</span>
                      </div>
                    ))}
                    <div className="mt-2">
                      <CostLine cost={intel.cost?.breakdown?.['Vercel']} />
                    </div>
                  </div>
                )}
              </>
            ) : <UnavailableNote label="API" />}
          </IntelCard>

          {/* §5 — External APIs */}
          <IntelCard
            title="External APIs"
            subtitle="OpenAI · Firebase · LinkedIn"
            active={activeSection === 'external'}
            onToggle={() => setActiveSection(s => s === 'external' ? null : 'external')}
          >
            {intel?.metrics?.external && intel.metrics.external.totalExternalCalls > 0 ? (
              <>
                <MetricRow label="Total calls" value={intel.metrics.external.totalExternalCalls.toLocaleString()} />
                {intel.metrics.external.topServices.slice(0, activeSection === 'external' ? 8 : 3).map(s => (
                  <MetricRow
                    key={s.service}
                    label={s.service}
                    value={s.calls.toLocaleString()}
                    sub={s.errors > 0 ? `${s.errors} err` : undefined}
                  />
                ))}
                {activeSection === 'external' && (
                  <div className="mt-3 pt-3 border-t border-gray-800/60">
                    <CostLine cost={intel.cost?.breakdown?.['AI APIs (OpenAI / Anthropic)']} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-600 mt-1">No external calls observed yet</p>
            )}
          </IntelCard>

          {/* §5 — Redis (instrumented) */}
          <IntelCard
            title="Redis"
            subtitle="Upstash"
            active={activeSection === 'redis'}
            onToggle={() => setActiveSection(s => s === 'redis' ? null : 'redis')}
          >
            {intel?.metrics?.redis ? (
              <>
                <MetricRow label="Ops/min"      value={intel.metrics.redis.opsPerMin.toString()} />
                <MetricRow label="Peak ops/min" value={intel.metrics.redis.peakOpsPerMin.toString()} />
                <MetricRow label="Total ops"    value={intel.metrics.redis.totalOps.toLocaleString()} />
                {intel.metrics.redis.topFeatures[0] && (
                  <MetricRow label="Top feature"  value={`${intel.metrics.redis.topFeatures[0].feature} (${intel.metrics.redis.topFeatures[0].pct}%)`} />
                )}
                {intel.metrics.redis.topCommands[0] && (
                  <MetricRow label="Top command"  value={`${intel.metrics.redis.topCommands[0].command} (${intel.metrics.redis.topCommands[0].pct}%)`} />
                )}
                {activeSection === 'redis' && (
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
                    {intel.metrics.redis.topFeatures.slice(0, 5).map(f => (
                      <div key={f.feature} className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-600">{f.feature}</span>
                        <span className="text-xs text-slate-600">{f.total.toLocaleString()} ({f.pct}%)</span>
                      </div>
                    ))}
                    <div className="mt-2"><CostLine cost={intel.cost?.breakdown?.['Upstash Redis']} /></div>
                  </div>
                )}
              </>
            ) : <UnavailableNote label="Redis" />}
          </IntelCard>

          {/* §6 — Cost Overview */}
          <IntelCard
            title="💰 Cost Overview"
            subtitle={intel?.cost ? `Confidence: ${intel.cost.confidence}` : 'Estimating…'}
            active={activeSection === 'cost'}
            onToggle={() => setActiveSection(s => s === 'cost' ? null : 'cost')}
            highlight
          >
            {intel?.cost ? (
              <>
                <div className="mb-3">
                  <p className="text-2xl font-bold text-slate-900">
                    ${intel.cost.totalMonthlyEstimate.toFixed(2)}
                    <span className="text-xs text-slate-600 font-normal ml-1">/ mo [est]</span>
                  </p>
                  <ConfidencePill confidence={intel.cost.confidence} />
                </div>
                {Object.values(intel.cost.breakdown)
                  .sort((a, b) => b.estimatedMonthly - a.estimatedMonthly)
                  .map(s => (
                    <div key={s.service} className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-slate-600 truncate">{s.service}</span>
                      <span className="text-xs font-medium text-slate-700 ml-2">
                        ${s.estimatedMonthly.toFixed(2)}
                      </span>
                    </div>
                  ))}
                {activeSection === 'cost' && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-yellow-700 leading-relaxed">
                      {intel.cost.warnings[0]}
                    </p>
                    {intel.cost.confidence === 'low' && (
                      <p className="text-xs text-slate-600 mt-1">
                        Counters are at zero — instrument more endpoints to improve accuracy.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : <UnavailableNote label="Cost engine" />}
          </IntelCard>
        </div>
      </div>

      {/* -- Activity & Cost Breakdown ---- */}
      <div className="mt-10 border-t border-slate-200 pt-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Activity × Cost Breakdown</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              How platform activity drives LLM + infra spend · current month
            </p>
          </div>
          {activityLoading && <span className="text-xs text-slate-600 animate-pulse">Loading…</span>}
        </div>

        {activityData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">

            {/* Feature area cost card */}
            <div
              className="bg-white border border-slate-200 rounded-lg p-4 lg:col-span-1 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              onClick={() => setDrilldown({ serviceKey: 'llm', serviceLabel: 'LLM Usage by Organisation', serviceCostUsd: 0 })}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">Cost by Feature Area</p>
                <span className="text-xs text-slate-600">↗ orgs</span>
              </div>
              <p className="text-xs text-slate-600 mb-3">What the platform spends LLM budget on · click for per-org view</p>
              {activityData.by_feature_area.length === 0 ? (
                <p className="text-xs text-slate-600">No LLM usage recorded this month.</p>
              ) : (() => {
                const maxCost = activityData.by_feature_area[0]?.total_cost_usd ?? 1;
                return activityData.by_feature_area.slice(0, 8).map(f => (
                  <div key={f.feature_area} className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-slate-700 truncate max-w-[170px]">{f.feature_area}</span>
                      <span className="text-slate-600 ml-2 shrink-0">
                        ${f.total_cost_usd.toFixed(4)} · {f.call_count.toLocaleString()} calls
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 shadow-sm">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full"
                        style={{ width: `${Math.max(2, (f.total_cost_usd / maxCost) * 100)}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Platform post distribution card */}
            <div
              className="bg-white border border-slate-200 rounded-lg p-4 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              onClick={() => setDrilldown({ serviceKey: 'api', serviceLabel: 'API Usage by Organisation', serviceCostUsd: 0 })}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">Posts by Platform</p>
                <span className="text-xs text-gray-600">↗ orgs</span>
              </div>
              <p className="text-xs text-gray-600 mb-3">
                Where content is scheduled · click for per-org API cost view
              </p>
              {activityData.by_platform.length === 0 ? (
                <p className="text-xs text-gray-600">No scheduled posts this month.</p>
              ) : (() => {
                const totalPosts = activityData.by_platform.reduce((s, p) => s + p.post_count, 0) || 1;
                const PLATFORM_COLORS: Record<string, string> = {
                  linkedin: 'bg-blue-500', twitter: 'bg-sky-400', instagram: 'bg-pink-500',
                  facebook: 'bg-indigo-500', youtube: 'bg-red-500',
                };
                return activityData.by_platform.map(p => (
                  <div key={p.platform} className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="capitalize text-gray-300">{p.platform}</span>
                      <span className="text-gray-500 ml-2">
                        {p.post_count.toLocaleString()} posts
                        {p.published_count > 0 && (
                          <span className="text-green-500 ml-1">({p.published_count} live)</span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className={`${PLATFORM_COLORS[p.platform] ?? 'bg-gray-500'} h-2 rounded-full`}
                        style={{ width: `${Math.max(2, (p.post_count / totalPosts) * 100)}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Content type breakdown (AI text vs creator video etc.) */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <p className="text-sm font-medium text-white mb-1">Content Type Mix</p>
              <p className="text-xs text-gray-600 mb-3">
                Campaign text posts vs creator-dependent content across platforms
              </p>
              {activityData.by_platform_content.length === 0 ? (
                <p className="text-xs text-gray-600">No content activity this month.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-600 border-b border-gray-800">
                        <th className="text-left py-1 font-medium">Platform</th>
                        <th className="text-left py-1 font-medium">Type</th>
                        <th className="text-right py-1 font-medium">Posts</th>
                        <th className="text-right py-1 font-medium">Live</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityData.by_platform_content.slice(0, 10).map(pc => (
                        <tr key={`${pc.platform}-${pc.content_type}`} className="border-b border-gray-800/50">
                          <td className="py-1 capitalize text-gray-300">{pc.platform}</td>
                          <td className="py-1 text-gray-400">{pc.content_type}</td>
                          <td className="py-1 text-right text-gray-300">{pc.post_count.toLocaleString()}</td>
                          <td className="py-1 text-right text-green-500">{pc.published_count || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* System overhead card */}
            <div className="bg-gray-900 border border-orange-500/20 rounded-lg p-4">
              <p className="text-sm font-medium text-white mb-1">Platform / System Overhead</p>
              <p className="text-xs text-gray-600 mb-3">
                LLM + API spend not tied to any organization (admin, health-checks, etc.)
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">LLM calls</span>
                  <span className="text-orange-400">{activityData.system_costs.llm_calls.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">LLM cost</span>
                  <span className="text-orange-400">${activityData.system_costs.llm_cost_usd.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">API calls</span>
                  <span className="text-orange-400">{activityData.system_costs.api_calls.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">API cost</span>
                  <span className="text-orange-400">${activityData.system_costs.api_cost_usd.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold border-t border-gray-800 pt-2 mt-2">
                  <span className="text-gray-300">Total system cost</span>
                  <span className="text-orange-300">${activityData.system_costs.total_cost_usd.toFixed(4)}</span>
                </div>
                {activityData.system_costs.total_cost_usd === 0 && (
                  <p className="text-xs text-gray-600 mt-1">
                    No system-level usage detected — all spend is attributed to organizations.
                  </p>
                )}
              </div>
            </div>

            {/* Top processes card */}
            {activityData.by_process_type.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <p className="text-sm font-medium text-white mb-1">Cost by Process</p>
                <p className="text-xs text-gray-600 mb-3">Internal operations ranked by LLM spend</p>
                {(() => {
                  const maxCost = activityData.by_process_type[0]?.total_cost_usd ?? 1;
                  return activityData.by_process_type.slice(0, 8).map(p => (
                    <div key={p.process_type} className="mb-2">
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="font-mono text-gray-300 truncate max-w-[160px]">{p.process_type}</span>
                        <span className="text-gray-500 ml-2 shrink-0">
                          ${p.total_cost_usd.toFixed(4)} · {p.call_count}×
                        </span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5">
                        <div
                          className="bg-violet-500 h-1.5 rounded-full"
                          style={{ width: `${Math.max(2, (p.total_cost_usd / maxCost) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

          </div>
        ) : !activityLoading ? (
          <p className="text-sm text-gray-600">Activity data unavailable.</p>
        ) : null}

        {/* ── Infra service cost-by-process cards ────────────────────────── */}
        {intel?.cost && (
          <div className="mt-6">
            <p className="text-sm font-medium text-white mb-1">Infrastructure Cost by Process</p>
            <p className="text-xs text-gray-500 mb-4">
              How each service's estimated monthly cost breaks down by internal process or activity type
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

              {/* ── Redis / Workers ── */}
              <ServiceCostCard
                title="Workers (Redis)"
                subtitle="Upstash — BullMQ job queues · ops + storage"
                svc={intel.cost.breakdown['Upstash Redis']}
                color="text-emerald-400"
                borderColor="border-emerald-500/20"
                onClick={() => setDrilldown({ serviceKey: 'redis', serviceLabel: 'Workers (Redis)', serviceCostUsd: intel.cost!.breakdown['Upstash Redis']?.estimatedMonthly ?? 0 })}
                processRows={(() => {
                  const svc        = intel.cost.breakdown['Upstash Redis'];
                  const opsCost    = svc?.breakdown?.['ops']     ?? 0;
                  const storageCost = svc?.breakdown?.['storage'] ?? 0;
                  const redis      = intel.metrics.redis;
                  const rows: ProcessRow[] = [];

                  // ── Storage row — always shown when we have data ──
                  const storageMB = redis?.storageBytesUsed
                    ? (redis.storageBytesUsed / (1024 * 1024))
                    : null;
                  rows.push({
                    label: 'Storage',
                    value: storageCost > 0 ? storageCost : null,
                    sub: storageMB != null
                      ? `${storageMB.toFixed(1)} MB used · 256 MB free · $0.25/GB above`
                      : '256 MB free · $0.25/GB above · fetching…',
                  });

                  // ── Ops cost row ──
                  const monthlyOps = redis ? Math.round(redis.opsPerMin * 60 * 24 * 30) : 0;
                  rows.push({
                    label: 'Commands (ops)',
                    value: opsCost > 0 ? opsCost : null,
                    sub: redis
                      ? `${redis.opsPerMin.toFixed(1)}/min · ~${Math.round(monthlyOps / 1000)}K/mo · 300K/mo free`
                      : '300K ops/month free · $0.20/100K above',
                  });

                  // ── Top-feature rows (by op share) ──
                  if (redis?.topFeatures?.length) {
                    const topCost = opsCost; // distribute ops cost across features
                    for (const f of redis.topFeatures.slice(0, 4)) {
                      rows.push({
                        label: f.feature,
                        value: topCost > 0 ? topCost * (f.pct / 100) : null,
                        sub: `${f.pct}% of ops · ${f.total.toLocaleString()} cmds`,
                      });
                    }
                  }

                  return rows;
                })()}
                subRows={(() => {
                  const redis = intel.metrics.redis;
                  if (!redis?.topCommands?.length) return [];
                  return redis.topCommands.slice(0, 4).map(c => ({
                    label: `CMD: ${c.command}`,
                    value: null,
                    sub: `${c.pct}% of all ops · ${c.total.toLocaleString()} calls`,
                  }));
                })()}
              />

              {/* ── Supabase / Database ── */}
              <ServiceCostCard
                title="Database (Supabase)"
                subtitle="Pro plan — compute + storage + bandwidth"
                svc={intel.cost.breakdown['Supabase']}
                color="text-green-400"
                borderColor="border-green-500/20"
                onClick={() => setDrilldown({ serviceKey: 'supabase', serviceLabel: 'Database (Supabase)', serviceCostUsd: intel.cost!.breakdown['Supabase']?.estimatedMonthly ?? 0 })}
                processRows={[
                  { label: 'Base plan',       value: intel.cost.breakdown['Supabase']?.breakdown?.base      ?? 0, sub: 'Supabase Pro ($25/mo)' },
                  { label: 'Compute',          value: intel.cost.breakdown['Supabase']?.breakdown?.compute   ?? 0, sub: '1 vCPU / 1 GB, always-on' },
                  { label: 'Bandwidth',        value: intel.cost.breakdown['Supabase']?.breakdown?.bandwidth ?? 0, sub: 'Above 50 GB/mo free tier' },
                ]}
                subRows={intel.metrics.supabase ? [
                  { label: 'Reads this window',  value: null, sub: `${intel.metrics.supabase.reads.toLocaleString()} reads · ${intel.metrics.supabase.queriesPerMin.toFixed(1)} q/min` },
                  { label: 'Writes this window', value: null, sub: `${intel.metrics.supabase.writes.toLocaleString()} writes · ${intel.metrics.supabase.errors} errors` },
                  ...(intel.metrics.supabase.avgReadLatency != null ? [{ label: 'Avg read latency', value: null, sub: `${intel.metrics.supabase.avgReadLatency.toFixed(0)} ms` }] : []),
                ] : []}
              />

              {/* ── Railway ── */}
              <ServiceCostCard
                title="Railway (Backend)"
                subtitle="Hobby plan — 1 vCPU / 0.5 GB worker"
                svc={intel.cost.breakdown['Railway']}
                color="text-purple-400"
                borderColor="border-purple-500/20"
                onClick={() => setDrilldown({ serviceKey: 'railway', serviceLabel: 'Railway (Backend)', serviceCostUsd: intel.cost!.breakdown['Railway']?.estimatedMonthly ?? 0 })}
                processRows={[
                  { label: 'CPU (1 vCPU)',     value: intel.cost.breakdown['Railway']?.breakdown?.cpu          ?? 0, sub: '$0.000463/vCPU-hr × 730 h' },
                  { label: 'Memory (0.5 GB)',  value: intel.cost.breakdown['Railway']?.breakdown?.memory       ?? 0, sub: '$0.000231/GB-hr × 730 h' },
                  { label: 'Hobby credit',     value: intel.cost.breakdown['Railway']?.breakdown?.hobby_credit ?? 0, sub: '$5/month included' },
                ]}
                subRows={[
                  { label: 'Services',    value: null, sub: 'Workers · Cron scheduler · Background jobs' },
                  { label: 'Uptime',      value: null, sub: 'Continuous — 730 h/month assumed' },
                ]}
              />

              {/* ── Vercel ── */}
              <ServiceCostCard
                title="Vercel (Frontend)"
                subtitle="Pro plan — Next.js + serverless functions"
                svc={intel.cost.breakdown['Vercel']}
                color="text-blue-400"
                borderColor="border-blue-500/20"
                onClick={() => setDrilldown({ serviceKey: 'vercel', serviceLabel: 'Vercel (Frontend)', serviceCostUsd: intel.cost!.breakdown['Vercel']?.estimatedMonthly ?? 0 })}
                processRows={[
                  { label: 'Base plan',    value: intel.cost.breakdown['Vercel']?.breakdown?.base        ?? 0, sub: 'Vercel Pro ($20/mo)' },
                  { label: 'Invocations',  value: intel.cost.breakdown['Vercel']?.breakdown?.invocations ?? 0, sub: 'Above 1M/mo free tier' },
                ]}
                subRows={intel.metrics.api ? [
                  { label: 'Calls/min',    value: null, sub: `${intel.metrics.api.callsPerMin.toFixed(1)}/min · ${intel.metrics.api.totalCalls.toLocaleString()} total` },
                  { label: 'Error rate',   value: null, sub: `4xx: ${intel.metrics.api.errors4xx} · 5xx: ${intel.metrics.api.errors5xx}` },
                  ...(intel.metrics.api.topEndpoints.slice(0, 3).map(ep => ({
                    label: ep.endpoint,
                    value: (intel.cost!.breakdown['Vercel']?.breakdown?.invocations ?? 0) > 0
                      ? ((intel.cost!.breakdown['Vercel']!.breakdown!.invocations!) * (ep.calls / (intel.metrics.api!.totalCalls || 1)))
                      : null,
                    sub: `${ep.calls.toLocaleString()} calls${ep.avgLatencyMs != null ? ` · ${ep.avgLatencyMs}ms` : ''}`,
                  }))),
                ] : []}
              />

              {/* ── CDN / Vercel Edge ── */}
              <ServiceCostCard
                title="CDN / Edge (Vercel)"
                subtitle="Included in Vercel Pro — edge network + static delivery"
                svc={intel.cost.breakdown['Vercel']}   /* shares Vercel cost */
                color="text-cyan-400"
                borderColor="border-cyan-500/20"
                hideTotalBadge
                onClick={() => setDrilldown({ serviceKey: 'cdn', serviceLabel: 'CDN / Edge (Vercel)', serviceCostUsd: intel.cost!.breakdown['Vercel']?.estimatedMonthly ?? 0 })}
                processRows={[
                  { label: 'Edge bandwidth',   value: null, sub: 'Included up to 1 TB/mo on Pro' },
                  { label: 'Edge functions',   value: null, sub: 'Bundled with invocation quota' },
                  { label: 'Static assets',    value: null, sub: 'Global CDN — no per-request cost' },
                  { label: 'Image optimisation', value: null, sub: 'Included on Pro (up to 5K src imgs/mo)' },
                ]}
                subRows={intel.metrics.api ? [
                  { label: 'p95 latency',  value: null, sub: intel.metrics.api.p95LatencyMs != null ? `${intel.metrics.api.p95LatencyMs} ms` : 'n/a' },
                  { label: 'Avg latency',  value: null, sub: intel.metrics.api.avgLatencyMs != null ? `${intel.metrics.api.avgLatencyMs} ms` : 'n/a' },
                ] : []}
                extraNote="CDN cost is bundled into Vercel Pro. Extra bandwidth above 1 TB billed at $0.15/GB."
              />

              {/* ── Firebase Auth ── */}
              <ServiceCostCard
                title="Firebase Auth"
                subtitle="Blaze plan — token verification"
                svc={intel.cost.breakdown['Firebase Auth']}
                color="text-yellow-400"
                borderColor="border-yellow-500/20"
                onClick={() => setDrilldown({ serviceKey: 'firebase', serviceLabel: 'Firebase Auth', serviceCostUsd: intel.cost!.breakdown['Firebase Auth']?.estimatedMonthly ?? 0 })}
                processRows={[
                  { label: 'MAU (est.)',       value: intel.cost.breakdown['Firebase Auth']?.breakdown?.auth_mau ?? 0, sub: 'Above 50K MAU free tier' },
                ]}
                subRows={intel.metrics.firebase ? [
                  { label: 'Verifications/min', value: null, sub: `${intel.metrics.firebase.verificationsPerMin.toFixed(2)}/min` },
                  { label: 'Total verified',    value: null, sub: intel.metrics.firebase.tokenVerifications.toLocaleString() },
                  { label: 'Auth errors',       value: null, sub: `${intel.metrics.firebase.authErrors} in window` },
                ] : []}
              />

            </div>
          </div>
        )}

      </div>
    </>
  );
}
