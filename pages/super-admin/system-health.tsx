import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import OrgServiceDrilldown, { type ServiceKey } from '../../components/super-admin/OrgServiceDrilldown';
import RailwayEfficiencyPanel from '../../components/super-admin/RailwayEfficiencyPanel';
import RailwayCompanyCostsPanel from '../../components/super-admin/RailwayCompanyCostsPanel';

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

import { useSysHealth } from '../../hooks/useSysHealth';
import SysHealthView from '../../components/SysHealthView';
export default function SystemHealthPage() {
  const d = useSysHealth();
  if (d._notReady) return null;
  return (
    <>
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Health diagnostics:</span>
          <a href="/super-admin/oauth-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">OAuth + Integration</a>
          <a href="/super-admin/system-health" className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">System</a>
          <a href="/super-admin/dashboard" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">Dashboard</a>
        </nav>
      </div>
      <SysHealthView d={d} />
    </>
  );
}
