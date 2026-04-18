import React, { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  Building2,
  Calendar,
  FileText,
  LayoutGrid,
  Search,
  Loader2,
  ExternalLink,
  MessageSquare,
  Save,
  FolderOpen,
  CalendarDays,
  ListTodo,
  Target,
  Plus,
  X,
} from 'lucide-react';
import { useCompanyContext } from './CompanyContext';
import RecommendationBlueprintCard from './recommendations/cards/RecommendationBlueprintCard';

type CompanyHit = { company_id: string; name: string };
type CampaignHit = { id: string; name: string; company_id: string };
type RecommendationHit = {
  id: string;
  campaign_id: string | null;
  company_id: string;
  trend_topic: string;
};

type WeekPlan = { weekNumber?: number; week?: number; theme?: string; focusArea?: string };
type DailyActivity = {
  id: string;
  execution_id: string;
  week_number: number;
  day: string;
  title: string;
  platform: string;
  content_type: string;
};

const TABS = [
  { id: 'company-profile', label: 'Company profile', icon: Building2 },
  { id: 'strategic-inputs', label: 'Strategic inputs', icon: Target },
  { id: 'campaigns', label: 'Campaigns', icon: FolderOpen },
  { id: 'recommendation-cards', label: 'Recommendation cards', icon: MessageSquare },
  { id: 'weekly-plan', label: 'Weekly plan', icon: Calendar },
  { id: 'daily-plan', label: 'Daily plan', icon: CalendarDays },
  { id: 'activity-workspace', label: 'Activity workspace', icon: LayoutGrid },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Which tab is the "furthest" unlocked based on current selection. Flow: company → campaigns → recommendation cards → weekly plan → daily plan → activity workspace. */
function getUnlockedTab(
  currentCompanyId: string | null,
  currentCampaignId: string | null,
  selectedWeek: number | null,
  selectedActivity: DailyActivity | null
): TabId {
  if (selectedActivity) return 'activity-workspace';
  if (selectedWeek != null) return 'daily-plan';
  if (currentCampaignId) return 'weekly-plan';
  if (currentCompanyId) return 'campaigns'; // after company profile only Campaigns is active; rest frozen
  return 'company-profile';
}

const TAB_ORDER: TabId[] = [
  'company-profile',
  'strategic-inputs',
  'campaigns',
  'recommendation-cards',
  'weekly-plan',
  'daily-plan',
  'activity-workspace',
];

function isTabUnlocked(tabId: TabId, unlocked: TabId): boolean {
  const idx = TAB_ORDER.indexOf(tabId);
  const unlockedIdx = TAB_ORDER.indexOf(unlocked);
  return idx <= unlockedIdx;
}

import type { useContentArchitect } from '../hooks/useContentArchitect';
type S = ReturnType<typeof useContentArchitect>;
export default function ContentArchitectView({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    activeTab,
    campaigns,
    companies,
    companyCampaigns,
    companyCampaignsLoadError,
    companyCampaignsLoading,
    contextSaveMessage,
    currentCampaignId,
    currentCompanyId,
    dailyActivities,
    dailyActivitiesLoading,
    error,
    geographyDisplay,
    handleSelectCampaign,
    handleSelectCompany,
    handleSelectRecommendation,
    isContentArchitect,
    isLoading,
    offeringsByAspect,
    recommendationContext,
    recommendationContextLoaded,
    recommendations,
    router,
    runSearch,
    saveRecommendationContext,
    saveStrategicInputs,
    savingContext,
    searchQuery,
    searching,
    selectedActivity,
    selectedCampaign,
    selectedCompany,
    selectedRecommendation,
    selectedWeek,
    setActiveTab,
    setCampaigns,
    setCompanies,
    setCompanyCampaigns,
    setCompanyCampaignsLoadError,
    setCompanyCampaignsLoading,
    setContextSaveMessage,
    setDailyActivities,
    setDailyActivitiesLoading,
    setError,
    setGeographyDisplay,
    setOfferingsByAspect,
    setRecommendationContext,
    setRecommendationContextLoaded,
    setRecommendations,
    setSavingContext,
    setSearchQuery,
    setSearching,
    setSelectedActivity,
    setSelectedCampaign,
    setSelectedCompany,
    setSelectedCompanyId,
    setSelectedRecommendation,
    setSelectedWeek,
    setShowStoredCard,
    setSourceRecommendationCard,
    setSourceRecommendationCardLoading,
    setStrategicAspects,
    setStrategicInputSubTab,
    setStrategicInputsLoaded,
    setStrategicInputsSaveErrorDetail,
    setStrategicInputsSaveMessage,
    setStrategicInputsSaving,
    setStrategicObjectives,
    setWeeklyPlans,
    setWeeklyPlansLoading,
    showStoredCard,
    sourceRecommendationCard,
    sourceRecommendationCardLoading,
    strategicAspects,
    strategicInputSubTab,
    strategicInputsLoaded,
    strategicInputsSaveErrorDetail,
    strategicInputsSaveMessage,
    strategicInputsSaving,
    strategicObjectives,
    userRole,
    weeklyPlans,
    weeklyPlansLoading,
  } = d;

    return (
    <>
      <Head>
        <title>Content Architect — Search &amp; open by ID</title>
      </Head>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Content Architect</h1>
        <p className="text-gray-600 mb-6">
          Search by <strong>company ID</strong>, name, or website URL; <strong>campaign ID</strong> or name; or <strong>recommendation ID</strong>. You can paste any ID directly (e.g. company ID or campaign ID) and it will find that entity. Select a company, campaign, or recommendation to open the tabs: Company profile, Recommendation cards, Weekly plan, Activity workspace.
        </p>

        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Paste company ID, campaign ID, or recommendation ID; or type name/URL..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            Search
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {error}
          </div>
        )}

        {(companies.length > 0 || campaigns.length > 0 || recommendations.length > 0) && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {companies.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Companies</h3>
                <ul className="space-y-1">
                  {companies.map((c) => (
                    <li key={c.company_id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCompany(c)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                          selectedCompany?.company_id === c.company_id
                            ? 'bg-indigo-100 text-indigo-800 font-medium'
                            : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate">{c.name || c.company_id}</span>
                        <span className="text-xs text-gray-500 font-mono shrink-0">{c.company_id.slice(0, 8)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {campaigns.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Campaigns</h3>
                <ul className="space-y-1">
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCampaign(c)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                          selectedCampaign?.id === c.id ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-gray-500 font-mono shrink-0">{c.id.slice(0, 8)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {recommendations.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recommendations (by ID)</h3>
                <ul className="space-y-1">
                  {recommendations.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectRecommendation(r)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex flex-col gap-0.5 ${
                          selectedRecommendation?.id === r.id ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <span className="truncate text-xs font-mono text-gray-500">{r.id.slice(0, 8)}…</span>
                        <span className="truncate">{r.trend_topic || 'Recommendation'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {currentCompanyId && (() => {
          const unlocked = getUnlockedTab(currentCompanyId, currentCampaignId, selectedWeek, selectedActivity);
          return (
          <>
            <div className="border-b border-gray-200 mb-4">
              <nav className="flex flex-wrap gap-1">
                {TABS.map((tab) => {
                  const enabled = isTabUnlocked(tab.id, unlocked);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => enabled && setActiveTab(tab.id)}
                      disabled={!enabled}
                      className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        activeTab === tab.id
                          ? 'border-indigo-600 text-indigo-600'
                          : enabled
                            ? 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                            : 'border-transparent text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <tab.icon className="h-4 w-4 shrink-0" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 min-h-[280px]">
              {activeTab === 'company-profile' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    Open the full company profile to view and refine company details.
                  </p>
                  <a
                    href={`/company-profile?companyId=${encodeURIComponent(currentCompanyId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                  >
                    <FileText className="h-4 w-4" />
                    Open company profile
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              )}

              {activeTab === 'strategic-inputs' && (
                <div className="space-y-6">
                  <p className="text-gray-600">
                    Structure strategic aspects, offering focus, and objectives for this company. These will appear on the Trend Campaigns page for company admins.
                  </p>
                  {!strategicInputsLoaded ? (
                    <div className="flex items-center gap-2 text-gray-500 py-6">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Loading…</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
                        {(['aspect', 'offering', 'objectives', 'geography'] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setStrategicInputSubTab(tab)}
                            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                              strategicInputSubTab === tab
                                ? 'bg-indigo-100 text-indigo-800 border border-b-0 border-gray-200 -mb-px'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                            }`}
                          >
                            {tab === 'aspect' && 'Strategic aspect'}
                            {tab === 'offering' && 'Offering focus'}
                            {tab === 'objectives' && 'Strategic objectives'}
                            {tab === 'geography' && 'Geography'}
                          </button>
                        ))}
                      </div>

                      {strategicInputSubTab === 'aspect' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic aspect</h3>
                          <p className="text-xs text-gray-500 mb-3">Add or remove aspects. These options will appear on Trend Campaigns.</p>
                          <ul className="space-y-2 mb-3">
                            {[...strategicAspects]
                              .map((item, idx) => ({ item, idx }))
                              .sort((a, b) => String(a.item).trim().toLowerCase().localeCompare(String(b.item).trim().toLowerCase()))
                              .map(({ item, idx }) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => setStrategicAspects((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                                    placeholder="Aspect label"
                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                                  />
                                  <button type="button" onClick={() => setStrategicAspects((prev) => prev.filter((_, i) => i !== idx))} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Delete"><X className="h-4 w-4" /></button>
                                </li>
                              ))}
                          </ul>
                          <button type="button" onClick={() => setStrategicAspects((prev) => [...prev, ''])} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"><Plus className="h-4 w-4" /> Add</button>
                        </section>
                      )}

                      {strategicInputSubTab === 'offering' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Offering focus</h3>
                          <p className="text-xs text-gray-500 mb-3">Per strategic aspect: add or remove offering options.</p>
                          {strategicAspects.filter(Boolean).length === 0 ? (
                            <p className="text-sm text-gray-500">Add at least one strategic aspect in the Strategic aspect tab first.</p>
                          ) : (
                            <div className="space-y-4">
                              {[...strategicAspects]
                                .filter(Boolean)
                                .sort((a, b) => String(a).trim().toLowerCase().localeCompare(String(b).trim().toLowerCase()))
                                .map((aspect) => (
                                  <div key={aspect} className="bg-white rounded-lg border border-gray-200 p-3">
                                    <h4 className="text-xs font-medium text-gray-600 mb-2">{aspect}</h4>
                                    <ul className="space-y-1.5 mb-2">
                                      {[...(offeringsByAspect[aspect] ?? [])]
                                        .map((off, oidx) => ({ off, oidx }))
                                        .sort((a, b) => String(a.off).trim().toLowerCase().localeCompare(String(b.off).trim().toLowerCase()))
                                        .map(({ off, oidx }) => (
                                          <li key={oidx} className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={off}
                                              onChange={(e) => setOfferingsByAspect((prev) => ({
                                                ...prev,
                                                [aspect]: (prev[aspect] ?? []).map((x, i) => (i === oidx ? e.target.value : x)),
                                              }))}
                                              placeholder="Offering"
                                              className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm"
                                            />
                                            <button type="button" onClick={() => setOfferingsByAspect((prev) => ({ ...prev, [aspect]: (prev[aspect] ?? []).filter((_, i) => i !== oidx) }))} className="p-1.5 text-red-600 hover:bg-red-50 rounded" aria-label="Delete"><X className="h-3.5 w-3.5" /></button>
                                          </li>
                                        ))}
                                    </ul>
                                    <button type="button" onClick={() => setOfferingsByAspect((prev) => ({ ...prev, [aspect]: [...(prev[aspect] ?? []), ''] }))} className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800"><Plus className="h-3.5 w-3.5" /> Add offering</button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </section>
                      )}

                      {strategicInputSubTab === 'objectives' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic objectives</h3>
                          <p className="text-xs text-gray-500 mb-3">Add or remove objectives. These options will appear on Trend Campaigns.</p>
                          <ul className="space-y-2 mb-3">
                            {[...strategicObjectives]
                              .map((item, idx) => ({ item, idx }))
                              .sort((a, b) => String(a.item).trim().toLowerCase().localeCompare(String(b.item).trim().toLowerCase()))
                              .map(({ item, idx }) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => setStrategicObjectives((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                                    placeholder="Objective label"
                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                                  />
                                  <button type="button" onClick={() => setStrategicObjectives((prev) => prev.filter((_, i) => i !== idx))} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Delete"><X className="h-4 w-4" /></button>
                                </li>
                              ))}
                          </ul>
                          <button type="button" onClick={() => setStrategicObjectives((prev) => [...prev, ''])} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"><Plus className="h-4 w-4" /> Add</button>
                        </section>
                      )}

                      {strategicInputSubTab === 'geography' && (
                        <section className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                          <h3 className="text-sm font-semibold text-gray-800 mb-2">Geography</h3>
                          <p className="text-xs text-gray-500 mb-2">Fixed from company profile (read-only). Edit on Company profile if needed.</p>
                          <p className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700">{geographyDisplay || '—'}</p>
                        </section>
                      )}

                      <div className="flex items-center gap-3">
                        <button type="button" onClick={saveStrategicInputs} disabled={strategicInputsSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
                          {strategicInputsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                        </button>
                        {strategicInputsSaveMessage === 'saved' && <span className="text-sm text-green-600">Saved. Changes will reflect on Trend Campaigns.</span>}
                        {strategicInputsSaveMessage === 'error' && (
                          <span className="text-sm text-red-600">
                            Failed to save.{strategicInputsSaveErrorDetail ? ` ${strategicInputsSaveErrorDetail}` : ''}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'campaigns' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    Select a campaign to open recommendation cards for that campaign.
                  </p>
                  {companyCampaignsLoading ? (
                    <div className="flex items-center gap-2 text-gray-500 py-6">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Loading campaigns…</span>
                    </div>
                  ) : companyCampaignsLoadError ? (
                    <p className="text-red-600 py-4">{companyCampaignsLoadError}</p>
                  ) : companyCampaigns.length === 0 ? (
                    <div className="text-gray-500 py-4 space-y-2">
                      <p>No campaigns found for this company. Create one from the company profile or recommendations.</p>
                      <p className="text-sm">
                        Or search above by <strong>campaign ID</strong> or <strong>campaign name</strong> to open a campaign directly (paste any ID or type a name and select from results).
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {companyCampaigns.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectCampaign(c)}
                            className={`w-full text-left px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-2 transition-colors ${
                              selectedCampaign?.id === c.id
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                            }`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-xs text-gray-500 font-mono shrink-0">{c.id.slice(0, 8)}…</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === 'recommendation-cards' && (
                <div className="space-y-6">
                  <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">
                      Company context for recommendations (this company only)
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Add or edit context that will be used only for this company when generating Trend Campaigns and recommendations. Saved here and applied from the next run onwards.
                    </p>
                    {!recommendationContextLoaded ? (
                      <div className="flex items-center gap-2 text-gray-500 py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading…</span>
                      </div>
                    ) : (
                      <>
                        <textarea
                          value={recommendationContext}
                          onChange={(e) => setRecommendationContext(e.target.value)}
                          placeholder="e.g. Prefer B2B angles; avoid crypto. Focus on SMB pain points in EMEA."
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y"
                        />
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={saveRecommendationContext}
                            disabled={savingContext}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {savingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save
                          </button>
                          {contextSaveMessage === 'saved' && (
                            <span className="text-sm text-green-600">Saved. Used for this company from next run.</span>
                          )}
                          {contextSaveMessage === 'error' && (
                            <span className="text-sm text-red-600">Failed to save. Try again.</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-600 mb-3">
                      {currentCampaignId
                        ? 'Recommendation cards for the selected campaign. Use the option below to view the strategic theme card linked to this campaign.'
                        : 'Select a campaign from the Campaigns tab (or from search) to see recommendation cards.'}
                    </p>
                    {currentCampaignId && (
                      <>
                        {sourceRecommendationCardLoading ? (
                          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-2 text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">Checking for linked strategic theme card…</span>
                          </div>
                        ) : sourceRecommendationCard?.source_strategic_theme ? (
                          <div className="mb-6">
                            <button
                              type="button"
                              onClick={() => setShowStoredCard((v) => !v)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium border border-indigo-600 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                            >
                              <MessageSquare className="h-4 w-4" />
                              {showStoredCard ? 'Hide strategic theme card' : 'View strategic theme card'}
                            </button>
                            {showStoredCard && (
                              <div className="mt-4">
                                <p className="text-sm text-gray-600 mb-3">
                                  Strategic theme card stored when &quot;Build Campaign Blueprint&quot; was clicked. This is the card used to create this campaign&apos;s blueprint.
                                </p>
                                <RecommendationBlueprintCard
                                  recommendation={{
                                    ...sourceRecommendationCard.source_strategic_theme,
                                    ...(sourceRecommendationCard.source_recommendation_id
                                      ? { id: sourceRecommendationCard.source_recommendation_id }
                                      : {}),
                                  }}
                                  onBuildCampaignBlueprint={undefined}
                                  onMarkLongTerm={undefined}
                                  onArchive={undefined}
                                  viewMode="FULL"
                                />
                              </div>
                            )}
                          </div>
                        ) : sourceRecommendationCard?.source_recommendation_id ? (
                          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
                            <p className="text-sm text-gray-500">Recommendation ID linked: {sourceRecommendationCard.source_recommendation_id}</p>
                            <p className="text-xs text-gray-400 mt-1">Full card data was not stored for this campaign.</p>
                          </div>
                        ) : !sourceRecommendationCardLoading && sourceRecommendationCard === null ? (
                          <p className="text-sm text-gray-500 mb-4">
                            No strategic theme card stored for this campaign. Create a campaign from a recommendation card (use &quot;Build Campaign Blueprint&quot; on Trend Campaigns) to link one.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-3 items-center">
                          <button
                            type="button"
                            onClick={() => setActiveTab('weekly-plan')}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200 border border-gray-300"
                          >
                            <Calendar className="h-4 w-4" />
                            View weekly plan
                          </button>
                        </div>
                      </>
                    )}
                    {!currentCampaignId && (
                      <p className="text-gray-500 text-sm">Go to the Campaigns tab and select a campaign first.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'weekly-plan' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    {currentCampaignId
                      ? 'Select a week to open the daily plan for that week.'
                      : 'Select a campaign from the Campaigns tab first.'}
                  </p>
                  {currentCampaignId && (
                    <>
                      {weeklyPlansLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 py-6">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>Loading weekly plan…</span>
                        </div>
                      ) : weeklyPlans.length === 0 ? (
                        <p className="text-gray-500 py-4">No weekly plan yet. Open the daily plan page to generate one, or create a blueprint from recommendations.</p>
                      ) : (
                        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {weeklyPlans.map((w) => {
                            const weekNum = w.weekNumber ?? w.week ?? 0;
                            return (
                              <li key={weekNum}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedWeek(weekNum);
                                    setActiveTab('daily-plan');
                                  }}
                                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                                    selectedWeek === weekNum
                                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                      : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                                  }`}
                                >
                                  <span className="font-medium">Week {weekNum}</span>
                                  {w.theme && <span className="block text-xs text-gray-500 truncate mt-0.5">{w.theme}</span>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <a
                        href={`/campaign-daily-plan/${currentCampaignId}?companyId=${encodeURIComponent(currentCompanyId || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-4 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Open full weekly / daily plan in new tab
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'daily-plan' && (
                <div>
                  <p className="text-gray-600 mb-4">
                    {selectedWeek != null
                      ? `Activities for Week ${selectedWeek}. Click an activity to open its workspace.`
                      : 'Select a week in the Weekly plan tab first.'}
                  </p>
                  {selectedWeek != null && currentCampaignId && (
                    <>
                      {dailyActivitiesLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 py-6">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>Loading activities…</span>
                        </div>
                      ) : dailyActivities.length === 0 ? (
                        <p className="text-gray-500 py-4">No activities for this week yet. Generate the weekly structure from the daily plan page.</p>
                      ) : (
                        <ul className="space-y-2">
                          {dailyActivities.map((a) => (
                            <li key={a.execution_id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedActivity(a);
                                  setActiveTab('activity-workspace');
                                }}
                                className={`w-full text-left px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-2 transition-colors ${
                                  selectedActivity?.execution_id === a.execution_id
                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-medium'
                                    : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-800'
                                }`}
                              >
                                <span className="truncate">{a.title}</span>
                                <span className="text-xs text-gray-500 shrink-0">
                                  {a.day} · {a.platform} · {a.content_type}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedWeek(null)}
                        className="mt-4 text-sm text-gray-500 hover:text-gray-700"
                      >
                        ← Back to weekly plan
                      </button>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'activity-workspace' && (
                <div className="min-h-[400px] flex flex-col">
                  {selectedActivity && currentCampaignId ? (
                    <>
                      <p className="text-gray-600 mb-3">
                        Activity: <strong>{selectedActivity.title}</strong> (Week {selectedActivity.week_number}, {selectedActivity.day})
                      </p>
                      <div className="flex-1 min-h-[360px] rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                        <iframe
                          title="Activity workspace"
                          src={`/activity-workspace?workspaceKey=${encodeURIComponent(`activity-workspace-${currentCampaignId}-${selectedActivity.execution_id}`)}`}
                          className="w-full h-full min-h-[360px] border-0"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedActivity(null)}
                        className="mt-3 text-sm text-gray-500 hover:text-gray-700"
                      >
                        ← Back to daily plan
                      </button>
                    </>
                  ) : (
                    <div>
                      <p className="text-gray-600 mb-4">
                        Click an activity in the Daily plan tab to open its workspace here.
                      </p>
                      {currentCampaignId && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('daily-plan')}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200"
                        >
                          <ListTodo className="h-4 w-4" />
                          Go to Daily plan
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
          );
        })()}

        {!currentCompanyId && (companies.length > 0 || campaigns.length > 0 || recommendations.length > 0) && (
          <p className="text-sm text-gray-500 mt-4">Select a company, campaign, or recommendation above to see tabs.</p>
        )}
      </div>
    </>
  );
}

