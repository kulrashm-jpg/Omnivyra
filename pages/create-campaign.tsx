import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  Plus,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import CampaignAIChat from '../components/CampaignAIChat';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import EngineContextPanel from '../components/recommendations/EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../components/recommendations/engine-framework/UnifiedContextModeSelector';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  buildHierarchicalPayload,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../lib/campaignTypeHierarchy';

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

interface CampaignData {
  name: string;
  contextMode: ContextMode;
  focusedModules: FocusModule[];
  additionalDirection: string;
  /** Hierarchical: one primary (mutually exclusive). */
  primaryCampaignType: PrimaryCampaignTypeId | null;
  /** Secondary options (only shown after primary; skipped for Third-Party). */
  secondaryCampaignTypes: SecondaryOptionId[];
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
    primaryCampaignType: 'brand_awareness',
    secondaryCampaignTypes: [],
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

  const hierarchicalPayload = useMemo(() => {
    const primary = campaignData.primaryCampaignType ?? 'brand_awareness';
    return buildHierarchicalPayload(primary, campaignData.secondaryCampaignTypes);
  }, [campaignData.primaryCampaignType, campaignData.secondaryCampaignTypes]);

  const dilutionSeverity = useMemo(
    () =>
      campaignData.primaryCampaignType && campaignData.secondaryCampaignTypes.length > 0
        ? getDilutionSeverity(campaignData.primaryCampaignType, campaignData.secondaryCampaignTypes)
        : 'none',
    [campaignData.primaryCampaignType, campaignData.secondaryCampaignTypes]
  );

  const selectPrimary = (id: PrimaryCampaignTypeId) => {
    setCampaignData((prev) => ({
      ...prev,
      primaryCampaignType: id,
      secondaryCampaignTypes: id === 'third_party' ? [] : prev.secondaryCampaignTypes,
    }));
  };

  const toggleSecondary = (id: SecondaryOptionId) => {
    setCampaignData((prev) => {
      if (!prev.primaryCampaignType || prev.primaryCampaignType === 'third_party') return prev;
      const has = prev.secondaryCampaignTypes.includes(id);
      const next = has
        ? prev.secondaryCampaignTypes.filter((t) => t !== id)
        : [...prev.secondaryCampaignTypes, id];
      return { ...prev, secondaryCampaignTypes: next };
    });
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
        campaign_types: hierarchicalPayload.campaign_types,
        campaign_weights: hierarchicalPayload.campaign_weights,
        planning_context: {
          context_mode: campaignData.contextMode,
          focused_modules: campaignData.focusedModules,
          additional_direction: campaignData.additionalDirection.trim() || undefined,
          target_regions:
            campaignData.regionInput.trim()
              ? campaignData.regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
              : undefined,
          primary_campaign_type: campaignData.primaryCampaignType ?? undefined,
          secondary_campaign_types: campaignData.secondaryCampaignTypes.length > 0 ? campaignData.secondaryCampaignTypes : undefined,
          context: hierarchicalPayload.context,
          mapped_core_types: hierarchicalPayload.mapped_core_types,
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

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Primary campaign focus (choose one)</label>
              <p className="text-xs text-gray-500 mb-3">Select your main objective. This locks the context for supporting options.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRIMARY_OPTIONS.map((opt) => {
                  const selected = campaignData.primaryCampaignType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectPrimary(opt.id)}
                      className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-colors ${
                        selected
                          ? 'border-green-500 bg-green-50 text-green-800'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {campaignData.primaryCampaignType && campaignData.primaryCampaignType !== 'third_party' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {isPersonalBrandPrimary(campaignData.primaryCampaignType)
                    ? 'Supporting goals (optional)'
                    : 'Supporting goals (optional)'}
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Add compatible objectives. These feed into the same recommendation engine.
                </p>
                {isPersonalBrandPrimary(campaignData.primaryCampaignType) ? (
                  <div className="space-y-4">
                    {PERSONAL_BRAND_SECONDARY_GROUPS.map((group) => (
                      <div key={group.label}>
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{group.label}</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {group.options.map((opt) => {
                            const selected = campaignData.secondaryCampaignTypes.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => toggleSecondary(opt.id)}
                                className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                                  selected ? 'bg-green-100 border-green-300 text-green-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {getSecondaryOptionsForPrimary(campaignData.primaryCampaignType).map((opt) => {
                      const selected = campaignData.secondaryCampaignTypes.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggleSecondary(opt.id)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                            selected ? 'bg-green-100 border-green-300 text-green-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {campaignData.primaryCampaignType === 'third_party' && (
              <p className="text-sm text-gray-600 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                Third-party campaign: no further options. Recommendations will be generic collaboration/distribution-focused.
              </p>
            )}

            {dilutionSeverity !== 'none' && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  dilutionSeverity === 'caution'
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-indigo-200 bg-indigo-50 text-indigo-800'
                }`}
                role="status"
              >
                {dilutionSeverity === 'caution'
                  ? 'These goals may dilute campaign focus. Consider selecting a primary campaign focus.'
                  : 'These goals may dilute campaign focus. Consider selecting a primary campaign focus.'}
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
            campaign_types: hierarchicalPayload.campaign_types,
            target_regions: campaignData.regionInput.trim()
              ? campaignData.regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
              : undefined,
          }}
        />
      )}
    </div>
  );
}
