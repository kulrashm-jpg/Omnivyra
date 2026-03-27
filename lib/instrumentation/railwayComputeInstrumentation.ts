/**
 * Railway Compute Instrumentation
 * 
 * Tracks per-request/job compute metrics:
 * - API handlers: route, duration, memory estimate
 * - Queue workers: job name, duration, memory estimate  
 * - Cron jobs: job name, duration, memory estimate
 *
 * Stores in Redis for fast aggregation, syncs to DB periodically
 */

import { redis } from '../../backend/queue/redis';
import { supabase } from '../../backend/db/supabaseClient';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ComputeMetric {
  feature: string;          // e.g., "ai_generation", "campaign_run"
  endpoint?: string;        // API route: "/api/ai/generate"
  jobName?: string;         // Queue or cron job name
  sourceType: 'api' | 'queue' | 'cron';
  duration_ms: number;
  memory_estimate_mb: number;
  cpu_estimate_percent: number;
  timestamp: string;
  company_id?: string;      // NEW: Which company initiated this cost
  activity_type?: string;   // NEW: Type of activity (campaign, publish, engagement, intelligence, etc.)
}

export interface ComputeMetricsReport {
  period_start: string;
  period_end: string;
  total_time_ms: number;
  total_memory_mb: number; // accumulated memory×duration
  avg_request_duration_ms: number;
  request_count: number;

  byFeature: Record<string, FeatureCostBreakdown>;
  bySourceType: Record<string, SourceCostBreakdown>;
  byCompany: Record<string, CompanyCostBreakdown>;
  byActivity: Record<string, ActivityCostBreakdown>;
  topExpensive: { feature: string; cost_pct: number; calls: number }[];
  insights: string[];
}

export interface FeatureCostBreakdown {
  feature: string;
  total_time_ms: number;
  avg_time_ms: number;
  calls_per_min: number;
  calls_total: number;
  estimated_cost_usd: number;
  cost_pct: number;
}

export interface SourceCostBreakdown {
  source: 'api' | 'queue' | 'cron';
  total_time_ms: number;
  calls: number;
  estimated_cost_usd: number;
  cost_pct: number;
  examples: { name: string; calls: number; avg_time_ms: number }[];
}

export interface CompanyCostBreakdown {
  company_id: string;
  total_time_ms: number;
  calls_total: number;
  avg_time_ms: number;
  estimated_cost_usd: number;
  cost_pct: number;
  activities: Record<string, ActivityCostBreakdown>;
}

export interface ActivityCostBreakdown {
  activity_type: string;
  total_time_ms: number;
  calls_total: number;
  avg_time_ms: number;
  estimated_cost_usd: number;
  cost_pct: number;
  top_features: { feature: string; calls: number; cost_usd: number }[];
}

// ── In-Memory Buffer (flushes to Redis every N metrics) ────────────────────

let metricsBuffer: ComputeMetric[] = [];
const BUFFER_FLUSH_SIZE = 100;
const BUFFER_FLUSH_INTERVAL_MS = 60000; // 1 minute

let flushTimer: NodeJS.Timeout | null = null;

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(async () => {
    await flushMetricsBuffer();
  }, BUFFER_FLUSH_INTERVAL_MS);
}

// ── Record Metric ──────────────────────────────────────────────────────────

export async function recordComputeMetric(
  feature: string,
  sourceType: 'api' | 'queue' | 'cron',
  duration_ms: number,
  options?: {
    endpoint?: string;
    jobName?: string;
    memory_estimate_mb?: number;
    cpu_estimate_percent?: number;
    company_id?: string;
    activity_type?: string;
  }
): Promise<void> {
  startFlushTimer();

  const metric: ComputeMetric = {
    feature,
    sourceType,
    duration_ms,
    timestamp: new Date().toISOString(),
    endpoint: options?.endpoint,
    jobName: options?.jobName,
    memory_estimate_mb: options?.memory_estimate_mb ?? estimateMemory(duration_ms),
    cpu_estimate_percent: options?.cpu_estimate_percent ?? estimateCPU(duration_ms),
    company_id: options?.company_id,
    activity_type: options?.activity_type,
  };

  metricsBuffer.push(metric);

  // Flush if buffer is full
  if (metricsBuffer.length >= BUFFER_FLUSH_SIZE) {
    await flushMetricsBuffer();
  }
}

