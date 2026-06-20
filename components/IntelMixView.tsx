/**
 * Command Center → Intelligent Mix Strategy
 *
 * Collects: goals, audience, format mix (text + creator), per-format frequency,
 * campaign start date and duration (1–12 weeks) — then hands off to the
 * Trend Campaigns page where AI enriches the plan further.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { CORE_AUDIENCE_LABELS } from '../lib/shared/audience/audienceRegistry';
import { useCompanyContext } from './CompanyContext';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import UnifiedContextModeSelector, {
  type ContextMode,
  type FocusModule,
} from './recommendations/engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from './recommendations/engine-framework/StrategicAspectSelector';
import OfferingFacetSelector from './recommendations/engine-framework/OfferingFacetSelector';
import { BoltCampaignChat } from './bolt/BoltCampaignChat';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';
import BoltPlatformPicker from './bolt/BoltPlatformPicker';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../lib/campaignTypeHierarchy';

type TextFormat = 'post' | 'article' | 'newsletter' | 'short_story' | 'white_paper';
type CreatorFormat = 'video' | 'reel' | 'carousel' | 'image' | 'podcast' | 'short' | 'story';

export const INTELLIGENT_MIX_STATE_KEY = 'intelligent-mix-strategy-state';

export type IntelligentMixState = {
  audience: string[];
  textFormats: TextFormat[];
  creatorFormats: CreatorFormat[];
  textFrequency: Record<string, number>;
  creatorFrequency: Record<string, number>;
  duration: number;
  startDate: string;
  extraContext: string;
  communicationStyle: string[];
  primaryCampaignType: PrimaryCampaignTypeId;
  secondaryCampaignTypes?: SecondaryOptionId[];
  contextMode?: ContextMode;
  focusedModules?: FocusModule[];
  additionalDirection?: string;
  selectedAspects?: string[];
  selectedFacets?: string[];
  strategicText?: string;
  regionsInput?: string;
  autoGenerateThemes?: boolean;
};

type StrategicConfig = {
  strategic_aspects: string[];
  aspect_offerings_map: Record<string, string[]>;
  offerings_by_aspect?: Record<string, string[]>;
};

type Suggestion = {
  id: string;
  topic: string;
  suggested_campaign_title: string;
  opportunity_score: number | null;
  suggested_duration: number;
};

const AUDIENCE_OPTIONS = CORE_AUDIENCE_LABELS;

const TEXT_FORMATS: { value: TextFormat; label: string; icon: string }[] = [
  { value: 'post',        label: 'Post',        icon: '📝' },
  { value: 'article',     label: 'Article',     icon: '🗞️' },
  { value: 'newsletter',  label: 'Newsletter',  icon: '✉️' },
  { value: 'short_story', label: 'Short Story', icon: '📖' },
  { value: 'white_paper', label: 'White Paper', icon: '📄' },
];

const CREATOR_FORMATS: { value: CreatorFormat; label: string; icon: string }[] = [
  { value: 'video',    label: 'Video',    icon: '🎬' },
  { value: 'reel',     label: 'Reel',     icon: '🎥' },
  { value: 'carousel', label: 'Carousel', icon: '🖼️' },
  { value: 'image',    label: 'Image',    icon: '📸' },
  { value: 'podcast',  label: 'Podcast',  icon: '🎙️' },
  { value: 'short',    label: 'Short',    icon: '⚡' },
  { value: 'story',    label: 'Story',    icon: '📱' },
];

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

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
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
];

function matchCountry(input: string, country: { name: string; code: string }): boolean {
  const q = input.trim().toLowerCase();
  if (!q) return false;
  if (country.code.toLowerCase() === q) return true;
  if (q.length <= 2) return false;
  return country.name.toLowerCase().startsWith(q);
}

function ChipButton({
  label, selected, onClick, icon,
}: { label: string; selected: boolean; onClick: () => void; icon?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
        selected
          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
          : 'bg-white text-gray-700 border-gray-300 hover:border-teal-400 hover:text-teal-700'
      }`}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

function FreqStepper({
  value, onChange, min = 1, max = 7,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-50 disabled:opacity-30"
      >−</button>
      <span className="w-6 text-center text-sm font-semibold text-gray-800">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-50 disabled:opacity-30"
      >+</button>
      <span className="text-xs text-gray-400 ml-0.5">/wk</span>
    </div>
  );
}

import type { useIntelMix } from '../hooks/useIntelMix';
type S = ReturnType<typeof useIntelMix>;
export default function IntelMixView({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    additionalDirection,
    applySuggestion,
    aspectOfferingsMap,
    aspects,
    audience,
    authChecked,
    canContinue,
    communicationStyle,
    contextMode,
    creatorFormats,
    creatorFrequency,
    dilutionSeverity,
    duration,
    durationWeeks,
    extraContext,
    focusedModules,
    handleContinue,
    isLoading,
    offeringFacetCards,
    offeringsForSelectedAspect,
    primaryCampaignType,
    regionInput,
    router,
    secondaryCampaignTypes,
    selectPrimary,
    selectedAspects,
    selectedCompanyId,
    selectedCompanyName,
    selectedFacets,
    setAdditionalDirection,
    setAudience,
    setCommunicationStyle,
    setContextMode,
    setCreatorFormats,
    setCreatorFreq,
    setCreatorFrequency,
    setDuration,
    setExtraContext,
    setFocusedModules,
    setPrimaryCampaignType,
    setRegionInput,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowChat,
    setStartDate,
    setStrategicConfig,
    setStrategicText,
    setSuggestions,
    setSuggestionsLoading,
    setTextFormats,
    setTextFreq,
    setTextFrequency,
    showChat,
    sourceContentToken,
    sourcePayload,
    startDate,
    strategicConfig,
    strategicText,
    suggestions,
    suggestionsLoading,
    textFormats,
    textFrequency,
    toggleSecondary,
    totalPerWeek,
    user,
    selectedPlatforms,
    togglePlatform,
    availablePlatforms,
    platformHidden,
    platformsLoading,
    platformBlocked,
  } = d;

    return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Back */}
        <button
          onClick={() => router.push('/command-center/campaigns')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Campaign Modes
        </button>

        {/* Header */}
        <div className="text-center">
          <div className="text-5xl mb-3">🤖</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Intelligent Mix</h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Set your campaign parameters. The AI will recommend the best content mix from live trend signals and guide you through the build.
          </p>
        </div>

        {sourcePayload && (
            <div className="rounded-2xl border border-gray-200 bg-teal-50/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">Source Content Loaded</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-xs text-gray-600">
              The campaign topic and extra context were prefilled from this {sourcePayload.contentType}. You can now shape the mix around it.
            </p>
          </div>
        )}

        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">

          <div className="p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Strategic setup</h2>
              <p className="text-xs text-gray-400">Choose context mode, strategic focus, company offerings, geography, and the campaign topic before theme generation.</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-4 space-y-3">
              <UnifiedContextModeSelector
                mode={contextMode}
                modules={focusedModules}
                additionalDirection={additionalDirection}
                onModeChange={setContextMode}
                onModulesChange={setFocusedModules}
                onAdditionalDirectionChange={setAdditionalDirection}
                requireDirectionWhenNone={true}
              />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-slate-50 p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                      Campaign Topic
                    </label>
                    <p className="text-xs text-gray-400">Describe what this campaign should be about.</p>
                  </div>
                  <textarea
                    value={strategicText}
                    onChange={(e) => setStrategicText(e.target.value)}
                    rows={5}
                    placeholder="e.g. Build brand awareness for our AI workflow platform among B2B marketers in India and the UAE."
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 placeholder:text-gray-300 bg-white"
                  />
                </div>
                <div className="rounded-xl border border-gray-200 p-4 space-y-4 bg-white">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Campaign goal <span className="text-red-500">*</span></h2>
                    <p className="text-xs text-gray-400">Choose one primary goal. Supporting goals can be layered underneath.</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {PRIMARY_OPTIONS.map((opt) => {
                      const selected = primaryCampaignType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => selectPrimary(opt.id)}
                          className={`rounded-xl border-2 px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                            selected
                              ? 'border-teal-500 bg-teal-50 text-teal-800'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-teal-300 hover:bg-gray-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {primaryCampaignType && primaryCampaignType !== 'third_party' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Supporting goals <span className="text-gray-400 font-normal">(optional)</span></label>
                      {isPersonalBrandPrimary(primaryCampaignType) ? (
                        <div className="space-y-3">
                          {PERSONAL_BRAND_SECONDARY_GROUPS.map((group) => (
                            <div key={group.label}>
                              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{group.label}</span>
                              <div className="flex flex-wrap gap-2 mt-1.5">
                                {group.options.map((opt) => {
                                  const sel = secondaryCampaignTypes.includes(opt.id);
                                  return (
                                    <button key={opt.id} type="button" onClick={() => toggleSecondary(opt.id)}
                                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sel ? 'bg-teal-100 border-teal-300 text-teal-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
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
                          {getSecondaryOptionsForPrimary(primaryCampaignType).map((opt) => {
                            const sel = secondaryCampaignTypes.includes(opt.id);
                            return (
                              <button key={opt.id} type="button" onClick={() => toggleSecondary(opt.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sel ? 'bg-teal-100 border-teal-300 text-teal-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {primaryCampaignType === 'third_party' && (
                    <p className="text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      Third-party campaign: recommendations will focus on generic collaboration and distribution.
                    </p>
                  )}
                  {dilutionSeverity !== 'none' && (
                    <div className={`rounded-lg border px-3 py-2 text-xs ${dilutionSeverity === 'caution' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-teal-200 bg-teal-50 text-teal-700'}`}>
                      Multiple goals may dilute focus. Consider a tighter primary objective.
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="bg-white rounded-2xl border border-teal-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Campaign Suggestions</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Click any suggestion to pre-fill the topic</p>
                    </div>
                    {suggestionsLoading && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-500" />
                    )}
                  </div>
                  <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                    {suggestionsLoading && suggestions.length === 0 && (
                      <p className="text-xs text-gray-400 py-4 text-center">Loading suggestions...</p>
                    )}
                    {!suggestionsLoading && suggestions.length === 0 && (
                      <p className="text-xs text-gray-400 py-4 text-center">No suggestions available yet.</p>
                    )}
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => applySuggestion(suggestion)}
                        className="w-full text-left rounded-xl border border-teal-100 bg-teal-50/60 hover:bg-teal-100/70 hover:border-teal-300 transition-all p-3 group"
                      >
                        <p className="text-xs font-semibold text-teal-900 line-clamp-2">{suggestion.suggested_campaign_title}</p>
                        <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{suggestion.topic}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] bg-white border border-teal-200 text-teal-700 px-2 py-0.5 rounded-full font-medium">{suggestion.suggested_duration}w</span>
                          {suggestion.opportunity_score !== null && <span className="text-[10px] text-gray-400">Score: {suggestion.opportunity_score}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowChat((value) => !value)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">AI Chat</span>
                      <div className="text-left">
                        <p className="text-xs font-bold text-gray-800">Refine Your Topic</p>
                        <p className="text-[11px] text-gray-400">Ask AI to improve or sharpen the campaign topic</p>
                      </div>
                    </div>
                    <span className="text-gray-400 text-sm">{showChat ? '▲' : '▼'}</span>
                  </button>
                  {showChat && (
                    <div className="border-t border-gray-100 flex flex-col" style={{ height: '320px' }}>
                      <BoltCampaignChat
                        companyId={selectedCompanyId}
                        context={{
                          topic: strategicText,
                          goal: PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label,
                          audience: audience.join(', '),
                          strategicFocus: selectedAspects,
                          duration,
                        }}
                        onApplySuggestion={(suggestion) => setStrategicText(suggestion.topic)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <StrategicAspectSelector
                aspects={aspects}
                selectedAspects={selectedAspects}
                onAspectsChange={setSelectedAspects}
              />
              <OfferingFacetSelector
                selectedAspect={selectedAspects.length > 0 ? selectedAspects[0] : null}
                offerings={offeringFacetCards}
                selectedFacets={selectedFacets}
                onChange={setSelectedFacets}
                mode={contextMode}
              />
            </div>
            <div className="rounded-xl border border-gray-200 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Geography</h3>
                <p className="text-xs text-gray-400">Use full country names or ISO codes, comma separated.</p>
              </div>
              <input
                type="text"
                value={regionInput}
                onChange={(e) => setRegionInput(e.target.value)}
                placeholder="e.g. India, United States, IN, US"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-300"
                autoComplete="off"
              />
              {regionInput.trim().length >= 2 && (
                <div className="flex flex-wrap gap-2">
                  {ISO_COUNTRIES.filter((country) => matchCountry(regionInput.split(',').map((part) => part.trim()).filter(Boolean).slice(-1)[0] ?? '', country))
                    .slice(0, 8)
                    .map((country) => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => {
                          const parts = regionInput.split(',').map((part) => part.trim()).filter(Boolean);
                          const prefix = parts.slice(0, -1);
                          setRegionInput([...prefix, country.code].join(', '));
                        }}
                        className="px-3 py-1.5 rounded-full border border-teal-200 bg-teal-50 text-xs font-medium text-teal-700 hover:bg-teal-100"
                      >
                        {country.name} ({country.code})
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          {false && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 p-6">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                  Campaign Topic
                </label>
                <p className="text-xs text-gray-400">Same pattern as BOLT (Text). Describe what this campaign should be about.</p>
              </div>
              <textarea
                value={strategicText}
                onChange={(e) => setStrategicText(e.target.value)}
                rows={5}
                placeholder="e.g. Build brand awareness for our AI workflow platform among B2B marketers in India and the UAE."
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 placeholder:text-gray-300"
              />
            </div>
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-2xl border border-teal-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Campaign Suggestions</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Click any suggestion to pre-fill the topic</p>
                  </div>
                  {suggestionsLoading && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-500" />
                  )}
                </div>
                <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                  {suggestionsLoading && suggestions.length === 0 && (
                    <p className="text-xs text-gray-400 py-4 text-center">Loading suggestions…</p>
                  )}
                  {!suggestionsLoading && suggestions.length === 0 && (
                    <p className="text-xs text-gray-400 py-4 text-center">No suggestions available yet.</p>
                  )}
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => applySuggestion(suggestion)}
                      className="w-full text-left rounded-xl border border-teal-100 bg-teal-50/60 hover:bg-teal-100/70 hover:border-teal-300 transition-all p-3 group"
                    >
                      <p className="text-xs font-semibold text-teal-900 line-clamp-2">{suggestion.suggested_campaign_title}</p>
                      <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{suggestion.topic}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] bg-white border border-teal-200 text-teal-700 px-2 py-0.5 rounded-full font-medium">{suggestion.suggested_duration}w</span>
                        {suggestion.opportunity_score !== null && <span className="text-[10px] text-gray-400">Score: {suggestion.opportunity_score}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowChat((value) => !value)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">AI Chat</span>
                    <div className="text-left">
                      <p className="text-xs font-bold text-gray-800">Refine Your Topic</p>
                      <p className="text-[11px] text-gray-400">Ask AI to improve or sharpen the campaign topic</p>
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm">{showChat ? '▲' : '▼'}</span>
                </button>
                {showChat && (
                  <div className="border-t border-gray-100 flex flex-col" style={{ height: '320px' }}>
                    <BoltCampaignChat
                      companyId={selectedCompanyId}
                      context={{
                        topic: strategicText,
                        goal: PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label,
                        audience: audience.join(', '),
                        strategicFocus: selectedAspects,
                        duration,
                      }}
                      onApplySuggestion={(suggestion) => setStrategicText(suggestion.topic)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Audience */}
          <div className="p-6 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Target audience <span className="text-red-500">*</span></h2>
              <p className="text-xs text-gray-400">Trend signals on the next screen will enrich this further.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.map((a) => (
                <ChipButton key={a} label={a} selected={audience.includes(a)} onClick={() => setAudience((p) => toggle(p, a))} />
              ))}
            </div>
          </div>

          {/* Communication style */}
          <div className="p-6 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Communication style <span className="text-red-500">*</span></h2>
              <p className="text-xs text-gray-400">Shapes the tone of all generated content. Pick up to 2.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['Professional', 'Conversational', 'Educational', 'Inspirational'] as const).map((v) => (
                <ChipButton
                  key={v}
                  label={v}
                  selected={communicationStyle.includes(v)}
                  onClick={() =>
                    setCommunicationStyle((prev) => {
                      if (prev.includes(v)) return prev.filter((x) => x !== v);
                      if (prev.length >= 2) return prev;
                      return [...prev, v];
                    })
                  }
                />
              ))}
            </div>
            {communicationStyle.length === 2 && (
              <p className="text-xs text-teal-600">Max 2 selected.</p>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 divide-y xl:divide-y-0 xl:divide-x divide-gray-100">
            <div className="p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Text formats <span className="text-gray-400 font-normal">(optional)</span></h2>
                <p className="text-xs text-gray-400">AI-generated written content. Set how many per week for each.</p>
              </div>
              <div className="space-y-2">
                {TEXT_FORMATS.map((f) => {
                  const selected = textFormats.includes(f.value);
                  return (
                    <div key={f.value} className={`flex items-center justify-between rounded-lg px-3 py-2 border transition-all ${selected ? 'border-teal-200 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setTextFormats((p) => toggle(p, f.value));
                          if (!textFrequency[f.value]) setTextFreq(f.value, 1);
                        }}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <span className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${selected ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 bg-white'}`}>
                          {selected ? 'âœ“' : ''}
                        </span>
                        <span className="text-sm">{f.icon}</span>
                        <span className={`text-sm font-medium ${selected ? 'text-teal-800' : 'text-gray-600'}`}>{f.label}</span>
                      </button>
                      {selected && (
                        <FreqStepper
                          value={textFrequency[f.value] ?? 1}
                          onChange={(v) => setTextFreq(f.value, v)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Creator formats <span className="text-gray-400 font-normal">(optional)</span></h2>
                <p className="text-xs text-gray-400">Media your team or creators produce. Set how many per week for each.</p>
              </div>
              <div className="space-y-2">
                {CREATOR_FORMATS.map((f) => {
                  const selected = creatorFormats.includes(f.value);
                  return (
                    <div key={f.value} className={`flex items-center justify-between rounded-lg px-3 py-2 border transition-all ${selected ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setCreatorFormats((p) => toggle(p, f.value));
                          if (!creatorFrequency[f.value]) setCreatorFreq(f.value, 1);
                        }}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <span className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
                          {selected ? 'âœ“' : ''}
                        </span>
                        <span className="text-sm">{f.icon}</span>
                        <span className={`text-sm font-medium ${selected ? 'text-blue-800' : 'text-gray-600'}`}>{f.label}</span>
                      </button>
                      {selected && (
                        <FreqStepper
                          value={creatorFrequency[f.value] ?? 1}
                          onChange={(v) => setCreatorFreq(f.value, v)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {false && (
          <>
          {/* Text formats + frequency */}
          <div className="p-6 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Text formats <span className="text-gray-400 font-normal">(optional)</span></h2>
              <p className="text-xs text-gray-400">AI-generated written content. Set how many per week for each.</p>
            </div>
            <div className="space-y-2">
              {TEXT_FORMATS.map((f) => {
                const selected = textFormats.includes(f.value);
                return (
                  <div key={f.value} className={`flex items-center justify-between rounded-lg px-3 py-2 border transition-all ${selected ? 'border-teal-200 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setTextFormats((p) => toggle(p, f.value));
                        if (!textFrequency[f.value]) setTextFreq(f.value, 1);
                      }}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <span className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${selected ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 bg-white'}`}>
                        {selected ? '✓' : ''}
                      </span>
                      <span className="text-sm">{f.icon}</span>
                      <span className={`text-sm font-medium ${selected ? 'text-teal-800' : 'text-gray-600'}`}>{f.label}</span>
                    </button>
                    {selected && (
                      <FreqStepper
                        value={textFrequency[f.value] ?? 1}
                        onChange={(v) => setTextFreq(f.value, v)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Creator formats + frequency */}
          <div className="p-6 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Creator formats <span className="text-gray-400 font-normal">(optional)</span></h2>
              <p className="text-xs text-gray-400">Media your team or creators produce. Set how many per week for each.</p>
            </div>
            <div className="space-y-2">
              {CREATOR_FORMATS.map((f) => {
                const selected = creatorFormats.includes(f.value);
                return (
                  <div key={f.value} className={`flex items-center justify-between rounded-lg px-3 py-2 border transition-all ${selected ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatorFormats((p) => toggle(p, f.value));
                        if (!creatorFrequency[f.value]) setCreatorFreq(f.value, 1);
                      }}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <span className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
                        {selected ? '✓' : ''}
                      </span>
                      <span className="text-sm">{f.icon}</span>
                      <span className={`text-sm font-medium ${selected ? 'text-blue-800' : 'text-gray-600'}`}>{f.label}</span>
                    </button>
                    {selected && (
                      <FreqStepper
                        value={creatorFrequency[f.value] ?? 1}
                        onChange={(v) => setCreatorFreq(f.value, v)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          </>
          )}

          {/* Duration + Start date */}
          <div className="p-6 space-y-5">
            {/* Duration */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-800">Campaign duration <span className="text-red-500">*</span></h2>
              <div className="flex flex-wrap gap-1.5">
                {durationWeeks.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setDuration(w)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                      duration === w
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-teal-400'
                    }`}
                  >
                    {w}w
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">{duration} week{duration > 1 ? 's' : ''} · ~{totalPerWeek * duration} total pieces</p>
            </div>

            {/* Start date */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-800">Campaign start date <span className="text-red-500">*</span></h2>
              <input
                type="date"
                value={startDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full sm:w-48 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-300 bg-white"
              />
            </div>

            {/* Platforms — capability-aware picker (Round-6: intelligent-mix = registry union) */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <BoltPlatformPicker
                accent="teal"
                loading={platformsLoading}
                blocked={platformBlocked}
                supported={availablePlatforms}
                hidden={platformHidden ?? []}
                selected={selectedPlatforms}
                onToggle={togglePlatform}
                hint="Intelligent Mix targets every connected platform that's registered for publishing."
                emptyMessage="No registered platforms connected yet. Connect your social accounts to enable Intelligent Mix."
              />
            </div>
          </div>

          {false && (
          <>
          {/* Campaign goal */}
          <div className="p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Campaign goal <span className="text-red-500">*</span></h2>
              <p className="text-xs text-gray-400">Choose one primary goal — optional supporting objectives can be added below.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIMARY_OPTIONS.map((opt) => {
                const selected = primaryCampaignType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectPrimary(opt.id)}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      selected
                        ? 'border-teal-500 bg-teal-50 text-teal-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-teal-300 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {primaryCampaignType && primaryCampaignType !== 'third_party' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Supporting goals <span className="text-gray-400 font-normal">(optional)</span></label>
                {isPersonalBrandPrimary(primaryCampaignType) ? (
                  <div className="space-y-3">
                    {PERSONAL_BRAND_SECONDARY_GROUPS.map((group) => (
                      <div key={group.label}>
                        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{group.label}</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {group.options.map((opt) => {
                            const sel = secondaryCampaignTypes.includes(opt.id);
                            return (
                              <button key={opt.id} type="button" onClick={() => toggleSecondary(opt.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sel ? 'bg-teal-100 border-teal-300 text-teal-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
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
                    {getSecondaryOptionsForPrimary(primaryCampaignType).map((opt) => {
                      const sel = secondaryCampaignTypes.includes(opt.id);
                      return (
                        <button key={opt.id} type="button" onClick={() => toggleSecondary(opt.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sel ? 'bg-teal-100 border-teal-300 text-teal-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {primaryCampaignType === 'third_party' && (
              <p className="text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                Third-party campaign: recommendations will focus on generic collaboration and distribution.
              </p>
            )}
            {dilutionSeverity !== 'none' && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${dilutionSeverity === 'caution' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-teal-200 bg-teal-50 text-teal-700'}`}>
                Multiple goals may dilute focus. Consider a tighter primary objective.
              </div>
            )}
          </div>
          </>
          )}

          {/* Validation hint */}
          {!canContinue && (
            <div className="px-6 py-3 bg-amber-50 text-xs text-amber-700 rounded-b-2xl">
              Select an audience, communication style, at least one format, and a start date to continue.
            </div>
          )}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-2xl mx-auto w-full space-y-4">
          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="w-full py-3.5 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-md flex items-center justify-center gap-2"
          >
            <span>Continue</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>

          {canContinue && (
            <div className="rounded-xl bg-teal-50 border border-teal-200 px-5 py-4 text-sm text-teal-800 space-y-1">
              <div className="font-semibold text-teal-900 mb-1">
                {duration}-week campaign starting {new Date(startDate + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })} · ~{totalPerWeek}/wk
              </div>
              <div><span className="font-medium">Goal:</span> {PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label ?? primaryCampaignType}{secondaryCampaignTypes.length > 0 ? ` + ${secondaryCampaignTypes.length} supporting` : ''}</div>
              <div><span className="font-medium">Audience:</span> {audience.join(', ')}</div>
              {textFormats.length > 0 && (
                <div><span className="font-medium">Text:</span> {textFormats.map((f) => `${f} ×${textFrequency[f] ?? 1}`).join(', ')}</div>
              )}
              {creatorFormats.length > 0 && (
                <div><span className="font-medium">Creator:</span> {creatorFormats.map((f) => `${f} ×${creatorFrequency[f] ?? 1}`).join(', ')}</div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
