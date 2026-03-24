/**
 * OrgServiceDrilldown — slide-over panel
 *
 * Per-service view with:
 * - Service-specific columns (LLM calls+tokens, API errors, Redis ops, Supabase
 *   queries, Vercel invocations, Firebase MAU — not generic LLM/API for all)
 * - Plan analysis: current spend vs plan limit, month-end prediction, 15% headroom
 * - Spike detection: opsPerMin vs baseline, WARNING/CRITICAL with remediation tips
 * - Built-in month/year selector + expandable org rows
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  X, RefreshCw, ChevronDown, ChevronUp, AlertCircle, Calendar,
  AlertTriangle, TrendingUp, CheckCircle, Info,
} from 'lucide-react';
import { getAuthToken } from '../../utils/getAuthToken';

// ── External types (subset of IntelligenceData) ────────────────────────────────

interface IntelMetrics {
  redis?:    { totalOps: number; opsPerMin: number; peakOpsPerMin: number; storageBytesUsed: number; topFeatures: {feature:string;total:number;pct:number}[] } | null;
  supabase?: { reads: number; writes: number; errors: number; queriesPerMin: number; avgReadLatency: number|null; avgWriteLatency: number|null } | null;
  firebase?: { tokenVerifications: number; revokedChecks: number; authErrors: number; signIns: number; verificationsPerMin: number; avgVerifyLatencyMs: number|null } | null;
  api?:      { totalCalls: number; callsPerMin: number; errors4xx: number; errors5xx: number; errorRate: number; avgLatencyMs: number|null; p95LatencyMs: number|null } | null;
}
interface IntelCostEntry {
  estimatedMonthly: number;
  breakdown: Record<string, number>;
  notes: string[];
  hasData: boolean;
}
export interface DrilldownIntel {
  metrics: IntelMetrics;
  cost: { breakdown: Record<string, IntelCostEntry | undefined> } | null;
}

// ── API response types ─────────────────────────────────────────────────────────

interface OrgActivity {
  posts_total:        number;
  posts_published:    number;
  posts_by_platform:  Record<string, number>;
  campaigns_total:    number;
  campaigns_active:   number;
}
interface OrgRow {
  organization_id: string;
  org_name:        string | null;
  llm_calls:       number;
  llm_cost_usd:    number;
  api_calls:       number;
  api_cost_usd:    number;
  total_cost_usd:  number;
  credit_balance:  number | null;
  activities:      OrgActivity;
}
interface BreakdownData {
  period:  { year: number; month: number };
  orgs:    OrgRow[];
  totals:  { llm_cost_usd: number; api_cost_usd: number; total_cost_usd: number; posts_total: number; org_count: number };
}

// ── Public types ───────────────────────────────────────────────────────────────

export type ServiceKey = 'llm' | 'api' | 'redis' | 'supabase' | 'railway' | 'vercel' | 'cdn' | 'firebase';

interface Props {
  serviceKey:     ServiceKey;
  serviceLabel:   string;
  serviceCostUsd: number;      // monthly infra estimate (0 for llm/api direct)
  initialYear:    number;
  initialMonth:   number;
  intel?:         DrilldownIntel | null;
  onClose:        () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-500', twitter: 'bg-sky-400', instagram: 'bg-pink-500',
  facebook: 'bg-indigo-500', youtube: 'bg-red-500',
};
const PLATFORM_TEXT: Record<string, string> = {
  linkedin: 'text-blue-400', twitter: 'text-sky-400', instagram: 'text-pink-400',
  facebook: 'text-indigo-400', youtube: 'text-red-400',
};

const SERVICE_COLOR: Record<ServiceKey, string> = {
  llm: 'text-emerald-400', api: 'text-amber-400', redis: 'text-emerald-400',
  supabase: 'text-green-400', railway: 'text-purple-400', vercel: 'text-blue-400',
  cdn: 'text-cyan-400', firebase: 'text-yellow-400',
};

// ── Plan definitions ──────────────────────────────────────────────────────────

interface PlanDef {
  name: string;
  baseCostUsd: number;         // monthly plan cost
  limitLabel: string;          // human-readable limit description
  freeUntil?: number;          // free tier limit value (for PAYG)
  overageLabel?: string;       // overage pricing text
  nextPlan?: { name: string; baseCostUsd: number; limitLabel: string };
  remediation: string[];       // spike-handling suggestions
}

const PLAN_DEFS: Partial<Record<ServiceKey, PlanDef>> = {
  redis: {
    name: 'Upstash Pay-as-you-go',
    baseCostUsd: 0,
    limitLabel: '10 K ops/day free · 256 MB storage free',
    freeUntil: 10000,
    overageLabel: 'Ops: $0.20/100 K above free · Storage: $0.25/GB above 256 MB',
    remediation: [
      'Enable AI-response caching (TTL 300 s) to reduce ops',
      'Batch Redis pipeline operations',
      'Add TTL jitter to prevent cache stampede',
      'Add TTL to all keys — orphaned keys grow storage unbounded',
      'Run SCAN + DEL for stale queue job keys periodically',
      'Review cache invalidation hot paths',
    ],
  },
  supabase: {
    name: 'Supabase Pro',
    baseCostUsd: 25,
    limitLabel: '8 GB DB · 250 K MAU · 100 GB bandwidth',
    nextPlan: { name: 'Supabase Team', baseCostUsd: 599, limitLabel: '100 GB DB · unlimited MAU' },
    remediation: [
      'Add indexes on frequently queried columns (EXPLAIN ANALYZE)',
      'Enable PgBouncer connection pooling',
      'Archive cold data to Supabase Storage or S3',
      'Use read-replica for analytics/reporting queries',
      'Cache hot reads in Redis (5-10 min TTL)',
    ],
  },
  railway: {
    name: 'Railway Pro',
    baseCostUsd: 20,
    limitLabel: 'Usage-based · $20 credit included',
    nextPlan: { name: 'Railway Enterprise', baseCostUsd: 500, limitLabel: 'Custom resources' },
    remediation: [
      'Enable auto-sleep on non-prod environments',
      'Right-size CPU/memory per service',
      'Move batch jobs to scheduled Railway cron services',
      'Use Railway private networking to reduce egress',
    ],
  },
  vercel: {
    name: 'Vercel Pro',
    baseCostUsd: 20,
    limitLabel: '1 M serverless invocations / mo',
    overageLabel: '$0.60 per additional 1 M invocations',
    nextPlan: { name: 'Vercel Enterprise', baseCostUsd: 150, limitLabel: '10 M+ invocations / mo' },
    remediation: [
      'Add Cache-Control headers to reduce invocations',
      'Enable ISR (Incremental Static Regeneration)',
      'Move heavy computation to background jobs on Railway',
      'Check for polling loops causing excess invocations',
      'Use Vercel Edge Middleware instead of serverless for auth checks',
    ],
  },
  cdn: {
    name: 'Vercel Pro (CDN included)',
    baseCostUsd: 0,
    limitLabel: '1 TB bandwidth / mo included',
    overageLabel: '$0.15 per GB above 1 TB',
    remediation: [
      'Enable Brotli compression on assets',
      'Increase browser Cache-Control max-age',
      'Lazy-load images and use WebP format',
      'Consolidate JS bundles to reduce request count',
    ],
  },
  firebase: {
    name: 'Firebase Blaze (PAYG)',
    baseCostUsd: 0,
    limitLabel: '50 K MAU free · $0.0055 per MAU above',
    freeUntil: 50000,
    overageLabel: '$0.0055 per active user above 50 K MAU',
    remediation: [
      'Cache verified Firebase tokens in secure session cookie',
      'Reduce token re-verification frequency per request',
      'Implement client-side token refresh (avoid server hits)',
      'Batch auth state checks where possible',
    ],
  },
};

// ── Spike detection config ─────────────────────────────────────────────────────

interface SpikeConfig {
  getRatePerMin: (m: IntelMetrics) => number | null;
  unit: string;
  normalBaseline: number;   // ops/min expected in steady state
  warnAt: number;           // multiplier (e.g. 1.5)
  critAt: number;           // multiplier (e.g. 2.5)
}

const SPIKE_CONFIGS: Partial<Record<ServiceKey, SpikeConfig>> = {
  redis:    { getRatePerMin: m => m.redis?.opsPerMin   ?? null, unit: 'ops/min',           normalBaseline: 100, warnAt: 1.5, critAt: 2.5 },
  supabase: { getRatePerMin: m => m.supabase?.queriesPerMin ?? null, unit: 'queries/min',  normalBaseline: 50,  warnAt: 1.5, critAt: 2.5 },
  vercel:   { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'invocations/min',   normalBaseline: 20,  warnAt: 1.5, critAt: 2.5 },
  cdn:      { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'requests/min',      normalBaseline: 50,  warnAt: 1.5, critAt: 2.5 },
  firebase: { getRatePerMin: m => m.firebase?.verificationsPerMin ?? null, unit: 'verifs/min', normalBaseline: 5, warnAt: 1.5, critAt: 2.5 },
  api:      { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'calls/min',         normalBaseline: 20,  warnAt: 1.5, critAt: 2.5 },
};

// ── Service metric columns ─────────────────────────────────────────────────────

// For infra services: the "secondary metric" column shows a proportion of global metric
interface MetricColDef {
  header: string;   // column label
  getValue: (weight: number, intel: DrilldownIntel | null | undefined) => number | null;
  format: (v: number) => string;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

const METRIC_COLS: Partial<Record<ServiceKey, MetricColDef>> = {
  redis: {
    header: 'Est. Ops',
    getValue: (w, intel) => {
      const total = intel?.metrics.redis?.totalOps;
      return total != null ? Math.round(total * w) : null;
    },
    format: v => v.toLocaleString(),
  },
  supabase: {
    header: 'Est. Queries',
    getValue: (w, intel) => {
      const s = intel?.metrics.supabase;
      if (!s) return null;
      return Math.round((s.reads + s.writes) * w);
    },
    format: v => v.toLocaleString(),
  },
  vercel: {
    header: 'Est. Invocations',
    getValue: (w, intel) => {
      const total = intel?.metrics.api?.totalCalls;
      return total != null ? Math.round(total * w) : null;
    },
    format: v => v.toLocaleString(),
  },
  cdn: {
    header: 'Est. Requests',
    getValue: (w, intel) => {
      const total = intel?.metrics.api?.totalCalls;
      return total != null ? Math.round(total * w) : null;
    },
    format: v => v.toLocaleString(),
  },
  firebase: {
    header: 'Est. MAU',
    getValue: (w, intel) => {
      const total = intel?.metrics.firebase?.tokenVerifications;
      return total != null ? Math.round(total * w) : null;
    },
    format: v => v.toLocaleString(),
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtUsd  = (n: number) => `$${n.toFixed(4)}`;
const fmtUsd2 = (n: number) => `$${n.toFixed(2)}`;
const fmtK    = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const fmtPct  = (n: number) => `${n.toFixed(1)}%`;

type SortKey =
  | 'org_name' | 'service_cost' | 'metric_value' | 'weight_pct'
  | 'llm_calls' | 'llm_cost' | 'api_calls' | 'api_cost'
  | 'posts' | 'credits';

// ── Plan Analysis Panel ────────────────────────────────────────────────────────

function PlanAnalysisPanel({
  serviceKey, serviceCostUsd, intel, year, month, totals,
}: {
  serviceKey: ServiceKey;
  serviceCostUsd: number;
  intel: DrilldownIntel | null | undefined;
  year: number;
  month: number;
  totals: BreakdownData['totals'] | undefined;
}) {
  const plan = PLAN_DEFS[serviceKey];
  const now  = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === (now.getMonth() + 1);
  const daysInMonth    = getDaysInMonth(year, month);
  const dayOfMonth     = isCurrentMonth ? now.getDate() : daysInMonth;
  const elapsedFraction = Math.max(0.01, dayOfMonth / daysInMonth);

  // Determine "current spend" and "predicted month-end"
  let currentSpend   = serviceCostUsd;
  let predictedEnd   = serviceCostUsd;
  let spendLabel     = 'Est. monthly';

  if (serviceKey === 'llm' && totals) {
    currentSpend = totals.llm_cost_usd;
    predictedEnd = isCurrentMonth ? currentSpend / elapsedFraction : currentSpend;
    spendLabel   = `Month-to-date (day ${dayOfMonth}/${daysInMonth})`;
  } else if (serviceKey === 'api' && totals) {
    currentSpend = totals.api_cost_usd;
    predictedEnd = isCurrentMonth ? currentSpend / elapsedFraction : currentSpend;
    spendLabel   = `Month-to-date (day ${dayOfMonth}/${daysInMonth})`;
  } else if (isCurrentMonth) {
    // Infra: serviceCostUsd is a live estimate; predicted end is already monthly
    predictedEnd = serviceCostUsd;
    spendLabel   = `Live estimate (day ${dayOfMonth}/${daysInMonth})`;
  }

  const marginPct = plan && plan.baseCostUsd > 0
    ? ((plan.baseCostUsd - predictedEnd) / plan.baseCostUsd) * 100
    : null;

  // Status
  let status: 'ok' | 'warning' | 'critical' | 'payg' = 'ok';
  let statusLabel = '';
  let recommendation = '';

  if (!plan) {
    return null;
  }

  if (plan.baseCostUsd === 0) {
    // PAYG — no hard cap, just cost growth awareness
    status    = 'payg';
    statusLabel = 'Pay-as-you-go — no hard limit';
    recommendation = predictedEnd > 10
      ? `At this pace: ${fmtUsd2(predictedEnd)}/mo. Consider caching to reduce ops.`
      : `Spend is nominal (${fmtUsd2(predictedEnd)}/mo est.).`;
  } else if (predictedEnd > plan.baseCostUsd) {
    status    = 'critical';
    statusLabel = `Over plan — ${fmtUsd2(predictedEnd - plan.baseCostUsd)} in overages`;
    recommendation = plan.nextPlan
      ? `Upgrade to ${plan.nextPlan.name} (${fmtUsd2(plan.nextPlan.baseCostUsd)}/mo) — cheaper than current overages.`
      : 'Contact vendor for custom pricing or optimise usage.';
  } else if (marginPct !== null && marginPct < 15) {
    status    = 'warning';
    statusLabel = `${fmtPct(marginPct)} headroom — below 15% safety margin`;
    recommendation = plan.nextPlan
      ? `Consider upgrading to ${plan.nextPlan.name} before capacity is exhausted.`
      : 'Optimise usage to maintain 15% headroom.';
  } else {
    status    = 'ok';
    statusLabel = marginPct !== null ? `${fmtPct(marginPct)} headroom — within plan` : 'Within plan';
    recommendation = 'Continue monitoring. No action required.';
  }

  const statusColors = {
    ok:       { bg: 'bg-green-500/10',  border: 'border-green-500/20',  text: 'text-green-400',  icon: <CheckCircle  className="w-4 h-4" /> },
    warning:  { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', icon: <AlertTriangle className="w-4 h-4" /> },
    critical: { bg: 'bg-red-500/10',    border: 'border-red-500/20',    text: 'text-red-400',    icon: <AlertCircle  className="w-4 h-4" /> },
    payg:     { bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   text: 'text-blue-400',   icon: <Info         className="w-4 h-4" /> },
  }[status];

  return (
    <div className={`mx-4 mt-3 mb-0 p-3 rounded-lg border text-xs ${statusColors.bg} ${statusColors.border}`}>
      <div className="flex items-start gap-2 mb-2">
        <span className={`shrink-0 mt-0.5 ${statusColors.text}`}>{statusColors.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={`font-semibold ${statusColors.text}`}>{plan.name}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors.bg} ${statusColors.text} border ${statusColors.border}`}>
              {status === 'payg' ? 'PAYG' : status.toUpperCase()}
            </span>
          </div>
          <p className="text-gray-400 mt-0.5">{statusLabel}</p>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 my-2 py-2 border-t border-b border-gray-800/50">
        <div>
          <p className="text-gray-500">{spendLabel}</p>
          <p className="text-white font-medium">{fmtUsd2(currentSpend)}</p>
        </div>
        <div>
          <p className="text-gray-500">Predicted month-end</p>
          <p className={`font-medium ${status === 'critical' ? 'text-red-400' : status === 'warning' ? 'text-yellow-400' : 'text-white'}`}>
            {fmtUsd2(predictedEnd)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Plan budget</p>
          <p className="text-gray-300 font-medium">
            {plan.baseCostUsd > 0 ? fmtUsd2(plan.baseCostUsd) : 'PAYG'}
          </p>
        </div>
      </div>

      {/* Redis-specific: ops vs storage breakdown */}
      {serviceKey === 'redis' && intel?.metrics.redis && (() => {
        const r = intel.metrics.redis!;
        const storageMB   = r.storageBytesUsed > 0 ? r.storageBytesUsed / (1024 * 1024) : null;
        const storagePct  = storageMB != null ? Math.min(100, (storageMB / 256) * 100) : null;
        const monthlyOps  = Math.round(r.opsPerMin * 60 * 24 * 30);
        const freeTierOps = 300_000; // 10K/day × 30
        const opsPct      = Math.min(100, (monthlyOps / freeTierOps) * 100);
        return (
          <div className="mb-2 space-y-2">
            {/* Ops vs free tier */}
            <div>
              <div className="flex justify-between text-gray-500 mb-0.5">
                <span>Commands/month vs free (300K)</span>
                <span className={opsPct > 85 ? 'text-red-400' : opsPct > 70 ? 'text-yellow-400' : 'text-gray-300'}>
                  {Math.round(monthlyOps / 1000)}K / 300K ({fmtPct(opsPct)})
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${opsPct > 85 ? 'bg-red-500' : opsPct > 70 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.max(2, opsPct)}%` }} />
              </div>
            </div>
            {/* Storage vs free tier */}
            {storageMB != null && storagePct != null && (
              <div>
                <div className="flex justify-between text-gray-500 mb-0.5">
                  <span>Storage vs free (256 MB)</span>
                  <span className={storagePct > 85 ? 'text-red-400' : storagePct > 70 ? 'text-yellow-400' : 'text-gray-300'}>
                    {storageMB.toFixed(1)} MB / 256 MB ({fmtPct(storagePct)})
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${storagePct > 85 ? 'bg-red-500' : storagePct > 70 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.max(2, storagePct)}%` }} />
                </div>
                {storagePct > 70 && (
                  <p className="text-yellow-600 mt-0.5">Storage growing — add TTL to all keys to prevent unbounded growth.</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Margin bar */}
      {plan.baseCostUsd > 0 && (
        <div className="mb-2">
          <div className="flex justify-between text-gray-500 mb-0.5">
            <span>Plan utilisation</span>
            <span>{fmtPct(Math.min(100, (predictedEnd / plan.baseCostUsd) * 100))}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, (predictedEnd / plan.baseCostUsd) * 100)}%` }}
            />
          </div>
          <div className="flex justify-end mt-0.5">
            <span className="text-gray-600">15% margin threshold at {fmtUsd2(plan.baseCostUsd * 0.85)}</span>
          </div>
        </div>
      )}

      {/* Recommendation */}
      <p className={`${statusColors.text}`}>{recommendation}</p>

      {/* Next plan compare */}
      {plan.nextPlan && status !== 'ok' && (
        <div className="mt-2 pt-2 border-t border-gray-800/50 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-gray-500">Next: <span className="text-gray-300">{plan.nextPlan.name}</span></span>
          <span className="text-gray-300 font-medium">{fmtUsd2(plan.nextPlan.baseCostUsd)}/mo</span>
          <span className="text-gray-500">{plan.nextPlan.limitLabel}</span>
        </div>
      )}

      {/* Overage label */}
      {plan.overageLabel && (
        <p className="mt-1 text-gray-600">{plan.overageLabel}</p>
      )}
    </div>
  );
}

// ── Spike Detection Panel ──────────────────────────────────────────────────────

function SpikePanel({ serviceKey, intel, planDef }: {
  serviceKey: ServiceKey;
  intel: DrilldownIntel | null | undefined;
  planDef: PlanDef | undefined;
}) {
  const cfg = SPIKE_CONFIGS[serviceKey];
  if (!cfg || !intel) return null;

  const currentRate = cfg.getRatePerMin(intel.metrics);
  if (currentRate == null || currentRate === 0) return null;

  const warnThreshold = cfg.normalBaseline * cfg.warnAt;
  const critThreshold = cfg.normalBaseline * cfg.critAt;

  if (currentRate < warnThreshold) return null;

  const isCritical = currentRate >= critThreshold;
  const multiplier = currentRate / cfg.normalBaseline;

  const color = isCritical
    ? { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', badge: 'bg-red-500/20 text-red-300' }
    : { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-300' };

  return (
    <div className={`mx-4 mt-2 p-3 rounded-lg border text-xs ${color.bg} ${color.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className={`w-4 h-4 ${color.text}`} />
        <span className={`font-semibold ${color.text}`}>
          {isCritical ? 'CRITICAL' : 'WARNING'} — Spike Detected
        </span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${color.badge}`}>
          {multiplier.toFixed(1)}× normal
        </span>
      </div>
      <p className="text-gray-400 mb-2">
        Current: <span className="text-white font-medium">{currentRate.toFixed(1)} {cfg.unit}</span>
        {' '}vs baseline <span className="text-gray-300">{cfg.normalBaseline} {cfg.unit}</span>
      </p>
      {planDef?.remediation && planDef.remediation.length > 0 && (
        <>
          <p className="text-gray-500 mb-1">Suggested actions:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            {planDef.remediation.map((s, i) => (
              <li key={i} className="text-gray-400">{s}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgServiceDrilldown({
  serviceKey, serviceLabel, serviceCostUsd, initialYear, initialMonth, intel, onClose,
}: Props) {
  const [year,    setYear]    = useState(initialYear);
  const [month,   setMonth]   = useState(initialMonth);
  const [data,    setData]    = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('service_cost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search,  setSearch]  = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const isDirectMode = serviceKey === 'llm' || serviceKey === 'api';
  const svcColor     = SERVICE_COLOR[serviceKey];
  const plan         = PLAN_DEFS[serviceKey];
  const metricCol    = METRIC_COLS[serviceKey];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token   = await getAuthToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const params  = new URLSearchParams({ year: String(year), month: String(month) });
      const resp    = await fetch(`/api/admin/consumption/org-activity-breakdown?${params}`, { credentials: 'include', headers });
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      setData(await resp.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Per-org computed fields ───────────────────────────────────────────────
  const totalAllCost = data?.totals.total_cost_usd ?? 0;

  const getWeight      = (row: OrgRow) => totalAllCost > 0 ? row.total_cost_usd / totalAllCost : 0;
  const getServiceCost = (row: OrgRow) => {
    if (serviceKey === 'llm') return row.llm_cost_usd;
    if (serviceKey === 'api') return row.api_cost_usd;
    return totalAllCost > 0 && serviceCostUsd > 0
      ? serviceCostUsd * (row.total_cost_usd / totalAllCost)
      : 0;
  };
  const getMetricValue = (row: OrgRow): number | null => {
    if (!metricCol) return null;
    return metricCol.getValue(getWeight(row), intel);
  };

  // ── Sort + filter ─────────────────────────────────────────────────────────
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const rows = (data?.orgs ?? [])
    .filter(r => !search || (r.org_name ?? r.organization_id).toLowerCase().includes(search.toLowerCase()))
    .map(r => ({
      ...r,
      _serviceCost:  getServiceCost(r),
      _metricValue:  getMetricValue(r),
      _weightPct:    getWeight(r) * 100,
    }))
    .sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      switch (sortKey) {
        case 'org_name':    av = (a.org_name ?? a.organization_id).toLowerCase(); bv = (b.org_name ?? b.organization_id).toLowerCase(); break;
        case 'service_cost': av = a._serviceCost;  bv = b._serviceCost;  break;
        case 'metric_value': av = a._metricValue ?? -1; bv = b._metricValue ?? -1; break;
        case 'weight_pct':  av = a._weightPct;    bv = b._weightPct;    break;
        case 'llm_calls':   av = a.llm_calls;     bv = b.llm_calls;     break;
        case 'llm_cost':    av = a.llm_cost_usd;  bv = b.llm_cost_usd;  break;
        case 'api_calls':   av = a.api_calls;     bv = b.api_calls;     break;
        case 'api_cost':    av = a.api_cost_usd;  bv = b.api_cost_usd;  break;
        case 'posts':       av = a.activities.posts_total; bv = b.activities.posts_total; break;
        case 'credits':     av = a.credit_balance ?? -1; bv = b.credit_balance ?? -1; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });

  const totalServiceCost = rows.reduce((s, r) => s + r._serviceCost, 0);
  const maxSvcCost       = Math.max(1, ...rows.map(r => r._serviceCost));
  const yearOptions      = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

  // ── Column definitions for the table header ───────────────────────────────
  // LLM mode: Org | LLM Calls | LLM Cost | Posts | Credits
  // API mode: Org | API Calls | Errors | API Cost | Posts | Credits
  // Infra:    Org | Alloc. $ | [Metric] | Weight % | Posts | Credits

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-5xl bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">{serviceLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isDirectMode
                ? `Per-organisation ${serviceKey.toUpperCase()} spend`
                : `Proportional allocation · ${fmtUsd2(serviceCostUsd)}/mo estimated total`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period selector + search */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 shrink-0 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
          <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search org…"
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 placeholder-gray-600 focus:outline-none focus:border-violet-500 w-44" />
          <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors ml-auto">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Plan analysis ── */}
          <PlanAnalysisPanel
            serviceKey={serviceKey}
            serviceCostUsd={serviceCostUsd}
            intel={intel}
            year={year}
            month={month}
            totals={data?.totals}
          />

          {/* ── Spike alert ── */}
          <SpikePanel serviceKey={serviceKey} intel={intel} planDef={plan} />

          {/* ── Summary strip ── */}
          {data && (
            <div className="flex items-center gap-4 px-6 py-2 bg-gray-900/40 border-b border-gray-800 text-xs mt-3 flex-wrap">
              <span className="text-gray-500">{data.totals.org_count} orgs</span>
              <span className="text-gray-700">·</span>
              {isDirectMode ? (
                <span className="text-gray-400">
                  {serviceKey === 'llm' ? 'Total LLM' : 'Total API'}: <span className="text-white font-medium">
                    {fmtUsd2(serviceKey === 'llm' ? data.totals.llm_cost_usd : data.totals.api_cost_usd)}
                  </span>
                </span>
              ) : (
                <span className="text-gray-400">
                  Allocated {serviceLabel}: <span className={`font-medium ${svcColor}`}>{fmtUsd2(totalServiceCost)}</span>
                  {' '}<span className="text-gray-600">(est. {fmtUsd2(serviceCostUsd)})</span>
                </span>
              )}
              <span className="text-gray-700">·</span>
              <span className="text-gray-400">Posts: <span className="text-white font-medium">{data.totals.posts_total.toLocaleString()}</span></span>
            </div>
          )}

          {/* ── Table ── */}
          {loading && !data ? (
            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 p-6 text-sm">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
              No data for {MONTH_NAMES[month - 1]} {year}.
            </div>
          ) : (
            <div className="px-4 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <Th k="org_name" label="Organisation" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />

                    {/* ── LLM mode ── */}
                    {serviceKey === 'llm' && <>
                      <Th k="llm_calls" label="LLM Calls" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="service_cost" label="LLM Cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="credits" label="Credits" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}

                    {/* ── API mode ── */}
                    {serviceKey === 'api' && <>
                      <Th k="api_calls" label="API Calls" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="service_cost" label="API Cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="credits" label="Credits" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}

                    {/* ── Infra mode ── */}
                    {!isDirectMode && <>
                      <Th k="service_cost" label={`${serviceLabel.split(' ')[0]} Cost`} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      {metricCol && <Th k="metric_value" label={metricCol.header} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />}
                      <Th k="weight_pct" label="Weight %" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isExpanded = expanded === r.organization_id;
                    const barPct     = (r._serviceCost / maxSvcCost) * 100;

                    return (
                      <React.Fragment key={r.organization_id}>
                        <tr
                          className="border-b border-gray-800/60 hover:bg-gray-900/60 cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : r.organization_id)}
                        >
                          {/* Org name */}
                          <td className="px-3 py-2.5 text-white font-medium">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 text-xs">{isExpanded ? '▼' : '▶'}</span>
                              {r.org_name ?? <span className="font-mono text-xs text-gray-500">{r.organization_id.slice(0, 8)}…</span>}
                            </div>
                          </td>

                          {/* ── LLM columns ── */}
                          {serviceKey === 'llm' && <>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{fmtK(r.llm_calls)}</td>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r.llm_cost_usd)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                            <td className={`px-3 py-2.5 text-right text-xs ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                            </td>
                          </>}

                          {/* ── API columns ── */}
                          {serviceKey === 'api' && <>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{fmtK(r.api_calls)}</td>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r.api_cost_usd)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                            <td className={`px-3 py-2.5 text-right text-xs ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                            </td>
                          </>}

                          {/* ── Infra columns ── */}
                          {!isDirectMode && <>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r._serviceCost)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            {metricCol && (
                              <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                                {r._metricValue != null ? metricCol.format(r._metricValue) : '—'}
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right text-gray-500 text-xs">{fmtPct(r._weightPct)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                          </>}
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr className="bg-gray-900/70 border-b border-gray-800">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">

                                {/* Posts by platform */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Posts by Platform</p>
                                  {Object.keys(r.activities.posts_by_platform).length === 0 ? (
                                    <p className="text-gray-600">No posts this period</p>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {Object.entries(r.activities.posts_by_platform)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([plat, count]) => {
                                          const total = r.activities.posts_total || 1;
                                          return (
                                            <div key={plat}>
                                              <div className="flex justify-between mb-0.5">
                                                <span className={`capitalize ${PLATFORM_TEXT[plat] ?? 'text-gray-400'}`}>{plat}</span>
                                                <span className="text-gray-300">{count}</span>
                                              </div>
                                              <div className="w-full bg-gray-800 rounded-full h-1.5">
                                                <div className={`${PLATFORM_COLORS[plat] ?? 'bg-gray-500'} h-1.5 rounded-full`} style={{ width: `${(count / total) * 100}%` }} />
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  )}
                                </div>

                                {/* Campaign activity */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Campaign Activity</p>
                                  <div className="space-y-1.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Total campaigns</span>
                                      <span className="text-white">{r.activities.campaigns_total}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Active campaigns</span>
                                      <span className="text-green-400">{r.activities.campaigns_active}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Posts published</span>
                                      <span className="text-emerald-400">{r.activities.posts_published}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Service-specific cost detail */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Cost Detail</p>
                                  <div className="space-y-1.5">

                                    {/* LLM details */}
                                    {serviceKey === 'llm' && <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">LLM calls</span>
                                        <span className="text-gray-300">{r.llm_calls.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">LLM cost</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r.llm_cost_usd)}</span>
                                      </div>
                                      {r.llm_calls > 0 && (
                                        <div className="flex justify-between text-gray-600">
                                          <span>Cost per call</span>
                                          <span>{fmtUsd(r.llm_cost_usd / r.llm_calls)}</span>
                                        </div>
                                      )}
                                    </>}

                                    {/* API details */}
                                    {serviceKey === 'api' && <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">API calls</span>
                                        <span className="text-gray-300">{r.api_calls.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">API cost</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r.api_cost_usd)}</span>
                                      </div>
                                      {r.api_calls > 0 && (
                                        <div className="flex justify-between text-gray-600">
                                          <span>Cost per call</span>
                                          <span>{fmtUsd(r.api_cost_usd / r.api_calls)}</span>
                                        </div>
                                      )}
                                    </>}

                                    {/* Infra details */}
                                    {!isDirectMode && <>
                                      <div className="flex justify-between">
                                        <span className={svcColor}>{serviceLabel} share</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r._serviceCost)}</span>
                                      </div>
                                      {metricCol && r._metricValue != null && (
                                        <div className="flex justify-between">
                                          <span className="text-gray-400">{metricCol.header}</span>
                                          <span className="text-gray-300">{metricCol.format(r._metricValue)}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between border-t border-gray-800 pt-1.5 mt-1.5">
                                        <span className="text-gray-400">Allocation weight</span>
                                        <span className="text-gray-300">{fmtPct(r._weightPct)}</span>
                                      </div>
                                      <div className="flex justify-between text-gray-600">
                                        <span>Based on LLM+API</span>
                                        <span>{fmtUsd(r.total_cost_usd)}</span>
                                      </div>
                                    </>}
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-600 shrink-0">
          {isDirectMode
            ? `Exact ${serviceKey.toUpperCase()} cost per org · ${MONTH_NAMES[month - 1]} ${year}`
            : `Infra allocated proportionally by org LLM+API spend · ${MONTH_NAMES[month - 1]} ${year} · [est]`}
          {' · '}15% capacity margin applied to plan thresholds
        </div>

      </div>
    </>
  );
}

// ── Table header helper ────────────────────────────────────────────────────────

function Th({ k, label, sortKey, sortDir, onSort, right, highlight }: {
  k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void; right?: boolean; highlight?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-white transition-colors
        ${right ? 'text-right' : 'text-left'}
        ${highlight ? 'text-violet-400' : active ? 'text-white' : 'text-gray-500'}`}
      onClick={() => onSort(k)}
    >
      {label}
      {active && (sortDir === 'desc'
        ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
        : <ChevronUp   className="w-3 h-3 inline ml-0.5" />)}
    </th>
  );
}