// ── Memory & CPU Estimation Rules ──────────────────────────────────────────

function estimateMemory(duration_ms: number): number {
  // Base 128 MB + 10 MB per second of execution
  return 128 + Math.max(10 * (duration_ms / 1000), 0);
}

function estimateCPU(duration_ms: number): number {
  // Average CPU utilization percent (assume 20-50% during execution)
  // For cost model, we'll use duration as proxy
  return Math.min(50, Math.max(20, duration_ms / 100));
}

// ── Flush Metrics to Redis ─────────────────────────────────────────────────

async function flushMetricsBuffer(): Promise<void> {
  if (metricsBuffer.length === 0) return;

  try {
    const toFlush = [...metricsBuffer];
    metricsBuffer = []; // Clear buffer immediately

    // Store each metric in a Redis list (trim to last 24h worth)
    const now = new Date();
    for (const metric of toFlush) {
      const key = `railway:compute:metrics:${metric.sourceType}`;
      await redis.lpush(key, JSON.stringify(metric));
      // Keep only last 10000 entries per source type
      await redis.ltrim(key, 0, 9999);

      // Also track by feature
      const featureKey = `railway:compute:feature:${metric.feature}`;
      await redis.lpush(featureKey, JSON.stringify(metric));
      await redis.ltrim(featureKey, 0, 4999);
    }

    // Update "last flush" timestamp
    await redis.set(
      'railway:compute:last_flush',
      new Date().toISOString(),
      'EX',
      86400, // 24 hours
    );
  } catch (err) {
    console.error('[railwayComputeInstrumentation] flushMetricsBuffer error:', err);
  }
}

// ── Shutdown (for graceful cleanup) ────────────────────────────────────────

export async function shutdownComputeInstrumentation(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushMetricsBuffer();
}

// ── Retrieve & Aggregate Metrics ───────────────────────────────────────────

export async function getComputeMetricsReport(options?: {
  time_window_hours?: number;
  feature?: string;
}): Promise<ComputeMetricsReport> {
  const hours = options?.time_window_hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const allMetrics = await getAllComputeMetrics();
  const filteredMetrics = allMetrics.filter((m) => {
    const t = new Date(m.timestamp);
    if (t < since) return false;
    if (options?.feature && m.feature !== options.feature) return false;
    return true;
  });

  return aggregateMetrics(filteredMetrics, since);
}

async function getAllComputeMetrics(): Promise<ComputeMetric[]> {
  const metrics: ComputeMetric[] = [];

  try {
    const sources: ('api' | 'queue' | 'cron')[] = ['api', 'queue', 'cron'];
    for (const source of sources) {
      const key = `railway:compute:metrics:${source}`;
      const data = await redis.lrange(key, 0, -1);
      for (const item of data) {
        try {
          metrics.push(JSON.parse(item));
        } catch {
          // Skip malformed entries
        }
      }
    }
  } catch (err) {
    console.error('[railwayComputeInstrumentation] getAllComputeMetrics error:', err);
  }

  return metrics;
}

