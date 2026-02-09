import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import ExecutiveSnapshot from '../../components/community-ai/ExecutiveSnapshot';
import NetworkHealth from '../../components/community-ai/NetworkHealth';
import PlaybookPerformance from '../../components/community-ai/PlaybookPerformance';
import PlatformMix from '../../components/community-ai/PlatformMix';
import RecentMomentum from '../../components/community-ai/RecentMomentum';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

type ExecutiveSummary = {
  total_discovered_users: number;
  total_eligible_users: number;
  eligibility_rate: number;
  total_actions_created: number;
  total_actions_executed: number;
  execution_rate: number;
  automation_mix: {
    observe: number;
    assist: number;
    automate: number;
  };
  platform_mix: Array<{ platform: string; discovered_users: number; share: number }>;
  last_activity_at: string | null;
};

type PlaybookPerformanceRow = {
  playbook_id: string | null;
  playbook_name: string;
  automation_level: 'observe' | 'assist' | 'automate';
  discovered_users_count: number;
  eligible_users_count: number;
  execution_rate: number;
  top_platforms: Array<{ platform: string; discovered_users_count: number }>;
};

type ExecutiveNarrative = {
  overview: string;
  key_shifts: string[];
  risks_to_watch: string[];
  recommendations_to_review: string[];
  explicitly_not_recommended: string[];
  confidence_level: number;
};

type WeekOverWeekMetric = {
  metric: 'eligible_users' | 'actions_created' | 'actions_executed' | 'execution_rate';
  current_value: number;
  previous_value: number;
  delta_percent: number;
  trend: 'up' | 'down' | 'flat';
};

type MonthOverMonthMetric = WeekOverWeekMetric;

type CampaignBaselineMetric = {
  metric: 'eligible_users' | 'actions_created' | 'actions_executed' | 'execution_rate';
  campaign_value: number;
  baseline_value: number;
  lift_percent: number;
  outcome: 'outperformed' | 'underperformed' | 'matched';
};

type ExecutiveAlert = {
  alert_type: string;
  severity: 'info' | 'warning' | 'attention';
  title: string;
  reason: string;
  supporting_metrics: Record<string, any>;
  first_detected_at: string | null;
};

type PlaybookLearningRecord = {
  playbook_id: string | null;
  playbook_name: string;
  learning_state: 'improving' | 'stable' | 'volatile' | 'decaying' | 'insufficient_data';
  confidence: 'low' | 'medium' | 'high';
  supporting_signals: string[];
  first_observed_at: string | null;
  last_updated_at: string | null;
};

type RecommendationItem = {
  category: string;
  suggestion: string;
  confidence: 'low' | 'medium' | 'high';
  requires_review: true;
  supporting_signals: string[];
};

