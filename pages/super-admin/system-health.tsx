import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import OrgServiceDrilldown, { type ServiceKey } from '../../components/super-admin/OrgServiceDrilldown';

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
  CRITICAL: { bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400',    label: 'CRITICAL' },
  WARNING:  { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400', label: 'WARNING'  },
  INFO:     { bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400',   label: 'INFO'     },
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
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'ok' ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
      {status === 'ok' ? 'Operational' : 'Degraded'}
    </span>
  );
}

function MetaExpander({ metadata }: { metadata: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!metadata || Object.keys(metadata).length === 0) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
      >
        {open ? 'hide' : 'view details'}
      </button>
      {open && (
        <pre className="mt-1.5 p-2 bg-gray-900 rounded text-xs text-gray-300 overflow-auto max-h-32 whitespace-pre-wrap break-all">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

const STATE_CONFIG: Record<SystemStatus, {
  border: string; bg: string; icon: string; label: string; textColor: string;
}> = {
  healthy:  { border: 'border-green-500/30',  bg: 'bg-green-500/10',  icon: '✓', label: 'System Healthy',   textColor: 'text-green-400'  },
  degraded: { border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', icon: '⚠', label: 'System Degraded',  textColor: 'text-yellow-400' },
  critical: { border: 'border-red-500/40',    bg: 'bg-red-500/15',    icon: '✕', label: 'System Critical',  textColor: 'text-red-400'    },
};

function SystemStateBanner({ state }: { state: SystemHealthData['systemState'] }) {
  const cfg = STATE_CONFIG[state.status];
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${cfg.bg} ${cfg.border} mb-6`}>
      <span className={`text-lg font-bold mt-0.5 ${cfg.textColor}`}>{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${cfg.textColor}`}>{cfg.label}</p>
        {state.reasons.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {state.reasons.map((r, i) => (
              <li key={i} className="text-xs text-gray-400">{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500 mt-0.5">No active alerts · All systems operational</p>
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

type Tab = 'all' | 'user' | 'company' | 'system';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all',     label: 'All'     },
  { key: 'user',    label: 'User'    },
  { key: 'company', label: 'Company' },
  { key: 'system',  label: 'System'  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemHealthPage() {
  const router = useRouter();
  const { userRole, isLoading: ctxLoading, isAuthenticated } = useCompanyContext();

  const [authResolved, setAuthResolved] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [cookieChecked, setCookieChecked] = useState(false);
  const [data,    setData]    = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tab,     setTab]     = useState<Tab>('all');
  const [intel,   setIntel]   = useState<IntelligenceData | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null); // drill-down

  const [activityData,    setActivityData]    = useState<ActivityBreakdown | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Drilldown — which service card is open
  const [drilldown, setDrilldown] = useState<{
    serviceKey: ServiceKey;
    serviceLabel: string;
    serviceCostUsd: number;
  } | null>(null);

  const now2 = new Date();
  const [drillYear,  setDrillYear]  = useState(now2.getFullYear());
  const [drillMonth, setDrillMonth] = useState(now2.getMonth() + 1);

  // ── Auth gate ────────────────────────────────────────────────────────────
  // Effect 1: check super_admin_session cookie once on mount (HttpOnly — server only)
  useEffect(() => {
    fetch('/api/admin/check-super-admin', { credentials: 'include' })
      .then(r => r.json())
      .then((json: { isSuperAdmin?: boolean }) => {
        if (json.isSuperAdmin) {
          setIsSuperAdmin(true);
          setAuthResolved(true);
        }
      })
      .catch(() => {})
      .finally(() => setCookieChecked(true));
  }, []); // run once on mount

  // Effect 2: after cookie check done + context loaded, fall back to role check
  useEffect(() => {
    if (!cookieChecked) return;  // wait for API result first
    if (authResolved) return;    // cookie check already passed
    if (ctxLoading) return;      // wait for CompanyContext
    if (!isAuthenticated) { router.replace('/login'); return; }
    if (userRole === 'SUPER_ADMIN') {
      setIsSuperAdmin(true);
      setAuthResolved(true);
    } else {
      router.replace('/login');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookieChecked, authResolved, ctxLoading, isAuthenticated, userRole]);

  // ── Data fetch ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/super-admin/system-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as SystemHealthData;
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIntelligence = useCallback(async () => {
    setIntelLoading(true);
    try {
      const res = await fetch('/api/super-admin/system-intelligence');
      if (!res.ok) return; // partial failure — silently degrade
      const json = await res.json() as IntelligenceData;
      setIntel(json);
    } catch {
      // silently degrade — intelligence panel shows "unavailable"
    } finally {
      setIntelLoading(false);
    }
  }, []);

  const fetchActivityBreakdown = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await fetch('/api/admin/consumption/activity-breakdown', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json() as ActivityBreakdown;
      setActivityData(json);
    } catch { /* silently degrade */ }
    finally { setActivityLoading(false); }
  }, []);

  // Fetch once auth is confirmed
  useEffect(() => {
    if (isSuperAdmin) { void fetchData(); void fetchIntelligence(); void fetchActivityBreakdown(); }
  }, [isSuperAdmin, fetchData, fetchIntelligence, fetchActivityBreakdown]);

  // Auto-refresh every 60 s
  useEffect(() => {
    if (!isSuperAdmin) return;
    const id = setInterval(() => { void fetchData(); void fetchIntelligence(); void fetchActivityBreakdown(); }, 60_000);
    return () => clearInterval(id);
  }, [isSuperAdmin, fetchData, fetchIntelligence, fetchActivityBreakdown]);

  // ── Filtered anomaly list ───────────────────────────────────────────────
  const filtered = (data?.anomalies ?? []).filter(
    a => tab === 'all' || a.entity_type === tab,
  );

  // ── Render ──────────────────────────────────────────────────────────────
  if (!authResolved) return null;  // hold until auth settled

  return (
    <>
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">System Health</h1>
          <p className="text-sm text-gray-500 mt-0.5">Anomaly detection · Last 24 hours</p>
        </div>
        <button
          onClick={() => void fetchData()}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* System State Banner */}
      {data?.systemState && <SystemStateBanner state={data.systemState} />}

      {/* System Status */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Redis */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1.5">Redis</p>
            <StatusDot status={data.systemStatus.redis} />
            {data.systemStatus.last_redis_failure && (
              <p className="text-xs text-gray-600 mt-1">
                Last failure: {fmt(data.systemStatus.last_redis_failure)}
              </p>
            )}
          </div>
          {/* Critical */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1.5">Critical (24 h)</p>
            <p className={`text-2xl font-bold ${data.summary.critical_24h > 0 ? 'text-red-400' : 'text-gray-300'}`}>
              {data.summary.critical_24h}
            </p>
            {data.summary.last_critical_at && (
              <p className="text-xs text-gray-600 mt-1">
                Last: {fmt(data.summary.last_critical_at)}
              </p>
            )}
          </div>
          {/* Warning */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1.5">Warnings (24 h)</p>
            <p className={`text-2xl font-bold ${data.summary.warning_24h > 0 ? 'text-yellow-400' : 'text-gray-300'}`}>
              {data.summary.warning_24h}
            </p>
          </div>
          {/* Auth events */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">Auth Events (24 h)</p>
            <div className="space-y-0.5">
              {Object.entries(data.authEventCounts).slice(0, 3).map(([evt, cnt]) => (
                <div key={evt} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 truncate">{evt.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-medium text-gray-300 ml-2">{cnt}</span>
                </div>
              ))}
              {Object.keys(data.authEventCounts).length === 0 && (
                <span className="text-xs text-gray-600">No events</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-800 pb-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              tab === t.key
                ? 'text-white bg-gray-800 border-b-2 border-indigo-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {data && t.key !== 'all' && (
              <span className="ml-1.5 text-xs text-gray-600">
                ({(data.anomalies ?? []).filter(a => a.entity_type === t.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Anomaly Table */}
      {loading && !data ? (
        <div className="flex items-center justify-center h-32 text-gray-600 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
          No anomalies in the last 24 hours 🎉
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 w-24">Severity</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Entity</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Value / Threshold</th>
                <th className="text-left px-4 py-3 hidden xl:table-cell">Details</th>
                <th className="text-left px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {filtered.map(anomaly => (
                <tr key={anomaly.id} className="hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <SeverityBadge severity={anomaly.severity} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-300">{anomaly.type}</span>
                    {anomaly.alerted_at && (
                      <span className="ml-2 text-xs text-indigo-400">notified</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-gray-400">
                      {anomaly.entity_type}
                      {anomaly.entity_id && (
                        <span className="text-gray-600"> / {anomaly.entity_id.slice(0, 12)}…</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {anomaly.metric_value != null ? (
                      <span className="text-xs text-gray-400">
                        <span className="text-white font-medium">{anomaly.metric_value}</span>
                        {anomaly.threshold != null && (
                          <span className="text-gray-600"> / {anomaly.threshold.toFixed(1)}</span>
                        )}
                        {anomaly.baseline != null && (
                          <span className="text-gray-700"> (base {anomaly.baseline.toFixed(1)}/h)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-700 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <MetaExpander metadata={anomaly.metadata} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">{fmt(anomaly.created_at)}</span>
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
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
            Current baselines (hourly averages over last 24 h)
          </summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(data.baselines).map(([type, avg]) => (
              <div key={type} className="bg-gray-900 border border-gray-800 rounded p-2">
                <p className="text-xs font-mono text-gray-500 truncate">{type}</p>
                <p className="text-sm font-medium text-gray-300">
                  {avg.toFixed(2)}<span className="text-xs text-gray-600">/h</span>
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── System Intelligence ───────────────────────────────────────────── */}
      <div className="mt-10 border-t border-gray-800 pt-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-white">System Intelligence</h2>
            <p className="text-xs text-gray-500 mt-0.5">Multi-service metrics · Cost estimates</p>
          </div>
          {intelLoading && <span className="text-xs text-gray-600 animate-pulse">Refreshing…</span>}
          {intel?.errors && Object.keys(intel.errors).length > 0 && (
            <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">
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
                  <div className="mt-3 pt-3 border-t border-gray-800/60">
                    <p className="text-xs text-gray-500 mb-1">Cost contribution</p>
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
                  <div className="mt-3 pt-3 border-t border-gray-800/60">
                    <p className="text-xs text-gray-500 mb-1">Cost contribution</p>
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
                  <div className="mt-3 pt-3 border-t border-gray-800/60 space-y-1">
                    <p className="text-xs text-gray-500 mb-1">Top endpoints</p>
                    {intel.metrics.api.topEndpoints.slice(0, 5).map(ep => (
                      <div key={ep.endpoint} className="flex items-center justify-between">
                        <span className="text-xs font-mono text-gray-400 truncate max-w-[160px]">{ep.endpoint}</span>
                        <span className="text-xs text-gray-500 ml-2">{ep.calls}</span>
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
              <p className="text-xs text-gray-600 mt-1">No external calls observed yet</p>
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
                  <div className="mt-3 pt-3 border-t border-gray-800/60 space-y-1">
                    {intel.metrics.redis.topFeatures.slice(0, 5).map(f => (
                      <div key={f.feature} className="flex items-center justify-between">
                        <span className="text-xs font-mono text-gray-400">{f.feature}</span>
                        <span className="text-xs text-gray-500">{f.total.toLocaleString()} ({f.pct}%)</span>
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
                  <p className="text-2xl font-bold text-white">
                    ${intel.cost.totalMonthlyEstimate.toFixed(2)}
                    <span className="text-xs text-gray-500 font-normal ml-1">/ mo [est]</span>
                  </p>
                  <ConfidencePill confidence={intel.cost.confidence} />
                </div>
                {Object.values(intel.cost.breakdown)
                  .sort((a, b) => b.estimatedMonthly - a.estimatedMonthly)
                  .map(s => (
                    <div key={s.service} className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-gray-400 truncate">{s.service}</span>
                      <span className="text-xs font-medium text-gray-300 ml-2">
                        ${s.estimatedMonthly.toFixed(2)}
                      </span>
                    </div>
                  ))}
                {activeSection === 'cost' && (
                  <div className="mt-3 pt-3 border-t border-gray-800/60">
                    <p className="text-xs text-yellow-500/80 leading-relaxed">
                      {intel.cost.warnings[0]}
                    </p>
                    {intel.cost.confidence === 'low' && (
                      <p className="text-xs text-gray-600 mt-1">
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

      {/* ── Activity & Cost Breakdown ──────────────────────────────────────── */}
      <div className="mt-10 border-t border-gray-800 pt-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-white">Activity × Cost Breakdown</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              How platform activity drives LLM + infra spend · current month
            </p>
          </div>
          {activityLoading && <span className="text-xs text-gray-600 animate-pulse">Loading…</span>}
        </div>

        {activityData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">

            {/* Feature area cost card */}
            <div
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 lg:col-span-1 cursor-pointer hover:bg-gray-800/50 hover:border-gray-700 transition-colors"
              onClick={() => setDrilldown({ serviceKey: 'llm', serviceLabel: 'LLM Usage by Organisation', serviceCostUsd: 0 })}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-white">Cost by Feature Area</p>
                <span className="text-xs text-gray-600">↗ orgs</span>
              </div>
              <p className="text-xs text-gray-600 mb-3">What the platform spends LLM budget on · click for per-org view</p>
              {activityData.by_feature_area.length === 0 ? (
                <p className="text-xs text-gray-600">No LLM usage recorded this month.</p>
              ) : (() => {
                const maxCost = activityData.by_feature_area[0]?.total_cost_usd ?? 1;
                return activityData.by_feature_area.slice(0, 8).map(f => (
                  <div key={f.feature_area} className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-300 truncate max-w-[170px]">{f.feature_area}</span>
                      <span className="text-gray-400 ml-2 shrink-0">
                        ${f.total_cost_usd.toFixed(4)} · {f.call_count.toLocaleString()} calls
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full"
                        style={{ width: `${Math.max(2, (f.total_cost_usd / maxCost) * 100)}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Platform post distribution card */}
            <div
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-800/50 hover:border-gray-700 transition-colors"
              onClick={() => setDrilldown({ serviceKey: 'api', serviceLabel: 'API Usage by Organisation', serviceCostUsd: 0 })}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-white">Posts by Platform</p>
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

    </div>

    {/* ── Org-level service drilldown ────────────────────────────────────── */}
    {drilldown && (
      <OrgServiceDrilldown
        serviceKey={drilldown.serviceKey}
        serviceLabel={drilldown.serviceLabel}
        serviceCostUsd={drilldown.serviceCostUsd}
        initialYear={drillYear}
        initialMonth={drillMonth}
        intel={intel as any}
        onClose={() => setDrilldown(null)}
      />
    )}
    </>
  );
}

// ── ServiceCostCard ────────────────────────────────────────────────────────────
// Reusable card showing cost broken down by process/activity for one infra service.

interface ProcessRow {
  label: string;
  value: number | null;   // null = no dollar estimate, show sub only
  sub?: string;
}

function ServiceCostCard({
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

function IntelCard({
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

function MetricRow({
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

function CostLine({ cost }: { cost?: ServiceCost }) {
  if (!cost) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">Est. monthly</span>
      <span className="text-xs font-medium text-yellow-400">${cost.estimatedMonthly.toFixed(2)} [est]</span>
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
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

function UnavailableNote({ label }: { label: string }) {
  return (
    <p className="text-xs text-gray-700 mt-1 italic">{label} metrics unavailable in this window</p>
  );
}
