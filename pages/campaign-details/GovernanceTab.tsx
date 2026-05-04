import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { GovernanceStatusCard, type GovernanceStatusData, type LatestGovernanceEvent } from '../../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard, type GovernanceCampaignAnalyticsData } from '../../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../../components/governance/TradeOffSuggestionList';
import { apiFetch } from '@/lib/apiFetch';

type NegotiationResult = {
  status: string;
  explanation: string;
  trade_off_options: Array<{ type: string; newDurationWeeks?: number; reasoning: string; [k: string]: unknown }>;
  evaluation?: { requested_weeks?: number; max_weeks_allowed?: number; min_weeks_required?: number };
} | null;

type GovernanceStatus = {
  governance: GovernanceStatusData;
  latestGovernanceEvent: LatestGovernanceEvent | null;
  trade_off_options?: Array<{ type: string; [key: string]: unknown }>;
} | null;

type GovernanceEvent = { id: string; campaignId: string; eventType: string; eventStatus: string; metadata: Record<string, unknown>; createdAt: string };

type GovernanceAnalytics = (GovernanceCampaignAnalyticsData & {
  projectionStatus?: 'ACTIVE' | 'REBUILDING' | 'MISSING';
  roiIntelligence?: {
    roiScore: number;
    performanceScore: number;
    governanceStabilityScore: number;
    executionReliabilityScore: number;
    optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
    recommendation?: string;
  } | null;
  optimizationInsights?: Array<{
    campaignId: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    category: string;
    headline: string;
    explanation: string;
    recommendedAction: string;
  }> | null;
  optimizationProposal?: {
    campaignId: string;
    summary: string;
    proposedDurationWeeks?: number;
    proposedPostsPerWeek?: number;
    reasoning: string[];
    confidenceScore: number;
  } | null;
  autoOptimizeEnabled?: boolean;
  autoOptimizationEligibility?: { eligible: boolean; reason?: string } | null;
}) | null;

interface Props {
  campaignId: string;
  effectiveCompanyId: string;
  isAdmin: boolean;
  governanceLoading: boolean;
  governanceStatus: GovernanceStatus;
  governanceLocked: boolean;
  governanceAnalytics: GovernanceAnalytics;
  governanceAuditStatus: 'OK' | 'WARNING' | 'CRITICAL' | null;
  governanceSnapshotAt: string | null;
  governanceSnapshotCount: number;
  governanceLatestSnapshotId: string | null;
  governanceLedgerIntegrity: 'VALID' | 'CORRUPTED' | null;
  governanceLoadGuardCounts: { replayRateLimitedCount: number; snapshotRestoreBlockedCount: number; projectionRebuildBlockedCount: number };
  governanceEvents: GovernanceEvent[];
  negotiationMessage: string;
  setNegotiationMessage: (v: string) => void;
  negotiationLoading: boolean;
  setNegotiationLoading: (v: boolean) => void;
  negotiationResult: NegotiationResult;
  setNegotiationResult: (v: NegotiationResult) => void;
  setGovernanceStatus: (v: GovernanceStatus) => void;
  setGovernanceEvents: (v: GovernanceEvent[]) => void;
  setGovernanceAnalytics: (v: GovernanceAnalytics) => void;
  loadGovernance: () => void;
}

