/**
 * OrgServiceDrilldown — analysis panels.
 *
 * PlanAnalysisPanel (spend vs plan limit, month-end prediction, headroom) and
 * SpikePanel (rate-vs-baseline spike detection with remediation tips). Split
 * from OrgServiceDrilldown.tsx (Agent-B large-file modularization).
 */
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import {
  type ServiceKey,
  type DrilldownIntel,
  type BreakdownData,
  type PlanDef,
  PLAN_DEFS,
  SPIKE_CONFIGS,
  getDaysInMonth,
  fmtUsd2,
  fmtPct,
} from './orgServiceDrilldownModel';

// ── Plan Analysis Panel ────────────────────────────────────────────────────────

export function PlanAnalysisPanel({
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

export function SpikePanel({ serviceKey, intel, planDef }: {
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
