import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import OrgServiceDrilldown, { type ServiceKey } from '../components/super-admin/OrgServiceDrilldown';
import RailwayEfficiencyPanel from '../components/super-admin/RailwayEfficiencyPanel';
import RailwayCompanyCostsPanel from '../components/super-admin/RailwayCompanyCostsPanel';

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


export function useSysHealth() {
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

  const [cacheData,    setCacheData]    = useState<CacheData | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheMsg,     setCacheMsg]     = useState<string | null>(null);

  // Drilldown — which service card is open
  const [drilldown, setDrilldown] = useState<{
    serviceKey: ServiceKey;
    serviceLabel: string;
    serviceCostUsd: number;
  } | null>(null);

  const now2 = new Date();
  const [drillYear,  setDrillYear]  = useState(now2.getFullYear());
  const [drillMonth, setDrillMonth] = useState(now2.getMonth() + 1);
  const [railwayView, setRailwayView] = useState<'efficiency' | 'company-costs'>('company-costs');

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

  const fetchCacheData = useCallback(async () => {
    setCacheLoading(true);
    try {
      const res = await fetch('/api/admin/cache-management', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json() as CacheData;
      setCacheData(json);
    } catch { /* silently degrade */ }
    finally { setCacheLoading(false); }
  }, []);

  const flushCache = async (action: 'flush_ai' | 'flush_ext_api' | 'flush_intelligence') => {
    setCacheMsg(null);
    try {
      const res = await fetch('/api/admin/cache-management', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json() as { message?: string; error?: string };
      setCacheMsg(json.message ?? json.error ?? 'Done');
      void fetchCacheData();
    } catch (e) {
      setCacheMsg('Flush failed: ' + (e as Error).message);
    }
  };

  // Fetch once auth is confirmed
  useEffect(() => {
    if (isSuperAdmin) { void fetchData(); void fetchIntelligence(); void fetchActivityBreakdown(); void fetchCacheData(); }
  }, [isSuperAdmin, fetchData, fetchIntelligence, fetchActivityBreakdown, fetchCacheData]);

  // Auto-refresh every 60 s
  useEffect(() => {
    if (!isSuperAdmin) return;
    const id = setInterval(() => { void fetchData(); void fetchIntelligence(); void fetchActivityBreakdown(); void fetchCacheData(); }, 60_000);
    return () => clearInterval(id);
  }, [isSuperAdmin, fetchData, fetchIntelligence, fetchActivityBreakdown]);

  // ── Filtered anomaly list ───────────────────────────────────────────────
  const filtered = (data?.anomalies ?? []).filter(
    a => tab === 'all' || a.entity_type === tab,
  );

  // ── Render ──────────────────────────────────────────────────────────────
  const _notReady = !authResolved;


  return {
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
  };
}
