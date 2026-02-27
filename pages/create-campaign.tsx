import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  Plus,
  Target,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import CampaignAIChat from '../components/CampaignAIChat';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import EngineContextPanel from '../components/recommendations/EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../components/recommendations/engine-framework/UnifiedContextModeSelector';

const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
];

const CAMPAIGN_TYPES = [
  { id: 'brand_awareness', label: 'Brand awareness' },
  { id: 'network_expansion', label: 'Network expansion' },
  { id: 'lead_generation', label: 'Lead generation' },
  { id: 'authority_positioning', label: 'Authority positioning' },
  { id: 'engagement_growth', label: 'Engagement growth' },
  { id: 'product_promotion', label: 'Product promotion' },
] as const;

interface CampaignData {
  name: string;
  contextMode: ContextMode;
  focusedModules: FocusModule[];
  additionalDirection: string;
  campaignTypes: string[];
  campaignWeights: Record<string, number>;
  regionInput: string;
}

function mapContextModeToBuildMode(mode: ContextMode): 'full_context' | 'focused_context' | 'no_context' {
  if (mode === 'FULL') return 'full_context';
  if (mode === 'FOCUSED') return 'focused_context';
  return 'no_context';
}

export default function CreateCampaign() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [isLoading, setIsLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [campaignData, setCampaignData] = useState<CampaignData>({
    name: '',
    contextMode: 'FULL',
    focusedModules: [],
    additionalDirection: '',
    campaignTypes: ['brand_awareness'],
    campaignWeights: { brand_awareness: 100 },
    regionInput: '',
  });
  const [regionWarning, setRegionWarning] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  const toggleCampaignType = (typeId: string) => {
    const current = campaignData.campaignTypes;
    let next: string[];
    let weights = { ...campaignData.campaignWeights };
    if (current.includes(typeId)) {
      next = current.filter((t) => t !== typeId);
      delete weights[typeId];
    } else {
      next = [...current, typeId];
    }
    if (next.length === 0) next = ['brand_awareness'];
    if (next.length === 1) {
      weights = { [next[0]]: 100 };
    } else {
      const per = Math.floor(100 / next.length);
      const remainder = 100 - per * next.length;
      weights = {};
      next.forEach((t, i) => {
        weights[t] = per + (i < remainder ? 1 : 0);
      });
    }
    setCampaignData({ ...campaignData, campaignTypes: next, campaignWeights: weights });
  };

  const createCampaign = async () => {
    if (!selectedCompanyId) {
      notify('info', 'Select a company first.');
      return;
    }
    if (!campaignData.name?.trim()) {
      notify('info', 'Please enter a campaign name.');
      return;
    }
    if (campaignData.contextMode === 'NONE' && !campaignData.additionalDirection.trim()) {
      notify('info', 'Please provide research direction when using No Company Context.');
      return;
    }
    if (campaignData.campaignTypes.length > 1) {
      const total = Object.values(campaignData.campaignWeights).reduce((a, b) => a + b, 0);
      if (total !== 100) {
        notify('info', `Campaign weights must sum to 100. Current total: ${total}%`);
        return;
      }
    }

    setIsLoading(true);
    try {
      const newCampaignId = uuidv4();
      const buildMode = mapContextModeToBuildMode(campaignData.contextMode);
      const contextScope =
        buildMode === 'focused_context' && campaignData.focusedModules.length > 0
          ? campaignData.focusedModules
          : null;

      const campaignToCreate = {
        id: newCampaignId,
        name: campaignData.name.trim(),
        description: campaignData.additionalDirection.trim() || undefined,
        status: 'planning',
        current_stage: 'planning',
        companyId: selectedCompanyId,
        build_mode: buildMode,
        context_scope: contextScope,
        campaign_types: campaignData.campaignTypes,
        campaign_weights: campaignData.campaignWeights,
        planning_context: {
          context_mode: campaignData.contextMode,
          focused_modules: campaignData.focusedModules,
          additional_direction: campaignData.additionalDirection.trim() || undefined,
          target_regions:
            campaignData.regionInput.trim()
              ? campaignData.regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
              : undefined,
        },
      };

      const response = await fetchWithAuth('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignToCreate),
      });

      if (response.ok) {
        const params = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : '';
        router.push(`/campaign-details/${newCampaignId}${params}`);
      } else {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        const details = err?.details ? `: ${err.details}` : '';
        throw new Error((err?.error || 'Failed to create campaign') + details);
      }
    } catch (error) {
      console.error('Create campaign error:', error);
      notify('error', error instanceof Error ? error.message : 'Failed to create campaign');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50">
      {notice && (
        <div className="max-w-3xl mx-auto px-6 pt-4">
          <div className={`rounded-lg border px-3 py-2 text-sm ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`} role="status" aria-live="polite">{notice.message}</div>
        </div>
      )}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/campaigns')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
                Back to Campaigns
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                  Create New Campaign
                </h1>
                <p className="text-gray-600 mt-1">Essential info to start building — pre-planning and blueprint follow in campaign details</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsChatOpen(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                AI Assistant
              </button>
              <button
                onClick={() => router.push('/campaigns')}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl p-8 shadow-sm border mb-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name *</label>
            <input
              type="text"
              value={campaignData.name}
              onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="Enter campaign name"
            />
          </div>

          {selectedCompanyId && (
            <EngineContextPanel companyId={selectedCompanyId} fetchWithAuth={fetchWithAuth} />
          )}

          <UnifiedContextModeSelector
            mode={campaignData.contextMode}
            modules={campaignData.focusedModules}
            additionalDirection={campaignData.additionalDirection}
            onModeChange={(m) => setCampaignData({ ...campaignData, contextMode: m })}
            onModulesChange={(m) => setCampaignData({ ...campaignData, focusedModules: m })}
            onAdditionalDirectionChange={(v) => setCampaignData({ ...campaignData, additionalDirection: v })}
            requireDirectionWhenNone={true}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Types (multi-select)</label>
            <div className="flex flex-wrap gap-2">
              {CAMPAIGN_TYPES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleCampaignType(id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                    campaignData.campaignTypes.includes(id)
                      ? 'bg-green-100 border-green-300 text-green-800'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {campaignData.campaignTypes.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-4">
                {campaignData.campaignTypes.map((t) => (
                  <div key={t} className="flex items-center gap-2">
                    <label className="text-sm whitespace-nowrap">{CAMPAIGN_TYPES.find((c) => c.id === t)?.label ?? t}</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={campaignData.campaignWeights[t] ?? 0}
                      onChange={(e) => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
                        setCampaignData({
                          ...campaignData,
                          campaignWeights: { ...campaignData.campaignWeights, [t]: v },
                        });
                      }}
                      className="w-16 px-2 py-1 border rounded"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                ))}
                <span className={`text-xs ${Object.values(campaignData.campaignWeights).reduce((a, b) => a + b, 0) === 100 ? 'text-green-600' : 'text-red-600'}`}>
                  Total: {Object.values(campaignData.campaignWeights).reduce((a, b) => a + b, 0)}%
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Geography (optional)</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Target Regions (ISO country codes, comma separated)</label>
              <input
                type="text"
                value={campaignData.regionInput}
                onChange={(e) => {
                  setCampaignData({ ...campaignData, regionInput: e.target.value });
                  const parts = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
                  const invalid = parts.filter((p) => p.length !== 2);
                  setRegionWarning(invalid.length > 0 ? 'Some codes are not 2-letter ISO codes.' : null);
                }}
                placeholder="IN, US, GB"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use 2-letter ISO country codes. Example: IN (India), US (United States), GB (United Kingdom).
                Leave empty for company default geography.
              </p>
              {regionWarning && <p className="mt-1 text-xs text-amber-600">{regionWarning}</p>}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Check country codes</label>
              <input
                type="text"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                placeholder="Type country name..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
              />
              {countrySearch.trim() && (
                <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-auto">
                  {ISO_COUNTRIES.filter((c) =>
                    c.name.toLowerCase().includes(countrySearch.trim().toLowerCase())
                  ).map((c) => (
                    <li key={c.code}>
                      <button
                        type="button"
                        onClick={() => {
                          const current = campaignData.regionInput.split(',').map((r) => r.trim()).filter(Boolean);
                          const next = current.includes(c.code) ? current : [...current, c.code];
                          setCampaignData({ ...campaignData, regionInput: next.join(', ') });
                          setCountrySearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {c.name} ({c.code})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border">
          <p className="text-gray-600 mb-4">
            After creation, you&apos;ll complete pre-planning (start date, duration, content capacity) and generate the campaign blueprint in campaign details.
          </p>
          <button
            onClick={createCampaign}
            disabled={isLoading || !campaignData.name?.trim()}
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-semibold flex items-center justify-center gap-3"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Create Campaign
          </button>
        </div>
      </div>

      {isChatOpen && (
        <CampaignAIChat
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          onMinimize={() => setIsChatOpen(false)}
          context="campaign-creation"
          campaignId={null}
          companyId={selectedCompanyId}
          campaignData={{
            name: campaignData.name,
            description: campaignData.additionalDirection,
            context_mode: campaignData.contextMode,
            focused_modules: campaignData.focusedModules,
            campaign_types: campaignData.campaignTypes,
            target_regions: campaignData.regionInput.trim()
              ? campaignData.regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
              : undefined,
          }}
        />
      )}
    </div>
  );
}
