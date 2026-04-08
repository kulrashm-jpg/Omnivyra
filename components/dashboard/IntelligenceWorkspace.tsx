import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, LineChart, Target } from 'lucide-react';
import { CampaignHealthOverview } from '@/components/dashboard/CampaignHealthOverview';
import { CampaignAttributionPanel } from '@/components/dashboard/CampaignAttributionPanel';
import { StrategicInsightsPanel } from '@/components/dashboard/StrategicInsightsPanel';
import { OpportunityPanel } from '@/components/dashboard/OpportunityPanel';
import { TrendSignalsPanel } from '@/components/dashboard/TrendSignalsPanel';
import { MarketingMemoryPanel } from '@/components/dashboard/MarketingMemoryPanel';
import EngagementIntelligenceSection from '@/components/dashboard/EngagementIntelligenceSection';
import ActiveLeadsTab from '@/components/recommendations/tabs/ActiveLeadsTab';
import MarketPulseTab from '@/components/recommendations/tabs/MarketPulseTab';

export type IntelligenceWorkspaceView = 'intelligence' | 'market-pulse' | 'active-leads';

type IntelligenceWorkspaceProps = {
  companyId: string | null;
  activeView: IntelligenceWorkspaceView;
  onViewChange: (view: IntelligenceWorkspaceView) => void;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type DashboardIntelligenceData = {
  campaign_health_reports: Array<{
    campaign_id: string;
    campaign_name: string;
    health_score: number;
    health_status: string;
    issue_count: number;
  }>;
  campaign_attribution?: {
    opportunity: number;
    trend: number;
    strategic_insight: number;
    manual: number;
  };
  campaign_origins?: Array<{
    campaign_id: string;
    campaign_name: string;
    origin_source: string;
  }>;
  strategic_insights: Array<{
    title: string;
    summary: string;
    confidence: number;
    recommended_action: string;
  }>;
  opportunities: Array<{
    title: string;
    description: string;
    opportunity_score: number;
    confidence: number;
    opportunity_type?: string;
  }>;
  trend_signals: Array<{
    topic: string;
    signal_strength: number;
    discussion_growth: number;
  }>;
  scheduler_runs?: Array<{
    id: string;
    job_name: string;
    started_at: string;
    status: string;
    is_stale: boolean;
  }>;
  marketing_memory?: {
    top_content_formats?: Array<{ format: string; avg_engagement?: number }>;
    top_narratives?: Array<{ narrative: string; engagement_score?: number }>;
    audience_patterns?: string[];
  };
};

const WORKSPACE_TABS: Array<{
  id: IntelligenceWorkspaceView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: 'intelligence',
    label: 'Intelligence',
    icon: Brain,
    description: 'Strategic insights, campaign health, opportunities, and performance gaps.',
  },
  {
    id: 'market-pulse',
    label: 'Market Pulse',
    icon: LineChart,
    description: 'Track signals, momentum shifts, and market openings in one place.',
  },
  {
    id: 'active-leads',
    label: 'Active Leads',
    icon: Target,
    description: 'Listen for buyer intent, qualify leads, and move outreach forward.',
  },
];

export default function IntelligenceWorkspace({
  companyId,
  activeView,
  onViewChange,
  fetchWithAuth,
}: IntelligenceWorkspaceProps) {
  const [data, setData] = useState<DashboardIntelligenceData | null>(null);
  const [loading, setLoading] = useState(activeView === 'intelligence');
  const [error, setError] = useState<string | null>(null);
  const [engineOverrides, setEngineOverrides] = useState<Record<IntelligenceWorkspaceView, string>>({
    intelligence: '',
    'market-pulse': '',
    'active-leads': '',
  });

  const fetchDashboardIntelligence = useCallback(async () => {
    if (!companyId || activeView !== 'intelligence') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/dashboard/intelligence?companyId=${encodeURIComponent(companyId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.details || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as DashboardIntelligenceData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load intelligence dashboard');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeView, companyId, fetchWithAuth]);

  useEffect(() => {
    void fetchDashboardIntelligence();
  }, [fetchDashboardIntelligence]);

  const activeTabMeta = useMemo(
    () => WORKSPACE_TABS.find((tab) => tab.id === activeView) ?? WORKSPACE_TABS[0],
    [activeView]
  );

  const handleOpportunityAction = useCallback(async () => {}, []);
  const handleOpportunityPromote = useCallback(async () => {}, []);
  const setEngineOverride = useCallback((key: IntelligenceWorkspaceView, value: string) => {
    setEngineOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (!companyId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        Select a company to view intelligence.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Dashboard Workspace
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">Intelligence Hub</h2>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Use one workspace for strategic intelligence, market pulse, and active lead tracking so
              the full picture stays together.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{activeTabMeta.label}</span>
            <span className="ml-2 text-indigo-700">{activeTabMeta.description}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onViewChange(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeView === 'intelligence' && (
        <div className="space-y-6">
          <EngagementIntelligenceSection companyId={companyId} fetchWithAuth={fetchWithAuth} />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
              {error}
              <button
                type="button"
                onClick={() => void fetchDashboardIntelligence()}
                className="ml-2 text-sm font-medium underline"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && data?.scheduler_runs?.some((run) => run.is_stale) && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
              role="alert"
            >
              <strong>Scheduler stale run detected.</strong> An intelligence job started over an hour
              ago is still marked as running and may have been interrupted.
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <OpportunityPanel
              companyId={companyId}
              opportunities={data?.opportunities}
              loading={loading}
              className="lg:col-span-2"
            />
            <StrategicInsightsPanel
              insights={data?.strategic_insights}
              loading={loading}
              className="lg:col-span-2"
            />
            <CampaignHealthOverview
              items={data?.campaign_health_reports ?? []}
              loading={loading}
              className="lg:col-span-2"
            />
            <CampaignAttributionPanel
              attribution={data?.campaign_attribution ?? null}
              campaigns={data?.campaign_origins ?? null}
              loading={loading}
              className="lg:col-span-2"
            />
            <TrendSignalsPanel
              signals={data?.trend_signals ?? []}
              loading={loading}
              className="lg:col-span-2"
            />
            <MarketingMemoryPanel
              top_content_formats={data?.marketing_memory?.top_content_formats}
              top_narratives={data?.marketing_memory?.top_narratives}
              audience_patterns={data?.marketing_memory?.audience_patterns}
              loading={loading}
              className="lg:col-span-2"
            />
          </div>
        </div>
      )}

      {activeView === 'market-pulse' && (
        <MarketPulseTab
          companyId={companyId}
          onPromote={handleOpportunityPromote}
          onAction={handleOpportunityAction}
          fetchWithAuth={fetchWithAuth}
          overrideText={engineOverrides['market-pulse']}
          onOverrideChange={(value) => setEngineOverride('market-pulse', value)}
        />
      )}

      {activeView === 'active-leads' && (
        <ActiveLeadsTab
          companyId={companyId}
          onPromote={handleOpportunityPromote}
          onAction={handleOpportunityAction}
          fetchWithAuth={fetchWithAuth}
          overrideText={engineOverrides['active-leads']}
          onOverrideChange={(value) => setEngineOverride('active-leads', value)}
        />
      )}
    </div>
  );
}