function aggregateMetrics(
  metrics: ComputeMetric[],
  since: Date,
): ComputeMetricsReport {
  const byFeature = new Map<string, { total_ms: number; calls: number; total_mem: number }>();
  const bySource = new Map<string, { total_ms: number; calls: number; names: Map<string, number> }>();
  const byCompany = new Map<string, { total_ms: number; calls: number; activities: Map<string, { total_ms: number; calls: number; features: Map<string, number> }> }>();
  const byActivity = new Map<string, { total_ms: number; calls: number; features: Map<string, number> }>();

  let totalTime = 0;
  let totalMemMoment = 0; // memory × time for cost calculation

  for (const m of metrics) {
    totalTime += m.duration_ms;
    totalMemMoment += m.memory_estimate_mb * (m.duration_ms / 1000); // MB-seconds

    // Aggregate by feature
    if (!byFeature.has(m.feature)) {
      byFeature.set(m.feature, { total_ms: 0, calls: 0, total_mem: 0 });
    }
    const f = byFeature.get(m.feature)!;
    f.total_ms += m.duration_ms;
    f.calls += 1;
    f.total_mem += m.memory_estimate_mb;

    // Aggregate by source
    if (!bySource.has(m.sourceType)) {
      bySource.set(m.sourceType, { total_ms: 0, calls: 0, names: new Map() });
    }
    const s = bySource.get(m.sourceType)!;
    s.total_ms += m.duration_ms;
    s.calls += 1;

    const name = m.endpoint ?? m.jobName ?? 'unknown';
    s.names.set(name, (s.names.get(name) ?? 0) + 1);

    // Aggregate by company → activity
    if (m.company_id) {
      const companyKey = m.company_id;
      const activityKey = m.activity_type ?? 'other';

      if (!byCompany.has(companyKey)) {
        byCompany.set(companyKey, { total_ms: 0, calls: 0, activities: new Map() });
      }
      const c = byCompany.get(companyKey)!;
      c.total_ms += m.duration_ms;
      c.calls += 1;

      if (!c.activities.has(activityKey)) {
        c.activities.set(activityKey, { total_ms: 0, calls: 0, features: new Map() });
      }
      const a = c.activities.get(activityKey)!;
      a.total_ms += m.duration_ms;
      a.calls += 1;
      a.features.set(m.feature, (a.features.get(m.feature) ?? 0) + 1);

      if (!byActivity.has(activityKey)) {
        byActivity.set(activityKey, { total_ms: 0, calls: 0, features: new Map() });
      }
      const act = byActivity.get(activityKey)!;
      act.total_ms += m.duration_ms;
      act.calls += 1;
      act.features.set(m.feature, (act.features.get(m.feature) ?? 0) + 1);
    }
  }

  // Calculate costs (Railway pricing model)
  const railwayPricingModel = {
    cpu_ms_price: 0.00000417, // $0.000000417 per CPU-millisecond (roughly)
    memory_gb_sec_price: 0.0000000289, // $0.0000000289 per GB-second
  };

  const byFeatureData = Array.from(byFeature.entries()).map(([feature, data]) => {
    const cpuCost = (data.total_ms / 1000) * railwayPricingModel.cpu_ms_price;
    const memoryCost = (data.total_mem / 1024) * (data.total_ms / 1000) * railwayPricingModel.memory_gb_sec_price;
    const cost = cpuCost + memoryCost;

    return {
      feature,
      total_time_ms: data.total_ms,
      avg_time_ms: Math.round(data.total_ms / data.calls),
      calls_total: data.calls,
      calls_per_min: (data.calls / 24) * 60, // Always normalize to per minute
      estimated_cost_usd: cost,
      cost_pct: 0, // Will calculate below
    };
  });

  const bySourceData = Array.from(bySource.entries()).map(([source, data]) => {
    const cpuCost = (data.total_ms / 1000) * railwayPricingModel.cpu_ms_price;
    const examples = Array.from(data.names.entries())
      .map(([name, calls]) => ({ name, calls, avg_time_ms: 0 }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 3);

    return {
      source: source as 'api' | 'queue' | 'cron',
      total_time_ms: data.total_ms,
      calls: data.calls,
      estimated_cost_usd: cpuCost,
      cost_pct: 0, // Will calculate below
      examples,
    };
  });

  const byCompanyData = Array.from(byCompany.entries()).map(([companyId, data]) => {
    const cpuCost = (data.total_ms / 1000) * railwayPricingModel.cpu_ms_price;
    const activities: Record<string, ActivityCostBreakdown> = {};

    for (const [activityKey, actData] of data.activities.entries()) {
      const actCpuCost = (actData.total_ms / 1000) * railwayPricingModel.cpu_ms_price;
      const topFeatures = Array.from(actData.features.entries())
        .map(([feat, calls]) => ({
          feature: feat,
          calls,
          cost_usd: (actData.total_ms * calls) / actData.calls / 1000 * railwayPricingModel.cpu_ms_price,
        }))
        .sort((a, b) => b.cost_usd - a.cost_usd)
        .slice(0, 3);

      activities[activityKey] = {
        activity_type: activityKey,
        total_time_ms: actData.total_ms,
        calls_total: actData.calls,
        avg_time_ms: Math.round(actData.total_ms / actData.calls),
        estimated_cost_usd: actCpuCost,
        cost_pct: 0,
        top_features: topFeatures,
      };
    }

    return {
      company_id: companyId,
      total_time_ms: data.total_ms,
      calls_total: data.calls,
      avg_time_ms: Math.round(data.total_ms / data.calls),
      estimated_cost_usd: cpuCost,
      cost_pct: 0,
      activities,
    };
  });

  const byActivityData = Array.from(byActivity.entries()).map(([activityKey, data]) => {
    const cpuCost = (data.total_ms / 1000) * railwayPricingModel.cpu_ms_price;
    const topFeatures = Array.from(data.features.entries())
      .map(([feat, calls]) => ({
        feature: feat,
        calls,
        cost_usd: (data.total_ms * calls) / data.calls / 1000 * railwayPricingModel.cpu_ms_price,
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 5);

    return {
      activity_type: activityKey,
      total_time_ms: data.total_ms,
      calls_total: data.calls,
      avg_time_ms: Math.round(data.total_ms / data.calls),
      estimated_cost_usd: cpuCost,
      cost_pct: 0,
      top_features: topFeatures,
    };
  });

  // Calculate percentages
  const totalCost = byFeatureData.reduce((sum, f) => sum + f.estimated_cost_usd, 0);
  for (const f of byFeatureData) {
    f.cost_pct = totalCost > 0 ? (f.estimated_cost_usd / totalCost) * 100 : 0;
  }
  for (const s of bySourceData) {
    s.cost_pct = totalCost > 0 ? (s.estimated_cost_usd / totalCost) * 100 : 0;
  }
  for (const c of byCompanyData) {
    c.cost_pct = totalCost > 0 ? (c.estimated_cost_usd / totalCost) * 100 : 0;
    for (const act of Object.values(c.activities)) {
      act.cost_pct = totalCost > 0 ? (act.estimated_cost_usd / totalCost) * 100 : 0;
    }
  }
  for (const a of byActivityData) {
    a.cost_pct = totalCost > 0 ? (a.estimated_cost_usd / totalCost) * 100 : 0;
  }

  const topExpensive = byFeatureData
    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
    .slice(0, 5)
    .map((f) => ({ feature: f.feature, cost_pct: f.cost_pct, calls: f.calls_total }));

  // Generate insights
  const insights = generateInsights(byFeatureData, metrics.length);

  return {
    period_start: since.toISOString(),
    period_end: new Date().toISOString(),
    total_time_ms: totalTime,
    total_memory_mb: totalMemMoment / 1000, // Convert to MB-seconds
    avg_request_duration_ms: metrics.length > 0 ? Math.round(totalTime / metrics.length) : 0,
    request_count: metrics.length,
    byFeature: Object.fromEntries(byFeatureData.map((f) => [f.feature, f])),
    bySourceType: Object.fromEntries(bySourceData.map((s) => [s.source, s])),
    byCompany: Object.fromEntries(byCompanyData.map((c) => [c.company_id, c])),
    byActivity: Object.fromEntries(byActivityData.map((a) => [a.activity_type, a])),
    topExpensive,
    insights,
  };
}

function generateInsights(byFeature: any[], totalRequests: number): string[] {
  const insights: string[] = [];

  if (byFeature.length === 0) {
    insights.push('No compute metrics recorded in this period');
    return insights;
  }

  // Sort by cost
  const sorted = [...byFeature].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
  const topFeature = sorted[0];
  const topPct = topFeature.cost_pct;

  if (topPct > 50) {
    insights.push(
      `⚠️ ${topFeature.feature} dominates compute cost at ${Math.round(topPct)}% — consider optimization or caching`
    );
  }

  // Average duration analysis
  const avgDuration = (byFeature.reduce((s, f) => s + f.avg_time_ms, 0) / byFeature.length);
  if (avgDuration > 2000) {
    insights.push(
      `⏱️ Average request duration is ${Math.round(avgDuration)}ms — check for slow database queries or external API calls`
    );
  } else if (avgDuration < 50) {
    insights.push(
      `✓ Average completion time is very fast (${Math.round(avgDuration)}ms) — compute is well-optimized`
    );
  }

  // Call frequency analysis
  const slowFeatures = byFeature.filter((f) => f.avg_time_ms > 1000 && f.calls_total > 10);
  if (slowFeatures.length > 0) {
    insights.push(
      `🔄 ${slowFeatures[0].feature} is slow (${Math.round(slowFeatures[0].avg_time_ms)}ms) but called frequently — batching could help`
    );
  }

  return insights;
}

// Export for API use
export const hours = 24; // Reference for aggregation functions
