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
interface RedisLiveReport {
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
interface QueueApiResponse {
  queueSummary: QueueStats[];
  topQueuesByRedisOps: { queueName: string; opsPerMin: number; opsPct: number }[];
  totalJobsAddedPerMin: number; totalJobsProcessedPerMin: number;
  totalRedisOpsPerMin: number; bullmqOpsFraction: number | null;
  jobsPerCronCycle: number | null; redisOpsContribution: string | null;
}
interface CycleRecord {
  cycleId: string; instanceId: string; timestamp: string;
  jobsTriggered: number; jobNames: string[];
  usefulCycle: boolean; durationMs: number;
}
interface CronApiResponse {
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
interface RateLimitAdminConfig {
  v: 1; updatedAt: string;
  endpoints: Record<string, RateLimitEndpointOverride>;
}
interface QueueJobOverride { maxJobsPerCycle: number; attempts: number; concurrency: number }
interface QueueAdminConfig {
  v: 1; updatedAt: string;
  queues: Record<string, QueueJobOverride>;
}
interface CronJobOverride { enabled: boolean; intervalMultiplier: number }
interface CronAdminConfig {
  v: 1; updatedAt: string;
  jobs: Record<string, CronJobOverride>;
}

// ── Known endpoints (from lib/auth/rateLimit.ts hardcoded defaults) ───────────
const KNOWN_ENDPOINTS: { key: string; label: string; defaultLimit: number; defaultWindowSecs: number }[] = [
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
const CRON_JOBS: { key: string; label: string; defaultIntervalMin: number }[] = [
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

type ImpactLevel = 'high' | 'medium' | 'low';

function impactBadge(level: ImpactLevel) {
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

function queueImpact(opsPerMin: number, total: number): ImpactLevel {
  if (total === 0) return 'low';
  const p = opsPerMin / total;
  return p >= 0.35 ? 'high' : p >= 0.15 ? 'medium' : 'low';
}

function fmt(n: number | null | undefined, d = 0) { return n == null ? '—' : n.toFixed(d); }
function msToSec(ms: number | null | undefined) { return ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`; }
function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3_600_000)}h ago`;
}

function StatCard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ? 'text-violet-300' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function InsightBox({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 bg-amber-950/30 border border-amber-700/30 rounded-lg px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
      <p className="text-sm text-amber-200">{text}</p>
    </div>
  );
}

function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
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

function buildAutoOptimizeProposals(
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

function AutoOptimizeDialog({ proposals, onConfirm, onCancel, applying }: AutoOptimizeDialogProps) {
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

interface IssueSummaryItem { rank: number; label: string; detail: string; impact: ImpactLevel }

function RootCauseSummary({ issues }: { issues: IssueSummaryItem[] }) {
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

function RateLimiterTab({
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

function QueueTab({
  queue: data, queueConfig, onQueueConfigSave,
}: {
  queue:             QueueApiResponse | null;
  queueConfig:       QueueAdminConfig | null;
  onQueueConfigSave: (cfg: QueueAdminConfig) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts,   setDrafts]   = useState<Record<string, QueueJobOverride>>({});
  const [saving,   setSaving]   = useState<string | null>(null);
  const [saved,    setSaved]    = useState<string | null>(null);

  useEffect(() => {
    if (queueConfig) setDrafts(queueConfig.queues ?? {});
  }, [queueConfig]);

  const toggle = (name: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const getDraft = (name: string): QueueJobOverride =>
    drafts[name] ?? { maxJobsPerCycle: 500, attempts: 3, concurrency: 5 };

  const setField = (name: string, field: keyof QueueJobOverride, val: number) =>
    setDrafts(d => ({ ...d, [name]: { ...getDraft(name), [field]: val } }));

  const saveQueue = async (name: string) => {
    setSaving(name);
    try {
      const next: QueueAdminConfig = {
        v: 1, updatedAt: new Date().toISOString(),
        queues: { ...(queueConfig?.queues ?? {}), [name]: getDraft(name) },
      };
      await onQueueConfigSave(next);
      setSaved(name); setTimeout(() => setSaved(null), 2500);
    } finally { setSaving(null); }
  };

  if (!data) {
    return <div className="py-10 text-center text-gray-500 text-sm">No queue metrics available. Queue workers must be running.</div>;
  }

  const queues   = data.queueSummary ?? [];
  const totalOps = data.totalRedisOpsPerMin;
  const top      = queues[0];
  const insight  = top?.opsPerMin > 0
    ? `"${top.queue}" is highest-load — ${top.opsPerMin} ops/min (${totalOps > 0 ? Math.round((top.opsPerMin / totalOps) * 100) : 0}%). Each job costs ~${top.opsPerJob} Redis ops.`
    : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Queue Ops / min" value={totalOps.toLocaleString()} sub="across all queues" accent />
        <StatCard label="Jobs Added / min"       value={fmt(data.totalJobsAddedPerMin)} />
        <StatCard label="Jobs Processed / min"   value={fmt(data.totalJobsProcessedPerMin)} />
        <StatCard label="BullMQ / Total Redis"   value={data.bullmqOpsFraction != null ? `${Math.round(data.bullmqOpsFraction * 100)}%` : '—'} sub={data.redisOpsContribution ?? ''} />
      </div>

      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
          <Database className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-gray-200">Queues — sorted by Redis ops · click to expand + configure</span>
        </div>

        {queues.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 text-center">No queue data yet.</div>
        ) : (
          <div className="divide-y divide-gray-700/40">
            {queues.map(q => {
              const isOpen  = expanded.has(q.queue);
              const impact  = queueImpact(q.opsPerMin, totalOps);
              const pctN    = totalOps > 0 ? (q.opsPerMin / totalOps) * 100 : 0;
              const errNum  = parseFloat(q.errorRate);
              const draft   = getDraft(q.queue);

              return (
                <div key={q.queue}>
                  <button
                    onClick={() => toggle(q.queue)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-700/30 transition-colors text-left"
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                    <span className="font-mono text-sm text-sky-300 min-w-[160px]">{q.queue}</span>
                    <div className="flex-1 flex items-center gap-4 flex-wrap text-xs text-gray-400">
                      <span><span className="text-white font-medium">{q.opsPerMin}</span> ops/min</span>
                      <span><span className="text-white font-medium">{q.addedPerMin}</span> added/min</span>
                      <span><span className="text-white font-medium">{q.processedPerMin}</span> proc/min</span>
                      {errNum > 0 && <span className={errNum > 10 ? 'text-red-400' : 'text-yellow-400'}>{q.errorRate} errors</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-20 h-1.5 bg-gray-700 rounded-full hidden sm:block">
                        <div
                          className={`h-1.5 rounded-full ${impact === 'high' ? 'bg-red-500' : impact === 'medium' ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(pctN, 100)}%` }}
                        />
                      </div>
                      {impactBadge(impact)}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-5 pt-2 bg-gray-900/50 border-t border-gray-700/30 space-y-4">
                      {/* Metrics row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Ops / job',    value: String(q.opsPerJob),         hint: 'estimated per lifecycle' },
                          { label: 'Avg duration', value: msToSec(q.avgDurationMs),    hint: 'mean wall-clock time'    },
                          { label: 'Error rate',   value: q.errorRate,                  hint: 'failed / processed'      },
                          { label: '% of ops',     value: `${pctN.toFixed(1)}%`,       hint: 'share of all queue ops'  },
                        ].map(m => (
                          <div key={m.label} className="bg-gray-800 rounded-lg p-3" title={m.hint}>
                            <p className="text-xs text-gray-400 mb-0.5">{m.label}</p>
                            <p className="text-sm font-bold text-white">{m.value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Config controls */}
                      <div className="bg-gray-800/70 rounded-lg p-4 space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Settings className="w-3.5 h-3.5 text-violet-400" />
                          <span className="text-xs font-semibold text-gray-300">Queue Config Override</span>
                          {queueConfig?.queues?.[q.queue] && (
                            <span className="text-xs text-violet-400">custom active</span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { field: 'maxJobsPerCycle' as const, label: 'Max jobs / cycle', min: 1,  max: 5000, hint: '1–5000 — caps addBulk fan-out' },
                            { field: 'attempts'        as const, label: 'Retry attempts',   min: 0,  max: 10,   hint: '0–10 — retry count on failure' },
                            { field: 'concurrency'     as const, label: 'Concurrency',      min: 1,  max: 50,   hint: '1–50 — parallel jobs per worker' },
                          ].map(f => (
                            <div key={f.field} title={f.hint}>
                              <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                              <input
                                type="number" min={f.min} max={f.max}
                                value={draft[f.field] ?? ''}
                                onChange={e => setField(q.queue, f.field, parseInt(e.target.value) || f.min)}
                                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-end">
                          <SaveButton
                            onClick={() => saveQueue(q.queue)}
                            saving={saving === q.queue}
                            saved={saved === q.queue}
                          />
                        </div>
                      </div>

                      {errNum > 5 && (
                        <div className="flex items-start gap-2 bg-red-950/30 border border-red-700/30 rounded-lg px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-red-200">Error rate {q.errorRate} is elevated. Retries add +4 Redis ops/attempt.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {insight && <InsightBox text={insight} />}
    </div>
  );
}

// ── TAB 3: CRON SYSTEM ────────────────────────────────────────────────────────

const MULTIPLIER_OPTIONS = [
  { value: 0.5, label: '0.5× (2× faster)'   },
  { value: 1,   label: '1× (normal)'         },
  { value: 2,   label: '2× (half frequency)' },
  { value: 3,   label: '3× (⅓ frequency)'   },
  { value: 5,   label: '5× (⅕ frequency)'   },
  { value: 10,  label: '10× (⅒ frequency)'  },
];

function CronTab({
  cron, cronConfig, onCronConfigSave,
}: {
  cron:             CronApiResponse | null;
  cronConfig:       CronAdminConfig | null;
  onCronConfigSave: (cfg: CronAdminConfig) => Promise<void>;
}) {
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [showCycles,  setShowCycles]  = useState(false);
  const [showWorkers, setShowWorkers] = useState(false);
  const [saving,      setSaving]      = useState<string | null>(null);
  const [saved,       setSaved]       = useState<string | null>(null);

  const getOverride = (key: string): CronJobOverride =>
    cronConfig?.jobs?.[key] ?? { enabled: true, intervalMultiplier: 1 };

  const saveJob = async (key: string, override: CronJobOverride) => {
    setSaving(key);
    try {
      const next: CronAdminConfig = {
        v: 1, updatedAt: new Date().toISOString(),
        jobs: { ...(cronConfig?.jobs ?? {}), [key]: override },
      };
      await onCronConfigSave(next);
      setSaved(key); setTimeout(() => setSaved(null), 2500);
    } finally { setSaving(null); }
  };

  const recentCycles = cron?.recentCycles ?? [];
  const topJobs      = cron?.topJobsByFrequency ?? [];
  const workers      = cron?.workers ?? {};

  const jobCycles: Record<string, CycleRecord[]> = {};
  for (const cycle of recentCycles) {
    for (const job of cycle.jobNames) {
      if (!jobCycles[job]) jobCycles[job] = [];
      jobCycles[job].push(cycle);
    }
  }

  const totalFires = topJobs.reduce((s, j) => s + j.count, 0);
  const topJob     = topJobs[0];
  const insight    = topJob
    ? `"${topJob.job}" fired ${topJob.count}× in last ${recentCycles.length} cycles (${totalFires > 0 ? Math.round((topJob.count / totalFires) * 100) : 0}%).` +
      (cron?.wastedPct && cron.wastedPct > 25 ? ` ${cron.wastedPct}% wasted cycles.` : '')
    : null;

  // Build the full job list: top frequency jobs first, then any with overrides, then all others
  const activatedKeys = new Set([...topJobs.map(j => j.job), ...Object.keys(cronConfig?.jobs ?? {})]);
  const displayJobs: { key: string; label: string; count?: number }[] = [
    ...topJobs.map(j => ({
      key:   j.job,
      label: CRON_JOBS.find(c => c.key === j.job)?.label ?? j.job,
      count: j.count,
    })),
    ...CRON_JOBS
      .filter(c => !activatedKeys.has(c.key) || (cronConfig?.jobs?.[c.key] && !topJobs.find(j => j.job === c.key)))
      .map(c => ({ key: c.key, label: c.label, count: undefined })),
  ];

  return (
    <div className="space-y-5">
      {cron ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Cycles / min"     value={fmt(cron.cyclesPerMin)} accent />
          <StatCard label="Useful cycles"    value={`${cron.usefulPct}%`} sub={`${cron.usefulCycles} of ${cron.totalCycles}`} />
          <StatCard label="Wasted cycles"    value={`${cron.wastedPct}%`} sub={`${cron.wastedCycles} fired nothing`} />
          <StatCard label="Jobs / cycle avg" value={fmt(cron.avgJobsPerCycle, 1)} />
        </div>
      ) : (
        <div className="py-10 text-center text-gray-500 text-sm">No cron metrics available. Cron process must be running.</div>
      )}

      {cron?.hasDuplicates && (
        <div className="flex items-start gap-2 bg-red-950/30 border border-red-700/40 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">Duplicate cron instances: {cron.duplicateInstances.join(', ')}</p>
        </div>
      )}

      {/* Job config table */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-gray-200">Cron Job Controls</span>
          <span className="text-xs text-gray-500 ml-1">applies within 15 min · click to expand</span>
        </div>
        <div className="divide-y divide-gray-700/40">
          {displayJobs.map(item => {
            const isOpen   = expandedJob === item.key;
            const override = getOverride(item.key);
            const isCustom = !!cronConfig?.jobs?.[item.key];
            const cycles   = jobCycles[item.key] ?? [];
            const firePct  = totalFires > 0 && item.count != null ? (item.count / totalFires) * 100 : 0;
            const impact: ImpactLevel = firePct >= 30 ? 'high' : firePct >= 15 ? 'medium' : 'low';

            return (
              <div key={item.key}>
                <div
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-700/20 cursor-pointer"
                  onClick={() => setExpandedJob(isOpen ? null : item.key)}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}

                  {/* Toggle */}
                  <button
                    onClick={e => { e.stopPropagation(); saveJob(item.key, { ...override, enabled: !override.enabled }); }}
                    className="shrink-0"
                    title={override.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    {override.enabled
                      ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                      : <ToggleLeft  className="w-5 h-5 text-gray-600"    />}
                  </button>

                  <span className={`flex-1 text-sm min-w-0 truncate ${override.enabled ? 'text-gray-200' : 'text-gray-600 line-through'}`}>
                    {item.label}
                  </span>

                  {item.count != null && (
                    <span className="text-xs text-gray-500 shrink-0">{item.count}× fired</span>
                  )}
                  {override.intervalMultiplier !== 1 && (
                    <span className="text-xs text-violet-400 shrink-0">{override.intervalMultiplier}×</span>
                  )}
                  {isCustom && <span className="text-xs text-violet-500 shrink-0">custom</span>}
                  {item.count != null && firePct > 5 && impactBadge(impact)}
                  {saving === item.key && <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin shrink-0" />}
                  {saved === item.key && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-gray-900/50 border-t border-gray-700/30">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <div className="bg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-0.5">Appearances</p>
                        <p className="text-sm font-bold text-white">{cycles.length}</p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-0.5">% of fires</p>
                        <p className="text-sm font-bold text-white">{firePct.toFixed(1)}%</p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-0.5">Status</p>
                        <p className={`text-sm font-bold ${override.enabled ? 'text-emerald-400' : 'text-red-400'}`}>
                          {override.enabled ? 'Enabled' : 'Disabled'}
                        </p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-0.5">Last fired</p>
                        <p className="text-sm font-bold text-white">{relTime(cycles[0]?.timestamp)}</p>
                      </div>
                    </div>

                    {/* Interval multiplier control */}
                    <div className="bg-gray-800/70 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Settings className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-semibold text-gray-300">Interval Override</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={override.intervalMultiplier}
                          onChange={e => saveJob(item.key, { ...override, intervalMultiplier: parseFloat(e.target.value) })}
                          disabled={!override.enabled}
                          className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-40"
                        >
                          {MULTIPLIER_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {CRON_JOBS.find(c => c.key === item.key) && (
                          <span className="text-xs text-gray-500 shrink-0">
                            base: {CRON_JOBS.find(c => c.key === item.key)!.defaultIntervalMin}min
                            {' '}→ effective: {Math.round(CRON_JOBS.find(c => c.key === item.key)!.defaultIntervalMin * override.intervalMultiplier)}min
                          </span>
                        )}
                      </div>
                    </div>

                    {cycles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {cycles.slice(0, 6).map(c => (
                          <span key={c.cycleId} className="text-xs font-mono bg-gray-800 text-gray-400 rounded px-2 py-0.5" title={c.timestamp}>
                            {c.cycleId.slice(0, 8)}
                          </span>
                        ))}
                        {cycles.length > 6 && <span className="text-xs text-gray-500">+{cycles.length - 6}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent cycles */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowCycles(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-gray-200">Recent Cycles</span>
            <span className="text-xs text-gray-500">last {Math.min(recentCycles.length, 20)}</span>
          </div>
          {showCycles ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
        {showCycles && (
          <div className="border-t border-gray-700 max-h-72 overflow-y-auto divide-y divide-gray-700/40">
            {recentCycles.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-500">No cycles yet.</div>
            ) : recentCycles.map(c => (
              <div key={c.cycleId} className={`px-4 py-2.5 flex items-center gap-3 text-sm ${c.usefulCycle ? '' : 'opacity-50'}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.usefulCycle ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                <span className="font-mono text-xs text-gray-500 w-20 shrink-0">{c.cycleId.slice(0, 8)}</span>
                <span className="text-xs text-gray-400 w-20 shrink-0">{relTime(c.timestamp)}</span>
                <span className="text-xs text-gray-400 w-14 shrink-0">{c.durationMs}ms</span>
                {c.jobNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {c.jobNames.slice(0, 4).map(j => (
                      <span key={j} className="text-xs bg-sky-900/40 text-sky-300 rounded px-1.5 py-0.5">{j}</span>
                    ))}
                    {c.jobNames.length > 4 && <span className="text-xs text-gray-500">+{c.jobNames.length - 4}</span>}
                  </div>
                ) : <span className="text-xs text-gray-600 italic">no jobs</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workers */}
      {Object.keys(workers).length > 0 && (
        <div className="bg-gray-800/60 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowWorkers(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold text-gray-200">Worker Execution Counts</span>
            </div>
            {showWorkers ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>
          {showWorkers && (
            <div className="border-t border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Worker</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Executions</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Errors</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Last run</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {Object.entries(workers)
                    .sort((a, b) => b[1].executions - a[1].executions)
                    .map(([name, s]) => (
                      <tr key={name} className="hover:bg-gray-700/20">
                        <td className="px-4 py-2.5 font-mono text-xs text-sky-300">{name}</td>
                        <td className="px-4 py-2.5 text-right text-white">{s.executions.toLocaleString()}</td>
                        <td className={`px-4 py-2.5 text-right ${s.errors > 0 ? 'text-red-400' : 'text-gray-600'}`}>{s.errors}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400 text-xs">{relTime(s.lastRunAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {insight && <InsightBox text={insight} />}
    </div>
  );
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────

type SubTab = 'rate-limiter' | 'queue' | 'cron';

export default function RedisEfficiencyPanel() {
  const [subTab,      setSubTab]      = useState<SubTab>('queue');
  const [redisData,   setRedisData]   = useState<RedisLiveReport | null>(null);
  const [queueData,   setQueueData]   = useState<QueueApiResponse | null>(null);
  const [cronData,    setCronData]    = useState<CronApiResponse | null>(null);
  const [rlConfig,    setRlConfig]    = useState<RateLimitAdminConfig | null>(null);
  const [queueConfig, setQueueConfig] = useState<QueueAdminConfig | null>(null);
  const [cronConfig,  setCronConfig]  = useState<CronAdminConfig | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [errors,      setErrors]      = useState<Record<SubTab, string | null>>({ 'rate-limiter': null, queue: null, cron: null });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showOptimize,  setShowOptimize]  = useState(false);
  const [applyingOpt,   setApplyingOpt]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch all metrics + configs in parallel ─────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const errs: Record<SubTab, string | null> = { 'rate-limiter': null, queue: null, cron: null };

    const [rRes, qRes, cRes, rlCfgRes, qCfgRes, cronCfgRes] = await Promise.allSettled([
      fetch('/api/super-admin/redis-metrics', { credentials: 'include' }),
      fetch('/api/super-admin/queue-metrics',  { credentials: 'include' }),
      fetch('/api/super-admin/cron-metrics',   { credentials: 'include' }),
      fetch('/api/admin/rate-limit-config',    { credentials: 'include' }),
      fetch('/api/admin/queue-config',         { credentials: 'include' }),
      fetch('/api/admin/cron-config',          { credentials: 'include' }),
    ]);

    if (rRes.status === 'fulfilled' && rRes.value.ok) {
      try { const d = await rRes.value.json(); setRedisData(d.live ?? null); }
      catch { errs['rate-limiter'] = 'Parse error'; }
    } else { errs['rate-limiter'] = rRes.status === 'fulfilled' ? `HTTP ${rRes.value.status}` : 'Network error'; }

    if (qRes.status === 'fulfilled' && qRes.value.ok) {
      try { setQueueData(await qRes.value.json()); }
      catch { errs.queue = 'Parse error'; }
    } else if (qRes.status === 'fulfilled' && qRes.value.status !== 503) {
      errs.queue = `HTTP ${qRes.value.status}`;
    }

    if (cRes.status === 'fulfilled' && cRes.value.ok) {
      try { setCronData(await cRes.value.json()); }
      catch { errs.cron = 'Parse error'; }
    } else if (cRes.status === 'fulfilled' && cRes.value.status !== 503) {
      errs.cron = `HTTP ${cRes.value.status}`;
    }

    if (rlCfgRes.status === 'fulfilled' && rlCfgRes.value.ok) {
      try { setRlConfig(await rlCfgRes.value.json()); } catch { /* non-fatal */ }
    }
    if (qCfgRes.status === 'fulfilled' && qCfgRes.value.ok) {
      try { setQueueConfig(await qCfgRes.value.json()); } catch { /* non-fatal */ }
    }
    if (cronCfgRes.status === 'fulfilled' && cronCfgRes.value.ok) {
      try { setCronConfig(await cronCfgRes.value.json()); } catch { /* non-fatal */ }
    }

    setErrors(errs);
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  // ── Config save handlers ─────────────────────────────────────────────────────

  const saveRlConfig = async (cfg: RateLimitAdminConfig) => {
    await fetch('/api/admin/rate-limit-config', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    setRlConfig(cfg);
  };

  const saveQueueConfig = async (cfg: QueueAdminConfig) => {
    await fetch('/api/admin/queue-config', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    setQueueConfig(cfg);
  };

  const saveCronConfig = async (cfg: CronAdminConfig) => {
    await fetch('/api/admin/cron-config', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    setCronConfig(cfg);
  };

  // ── Auto-optimize ─────────────────────────────────────────────────────────────

  const proposals = buildAutoOptimizeProposals(redisData, queueData, cronData);

  const applyOptimizations = async () => {
    setApplyingOpt(true);
    try {
      // Cron proposals
      const cronProposals = proposals.filter(p => p.type === 'cron');
      if (cronProposals.length > 0) {
        const newJobs = { ...(cronConfig?.jobs ?? {}) };
        for (const p of cronProposals) {
          newJobs[p.key] = { enabled: true, intervalMultiplier: 2 };
        }
        await saveCronConfig({ v: 1, updatedAt: new Date().toISOString(), jobs: newJobs });
      }
      // Queue proposals
      const queueProposals = proposals.filter(p => p.type === 'queue');
      if (queueProposals.length > 0) {
        const newQueues = { ...(queueConfig?.queues ?? {}) };
        for (const p of queueProposals) {
          const cur = newQueues[p.key] ?? { maxJobsPerCycle: 500, attempts: 3, concurrency: 5 };
          newQueues[p.key] = { ...cur, maxJobsPerCycle: Math.ceil(cur.maxJobsPerCycle / 2) };
        }
        await saveQueueConfig({ v: 1, updatedAt: new Date().toISOString(), queues: newQueues });
      }
      // Rate limit proposals
      const rlProposals = proposals.filter(p => p.type === 'rate_limit');
      if (rlProposals.length > 0) {
        const newEndpoints = { ...(rlConfig?.endpoints ?? {}) };
        for (const p of rlProposals) {
          const defaults = KNOWN_ENDPOINTS.find(e => e.key === p.key);
          const cur = newEndpoints[p.key] ?? { limit: defaults?.defaultLimit ?? 10, windowSecs: defaults?.defaultWindowSecs ?? 900 };
          newEndpoints[p.key] = { ...cur, limit: Math.max(1, Math.ceil(cur.limit * 0.8)) };
        }
        await saveRlConfig({ v: 1, updatedAt: new Date().toISOString(), endpoints: newEndpoints });
      }
      setShowOptimize(false);
    } finally { setApplyingOpt(false); }
  };

  // ── Root cause issues ─────────────────────────────────────────────────────────

  const issues: IssueSummaryItem[] = [];
  if (queueData?.queueSummary?.length) {
    const top = queueData.queueSummary[0];
    const pct = queueData.totalRedisOpsPerMin > 0 ? Math.round((top.opsPerMin / queueData.totalRedisOpsPerMin) * 100) : 0;
    issues.push({ rank: 1, label: `Queue: ${top.queue}`, detail: `${top.opsPerMin} ops/min · ${pct}% of queue ops`, impact: queueImpact(top.opsPerMin, queueData.totalRedisOpsPerMin) });
  }
  if (redisData?.byFeature?.['rate_limit']) {
    const rl = redisData.byFeature['rate_limit'];
    const pct = redisData.totalOps > 0 ? (rl.total / redisData.totalOps) * 100 : 0;
    if (pct > 1) issues.push({ rank: 2, label: 'Rate Limiter', detail: `${pct.toFixed(1)}% of all Redis ops`, impact: pct >= 30 ? 'high' : pct >= 10 ? 'medium' : 'low' });
  }
  if (cronData) {
    const topJob = cronData.topJobsByFrequency[0];
    if (cronData.wastedPct > 25) {
      issues.push({ rank: 3, label: 'Cron: wasted cycles', detail: `${cronData.wastedPct}% wasted`, impact: cronData.wastedPct >= 50 ? 'high' : 'medium' });
    } else if (topJob) {
      const tot = cronData.topJobsByFrequency.reduce((s, j) => s + j.count, 0);
      const pct = tot > 0 ? Math.round((topJob.count / tot) * 100) : 0;
      issues.push({ rank: 3, label: `Cron: ${topJob.job}`, detail: `${pct}% of all job fires`, impact: pct >= 40 ? 'high' : pct >= 20 ? 'medium' : 'low' });
    }
  }

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'rate-limiter', label: 'Rate Limiter' },
    { key: 'queue',        label: 'Queue System' },
    { key: 'cron',         label: 'Cron System'  },
  ];

  return (
    <div className="space-y-0">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">Redis Efficiency</h2>
          <span className="text-xs text-gray-500">monitoring + control</span>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-gray-500">Updated {relTime(lastRefresh.toISOString())}</span>}
          <button
            onClick={() => setShowOptimize(true)}
            disabled={proposals.length === 0 || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700/50 hover:bg-violet-600/60 text-violet-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5" /> Auto Optimize
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <RootCauseSummary issues={issues} />

      {/* Sub-tabs */}
      <div className="mb-5">
        <div className="flex gap-1 bg-gray-800/50 rounded-xl p-1 w-max">
          {subTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                subTab === t.key ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {errors[subTab] && (
        <div className="mb-4 flex items-center gap-2 bg-red-950/30 border border-red-700/30 rounded-lg px-4 py-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load: {errors[subTab]}
        </div>
      )}

      {subTab === 'rate-limiter' && (
        <RateLimiterTab redis={redisData} rlConfig={rlConfig} onRlConfigSave={saveRlConfig} />
      )}
      {subTab === 'queue' && (
        <QueueTab queue={queueData} queueConfig={queueConfig} onQueueConfigSave={saveQueueConfig} />
      )}
      {subTab === 'cron' && (
        <CronTab cron={cronData} cronConfig={cronConfig} onCronConfigSave={saveCronConfig} />
      )}

      {showOptimize && (
        <AutoOptimizeDialog
          proposals={proposals}
          onConfirm={applyOptimizations}
          onCancel={() => setShowOptimize(false)}
          applying={applyingOpt}
        />
      )}
    </div>
  );
}