export default function GovernanceTab({
  campaignId,
  effectiveCompanyId,
  isAdmin,
  governanceLoading,
  governanceStatus,
  governanceLocked,
  governanceAnalytics,
  governanceAuditStatus,
  governanceSnapshotAt,
  governanceSnapshotCount,
  governanceLatestSnapshotId,
  governanceLedgerIntegrity,
  governanceLoadGuardCounts,
  governanceEvents,
  negotiationMessage,
  setNegotiationMessage,
  negotiationLoading,
  setNegotiationLoading,
  negotiationResult,
  setNegotiationResult,
  setGovernanceStatus,
  setGovernanceEvents,
  setGovernanceAnalytics,
  loadGovernance,
}: Props) {
  return (
    <div className="space-y-6">
      {governanceLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : !governanceStatus ? (
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
          <p className="text-sm text-gray-500">Unable to load governance data. Try again later.</p>
        </div>
      ) : (
        <>
          {governanceLocked && (
            <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 font-medium">
              Governance Lockdown Active — Mutations Disabled
            </div>
          )}
          {governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
            <div className="mb-6 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-amber-800">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                Execution Window Frozen — Changes Locked (&lt;24h to first scheduled post)
              </div>
              <p className="mt-1 text-sm text-amber-700">
                Duration edit, regenerate blueprint, and negotiation are disabled until after the first scheduled post.
              </p>
            </div>
          )}
          {governanceStatus.governance?.blueprintImmutable && !governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
            <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-red-800">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                Blueprint Locked — Campaign In Execution
              </div>
              <p className="mt-1 text-sm text-red-700">
                Duration edit, regenerate blueprint, and negotiation are disabled while the campaign has scheduled or published posts.
              </p>
            </div>
          )}
          <GovernanceStatusCard
            governance={governanceStatus.governance}
            latestEvent={governanceStatus.latestGovernanceEvent}
          />
          <GovernanceAnalyticsCard
            analytics={governanceAnalytics}
            loading={governanceLoading}
            campaignId={campaignId}
            companyId={effectiveCompanyId ?? undefined}
            onRefresh={loadGovernance}
            auditStatus={governanceAuditStatus ?? undefined}
            governanceLocked={governanceLocked}
            lastSnapshotAt={governanceSnapshotAt}
            snapshotCount={governanceSnapshotCount}
            latestSnapshotId={governanceLatestSnapshotId}
            isSuperAdmin={isAdmin}
            ledgerIntegrity={governanceLedgerIntegrity ?? undefined}
            projectionStatus={governanceAnalytics?.projectionStatus ?? undefined}
            replayRateLimitedCount={governanceLoadGuardCounts.replayRateLimitedCount}
            snapshotRestoreBlockedCount={governanceLoadGuardCounts.snapshotRestoreBlockedCount}
            projectionRebuildBlockedCount={governanceLoadGuardCounts.projectionRebuildBlockedCount}
            roiIntelligence={governanceAnalytics?.roiIntelligence}
            optimizationInsights={governanceAnalytics?.optimizationInsights}
            optimizationProposal={governanceAnalytics?.optimizationProposal ?? null}
            onApplyProposal={(proposal: any) => {
              const parts: string[] = [];
              if (proposal.proposedDurationWeeks != null) parts.push(`${proposal.proposedDurationWeeks} weeks`);
              if (proposal.proposedPostsPerWeek != null) parts.push(`${proposal.proposedPostsPerWeek} posts per week`);
              setNegotiationMessage(parts.length > 0 ? parts.join(', ') : proposal.summary);
            }}
            autoOptimizeEnabled={governanceAnalytics?.autoOptimizeEnabled}
            autoOptimizationEligibility={governanceAnalytics?.autoOptimizationEligibility}
            onToggleAutoOptimize={async (enabled: boolean) => {
              if (!campaignId || !effectiveCompanyId) return;
              const res = await apiFetch('/api/analytics/toggle-auto-optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaignId, companyId: effectiveCompanyId, enabled }),
              });
              if (res.ok) loadGovernance();
            }}
          />
          {governanceStatus.latestGovernanceEvent ? (
            <GovernanceExplanationPanel
              derived={deriveFromEvent(
                governanceStatus.latestGovernanceEvent.eventType,
                governanceStatus.latestGovernanceEvent.metadata
              )}
            />
          ) : (
            <GovernanceExplanationPanel />
          )}
          {governanceStatus.trade_off_options && governanceStatus.trade_off_options.length > 0 && (
            <TradeOffSuggestionList options={governanceStatus.trade_off_options} />
          )}
          {governanceStatus.governance?.durationWeeks != null &&
            !governanceStatus.governance?.blueprintImmutable &&
            !governanceStatus.governance?.blueprintFrozen &&
            !governanceLocked &&
            ((governanceStatus.latestGovernanceEvent?.eventType === 'PRE_PLANNING_EVALUATED' ||
              governanceStatus.latestGovernanceEvent?.eventType === 'DURATION_NEGOTIATED') &&
              governanceStatus.latestGovernanceEvent?.eventStatus === 'NEGOTIATE') && (
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Refine your duration</h3>
              <p className="text-sm text-gray-600 mb-3">
                Try a different duration (e.g. &quot;14 weeks&quot;, &quot;extend&quot;, &quot;reduce&quot;) and re-evaluate.
              </p>
              <div className="flex gap-3 flex-wrap">
                <input
                  type="text"
                  placeholder="Refine your duration…"
                  value={negotiationMessage}
                  onChange={(e) => setNegotiationMessage(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  onClick={async () => {
                    if (!campaignId || !effectiveCompanyId) return;
                    setNegotiationLoading(true);
                    setNegotiationResult(null);
                    try {
                      const res = await apiFetch('/api/campaigns/negotiate-duration', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ campaignId, companyId: effectiveCompanyId, message: negotiationMessage }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setNegotiationResult({
                          status: data.status,
                          explanation: data.explanation,
                          trade_off_options: data.trade_off_options ?? [],
                          evaluation: data.evaluation,
                        });
                        const [statusRes, eventsRes, analyticsRes] = await Promise.all([
                          apiFetch(`/api/governance/campaign-status?campaignId=${encodeURIComponent(campaignId)}&companyId=${encodeURIComponent(effectiveCompanyId)}`),
                          apiFetch(`/api/governance/events?companyId=${encodeURIComponent(effectiveCompanyId)}&campaignId=${encodeURIComponent(campaignId)}`),
                          apiFetch(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(campaignId)}`),
                        ]);
                        if (statusRes.ok) {
                          const statusData = await statusRes.json();
                          setGovernanceStatus({ governance: statusData.governance, latestGovernanceEvent: statusData.latestGovernanceEvent, trade_off_options: statusData.trade_off_options });
                        }
                        if (eventsRes.ok) {
                          const eventsData = await eventsRes.json();
                          setGovernanceEvents(eventsData.events ?? []);
                        }
                        if (analyticsRes.ok) {
                          const analyticsData = await analyticsRes.json();
                          setGovernanceAnalytics(analyticsData);
                        }
                      }
                    } catch (err) {
                      console.error('Negotiation failed', err);
                    } finally {
                      setNegotiationLoading(false);
                    }
                  }}
                  disabled={negotiationLoading || governanceLocked}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {negotiationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Re-evaluate
                </button>
              </div>
              {negotiationResult && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-2">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{negotiationResult.explanation}</p>
                  {negotiationResult.trade_off_options && negotiationResult.trade_off_options.length > 0 && (
                    <TradeOffSuggestionList options={negotiationResult.trade_off_options} />
                  )}
                </div>
              )}
            </div>
          )}
          <PreemptionHistory events={governanceEvents} />
          <GovernanceTimeline events={governanceEvents} />
        </>
      )}
    </div>
  );
}
