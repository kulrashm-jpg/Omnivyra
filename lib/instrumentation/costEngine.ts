/**
 * Infrastructure cost estimation engine — v2.
 *
 * Changes from v1:
 *  - Free-tier handling: cost = 0 when usage ≤ free allowance
 *  - Tiered pricing: correct per-unit rates at each tier boundary
 *  - topCostDrivers: ranked list of (service, reason, impact) for explainability
 *  - estimationQuality: per-service flag when counters have no data
 *
 * All costs are ESTIMATES.  Rate cards are based on published pricing as of
 * 2026-Q1.  Mark values [est] in the UI — never present as exact invoices.
 *
 * Pricing sources:
 *   Upstash Redis  — upstash.com/pricing (Pay-as-you-go)
 *   Supabase       — supabase.com/pricing (Pro plan)
 *   Vercel         — vercel.com/pricing (Pro plan)
 *   Firebase       — firebase.google.com/pricing (Blaze plan)
 *   Railway        — railway.app/pricing (Hobby plan)
 *   OpenAI         — openai.com/pricing
 *   Anthropic      — anthropic.com/pricing
 */

import type { SystemMetrics } from './systemMetrics';

// ── Rate cards ────────────────────────────────────────────────────────────────

const RATES = {
  upstash: {
    dailyFreeOps:       10_000,          // free per day
    payg_per_op:        0.20 / 100_000,  // $0.20 per 100K after free tier
    maxDailyBandwidthGB: 0.1,            // 100 MB/day free
    freeStorageMB:      256,             // 256 MB free storage
    storagePerGbMonth:  0.25,            // $0.25 per GB/month above free tier
  },
  supabase: {
    // Pro plan
    baseMonthly:       25,
    freeComputeHours:  0,            // compute billed on Pro
    computePerHour:    0.01056,      // compute-2: 1 vCPU / 1 GB
    freeStorageGB:     8,
    extraStoragePerGB: 0.021,
    freeBandwidthGB:   50,
    extraBandwidthPerGB: 0.09,
    // Free tier (if on free plan) reference — not used for cost, just for notes
    freePlanStorageGB: 0.5,
  },
  vercel: {
    // Pro plan
    baseMonthly:          20,
    includedInvocations:  1_000_000,
    extraInvocationsPerM: 0.60,      // per 1M beyond included
    includedBandwidthGB:  1_000,
    extraBandwidthPerGB:  0.15,
  },
  firebase: {
    // Blaze plan — free tier applies
    freeMauPerMonth:    50_000,
    extraPer1000Mau:    0.0055,
    freeFunctionCalls:  2_000_000,   // per month
    functionCallsPerM:  0.40,
  },
  railway: {
    hobbyCredit:           5,        // $5/month included
    cpuPerVcpuHour:        0.000463,
    memPerGbHour:          0.000231,
    networkPerGB:          0.10,
    // Assumed footprint for a 1-worker deployment
    assumedVcpu:           1,
    assumedMemGb:          0.5,
    hoursPerMonth:         730,
  },
  openai: {
    // GPT-4o
    gpt4o: { inputPerM: 5.00, outputPerM: 15.00 },
    // GPT-4o-mini (default assumption when model unknown)
    gpt4oMini: { inputPerM: 0.15, outputPerM: 0.60 },
    // Assumed token distribution per call
    assumedInputTokens:  1_000,
    assumedOutputTokens:   500,
  },
  anthropic: {
    // Claude 3.5 Sonnet
    sonnet35: { inputPerM: 3.00, outputPerM: 15.00 },
    assumedInputTokens:  2_000,
    assumedOutputTokens: 1_000,
  },
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CostDriver {
  service: string;
  reason:  string;
  /** Absolute estimated monthly cost contribution in USD */
  impact:  number;
}

export interface ServiceCost {
  service:          string;
  estimatedMonthly: number;
  breakdown:        Record<string, number>;
  notes:            string[];
  hasData:          boolean;  // false if counters are all zero
}

export interface CostEstimate {
  totalMonthlyEstimate: number;
  currency:             'USD';
  asOf:                 string;
  confidence:           'low' | 'medium' | 'high';
  breakdown:            Record<string, ServiceCost>;
  topCostDrivers:       CostDriver[];
  warnings:             string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return cost for usage above a free tier, 0 if within free tier. */
function aboveFreeTier(usage: number, freeAllowance: number, unitCost: number): number {
  const billable = Math.max(0, usage - freeAllowance);
  return billable * unitCost;
}

/** Extrapolate a per-minute rate to a monthly total (30-day month). */
function toMonthly(perMin: number): number {
  return perMin * 60 * 24 * 30;
}

// ── Per-service estimators ────────────────────────────────────────────────────

function estimateRedis(redis: SystemMetrics['redis']): ServiceCost {
  const notes: string[] = [];
  const breakdown: Record<string, number> = {};

  // ── Storage cost (based on INFO memory, injected into redis.storageBytesUsed) ──
  const storageBytesUsed = redis?.storageBytesUsed ?? 0;
  const storageUsedMB    = storageBytesUsed / (1024 * 1024);
  const storageUsedGB    = storageUsedMB / 1024;
  const storageCost      = aboveFreeTier(
    storageUsedGB,
    RATES.upstash.freeStorageMB / 1024,
    RATES.upstash.storagePerGbMonth,
  );
  breakdown['storage'] = storageCost;

  if (storageUsedMB > 0) {
    if (storageCost === 0) {
      notes.push(`Storage: ${storageUsedMB.toFixed(1)} MB used · within 256 MB free tier`);
    } else {
      const billableMB = Math.max(0, storageUsedMB - RATES.upstash.freeStorageMB);
      notes.push(`Storage: ${storageUsedMB.toFixed(1)} MB used · ${billableMB.toFixed(0)} MB billed at $0.25/GB`);
    }
  }

  if (!redis || redis.totalOps === 0) {
    if (storageCost === 0 && storageUsedMB === 0) {
      notes.push('No Redis activity observed yet');
      return { service: 'Upstash Redis', estimatedMonthly: 0, breakdown, notes, hasData: false };
    }
    // Has storage but no ops yet
    return { service: 'Upstash Redis', estimatedMonthly: storageCost, breakdown, notes, hasData: storageCost > 0 };
  }

  // ── Ops cost ──────────────────────────────────────────────────────────────
  const windowMs  = Math.max(
    1_000,
    new Date(redis.windowEnd).getTime() - new Date(redis.windowStart).getTime(),
  );
  const opsPerMin    = redis.opsPerMin > 0 ? redis.opsPerMin : redis.totalOps / (windowMs / 60_000);
  const monthlyOps   = toMonthly(opsPerMin);
  const monthlyFree  = RATES.upstash.dailyFreeOps * 30;
  const opsCost      = aboveFreeTier(monthlyOps, monthlyFree, RATES.upstash.payg_per_op);
  breakdown['ops']   = opsCost;

  if (opsCost === 0) {
    notes.push(`Ops: ~${Math.round(monthlyOps / 1_000)}K/month · within ${Math.round(monthlyFree / 1_000)}K free tier`);
  } else {
    const billable = Math.max(0, monthlyOps - monthlyFree);
    notes.push(`Ops: ~${Math.round(billable / 1_000)}K billable ops/month above free tier`);
  }

  if (redis.topFeatures[0]) {
    notes.push(`Top consumer: ${redis.topFeatures[0].feature} (${redis.topFeatures[0].pct}%)`);
  }

  const totalCost = opsCost + storageCost;
  return {
    service: 'Upstash Redis',
    estimatedMonthly: totalCost,
    breakdown,
    notes,
    hasData: true,
  };
}

function estimateSupabase(supabase: SystemMetrics['supabase']): ServiceCost {
  const notes: string[] = ['Pro plan base ($25/month)'];
  const breakdown: Record<string, number> = { base: RATES.supabase.baseMonthly };

  // Compute cost (constant for Pro — 1 compute instance)
  const computeCost = RATES.supabase.computePerHour * 730;
  breakdown['compute'] = computeCost;

  let bandwidthCost = 0;
  if (supabase && supabase.estimatedBytesIn > 0) {
    const totalBandwidthGB = supabase.estimatedBytesIn / (1024 ** 3);
    // Extrapolate current window to monthly
    bandwidthCost = aboveFreeTier(totalBandwidthGB * 30, RATES.supabase.freeBandwidthGB, RATES.supabase.extraBandwidthPerGB);
    breakdown['bandwidth'] = bandwidthCost;
    if (bandwidthCost > 0) notes.push(`~${(totalBandwidthGB * 30).toFixed(1)} GB/month bandwidth`);
  }

  const hasData = !!(supabase && (supabase.reads > 0 || supabase.writes > 0));
  if (!hasData) notes.push('No query activity observed — base plan cost only');

  if (supabase && supabase.errors > 0) {
    notes.push(`${supabase.errors} DB errors observed — check connection pool`);
  }

  return {
    service: 'Supabase',
    estimatedMonthly: RATES.supabase.baseMonthly + computeCost + bandwidthCost,
    breakdown,
    notes,
    hasData,
  };
}

function estimateVercel(api: SystemMetrics['api']): ServiceCost {
  const notes: string[] = ['Pro plan base ($20/month)'];
  const breakdown: Record<string, number> = { base: RATES.vercel.baseMonthly };

  let invocationCost = 0;
  const hasData = !!(api && api.totalCalls > 0);

  if (api && api.callsPerMin > 0) {
    const monthlyInvocations = toMonthly(api.callsPerMin);
    invocationCost = aboveFreeTier(
      monthlyInvocations,
      RATES.vercel.includedInvocations,
      RATES.vercel.extraInvocationsPerM / 1_000_000,
    );
    breakdown['invocations'] = invocationCost;

    if (invocationCost === 0) {
      notes.push(`~${Math.round(monthlyInvocations / 1_000)}K inv/month within included 1M`);
    } else {
      notes.push(`~${Math.round(monthlyInvocations / 1_000)}K inv/month (overage billed)`);
    }

    if (api.errorRate > 0.05) {
      notes.push(`Error rate ${(api.errorRate * 100).toFixed(1)}% — investigate 4xx/5xx`);
    }
  } else {
    notes.push('No API call activity observed — base plan cost only');
  }

  return {
    service: 'Vercel',
    estimatedMonthly: RATES.vercel.baseMonthly + invocationCost,
    breakdown,
    notes,
    hasData,
  };
}

function estimateFirebase(firebase: SystemMetrics['firebase']): ServiceCost {
  const notes: string[] = [];
  const breakdown: Record<string, number> = {};
  const hasData = !!(firebase && firebase.tokenVerifications > 0);

  if (!hasData) {
    notes.push('No Firebase auth activity observed');
    return { service: 'Firebase Auth', estimatedMonthly: 0, breakdown, notes, hasData };
  }

  // Estimate monthly active users: verifications/month × 0.1 (sessions per MAU)
  const verificationsPerMonth = toMonthly(firebase!.verificationsPerMin);
  const estimatedMau = Math.round(verificationsPerMonth * 0.10);
  const authCost = aboveFreeTier(estimatedMau, RATES.firebase.freeMauPerMonth, RATES.firebase.extraPer1000Mau / 1_000);
  breakdown['auth_mau'] = authCost;

  if (authCost === 0) {
    notes.push(`~${estimatedMau.toLocaleString()} est. MAU — within free 50K tier`);
  } else {
    const billable = Math.max(0, estimatedMau - RATES.firebase.freeMauPerMonth);
    notes.push(`~${billable.toLocaleString()} MAU above free tier`);
  }

  if (firebase!.authErrors > 0) {
    notes.push(`${firebase!.authErrors} auth errors — review token issuance`);
  }

  return {
    service: 'Firebase Auth',
    estimatedMonthly: authCost,
    breakdown,
    notes,
    hasData,
  };
}

function estimateRailway(): ServiceCost {
  const cpuCost = RATES.railway.cpuPerVcpuHour * RATES.railway.assumedVcpu * RATES.railway.hoursPerMonth;
  const memCost = RATES.railway.memPerGbHour   * RATES.railway.assumedMemGb * RATES.railway.hoursPerMonth;
  const gross   = cpuCost + memCost;
  const net     = Math.max(0, gross - RATES.railway.hobbyCredit);

  return {
    service: 'Railway',
    estimatedMonthly: net,
    breakdown: {
      cpu:          cpuCost,
      memory:       memCost,
      hobby_credit: -RATES.railway.hobbyCredit,
    },
    notes: [
      `1 vCPU × 0.5 GB worker, continuous (${RATES.railway.hoursPerMonth} h/month)`,
      `$${RATES.railway.hobbyCredit} Hobby credit applied`,
    ],
    hasData: true,  // constant — doesn't depend on observed counters
  };
}

function estimateAiApis(external: SystemMetrics['external']): ServiceCost {
  const notes: string[] = [];
  const breakdown: Record<string, number> = {};
  let total = 0;

  // OpenAI
  const openai = external?.byService?.['openai'];
  if (openai && openai.calls > 0) {
    const monthlyCallsEst = toMonthly(openai.calls / 1);  // calls in current window ≈ 1 min
    const inputCost  = (monthlyCallsEst * RATES.openai.assumedInputTokens  / 1_000_000) * RATES.openai.gpt4oMini.inputPerM;
    const outputCost = (monthlyCallsEst * RATES.openai.assumedOutputTokens / 1_000_000) * RATES.openai.gpt4oMini.outputPerM;
    breakdown['openai'] = inputCost + outputCost;
    total += inputCost + outputCost;
    notes.push('OpenAI: gpt-4o-mini assumed; actual model may differ');
  }

  const anthropic = external?.byService?.['anthropic'];
  if (anthropic && anthropic.calls > 0) {
    const monthlyCallsEst = toMonthly(anthropic.calls / 1);
    const inputCost  = (monthlyCallsEst * RATES.anthropic.assumedInputTokens  / 1_000_000) * RATES.anthropic.sonnet35.inputPerM;
    const outputCost = (monthlyCallsEst * RATES.anthropic.assumedOutputTokens / 1_000_000) * RATES.anthropic.sonnet35.outputPerM;
    breakdown['anthropic'] = inputCost + outputCost;
    total += inputCost + outputCost;
    notes.push('Anthropic: Claude 3.5 Sonnet pricing assumed');
  }

  const hasData = total > 0;
  if (!hasData) notes.push('No AI API calls observed in current window');

  return {
    service:          'AI APIs',
    estimatedMonthly: total,
    breakdown,
    notes,
    hasData,
  };
}

// ── Cost drivers ──────────────────────────────────────────────────────────────

function buildCostDrivers(
  metrics: SystemMetrics,
  breakdown: Record<string, ServiceCost>,
): CostDriver[] {
  const drivers: CostDriver[] = [];

  // Redis drivers
  const redisCost = breakdown['Upstash Redis'];
  if (redisCost && redisCost.hasData && metrics.redis) {
    const topFeature = metrics.redis.topFeatures[0];
    if (topFeature) {
      drivers.push({
        service: 'Upstash Redis',
        reason:  `${topFeature.pct}% of ops from "${topFeature.feature}" feature`,
        impact:  redisCost.estimatedMonthly * (topFeature.pct / 100),
      });
    }
    const topCmd = metrics.redis.topCommands[0];
    if (topCmd && topCmd.pct > 30) {
      drivers.push({
        service: 'Upstash Redis',
        reason:  `High "${topCmd.command}" usage (${topCmd.pct}% of all ops)`,
        impact:  redisCost.estimatedMonthly * (topCmd.pct / 100),
      });
    }
  }

  // Supabase drivers
  const supaCost = breakdown['Supabase'];
  if (supaCost && metrics.supabase) {
    const totalQueries = metrics.supabase.reads + metrics.supabase.writes;
    if (totalQueries > 0) {
      const writeRatio = metrics.supabase.writes / totalQueries;
      if (writeRatio > 0.4) {
        drivers.push({
          service: 'Supabase',
          reason:  `High write ratio (${(writeRatio * 100).toFixed(0)}%) — consider batching`,
          impact:  supaCost.estimatedMonthly * 0.3,
        });
      }
      if (metrics.supabase.errors > 0) {
        drivers.push({
          service: 'Supabase',
          reason:  `${metrics.supabase.errors} query errors — wasted compute cost`,
          impact:  supaCost.estimatedMonthly * 0.05,
        });
      }
    }
    // Compute is the largest line item on Pro
    drivers.push({
      service: 'Supabase',
      reason:  'Dedicated compute instance (always-on on Pro plan)',
      impact:  RATES.supabase.computePerHour * 730,
    });
  }

  // AI API drivers
  const aiCost = breakdown['AI APIs'];
  if (aiCost && aiCost.hasData && metrics.external) {
    const openai = metrics.external.byService?.['openai'];
    if (openai && openai.calls > 0) {
      // Cross-correlate: if Redis ai_cache is low, AI costs are avoidable
      const cacheFeature = metrics.redis?.topFeatures?.find(f => f.feature === 'ai_cache');
      const cachePercent = cacheFeature?.pct ?? 0;
      if (cachePercent < 10) {
        drivers.push({
          service: 'AI APIs',
          reason:  'Low ai_cache Redis utilisation — uncached prompts inflate OpenAI cost',
          impact:  (aiCost.breakdown['openai'] ?? 0) * 0.4,
        });
      } else {
        drivers.push({
          service: 'AI APIs',
          reason:  `OpenAI calls (${openai.calls} observed in window)`,
          impact:  aiCost.breakdown['openai'] ?? 0,
        });
      }
    }
  }

  // Vercel driver — p95 latency hint
  const vercelCost = breakdown['Vercel'];
  if (vercelCost && metrics.api && metrics.api.p95LatencyMs && metrics.api.p95LatencyMs > 3_000) {
    drivers.push({
      service: 'Vercel',
      reason:  `High p95 latency (${metrics.api.p95LatencyMs}ms) — cold starts or slow upstream`,
      impact:  vercelCost.estimatedMonthly * 0.1,
    });
  }

  return drivers.sort((a, b) => b.impact - a.impact).slice(0, 8);
}

// ── Main estimator ────────────────────────────────────────────────────────────

export function estimateCost(metrics: SystemMetrics): CostEstimate {
  const warnings = [
    'All values are [est] — not actual invoices.',
    'Extrapolated from current observation window to 30-day month.',
    'Plan tiers assumed: Supabase Pro, Vercel Pro, Railway Hobby.',
  ];

  const services: ServiceCost[] = [
    estimateRedis(metrics.redis),
    estimateSupabase(metrics.supabase),
    estimateVercel(metrics.api),
    estimateFirebase(metrics.firebase),
    estimateRailway(),
    estimateAiApis(metrics.external),
  ];

  const breakdown: Record<string, ServiceCost> = {};
  let total = 0;
  for (const s of services) {
    breakdown[s.service] = s;
    total += s.estimatedMonthly;
  }

  const topCostDrivers = buildCostDrivers(metrics, breakdown);

  // Confidence: based on how many services have real data
  const withData = services.filter(s => s.hasData).length;
  const confidence: CostEstimate['confidence'] =
    withData >= 4 ? 'high' : withData >= 2 ? 'medium' : 'low';

  return {
    totalMonthlyEstimate: Math.round(total * 100) / 100,
    currency:             'USD',
    asOf:                 new Date().toISOString(),
    confidence,
    breakdown,
    topCostDrivers,
    warnings,
  };
}