export default function ExecutiveDashboard() {
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [playbooks, setPlaybooks] = useState<PlaybookPerformanceRow[]>([]);
  const [narrative, setNarrative] = useState<ExecutiveNarrative | null>(null);
  const [wowMetrics, setWowMetrics] = useState<WeekOverWeekMetric[]>([]);
  const [momMetrics, setMomMetrics] = useState<MonthOverMonthMetric[]>([]);
  const [campaignBaseline, setCampaignBaseline] = useState<CampaignBaselineMetric[]>([]);
  const [alerts, setAlerts] = useState<ExecutiveAlert[]>([]);
  const [learningRecords, setLearningRecords] = useState<PlaybookLearningRecord[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadExecutiveData = async () => {
      if (!tenantId) {
        setSummary(null);
        setPlaybooks([]);
        setNarrative(null);
        setWowMetrics([]);
        setMomMetrics([]);
        setCampaignBaseline([]);
        setAlerts([]);
        setLearningRecords([]);
        setRecommendations([]);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [
          summaryResponse,
          playbookResponse,
          narrativeResponse,
          wowResponse,
          momResponse,
          campaignBaselineResponse,
          alertsResponse,
          learningResponse,
          recommendationsResponse,
        ] =
          await Promise.all([
          fetchWithAuth(
            `/api/community-ai/executive-summary?tenant_id=${encodeURIComponent(
              tenantId
            )}&organization_id=${encodeURIComponent(tenantId)}`
          ),
          fetchWithAuth(
            `/api/community-ai/playbook-effectiveness?tenant_id=${encodeURIComponent(
              tenantId
            )}&organization_id=${encodeURIComponent(tenantId)}`
          ),
          fetchWithAuth(
            `/api/community-ai/executive-narrative?tenant_id=${encodeURIComponent(
              tenantId
            )}&organization_id=${encodeURIComponent(tenantId)}`
          ),
          fetchWithAuth(
            `/api/community-ai/wow-comparison?tenant_id=${encodeURIComponent(
              tenantId
            )}&organization_id=${encodeURIComponent(tenantId)}`
          ),
            fetchWithAuth(
              `/api/community-ai/mom-comparison?tenant_id=${encodeURIComponent(
                tenantId
              )}&organization_id=${encodeURIComponent(tenantId)}`
            ),
            fetchWithAuth(
              `/api/community-ai/campaign-baseline?tenant_id=${encodeURIComponent(
                tenantId
              )}&organization_id=${encodeURIComponent(tenantId)}`
            ),
            fetchWithAuth(
              `/api/community-ai/executive-alerts?tenant_id=${encodeURIComponent(
                tenantId
              )}&organization_id=${encodeURIComponent(tenantId)}`
            ),
            fetchWithAuth(
              `/api/community-ai/playbook-learning?tenant_id=${encodeURIComponent(
                tenantId
              )}&organization_id=${encodeURIComponent(tenantId)}`
            ),
            fetchWithAuth(
              `/api/community-ai/recommendations?tenant_id=${encodeURIComponent(
                tenantId
              )}&organization_id=${encodeURIComponent(tenantId)}`
            ),
        ]);

        if (!summaryResponse.ok) {
          const data = await summaryResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load executive summary');
        }
        if (!playbookResponse.ok) {
          const data = await playbookResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load playbook performance');
        }
        if (!narrativeResponse.ok) {
          const data = await narrativeResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load executive narrative');
        }
        if (!wowResponse.ok) {
          const data = await wowResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load week-over-week comparison');
        }
        if (!momResponse.ok) {
          const data = await momResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load month-over-month comparison');
        }
        if (!campaignBaselineResponse.ok) {
          const data = await campaignBaselineResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load campaign baseline comparison');
        }
        if (!alertsResponse.ok) {
          const data = await alertsResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load executive alerts');
        }
        if (!learningResponse.ok) {
          const data = await learningResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load playbook learning status');
        }
        if (!recommendationsResponse.ok) {
          const data = await recommendationsResponse.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load recommendations');
        }

        const summaryData = await summaryResponse.json();
        const playbookData = await playbookResponse.json();
        const narrativeData = await narrativeResponse.json();
        const wowData = await wowResponse.json();
        const momData = await momResponse.json();
        const campaignData = await campaignBaselineResponse.json();
        const alertsData = await alertsResponse.json();
        const learningData = await learningResponse.json();
        const recommendationsData = await recommendationsResponse.json();
        setSummary(summaryData?.summary || null);
        setPlaybooks(playbookData?.records || []);
        setNarrative(narrativeData?.narrative || null);
        setWowMetrics(wowData?.metrics || []);
        setMomMetrics(momData?.metrics || []);
        setCampaignBaseline(campaignData?.metrics || []);
        setAlerts(alertsData?.alerts || []);
        setLearningRecords(learningData?.records || []);
        setRecommendations(recommendationsData?.recommendations || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load executive data');
      } finally {
        setIsLoading(false);
      }
    };

    loadExecutiveData();
  }, [tenantId]);

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      executive_summary: summary,
      playbook_performance: playbooks,
      executive_narrative: narrative,
      week_over_week: wowMetrics,
      month_over_month: momMetrics,
      campaign_baseline: campaignBaseline,
      executive_alerts: alerts,
      playbook_learning: learningRecords,
      recommendations,
    }),
    [
      tenantId,
      summary,
      playbooks,
      narrative,
      wowMetrics,
      momMetrics,
      campaignBaseline,
      alerts,
      learningRecords,
      recommendations,
    ]
  );

  return (
    <CommunityAiLayout title="Executive Network Intelligence" context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      {summary && (
        <div className="flex justify-end">
          <button
            type="button"
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            onClick={() =>
              window.open(
                `/api/community-ai/executive-export?format=pdf&tenant_id=${encodeURIComponent(
                  tenantId
                )}&organization_id=${encodeURIComponent(tenantId)}`
              )
            }
          >
            Export PDF
          </button>
        </div>
      )}

      <SectionCard title="Executive Snapshot" subtitle={isLoading ? 'Loading…' : undefined}>
        <ExecutiveSnapshot
          totalDiscoveredUsers={summary?.total_discovered_users ?? 0}
          eligibilityRate={summary?.eligibility_rate ?? 0}
          executionRate={summary?.execution_rate ?? 0}
          automationMix={
            summary?.automation_mix ?? { observe: 0, assist: 0, automate: 0 }
          }
          lastActivityAt={summary?.last_activity_at ?? null}
        />
      </SectionCard>

      <SectionCard title="AI Executive Interpretation" subtitle={isLoading ? 'Loading…' : undefined}>
        <div className="text-sm text-slate-700 space-y-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Interpretation only — not an execution directive
          </p>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Overview</p>
            <p>{narrative?.overview || '—'}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Key Shifts</p>
            {narrative?.key_shifts?.length ? (
              <ul className="list-disc list-inside">
                {narrative.key_shifts.map((item, index) => (
                  <li key={`shift-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Risks to Watch</p>
            {narrative?.risks_to_watch?.length ? (
              <ul className="list-disc list-inside">
                {narrative.risks_to_watch.map((item, index) => (
                  <li key={`risk-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">What NOT to Change Yet</p>
            {narrative?.explicitly_not_recommended?.length ? (
              <ul className="list-disc list-inside">
                {narrative.explicitly_not_recommended.map((item, index) => (
                  <li key={`not-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Confidence Indicator</p>
            <p>
              {typeof narrative?.confidence_level === 'number'
                ? `${Math.round(narrative.confidence_level * 100)}%`
                : '—'}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Week-over-Week Change" subtitle={isLoading ? 'Loading…' : undefined}>
        <div className="space-y-3 text-sm text-slate-700">
          {wowMetrics.length === 0 && <p>—</p>}
          {wowMetrics.map((metric) => {
            const labelMap: Record<WeekOverWeekMetric['metric'], string> = {
              eligible_users: 'Eligible users',
              actions_created: 'Actions created',
              actions_executed: 'Actions executed',
              execution_rate: 'Execution rate',
            };
            const arrow = metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→';
            const deltaText = `${metric.delta_percent.toFixed(1)}%`;
            return (
              <div
                key={metric.metric}
                className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2"
              >
                <div className="font-semibold text-slate-900">{labelMap[metric.metric]}</div>
                <div className="text-slate-600">
                  {arrow} {deltaText}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Month-over-Month Momentum" subtitle={isLoading ? 'Loading…' : undefined}>
        <div className="space-y-3 text-sm text-slate-700">
          {momMetrics.length === 0 && <p>—</p>}
          {momMetrics.map((metric) => {
            const labelMap: Record<MonthOverMonthMetric['metric'], string> = {
              eligible_users: 'Eligible users',
              actions_created: 'Actions created',
              actions_executed: 'Actions executed',
              execution_rate: 'Execution rate',
            };
            const arrow = metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→';
            const deltaText = `${metric.delta_percent.toFixed(1)}%`;
            const descriptor =
              metric.trend === 'up'
                ? 'accelerating'
                : metric.trend === 'down'
                ? 'softening'
                : 'stable';
            return (
              <div
                key={`mom-${metric.metric}`}
                className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2"
              >
                <div className="font-semibold text-slate-900">{labelMap[metric.metric]}</div>
                <div className="text-slate-600">
                  {arrow} {deltaText} <span className="text-xs text-slate-500">{descriptor}</span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Campaign Effectiveness vs Baseline"
        subtitle={isLoading ? 'Loading…' : undefined}
      >
        {campaignBaseline.length === 0 ? (
          <p className="text-sm text-slate-600">—</p>
        ) : (
          <div className="grid gap-2 text-sm text-slate-700">
            <div className="grid grid-cols-5 gap-2 text-xs uppercase tracking-wide text-slate-500">
              <span>Metric</span>
              <span>Campaign</span>
              <span>Baseline</span>
              <span>Lift</span>
              <span>Outcome</span>
            </div>
            {campaignBaseline.map((row) => {
              const labelMap: Record<CampaignBaselineMetric['metric'], string> = {
                eligible_users: 'Eligible users',
                actions_created: 'Actions created',
                actions_executed: 'Actions executed',
                execution_rate: 'Execution rate',
              };
              const liftText = `${row.lift_percent.toFixed(1)}%`;
              const outcomeLabel =
                row.outcome === 'outperformed'
                  ? '🟢 outperformed'
                  : row.outcome === 'underperformed'
                  ? '🔴 underperformed'
                  : '🟡 matched';
              const formatValue = (metric: CampaignBaselineMetric['metric'], value: number) =>
                metric === 'execution_rate' ? `${Math.round(value * 100)}%` : String(value);
              return (
                <div
                  key={`campaign-${row.metric}`}
                  className="grid grid-cols-5 gap-2 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <span className="font-semibold text-slate-900">{labelMap[row.metric]}</span>
                  <span>{formatValue(row.metric, row.campaign_value)}</span>
                  <span>{formatValue(row.metric, row.baseline_value)}</span>
                  <span>{liftText}</span>
                  <span>{outcomeLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Executive Alerts" subtitle={isLoading ? 'Loading…' : undefined}>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-600">—</p>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            {alerts.map((alert) => {
              const badge =
                alert.severity === 'attention'
                  ? 'bg-red-100 text-red-800'
                  : alert.severity === 'warning'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-blue-100 text-blue-800';
              return (
                <div
                  key={alert.alert_type}
                  className="flex items-start gap-3 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <span className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${badge}`}>
                    {alert.severity}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{alert.title}</p>
                    <p className="text-slate-600">{alert.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Playbook Learning Status" subtitle={isLoading ? 'Loading…' : undefined}>
        {learningRecords.length === 0 ? (
          <p className="text-sm text-slate-600">—</p>
        ) : (
          <div className="grid gap-2 text-sm text-slate-700">
            <div className="grid grid-cols-4 gap-2 text-xs uppercase tracking-wide text-slate-500">
              <span>Playbook</span>
              <span>State</span>
              <span>Confidence</span>
              <span>Last Updated</span>
            </div>
            {learningRecords.map((record) => {
              const lastUpdated = record.last_updated_at
                ? new Date(record.last_updated_at).toLocaleDateString()
                : '—';
              return (
                <div
                  key={record.playbook_id || record.playbook_name}
                  className="grid grid-cols-4 gap-2 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <span className="font-semibold text-slate-900">{record.playbook_name}</span>
                  <span className="capitalize">{record.learning_state.replace('_', ' ')}</span>
                  <span className="capitalize">{record.confidence}</span>
                  <span>{lastUpdated}</span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recommendations to Review" subtitle={isLoading ? 'Loading…' : undefined}>
        {recommendations.length === 0 ? (
          <p className="text-sm text-slate-600">—</p>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            {recommendations.map((rec, index) => {
              const badge =
                rec.confidence === 'high'
                  ? 'bg-emerald-100 text-emerald-800'
                  : rec.confidence === 'medium'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-800';
              return (
                <div
                  key={`${rec.category}-${index}`}
                  className="flex items-start gap-3 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <span className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${badge}`}>
                    {rec.confidence}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{rec.category}</p>
                    <p className="text-slate-600">{rec.suggestion}</p>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">
              Recommendations are advisory only and require human review.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Network Growth Health">
        <NetworkHealth
          totalDiscoveredUsers={summary?.total_discovered_users ?? 0}
          totalEligibleUsers={summary?.total_eligible_users ?? 0}
          lastActivityAt={summary?.last_activity_at ?? null}
        />
      </SectionCard>

      <SectionCard title="Playbook Performance" subtitle="Sorted by eligible users (desc)">
        <PlaybookPerformance rows={playbooks} />
      </SectionCard>

      <SectionCard title="Platform Mix">
        <PlatformMix rows={summary?.platform_mix ?? []} />
      </SectionCard>

      <SectionCard title="Recent Momentum">
        <RecentMomentum lastActivityAt={summary?.last_activity_at ?? null} />
      </SectionCard>
    </CommunityAiLayout>
  );
}
