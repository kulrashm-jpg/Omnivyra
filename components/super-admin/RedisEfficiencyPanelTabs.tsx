/** Part 1/2 of RedisEfficiencyPanel.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * RedisEfficiencyPanel — monitoring + control panel for Redis usage.
 *
 * Tabs:
 *   Rate Limiter — drill-down + live limit/window overrides per endpoint
 *   Queue System — drill-down + maxJobsPerCycle / attempts controls per queue
 *   Cron System  — drill-down + enable/disable + interval-multiplier per job
 *
 * Top section:
 *   Root Cause Summary  — ranked cost drivers
 *   Auto Optimize       — one-click preset with estimated impact + confirm dialog
 *
 * All config changes write to Redis via /api/admin/{rate-limit,queue,cron}-config
 * and take effect within 30 s (next cycle / next request) — no restart needed.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ChevronDown, ChevronRight, AlertTriangle, AlertCircle,
  Activity, Clock, Zap, Database, BarChart2, Settings, Save,
  ToggleLeft, ToggleRight, Sparkles, X, Check,
} from 'lucide-react';

// ── API types ─────────────────────────────────────────────────────────────────


interface FeatureMetrics { total: number; commands: Record<string, number> }
export interface RedisLiveReport {
  windowStart: string; windowEnd: string;
  totalOps: number; opsPerMin: number; peakOpsPerMin: number;
  byFeature: Record<string, FeatureMetrics>;
  topFeatures: { feature: string; total: number; pct: number }[];
  topCommands: { command: string; total: number; pct: number }[];
  peakWindows: { ts: string; opsPerMin: number }[];
}
interface QueueStats {
  queue: string; addedPerMin: number; processedPerMin: number;
  avgDurationMs: number | null; errorRate: string;
  opsPerJob: number; opsPerMin: number; opsTotal: number;
}
export interface QueueApiResponse {
  queueSummary: QueueStats[];
  topQueuesByRedisOps: { queueName: string; opsPerMin: number; opsPct: number }[];
  totalJobsAddedPerMin: number; totalJobsProcessedPerMin: number;
  totalRedisOpsPerMin: number; bullmqOpsFraction: number | null;
  jobsPerCronCycle: number | null; redisOpsContribution: string | null;
}
export interface CycleRecord {
  cycleId: string; instanceId: string; timestamp: string;
  jobsTriggered: number; jobNames: string[];
  usefulCycle: boolean; durationMs: number;
}
export interface CronApiResponse {
  instanceId: string; generatedAt: string; uptimeMs: number;
  cyclesPerMin: number; totalCycles: number;
  usefulCycles: number; wastedCycles: number;
  usefulPct: number; wastedPct: number;
  totalJobsTriggered: number; avgJobsPerCycle: number;
  duplicateInstances: string[]; recentCycles: CycleRecord[];
  workers: Record<string, { executions: number; lastRunAt: string | null; errors: number }>;
  topJobsByFrequency: { job: string; count: number }[];
  hasDuplicates: boolean; wastedCycleIds: string[];
}

// Config types (mirrors backend/services/adminRuntimeConfig.ts)
interface RateLimitEndpointOverride { limit: number; windowSecs: number }
export interface RateLimitAdminConfig {
  v: 1; updatedAt: string;
  endpoints: Record<string, RateLimitEndpointOverride>;
}
export interface QueueJobOverride { maxJobsPerCycle: number; attempts: number; concurrency: number }
export interface QueueAdminConfig {
  v: 1; updatedAt: string;
  queues: Record<string, QueueJobOverride>;
}
export interface CronJobOverride { enabled: boolean; intervalMultiplier: number }
export interface CronAdminConfig {
  v: 1; updatedAt: string;
  jobs: Record<string, CronJobOverride>;
}

// ── Known endpoints (from lib/auth/rateLimit.ts hardcoded defaults) ───────────
export const KNOWN_ENDPOINTS: { key: string; label: string; defaultLimit: number; defaultWindowSecs: number }[] = [
  { key: 'login',           label: '/api/auth/login',           defaultLimit: 10, defaultWindowSecs: 900   },
  { key: 'otp_send',        label: '/api/auth/otp (send)',       defaultLimit: 5,  defaultWindowSecs: 3600  },
  { key: 'otp_verify',      label: '/api/auth/otp (verify)',     defaultLimit: 10, defaultWindowSecs: 900   },
  { key: 'email_link',      label: '/api/auth/email-link',       defaultLimit: 3,  defaultWindowSecs: 3600  },
  { key: 'onboarding',      label: '/api/onboarding/complete',   defaultLimit: 5,  defaultWindowSecs: 3600  },
  { key: 'uid:onboarding',  label: '/api/onboarding (per UID)',  defaultLimit: 3,  defaultWindowSecs: 3600  },
  { key: 'uid:invite',      label: '/api/invite (per UID)',      defaultLimit: 10, defaultWindowSecs: 3600  },
];

// Known queues
const KNOWN_QUEUES = ['publish', 'posting', 'ai-heavy', 'engagement-polling'];

// All cron job keys with labels
export const CRON_JOBS: { key: string; label: string; defaultIntervalMin: number }[] = [
  { key: 'engagementPolling',          label: 'Engagement Polling',          defaultIntervalMin: 10    },
  { key: 'intelligencePolling',        label: 'Intelligence Polling',         defaultIntervalMin: 120   },
  { key: 'signalClustering',           label: 'Signal Clustering',            defaultIntervalMin: 30    },
  { key: 'signalIntelligence',         label: 'Signal Intelligence',          defaultIntervalMin: 60    },
  { key: 'strategicTheme',             label: 'Strategic Themes',             defaultIntervalMin: 60    },
  { key: 'campaignOpportunity',        label: 'Campaign Opportunities',       defaultIntervalMin: 60    },
  { key: 'contentOpportunity',         label: 'Content Opportunities',        defaultIntervalMin: 120   },
  { key: 'narrativeEngine',            label: 'Narrative Engine',             defaultIntervalMin: 240   },
  { key: 'communityPost',              label: 'Community Posts',              defaultIntervalMin: 180   },
  { key: 'threadEngine',               label: 'Thread Engine',                defaultIntervalMin: 180   },
  { key: 'engagementCapture',          label: 'Engagement Capture',           defaultIntervalMin: 30    },
  { key: 'engagementSignalScheduler',  label: 'Engagement Signal Scheduler',  defaultIntervalMin: 15    },
  { key: 'engagementOpportunityScanner',label:'Engagement Opportunity Scanner',defaultIntervalMin: 240  },
  { key: 'engagementDigest',           label: 'Engagement Digest',            defaultIntervalMin: 1440  },
  { key: 'feedbackIntelligence',       label: 'Feedback Intelligence',        defaultIntervalMin: 360   },
  { key: 'companyTrendRelevance',      label: 'Company Trend Relevance',      defaultIntervalMin: 360   },
  { key: 'performanceIngestion',       label: 'Performance Ingestion',        defaultIntervalMin: 360   },
  { key: 'performanceAggregation',     label: 'Performance Aggregation',      defaultIntervalMin: 1440  },
  { key: 'campaignHealthEvaluation',   label: 'Campaign Health Evaluation',   defaultIntervalMin: 1440  },
  { key: 'dailyIntelligence',          label: 'Daily Intelligence',           defaultIntervalMin: 1440  },
  { key: 'intelligenceEventCleanup',   label: 'Intelligence Event Cleanup',   defaultIntervalMin: 1440  },
  { key: 'connectorTokenRefresh',      label: 'Connector Token Refresh',      defaultIntervalMin: 360   },
  { key: 'leadThreadQueueCleanup',     label: 'Lead Thread Queue Cleanup',    defaultIntervalMin: 10    },
  { key: 'engagementSignalArchive',    label: 'Engagement Signal Archive',    defaultIntervalMin: 1440  },
  { key: 'opportunitySlots',           label: 'Opportunity Slots',            defaultIntervalMin: 1440  },
  { key: 'governanceAudit',            label: 'Governance Audit',             defaultIntervalMin: 1440  },
  { key: 'autoOptimization',           label: 'Auto Optimization',            defaultIntervalMin: 1440  },
  { key: 'confidenceCalibration',      label: 'Confidence Calibration',       defaultIntervalMin: 10080 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export type ImpactLevel = 'high' | 'medium' | 'low';

export function impactBadge(level: ImpactLevel) {
  const cfg = {
    high:   { dot: 'bg-red-500',     text: 'text-red-400',     label: 'High' },
    medium: { dot: 'bg-yellow-500',  text: 'text-yellow-400',  label: 'Med'  },
    low:    { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Low'  },
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export function queueImpact(opsPerMin: number, total: number): ImpactLevel {
  if (total === 0) return 'low';
  const p = opsPerMin / total;
  return p >= 0.35 ? 'high' : p >= 0.15 ? 'medium' : 'low';
}

export function fmt(n: number | null | undefined, d = 0) { return n == null ? '—' : n.toFixed(d); }
export function msToSec(ms: number | null | undefined) { return ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`; }
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3_600_000)}h ago`;
}

export function StatCard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ? 'text-violet-300' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export function InsightBox({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 bg-amber-950/30 border border-amber-700/30 rounded-lg px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
      <p className="text-sm text-amber-200">{text}</p>
    </div>
  );
}

export function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
        saved
          ? 'bg-emerald-700/40 text-emerald-300'
          : 'bg-violet-700/40 text-violet-200 hover:bg-violet-600/50'
      }`}
    >
      {saving ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      ) : saved ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Save className="w-3.5 h-3.5" />
      )}
      {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
    </button>
  );
}

// ── Auto-optimize dialog ──────────────────────────────────────────────────────

interface OptimizeProposal {
  type:     'cron' | 'queue' | 'rate_limit';
  key:      string;
  label:    string;
  change:   string;
  opsReductionPct: number;
}

export function buildAutoOptimizeProposals(
  redis:  RedisLiveReport | null,
  queue:  QueueApiResponse | null,
  cron:   CronApiResponse | null,
): OptimizeProposal[] {
  const proposals: OptimizeProposal[] = [];

  // Cron: slow down top-3 most frequent jobs by 2x
  if (cron?.topJobsByFrequency?.length) {
    const total = cron.topJobsByFrequency.reduce((s, j) => s + j.count, 0);
    cron.topJobsByFrequency.slice(0, 3).forEach(j => {
      const firePct = total > 0 ? j.count / total : 0;
      const jobMeta = CRON_JOBS.find(c => c.key === j.job);
      proposals.push({
        type:  'cron',
        key:   j.job,
        label: jobMeta?.label ?? j.job,
        change: 'Set intervalMultiplier → 2× (runs half as often)',
        opsReductionPct: Math.round(firePct * 50), // ~50% ops reduction for this job
      });
    });
  }

  // Queue: halve the maxJobsPerCycle for the highest-load queue
  if (queue?.queueSummary?.[0]) {
    const top = queue.queueSummary[0];
    const totalOps = queue.totalRedisOpsPerMin;
    const topPct = totalOps > 0 ? top.opsPerMin / totalOps : 0;
    proposals.push({
      type:  'queue',
      key:   top.queue,
      label: `Queue: ${top.queue}`,
      change: 'Reduce maxJobsPerCycle: 500 → 250',
      opsReductionPct: Math.round(topPct * 30),
    });
  }

  // Rate limit: tighten login by 20% if it's a notable contributor
  if (redis?.byFeature?.['rate_limit']) {
    const rlTotal = redis.byFeature['rate_limit'].total;
    const rlPct = redis.totalOps > 0 ? rlTotal / redis.totalOps : 0;
    if (rlPct > 0.05) {
      proposals.push({
        type:  'rate_limit',
        key:   'login',
        label: '/api/auth/login limit',
        change: 'Reduce limit: 10 → 8 requests per 15 min',
        opsReductionPct: Math.round(rlPct * 20),
      });
    }
  }

  return proposals.sort((a, b) => b.opsReductionPct - a.opsReductionPct);
}

interface AutoOptimizeDialogProps {
  proposals: OptimizeProposal[];
  onConfirm: () => void;
  onCancel:  () => void;
  applying:  boolean;
}

export function AutoOptimizeDialog({ proposals, onConfirm, onCancel, applying }: AutoOptimizeDialogProps) {
  const totalReduction = Math.min(95, proposals.reduce((s, p) => s + p.opsReductionPct, 0));
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            <span className="text-base font-semibold text-white">Auto Optimize</span>
          </div>
          <button onClick={onCancel} className="p-1 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-400">
            The following changes will be applied immediately (within 30s). No restart required.
          </p>

          {proposals.map((p, i) => (
            <div key={i} className="flex items-start gap-3 bg-gray-800/60 rounded-lg p-3">
              <span className="w-5 h-5 rounded-full bg-violet-900/60 flex items-center justify-center text-xs text-violet-300 shrink-0 mt-0.5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{p.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{p.change}</p>
              </div>
              <span className="text-xs font-medium text-emerald-400 shrink-0">−{p.opsReductionPct}%</span>
            </div>
          ))}

          <div className="bg-emerald-950/40 border border-emerald-700/30 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-emerald-300">Expected Redis ops reduction</span>
            <span className="text-xl font-bold text-emerald-400">~{totalReduction}%</span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={applying}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {applying ? 'Applying…' : 'Apply Optimizations'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root cause summary ────────────────────────────────────────────────────────

export interface IssueSummaryItem { rank: number; label: string; detail: string; impact: ImpactLevel }

export function RootCauseSummary({ issues }: { issues: IssueSummaryItem[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-5 bg-gray-800/60 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-400" />
        <span className="text-sm font-semibold text-gray-200">Top Redis Cost Drivers</span>
        <span className="text-xs text-gray-500 ml-1">highest impact first</span>
      </div>
      <div className="divide-y divide-gray-700/50">
        {issues.map(item => (
          <div key={item.rank} className="px-4 py-3 flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">{item.rank}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-white">{item.label}</span>
              <span className="text-xs text-gray-400 ml-2">{item.detail}</span>
            </div>
            {impactBadge(item.impact)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TAB 1: RATE LIMITER ───────────────────────────────────────────────────────

export function RateLimiterTab({
  redis, rlConfig, onRlConfigSave,
}: {
  redis:          RedisLiveReport | null;
  rlConfig:       RateLimitAdminConfig | null;
  onRlConfigSave: (cfg: RateLimitAdminConfig) => Promise<void>;
}) {
  const [drafts, setDrafts]           = useState<Record<string, RateLimitEndpointOverride>>({});
  const [expandCommands, setExpCmd]   = useState(false);
  const [expandFeatures, setExpFeat]  = useState(false);
  const [saving, setSaving]           = useState(false);
  const [savedKey, setSavedKey]       = useState<string | null>(null);

  // Initialise drafts from loaded config
  useEffect(() => {
    if (rlConfig) setDrafts(rlConfig.endpoints ?? {});
  }, [rlConfig]);

  const effectiveLimit   = (key: string) => drafts[key]?.limit      ?? KNOWN_ENDPOINTS.find(e => e.key === key)?.defaultLimit;
  const effectiveWindow  = (key: string) => drafts[key]?.windowSecs ?? KNOWN_ENDPOINTS.find(e => e.key === key)?.defaultWindowSecs;
  const isOverridden     = (key: string) => !!rlConfig?.endpoints?.[key];

  const saveEndpoint = async (key: string) => {
    const limit      = drafts[key]?.limit;
    const windowSecs = drafts[key]?.windowSecs;
    if (!limit || !windowSecs) return;
    setSaving(true);
    try {
      const next: RateLimitAdminConfig = {
        v:         1,
        updatedAt: new Date().toISOString(),
        endpoints: { ...(rlConfig?.endpoints ?? {}), [key]: { limit, windowSecs } },
      };
      await onRlConfigSave(next);
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2500);
    } finally { setSaving(false); }
  };

  const resetEndpoint = async (key: string) => {
    const next = { ...(rlConfig?.endpoints ?? {}) };
    delete next[key];
    setSaving(true);
    try {
      await onRlConfigSave({ v: 1, updatedAt: new Date().toISOString(), endpoints: next });
    } finally { setSaving(false); }
  };

  const rlFeature  = redis?.byFeature?.['rate_limit'];
  const rlTotal    = rlFeature?.total ?? 0;
  const rlPct      = redis?.totalOps ? (rlTotal / redis.totalOps) * 100 : 0;
  const rlOpsPerMin = redis?.totalOps
    ? Math.round(redis.opsPerMin * (rlTotal / Math.max(1, redis.totalOps)))
    : 0;
  const estChecksPerMin = Math.round(rlOpsPerMin / 3);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="RL Ops / min"           value={rlOpsPerMin}           sub="rolling 60s" accent />
        <StatCard label="% of All Redis"          value={`${rlPct.toFixed(1)}%`} sub="share of total ops" />
        <StatCard label="Est. Checks / min"       value={estChecksPerMin}        sub="÷3 ops/check" />
        <StatCard label="RL Ops (cumul.)"         value={rlTotal.toLocaleString()} sub="since last reset" />
      </div>

      {/* Endpoint controls */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
          <Settings className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-gray-200">Endpoint Rate Limit Overrides</span>
          <span className="text-xs text-gray-500 ml-1">applies within 30s, no restart</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Endpoint</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-400">Max requests</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-400">Window (sec)</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-400">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {KNOWN_ENDPOINTS.map(ep => (
              <tr key={ep.key} className="hover:bg-gray-700/20">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-sky-300">{ep.label}</span>
                  {isOverridden(ep.key) && (
                    <span className="ml-2 text-xs text-violet-400">overridden</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="number" min={1} max={1000}
                    value={effectiveLimit(ep.key) ?? ''}
                    onChange={e => setDrafts(d => ({
                      ...d,
                      [ep.key]: { limit: parseInt(e.target.value) || ep.defaultLimit, windowSecs: d[ep.key]?.windowSecs ?? ep.defaultWindowSecs },
                    }))}
                    className="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-violet-500"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="number" min={10} max={86400}
                    value={effectiveWindow(ep.key) ?? ''}
                    onChange={e => setDrafts(d => ({
                      ...d,
                      [ep.key]: { windowSecs: parseInt(e.target.value) || ep.defaultWindowSecs, limit: d[ep.key]?.limit ?? ep.defaultLimit },
                    }))}
                    className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-violet-500"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs font-medium ${isOverridden(ep.key) ? 'text-violet-400' : 'text-gray-500'}`}>
                    {isOverridden(ep.key) ? 'custom' : 'default'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <SaveButton
                      onClick={() => saveEndpoint(ep.key)}
                      saving={saving && savedKey !== ep.key}
                      saved={savedKey === ep.key}
                    />
                    {isOverridden(ep.key) && (
                      <button
                        onClick={() => resetEndpoint(ep.key)}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                      >Reset</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Command breakdown (collapsible) */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpCmd(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-gray-200">Redis Command Breakdown</span>
          </div>
          {expandCommands ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
        {expandCommands && (
          <div className="border-t border-gray-700">
            {!rlFeature || Object.keys(rlFeature.commands).length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-500">No rate-limit commands recorded yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Command</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Count</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {Object.entries(rlFeature.commands)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cmd, count]) => (
                      <tr key={cmd} className="hover:bg-gray-700/20">
                        <td className="px-4 py-2.5 font-mono text-xs text-sky-300">{cmd}</td>
                        <td className="px-4 py-2.5 text-right text-white">{count.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400">
                          {rlTotal > 0 ? ((count / rlTotal) * 100).toFixed(1) : 0}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* All features */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpFeat(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-gray-200">All Features — Op Ranking</span>
          </div>
          {expandFeatures ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
        {expandFeatures && redis && (
          <div className="border-t border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Feature</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Ops</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">%</th>
                  <th className="px-4 py-2 pr-4 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {redis.topFeatures.map(f => (
                  <tr key={f.feature} className={`hover:bg-gray-700/20 ${f.feature === 'rate_limit' ? 'bg-violet-900/10' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-200 capitalize">{f.feature.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-right text-white">{f.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300">{f.pct}%</td>
                    <td className="px-4 py-2.5 pr-4">
                      <div className="h-1.5 bg-gray-700 rounded-full">
                        <div className="h-1.5 bg-violet-500 rounded-full" style={{ width: `${Math.min(f.pct, 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TAB 2: QUEUE SYSTEM ───────────────────────────────────────────────────────

