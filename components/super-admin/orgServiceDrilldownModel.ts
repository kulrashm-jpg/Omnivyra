/**
 * OrgServiceDrilldown — model layer.
 *
 * Types, plan/spike/metric-column definitions, and formatting helpers for the
 * per-service drilldown panel. Split from OrgServiceDrilldown.tsx (Agent-B
 * large-file modularization); the component re-exports the public types, so
 * external importers keep using './super-admin/OrgServiceDrilldown'.
 */

// ── External types (subset of IntelligenceData) ────────────────────────────────

export interface IntelMetrics {
  redis?:    { totalOps: number; opsPerMin: number; peakOpsPerMin: number; storageBytesUsed: number; topFeatures: {feature:string;total:number;pct:number}[] } | null;
  supabase?: { reads: number; writes: number; errors: number; queriesPerMin: number; avgReadLatency: number|null; avgWriteLatency: number|null } | null;
  firebase?: { tokenVerifications: number; revokedChecks: number; authErrors: number; signIns: number; verificationsPerMin: number; avgVerifyLatencyMs: number|null } | null;
  api?:      { totalCalls: number; callsPerMin: number; errors4xx: number; errors5xx: number; errorRate: number; avgLatencyMs: number|null; p95LatencyMs: number|null } | null;
}
export interface IntelCostEntry {
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

export interface OrgActivity {
  posts_total:        number;
  posts_published:    number;
  posts_by_platform:  Record<string, number>;
  campaigns_total:    number;
  campaigns_active:   number;
}
export interface OrgRow {
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
export interface BreakdownData {
  period:  { year: number; month: number };
  orgs:    OrgRow[];
  totals:  { llm_cost_usd: number; api_cost_usd: number; total_cost_usd: number; posts_total: number; org_count: number };
}

// ── Public types ───────────────────────────────────────────────────────────────

export type ServiceKey = 'llm' | 'api' | 'redis' | 'supabase' | 'railway' | 'vercel' | 'cdn' | 'firebase';

export interface Props {
  serviceKey:     ServiceKey;
  serviceLabel:   string;
  serviceCostUsd: number;      // monthly infra estimate (0 for llm/api direct)
  initialYear:    number;
  initialMonth:   number;
  intel?:         DrilldownIntel | null;
  onClose:        () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-500', twitter: 'bg-sky-400', instagram: 'bg-pink-500',
  facebook: 'bg-indigo-500', youtube: 'bg-red-500',
};
export const PLATFORM_TEXT: Record<string, string> = {
  linkedin: 'text-blue-400', twitter: 'text-sky-400', instagram: 'text-pink-400',
  facebook: 'text-indigo-400', youtube: 'text-red-400',
};

export const SERVICE_COLOR: Record<ServiceKey, string> = {
  llm: 'text-emerald-400', api: 'text-amber-400', redis: 'text-emerald-400',
  supabase: 'text-green-400', railway: 'text-purple-400', vercel: 'text-blue-400',
  cdn: 'text-cyan-400', firebase: 'text-yellow-400',
};

// ── Plan definitions ──────────────────────────────────────────────────────────

export interface PlanDef {
  name: string;
  baseCostUsd: number;         // monthly plan cost
  limitLabel: string;          // human-readable limit description
  freeUntil?: number;          // free tier limit value (for PAYG)
  overageLabel?: string;       // overage pricing text
  nextPlan?: { name: string; baseCostUsd: number; limitLabel: string };
  remediation: string[];       // spike-handling suggestions
}

export const PLAN_DEFS: Partial<Record<ServiceKey, PlanDef>> = {
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

export interface SpikeConfig {
  getRatePerMin: (m: IntelMetrics) => number | null;
  unit: string;
  normalBaseline: number;   // ops/min expected in steady state
  warnAt: number;           // multiplier (e.g. 1.5)
  critAt: number;           // multiplier (e.g. 2.5)
}

export const SPIKE_CONFIGS: Partial<Record<ServiceKey, SpikeConfig>> = {
  redis:    { getRatePerMin: m => m.redis?.opsPerMin   ?? null, unit: 'ops/min',           normalBaseline: 100, warnAt: 1.5, critAt: 2.5 },
  supabase: { getRatePerMin: m => m.supabase?.queriesPerMin ?? null, unit: 'queries/min',  normalBaseline: 50,  warnAt: 1.5, critAt: 2.5 },
  vercel:   { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'invocations/min',   normalBaseline: 20,  warnAt: 1.5, critAt: 2.5 },
  cdn:      { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'requests/min',      normalBaseline: 50,  warnAt: 1.5, critAt: 2.5 },
  firebase: { getRatePerMin: m => m.firebase?.verificationsPerMin ?? null, unit: 'verifs/min', normalBaseline: 5, warnAt: 1.5, critAt: 2.5 },
  api:      { getRatePerMin: m => m.api?.callsPerMin   ?? null, unit: 'calls/min',         normalBaseline: 20,  warnAt: 1.5, critAt: 2.5 },
};

// ── Service metric columns ─────────────────────────────────────────────────────

// For infra services: the "secondary metric" column shows a proportion of global metric
export interface MetricColDef {
  header: string;   // column label
  getValue: (weight: number, intel: DrilldownIntel | null | undefined) => number | null;
  format: (v: number) => string;
}

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export const METRIC_COLS: Partial<Record<ServiceKey, MetricColDef>> = {
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

export const fmtUsd  = (n: number) => `$${n.toFixed(4)}`;
export const fmtUsd2 = (n: number) => `$${n.toFixed(2)}`;
export const fmtK    = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
export const fmtPct  = (n: number) => `${n.toFixed(1)}%`;

export type SortKey =
  | 'org_name' | 'service_cost' | 'metric_value' | 'weight_pct'
  | 'llm_calls' | 'llm_cost' | 'api_calls' | 'api_cost'
  | 'posts' | 'credits';
