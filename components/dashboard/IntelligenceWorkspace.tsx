import React, { useCallback, useState } from 'react';
import MarketPulseTabV2 from '@/components/recommendations/tabs/MarketPulseTabV2';

export type IntelligenceWorkspaceView = 'market-pulse' | 'active-leads';

type IntelligenceWorkspaceProps = {
  companyId: string | null;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

export default function IntelligenceWorkspace({
  companyId,
  fetchWithAuth,
}: IntelligenceWorkspaceProps) {
  const [engineOverrides, setEngineOverrides] = useState<Record<'market-pulse', string>>({
    'market-pulse': '',
  });

  const handleOpportunityAction = useCallback(async () => {}, []);
  const handleOpportunityPromote = useCallback(async () => {}, []);
  const setEngineOverride = useCallback((key: 'market-pulse', value: string) => {
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
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Signals Workspace
            </p>
            <h2 className="mt-1 text-2xl font-bold text-gray-900">Market signals</h2>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800">
            Market Pulse
          </div>
        </div>
      </div>

      <MarketPulseTabV2
        companyId={companyId}
        onPromote={handleOpportunityPromote}
        onAction={handleOpportunityAction}
        fetchWithAuth={fetchWithAuth}
        overrideText={engineOverrides['market-pulse']}
        onOverrideChange={(value) => setEngineOverride('market-pulse', value)}
      />
    </div>
  );
}
