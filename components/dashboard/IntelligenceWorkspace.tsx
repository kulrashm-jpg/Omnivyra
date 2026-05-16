import React, { useCallback, useMemo, useState } from 'react';
import { LineChart, Target } from 'lucide-react';
import ActiveLeadsTab from '@/components/recommendations/tabs/ActiveLeadsTab';
import MarketPulseTabV2 from '@/components/recommendations/tabs/MarketPulseTabV2';
import ExecutiveMarketPulseExperience from '@/components/market-pulse/ExecutiveMarketPulseExperience';

export type IntelligenceWorkspaceView = 'market-pulse' | 'active-leads';

type IntelligenceWorkspaceProps = {
  companyId: string | null;
  activeView: IntelligenceWorkspaceView;
  onViewChange: (view: IntelligenceWorkspaceView) => void;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

const WORKSPACE_TABS: Array<{
  id: IntelligenceWorkspaceView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
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
  const [engineOverrides, setEngineOverrides] = useState<Record<IntelligenceWorkspaceView, string>>({
    'market-pulse': '',
    'active-leads': '',
  });

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
              Signals Workspace
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">Market Signals Hub</h2>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Use one workspace for Market Pulse and Active Leads. Broader Intelligence now lives on
              its own dedicated page.
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

      {activeView === 'market-pulse' && (
        <div className="space-y-6">
          <ExecutiveMarketPulseExperience
            companyId={companyId}
            fetchWithAuth={fetchWithAuth}
          />
          <MarketPulseTabV2
            companyId={companyId}
            onPromote={handleOpportunityPromote}
            onAction={handleOpportunityAction}
            fetchWithAuth={fetchWithAuth}
            overrideText={engineOverrides['market-pulse']}
            onOverrideChange={(value) => setEngineOverride('market-pulse', value)}
          />
        </div>
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
