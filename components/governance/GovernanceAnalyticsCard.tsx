/**
 * Governance Analytics Card — Stage 22.
 * Displays: total events, negotiations, rejections, freeze blocks, scheduler runs, completion status, health score.
 * Health score is pure UI logic — no backend changes.
 * Stage 26: Policy upgrade badge, simulate under latest policy.
 */

import React, { useState } from 'react';
import { BarChart3, Lock, RefreshCw, Loader2, Camera, ShieldCheck, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

export interface GovernanceCampaignAnalyticsData {
  campaignId: string;
  executionState: string;
  totalEvents: number;
  negotiationCount: number;
  rejectionCount: number;
  preemptionCount: number;
  freezeBlocks: number;
  schedulerRuns: number;
  completionTimestamp?: string;
  totalScheduledPosts?: number;
  totalPublishedPosts?: number;
  /** Stage 23 */
  policyVersion?: string;
  policyHash?: string;
  /** Stage 24 */
  replayIntegrity?: 'VERIFIED' | 'DRIFT_DETECTED' | 'NOT_REPLAYABLE';
  /** Stage 25 */
  replayCoverageRatio?: number;
  driftCount?: number;
  /** Stage 26 */
  currentPolicyVersion?: string;
  evaluatedUnderPolicyVersion?: string;
  policyUpgradeAvailable?: boolean;
}

interface GovernanceAnalyticsCardProps {
  analytics: GovernanceCampaignAnalyticsData | null;
  loading?: boolean;
  /** Stage 26: Required for simulate-policy button */
  campaignId?: string;
  companyId?: string;
  /** Stage 26: Callback after simulate (e.g. to refresh analytics) */
  onRefresh?: () => void;
  /** Stage 28: Latest company audit status from governance_audit_runs */
  auditStatus?: 'OK' | 'WARNING' | 'CRITICAL';
  /** Stage 29: Governance lockdown active — mutations disabled */
  governanceLocked?: boolean;
  /** Stage 30: Latest snapshot timestamp (company-level) */
  lastSnapshotAt?: string | null;
  /** Stage 30: Snapshot count for company */
  snapshotCount?: number;
  /** Stage 30: SUPER_ADMIN — show Create Snapshot button */
  isSuperAdmin?: boolean;
  /** Stage 30: Latest snapshot id for verify (optional) */
  latestSnapshotId?: string | null;
  /** Stage 31: Ledger hash chain integrity */
  ledgerIntegrity?: 'VALID' | 'CORRUPTED';
  /** Stage 32: Read model projection status */
  projectionStatus?: 'ACTIVE' | 'REBUILDING' | 'MISSING';
  /** Stage 33: Governance load guard counters — show badge when any > 0 */
  replayRateLimitedCount?: number;
  snapshotRestoreBlockedCount?: number;
  projectionRebuildBlockedCount?: number;
  /** Stage 34: ROI intelligence */
  roiIntelligence?: {
    roiScore: number;
    performanceScore: number;
    governanceStabilityScore: number;
    executionReliabilityScore: number;
    optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
    recommendation?: string;
  };
  /** Stage 35: Optimization insights (advisory only) */
  optimizationInsights?: Array<{
    campaignId: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    category: string;
    headline: string;
    explanation: string;
    recommendedAction: string;
  }>;
  /** Stage 36: Optimization proposal (advisory only) */
  optimizationProposal?: {
    campaignId: string;
    summary: string;
    proposedDurationWeeks?: number;
    proposedPostsPerWeek?: number;
    proposedContentMixAdjustment?: Record<string, number>;
    proposedStartDateShift?: string;
    reasoning: string[];
    confidenceScore: number;
  } | null;
  /** Stage 36: Callback when user clicks Apply Proposal — pre-fill negotiation input */
  onApplyProposal?: (proposal: {
    proposedDurationWeeks?: number;
    proposedPostsPerWeek?: number;
    summary: string;
  }) => void;
  /** Stage 37: Auto-optimization */
  autoOptimizeEnabled?: boolean;
  autoOptimizationEligibility?: { eligible: boolean; reason?: string };
  onToggleAutoOptimize?: (enabled: boolean) => Promise<void>;
}

function computeHealthScore(a: GovernanceCampaignAnalyticsData): number {
  let score = 100;
  score -= a.rejectionCount * 10;
  score -= a.negotiationCount * 5;
  score -= a.freezeBlocks * 15;
  score -= a.preemptionCount * 20;
  return Math.max(0, score);
}

function getHealthBadgeColor(score: number): { bg: string; text: string } {
  if (score >= 80) return { bg: 'bg-green-100', text: 'text-green-800' };
  if (score >= 50) return { bg: 'bg-yellow-100', text: 'text-yellow-800' };
  return { bg: 'bg-red-100', text: 'text-red-800' };
}

export function GovernanceAnalyticsCard({
  analytics,
  loading,
  campaignId,
  companyId,
  onRefresh,
  auditStatus,
  governanceLocked,
  lastSnapshotAt,
  snapshotCount = 0,
  isSuperAdmin,
  latestSnapshotId,
  ledgerIntegrity,
  projectionStatus,
  replayRateLimitedCount = 0,
  snapshotRestoreBlockedCount = 0,
  projectionRebuildBlockedCount = 0,
  roiIntelligence,
  optimizationInsights,
  optimizationProposal: optimizationProposalProp,
  onApplyProposal,
  autoOptimizeEnabled,
  autoOptimizationEligibility: autoOptimizationEligibilityProp,
  onToggleAutoOptimize,
}: GovernanceAnalyticsCardProps) {
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; mismatchFields?: string[] } | null>(null);
  const [simulateResult, setSimulateResult] = useState<{
    policyVersion: string;
    status: string;
    trade_off_options: unknown[];
    explanation: string;
    policyHash: string;
  } | null>(null);

  const runCreateSnapshot = async () => {
    if (!companyId || !isSuperAdmin) return;
    setSnapshotLoading(true);
    try {
      const res = await fetchWithAuth('/api/governance/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, snapshotType: 'FULL' }),
      });
      if (res.ok) onRefresh?.();
    } catch (err) {
      console.error('Create snapshot failed', err);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const runVerifySnapshot = async () => {
    if (!latestSnapshotId) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await fetchWithAuth(
        `/api/governance/verify-snapshot?snapshotId=${encodeURIComponent(latestSnapshotId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setVerifyResult({ valid: data.valid, mismatchFields: data.mismatchFields });
      }
    } catch (err) {
      console.error('Verify snapshot failed', err);
    } finally {
      setVerifyLoading(false);
    }
  };

  const runSimulate = async () => {
    if (!campaignId || !companyId || !analytics?.currentPolicyVersion) return;
    setSimulateLoading(true);
    setSimulateResult(null);
    try {
      const res = await fetchWithAuth(
        `/api/governance/simulate-policy?campaignId=${encodeURIComponent(campaignId)}&companyId=${encodeURIComponent(companyId)}&policyVersion=${encodeURIComponent(analytics.currentPolicyVersion)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSimulateResult({
          policyVersion: data.policyVersion,
          status: data.status,
          trade_off_options: data.trade_off_options ?? [],
          explanation: data.explanation ?? '',
          policyHash: data.policyHash ?? '',
        });
        onRefresh?.();
      }
    } catch (err) {
      console.error('Simulate policy failed', err);
    } finally {
      setSimulateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-semibold">Governance Metrics</h2>
        </div>
        <div className="h-24 flex items-center justify-center text-gray-400 text-sm">Loading analytics…</div>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  const healthScore = computeHealthScore(analytics);
  const badge = getHealthBadgeColor(healthScore);

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      {governanceLocked && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 font-medium flex items-center gap-2">
          <Lock className="h-5 w-5 shrink-0" />
          Governance Lockdown Active — Mutations Disabled
        </div>
      )}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-semibold">Governance Metrics</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${badge.bg} ${badge.text}`}>
            Health Score: {healthScore}
          </span>
          {auditStatus === 'OK' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Integrity Stable
            </span>
          )}
          {auditStatus === 'WARNING' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              Integrity Warning
            </span>
          )}
          {auditStatus === 'CRITICAL' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Integrity Critical
            </span>
          )}
          {(analytics.policyVersion || analytics.policyHash) && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
              <Lock className="h-3.5 w-3.5" />
              Policy Locked
            </span>
          )}
          {analytics.replayIntegrity === 'VERIFIED' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Deterministic Verified
            </span>
          )}
          {analytics.replayIntegrity === 'DRIFT_DETECTED' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Policy Drift Detected
            </span>
          )}
          {analytics.replayIntegrity === 'NOT_REPLAYABLE' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              Replay Not Available
            </span>
          )}
          {(analytics.replayCoverageRatio ?? 1) < 0.8 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              Low Replay Coverage
            </span>
          )}
          {(analytics.driftCount ?? 0) > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Drift Events Detected ({analytics.driftCount})
            </span>
          )}
          {analytics.policyUpgradeAvailable && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              Policy Upgrade Available
            </span>
          )}
          {ledgerIntegrity === 'VALID' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Ledger Verified
            </span>
          )}
          {ledgerIntegrity === 'CORRUPTED' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Ledger Corruption Detected
            </span>
          )}
          {projectionStatus === 'ACTIVE' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Projection Active
            </span>
          )}
          {projectionStatus === 'REBUILDING' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              Projection Rebuilding
            </span>
          )}
          {projectionStatus === 'MISSING' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Projection Missing
            </span>
          )}
          {(replayRateLimitedCount > 0 || snapshotRestoreBlockedCount > 0 || projectionRebuildBlockedCount > 0) && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              Governance Load Guard Activated
            </span>
          )}
          {(() => {
            const enabled = autoOptimizeEnabled ?? (analytics as any)?.autoOptimizeEnabled;
            const eligible = (autoOptimizationEligibilityProp ?? (analytics as any)?.autoOptimizationEligibility)?.eligible;
            if (enabled && eligible) {
              return (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Autonomous Optimization Active
                </span>
              );
            }
            if (enabled && !eligible) {
              return (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  Auto Mode Enabled — Waiting for Stability
                </span>
              );
            }
            return null;
          })()}
          {analytics.policyUpgradeAvailable && campaignId && companyId && !governanceLocked && (
            <button
              type="button"
              onClick={runSimulate}
              disabled={simulateLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {simulateLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Simulate Under Latest Policy
            </button>
          )}
        </div>
      </div>

      {campaignId &&
        companyId &&
        !governanceLocked &&
        analytics.replayIntegrity === 'VERIFIED' &&
        (analytics.driftCount ?? 0) === 0 &&
        onToggleAutoOptimize && (
        <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Autonomous Optimization</h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoOptimizeEnabled ?? (analytics as any)?.autoOptimizeEnabled ?? false}
              onChange={(e) => onToggleAutoOptimize(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">Enable Autonomous Optimization</span>
          </label>
          <p className="text-xs text-slate-500 mt-1">
            When eligible, the system may automatically apply optimization proposals. Fully auditable and reversible.
          </p>
        </div>
      )}

      {(analytics.policyVersion || analytics.policyHash) && (
        <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-slate-500">Policy Version:</span>{' '}
              <span className="font-medium text-slate-900">{analytics.policyVersion ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Policy Hash:</span>{' '}
              <code className="text-xs font-mono text-slate-700 bg-white px-1.5 py-0.5 rounded">
                {(analytics.policyHash ?? '').slice(0, 8)}
              </code>
            </div>
          </div>
        </div>
      )}

      {(optimizationProposalProp ?? (analytics as any)?.optimizationProposal) && (
        <div className="mb-4 p-4 bg-violet-50 rounded-lg border border-violet-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Optimization Proposal
          </h3>
          {(() => {
            const p = optimizationProposalProp ?? (analytics as any)?.optimizationProposal;
            const confidence = p.confidenceScore ?? 0;
            const confBadge =
              confidence >= 80
                ? { bg: 'bg-green-100', text: 'text-green-800' }
                : confidence >= 50
                  ? { bg: 'bg-yellow-100', text: 'text-yellow-800' }
                  : { bg: 'bg-red-100', text: 'text-red-800' };
            return (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{p.summary}</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {p.proposedDurationWeeks != null && (
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-800">Duration:</span> {p.proposedDurationWeeks} weeks
                    </span>
                  )}
                  {p.proposedPostsPerWeek != null && (
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-800">Posts/week:</span> {p.proposedPostsPerWeek}
                    </span>
                  )}
                  {p.proposedContentMixAdjustment && Object.keys(p.proposedContentMixAdjustment).length > 0 && (
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-800">Mix:</span>{' '}
                      {Object.entries(p.proposedContentMixAdjustment)
                        .map(([k, v]) => `${k}: ${Math.round((v as number) * 100)}%`)
                        .join(', ')}
                    </span>
                  )}
                  {p.proposedStartDateShift && (
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-800">Start shift:</span> {p.proposedStartDateShift} days
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${confBadge.bg} ${confBadge.text}`}>
                    Confidence: {confidence}%
                  </span>
                  {onApplyProposal && !governanceLocked && (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyProposal({
                          proposedDurationWeeks: p.proposedDurationWeeks,
                          proposedPostsPerWeek: p.proposedPostsPerWeek,
                          summary: p.summary,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-violet-600 text-white hover:bg-violet-700"
                    >
                      Apply Proposal (Review)
                    </button>
                  )}
                </div>
                {p.reasoning?.length > 0 && (
                  <ul className="text-xs text-slate-600 list-disc list-inside space-y-0.5">
                    {p.reasoning.map((r: string, i: number) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {(optimizationInsights ?? (analytics as any)?.optimizationInsights)?.length > 0 && (
        <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Optimization Insights</h3>
          <div className="space-y-3">
            {(optimizationInsights ?? (analytics as any)?.optimizationInsights).map((insight: any, idx: number) => {
              const priorityBadge =
                insight.priority === 'HIGH'
                  ? { bg: 'bg-red-100', text: 'text-red-800' }
                  : insight.priority === 'MEDIUM'
                    ? { bg: 'bg-amber-100', text: 'text-amber-800' }
                    : { bg: 'bg-green-100', text: 'text-green-800' };
              return (
                <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${priorityBadge.bg} ${priorityBadge.text}`}>
                      {insight.priority}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{insight.headline}</span>
                  </div>
                  {insight.explanation && (
                    <p className="text-sm text-slate-600 mt-1">{insight.explanation}</p>
                  )}
                  {insight.recommendedAction && (
                    <p className="text-sm text-slate-700 mt-1 font-medium">{insight.recommendedAction}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(roiIntelligence ?? (analytics as any)?.roiIntelligence) && (
        <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">ROI Intelligence</h3>
          {(() => {
            const roi = roiIntelligence ?? (analytics as any)?.roiIntelligence;
            const score = roi?.roiScore ?? 0;
            const badge =
              score >= 80
                ? { label: 'High Performing', bg: 'bg-green-100', text: 'text-green-800' }
                : score >= 50
                  ? { label: 'Monitor', bg: 'bg-yellow-100', text: 'text-yellow-800' }
                  : { label: 'At Risk', bg: 'bg-red-100', text: 'text-red-800' };
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">ROI Score: {score}</span>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({roi?.optimizationSignal ?? 'STABLE'})
                  </span>
                </div>
                {roi?.recommendation && (
                  <p className="text-sm text-slate-600">{roi.recommendation}</p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {simulateResult && (
        <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Simulated Under Latest Policy</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Current (evaluated under):</span>{' '}
              <span className="font-medium text-slate-900">{analytics?.evaluatedUnderPolicyVersion ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Simulated status:</span>{' '}
              <span className="font-medium text-slate-900">{simulateResult.status}</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-700">{simulateResult.explanation}</p>
          {simulateResult.trade_off_options.length > 0 && (
            <div className="mt-2 text-sm">
              <span className="text-slate-500">Trade-off options: </span>
              <span className="text-slate-700">
                {simulateResult.trade_off_options.length} available
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div>
          <div className="text-sm font-medium text-gray-500">Total Events</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.totalEvents}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Negotiations</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.negotiationCount}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Rejections</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.rejectionCount}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Freeze Blocks</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.freezeBlocks}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Scheduler Runs</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.schedulerRuns}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Preemptions</div>
          <div className="text-lg font-semibold text-gray-900">{analytics.preemptionCount}</div>
        </div>
      </div>

      {snapshotCount > 0 && (
        <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Snapshot Status
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">
              Latest: {lastSnapshotAt ? new Date(lastSnapshotAt).toLocaleString() : '—'}
            </span>
            <span className="text-sm text-slate-600">Total: {snapshotCount}</span>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={runCreateSnapshot}
                disabled={snapshotLoading || governanceLocked}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {snapshotLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Create Snapshot
              </button>
            )}
            {latestSnapshotId && (
              <button
                type="button"
                onClick={runVerifySnapshot}
                disabled={verifyLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-600 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {verifyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Verify Snapshot
              </button>
            )}
            {verifyResult && !verifyResult.valid && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                Snapshot Integrity Failed
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-sm font-medium text-gray-500">Execution State</div>
          <div className="font-medium text-gray-900">{analytics.executionState}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Scheduled Posts</div>
          <div className="font-medium text-gray-900">{analytics.totalScheduledPosts ?? '—'}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Published Posts</div>
          <div className="font-medium text-gray-900">{analytics.totalPublishedPosts ?? '—'}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Completion</div>
          {analytics.completionTimestamp ? (
            <div className="font-medium text-gray-900 text-sm">
              {new Date(analytics.completionTimestamp).toLocaleString()}
            </div>
          ) : (
            <span className="text-gray-500">Not completed</span>
          )}
        </div>
      </div>
    </div>
  );
}
