import React from 'react';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ISO_COUNTRIES, matchCountry } from './TrendCampaignsTabHelpers';
import { TARGET_AUDIENCE_CATEGORIES, PROFESSIONAL_SEGMENTS } from '../../../lib/audienceCategories';
import { PRIMARY_OPTIONS, PERSONAL_BRAND_SECONDARY_GROUPS, getSecondaryOptionsForPrimary, isPersonalBrandPrimary } from '../../../lib/campaignTypeHierarchy';
import type { useTrendCampaignsState } from './useTrendCampaignsState';
import ReactDOM from 'react-dom';

import type { PrimaryCampaignTypeId, SecondaryOptionId } from '../../../lib/campaignTypeHierarchy';

type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & {
  communicationStyle?: string[];
  primaryCampaignType?: PrimaryCampaignTypeId;
  secondaryCampaignTypes?: SecondaryOptionId[];
};

type TrendState = ReturnType<typeof useTrendCampaignsState>;

export default function TrendCampaignsExecutionForm({ d }: { d: TrendState }) {
  const {
    companyId, regions, apiFetch, viewMode, initialBlogId, intelligentMixContext,
    hasRun, isSubmitting, isExecutionFormComplete, handleRunClick,
    contextMode, setContextMode, focusedModules, setFocusedModules,
    additionalDirection, setAdditionalDirection, clusterInputs, setClusterInputs,
    selectedAspects, setSelectedAspects, selectedFacets, setSelectedFacets,
    strategicText, setStrategicText,
    primaryCampaignType, setPrimaryCampaignType,
    secondaryCampaignTypes, setSecondaryCampaignTypes,
    validationError, setValidationError,
    regionInput, setRegionInput, regionWarning, setRegionWarning,
    regionDropdownOpen, setRegionDropdownOpen, regionInputRef,
    executionCollapsed, setExecutionCollapsed,
    targetAudience, setTargetAudience,
    professionalSegments, setProfessionalSegments,
    professionalDropdownOpen, setProfessionalDropdownOpen,
    professionalDropdownRef, professionalTriggerRef, professionalPortalRef,
    professionalDropdownRect, setProfessionalDropdownRect,
    communicationStyle, setCommunicationStyle,
    contentDepth, setContentDepth,
    frequencyPerWeek, setFrequencyPerWeek,
    tentativeStartDate, setTentativeStartDate,
    campaignGoal, setCampaignGoal,
    executionCalendarOpen, setExecutionCalendarOpen,
    mixPreFilled, showStrategicSetupEditor, setShowStrategicSetupEditor,
    hasStrategicMixPrefill, insightSource, setInsightSource,
    requiredExecutionFields, focusFirstMissingExecutionField,
    aspects, offeringFacetCards, intentSummary, modeIndicatorLabel,
    strategicIntents, onStrategicIntentsChange,
    strategicConfig, setStrategicConfig,
    showMissingFieldsMessage, setShowMissingFieldsMessage,
    executionSectionRefs, setMixPreFilled,
  } = d;

  return (
    <>
      {hasStrategicMixPrefill && !showStrategicSetupEditor && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-teal-900">Strategic setup loaded from Intelligent Mix</h3>
              <p className="text-xs text-teal-700 mt-1">Context mode, strategic direction, offerings, and geography were carried forward. Theme generation continues with those inputs.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowStrategicSetupEditor(true)}
              className="shrink-0 text-xs text-teal-700 hover:text-teal-900 underline"
            >
              Edit setup
            </button>
          </div>
          <div className="rounded-lg border border-teal-100 bg-white/70 px-4 py-3">
            <h4 className="text-xs font-semibold text-teal-900 mb-2">Strategic Intent Summary</h4>
            {intentSummary.type === 'warning' ? (
              <p className="text-sm text-amber-700">{intentSummary.text}</p>
            ) : (
              <div className="text-sm text-teal-900">{intentSummary.text}</div>
            )}
          </div>
        </div>
      )}
      {(!hasStrategicMixPrefill || showStrategicSetupEditor) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <EngineContextPanel
            companyId={companyId}
            apiFetch={apiFetch}
            contextMode={contextMode}
            focusedModules={focusedModules}
            additionalDirection={additionalDirection}
          />
          <UnifiedContextModeSelector
            mode={contextMode}
            modules={focusedModules}
            additionalDirection={additionalDirection}
            onModeChange={setContextMode}
            onModulesChange={setFocusedModules}
            onAdditionalDirectionChange={setAdditionalDirection}
            requireDirectionWhenNone={true}
          />
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-700">
            {modeIndicatorLabel}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <StrategicConsole
            value={strategicText}
            onChange={setStrategicText}
            mode={contextMode}
          />
        </div>
      </div>
      )}
      {/* Intelligent Mix context banner */}
      {mixPreFilled && intelligentMixContext && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-teal-800">
              <span>🤖</span> Intelligent Mix — campaign context loaded
            </div>
            <button
              type="button"
              onClick={() => {
                try { sessionStorage.removeItem('intelligent-mix-strategy-state'); } catch { /* ignore */ }
                setMixPreFilled(false);
                setExecutionCollapsed(false);
              }}
              className="text-xs text-teal-600 hover:text-teal-800 underline"
            >
              Clear &amp; start fresh
            </button>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-teal-700">
            {intelligentMixContext.primaryCampaignType && (
              <span><span className="font-medium">Goal:</span> {(intelligentMixContext as IntelligentMixContextWithFocus & { primaryCampaignType: string }).primaryCampaignType.replace(/_/g, ' ')}{(intelligentMixContext as IntelligentMixContextWithFocus).secondaryCampaignTypes?.length ? ` + ${(intelligentMixContext as IntelligentMixContextWithFocus).secondaryCampaignTypes!.length} supporting` : ''}</span>
            )}
            <span><span className="font-medium">Audience:</span> {intelligentMixContext.audience.join(', ')}</span>
            <span><span className="font-medium">Duration:</span> {intelligentMixContext.duration} weeks</span>
            <span><span className="font-medium">Start:</span> {new Date(intelligentMixContext.startDate + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
            {intelligentMixContext.textFormats.length > 0 && (
              <span><span className="font-medium">Text:</span> {intelligentMixContext.textFormats.map((f) => `${f}×${intelligentMixContext.textFrequency?.[f] ?? 1}`).join(', ')}</span>
            )}
            {intelligentMixContext.creatorFormats.length > 0 && (
              <span><span className="font-medium">Creator:</span> {intelligentMixContext.creatorFormats.map((f) => `${f}×${intelligentMixContext.creatorFrequency?.[f] ?? 1}`).join(', ')}</span>
            )}
          </div>
          <p className="text-xs text-teal-600">Goals and audience can be further refined by the AI chat below. Trend signals will enrich your audience profile.</p>
        </div>
      )}

      {(!mixPreFilled || !isExecutionFormComplete) && (
      <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold">Execution Configuration {mixPreFilled && <span className="text-xs font-normal text-teal-600 ml-1">(pre-filled from Intelligent Mix)</span>}</h3>
          {executionCollapsed ? (
            <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(false)}>
              Edit
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExecutionCollapsed(true)}
              className="text-muted-foreground"
            >
              Collapse
            </Button>
          )}
        </div>
        <div className="relative min-h-[240px] transition-all duration-200">
          {executionCollapsed && (
            <div className="absolute inset-0 flex items-center">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                <span>
                  {targetAudience ?? '—'}
                  {targetAudience === 'Professionals' && professionalSegments.length > 0 && ` (${professionalSegments.join(', ')})`}
                </span>
                <span>{communicationStyle?.length ? communicationStyle.join(', ') : '—'}</span>
                <span>{contentDepth ?? '—'}</span>
                <span>{frequencyPerWeek ?? '—'}</span>
                <span>{campaignGoal ?? '—'}</span>
                <span>{tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'long' }) : '—'}</span>
              </div>
            </div>
          )}
          {!executionCollapsed && (
          <>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>Setup Progress</span>
              <span className="font-medium">{requiredExecutionFields.completedCount} / 5 required fields completed</span>
            </div>
            {/* Row 1: Target Audience (left) | Start Date (right) */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              {/* Target Audience — hidden when pre-filled from Intelligent Mix */}
              {mixPreFilled ? (
                <div className="space-y-1 min-w-0 rounded-lg border border-teal-200 bg-teal-50 p-3">
                  <div className="text-xs font-medium text-teal-700">Target Audience <span className="font-normal text-teal-500">(from Intelligent Mix)</span></div>
                  <div className="text-sm font-semibold text-teal-900">{targetAudience ?? '—'}</div>
                  <button type="button" onClick={() => setExecutionCollapsed(false)} className="text-[10px] text-teal-600 underline">Change</button>
                </div>
              ) : (
              <div
                ref={(el) => { executionSectionRefs.current.targetAudience = el; }}
                className={`space-y-2 min-w-0 rounded-lg border p-3 transition-colors ${!targetAudience ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="Who is the primary audience for this campaign?">
                  Target Audience <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-2" role="group">
                {TARGET_AUDIENCE_CATEGORIES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="Who is the primary audience for this campaign?"
                    onClick={() => setTargetAudience(v)}
                    className={`shrink-0 px-3 py-1.5 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      targetAudience === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {targetAudience === 'Professionals' && (
                  <div className="relative shrink-0" ref={professionalDropdownRef}>
                    <button
                      ref={professionalTriggerRef}
                      type="button"
                      onClick={() => setProfessionalDropdownOpen((o) => !o)}
                      title={professionalSegments.length > 0 ? `Segments: ${professionalSegments.join(', ')}` : 'Narrow down which types of professionals (optional).'}
                      className={`h-9 min-w-[12rem] max-w-[22rem] rounded-md border px-3 text-sm text-left text-gray-900 flex items-center justify-between gap-2 whitespace-nowrap ${
                        professionalSegments.length > 0
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
                          : 'border-amber-300 bg-amber-50/80 text-amber-900'
                      }`}
                    >
                      <span className="truncate min-w-0">
                        {professionalSegments.length > 0 ? professionalSegments.join(', ') : 'Select'}
                      </span>
                      <span className="shrink-0 text-gray-500">{professionalDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {professionalDropdownOpen && professionalDropdownRect && typeof document !== 'undefined' && ReactDOM.createPortal(
                      <div
                        ref={professionalPortalRef}
                        className="fixed z-[9999] min-w-[12rem] rounded-md border border-gray-200 bg-white py-1 shadow-xl"
                        role="listbox"
                        style={{ top: professionalDropdownRect.top, left: professionalDropdownRect.left }}
                      >
                        <div className="flex flex-nowrap gap-x-4 gap-y-1 px-3 py-2">
                          {PROFESSIONAL_SEGMENTS.map((opt) => (
                            <label
                              key={opt}
                              className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-900 hover:bg-gray-50 cursor-pointer rounded px-1.5 py-1"
                              role="option"
                            >
                              <input
                                type="checkbox"
                                checked={professionalSegments.includes(opt)}
                                onChange={() => {
                                  setProfessionalSegments((prev) =>
                                    prev.includes(opt) ? prev.filter((s) => s !== opt) : [...prev, opt]
                                  );
                                }}
                                className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )}
              </div>
              </div>
              )}
              {/* Start Date — hidden when pre-filled from Intelligent Mix */}
              {mixPreFilled ? (
                <div className="space-y-1 shrink-0 rounded-lg border border-teal-200 bg-teal-50 p-3">
                  <div className="text-xs font-medium text-teal-700">Start Date <span className="font-normal text-teal-500">(from Intelligent Mix)</span></div>
                  <div className="text-sm font-semibold text-teal-900">{tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}</div>
                  <button type="button" onClick={() => setExecutionCollapsed(false)} className="text-[10px] text-teal-600 underline">Change</button>
                </div>
              ) : (
              <div
                ref={(el) => { executionSectionRefs.current.startDate = el; }}
                className={`space-y-1.5 shrink-0 rounded-lg border p-3 transition-colors ${!tentativeStartDate ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="When do you plan to start this campaign?">
                  Start Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    title="When do you plan to start this campaign?"
                    onClick={() => setExecutionCalendarOpen((o) => !o)}
                    className="h-9 min-w-[8rem] rounded-md border border-gray-200 bg-white px-3 text-sm text-left text-gray-900"
                  >
                    {tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Pick date'}
                  </button>
                  {executionCalendarOpen && (
                    <>
                      <div className="fixed inset-0 z-[100]" aria-hidden onClick={() => setExecutionCalendarOpen(false)} />
                      <div className="absolute z-[101] right-0 top-full mt-1 p-2 rounded-lg border border-gray-200 bg-white shadow-lg">
                        <input
                          type="date"
                          value={tentativeStartDate?.toISOString().slice(0, 10) ?? ''}
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTentativeStartDate(v ? new Date(v) : undefined);
                          }}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                        <Button variant="ghost" size="sm" onClick={() => setExecutionCalendarOpen(false)} className="mt-2 w-full">
                          Done
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              )}
            </div>
            <div className="flex flex-nowrap items-end gap-4 overflow-x-auto pb-1">
              {/* Campaign Goal — hidden when pre-filled from Intelligent Mix */}
              {mixPreFilled ? (
                <div className="space-y-1 shrink-0 rounded-lg border border-teal-200 bg-teal-50 p-3">
                  <div className="text-xs font-medium text-teal-700">Campaign Goal <span className="font-normal text-teal-500">(from Intelligent Mix)</span></div>
                  <div className="text-sm font-semibold text-teal-900">{campaignGoal ?? '—'}</div>
                  <button type="button" onClick={() => setMixPreFilled(false)} className="text-[10px] text-teal-600 underline">Change</button>
                </div>
              ) : (
              <div
                ref={(el) => { executionSectionRefs.current.campaignGoal = el; }}
                className={`space-y-1.5 shrink-0 rounded-lg border p-3 transition-colors ${!campaignGoal ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
              <label className="block text-xs font-medium text-gray-600" title="What is the main goal of this campaign?">
                Campaign Goal <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-nowrap gap-1.5" role="group">
                {['Awareness', 'Leads', 'Engagement', 'Product'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="What is the main goal of this campaign?"
                    onClick={() => setCampaignGoal(v)}
                    className={`shrink-0 px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      campaignGoal === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              </div>
              )}
              <div className="space-y-1.5 shrink-0">
                <label className="block text-xs font-medium text-gray-600" title="How detailed should each piece of content be?">Content Depth</label>
                <div className="flex flex-nowrap gap-1.5" role="group">
                {['Short', 'Medium', 'Long'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="How detailed should each piece of content be?"
                    onClick={() => setContentDepth(v)}
                    className={`shrink-0 px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      contentDepth === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              </div>
              {/* Frequency per week — hidden when pre-filled from Intelligent Mix */}
              {mixPreFilled ? (
                <div className="space-y-1 shrink-0 rounded-lg border border-teal-200 bg-teal-50 p-3 w-28">
                  <div className="text-xs font-medium text-teal-700">Freq/week <span className="font-normal text-teal-500">(Mix)</span></div>
                  <div className="text-sm font-semibold text-teal-900">{frequencyPerWeek ?? '—'}</div>
                  <button type="button" onClick={() => setMixPreFilled(false)} className="text-[10px] text-teal-600 underline">Change</button>
                </div>
              ) : (
              <div
                ref={(el) => { executionSectionRefs.current.frequencyPerWeek = el; }}
                className={`space-y-1.5 shrink-0 w-24 rounded-lg border p-3 transition-colors ${!frequencyPerWeek ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="How many posts/pieces do you want to send per week?">
                  Frequency per week <span className="text-red-500">*</span>
                </label>
                <select
                  value={frequencyPerWeek ?? ''}
                  onChange={(e) => setFrequencyPerWeek(e.target.value || null)}
                  title="How many posts/pieces do you want to send per week?"
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900"
                >
                  <option value="">Select</option>
                  <option value="1/w">1/w</option>
                  <option value="2/w">2/w</option>
                  <option value="3/w">3/w</option>
                  <option value="5/w">5/w</option>
                  <option value="Daily">Daily</option>
                </select>
              </div>
              )}
              <div
                ref={(el) => { executionSectionRefs.current.communicationStyle = el; }}
                className={`space-y-1.5 shrink-0 min-w-[12rem] rounded-lg border p-3 transition-colors ${communicationStyle.length === 0 ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
              <label className="block text-xs font-medium text-gray-600" title="Tone and style of your content (pick up to 2).">
                Communication Style (max 2) <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-nowrap gap-2">
                {['Professional', 'Conversational', 'Educational', 'Inspirational'].map((v) => {
                  const checked = communicationStyle.includes(v);
                  return (
                    <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap" title="Tone and style of your content (pick up to 2).">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setCommunicationStyle((prev) => {
                            if (prev.includes(v)) return prev.filter((x) => x !== v);
                            if (prev.length >= 2) return prev;
                            return [...prev, v];
                          });
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{v}</span>
                    </label>
                  );
                })}
              </div>
              </div>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
      )}
      {(!hasStrategicMixPrefill || showStrategicSetupEditor) && (
      <StrategicAspectSelector
        aspects={aspects}
        selectedAspects={selectedAspects}
        onAspectsChange={setSelectedAspects}
      />
      )}
      {(!hasStrategicMixPrefill || showStrategicSetupEditor) && (
      <OfferingFacetSelector
        selectedAspect={selectedAspects.length > 0 ? selectedAspects[0] : null}
        offerings={offeringFacetCards}
        selectedFacets={selectedFacets}
        onChange={setSelectedFacets}
        mode={contextMode}
      />
      )}
      {(!hasStrategicMixPrefill || showStrategicSetupEditor) && (
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Geographic Targeting (Optional)</h3>
        <div className="relative">
          <label className="block text-xs text-gray-500 mb-1">Target Regions (type country name or ISO code, comma separated)</label>
          <input
            ref={regionInputRef}
            type="text"
            value={regionInput}
            onChange={(e) => {
              setRegionInput(e.target.value);
              setRegionDropdownOpen(true);
              const parts = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
              const invalid = parts.filter((p) => p.length !== 2 && !ISO_COUNTRIES.some((c) => matchCountry(p, c)));
              setRegionWarning(invalid.length > 0 ? 'Some codes are not 2-letter ISO codes; generation will still run.' : null);
            }}
            onFocus={() => {
              const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
              const last = parts[parts.length - 1] ?? '';
              if (last.length >= 2 && ISO_COUNTRIES.some((c) => matchCountry(last, c))) setRegionDropdownOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setRegionDropdownOpen(false), 150);
            }}
            placeholder="e.g. India, US, Germany or IN, US, DE"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            autoComplete="off"
          />
          {regionDropdownOpen && (() => {
            const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
            const lastToken = (parts[parts.length - 1] ?? '').trim();
            const isAlreadyCode = lastToken.length === 2 && ISO_COUNTRIES.some((c) => c.code.toLowerCase() === lastToken.toLowerCase());
            const matches = lastToken.length >= 2 && !isAlreadyCode
              ? ISO_COUNTRIES.filter((c) => matchCountry(lastToken, c)).slice(0, 8)
              : [];
            if (matches.length === 0) return null;
            return (
              <ul
                className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg bg-white shadow-lg divide-y divide-gray-100 max-h-48 overflow-auto"
                role="listbox"
              >
                {matches.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => {
                        const prev = parts.slice(0, -1);
                        const next = [...prev, c.code];
                        setRegionInput(next.join(', '));
                        setRegionDropdownOpen(false);
                        setRegionWarning(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-gray-800"
                    >
                      {c.name} → <span className="font-medium text-indigo-600">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
          <p className="mt-1 text-xs text-gray-500">
            Type a country name (e.g. India, United States) and pick from the list to get the ISO code, or enter codes directly (IN, US, GB). Leave empty to use company default geography.
          </p>
          {regionWarning && <p className="mt-1 text-xs text-red-600">{regionWarning}</p>}
        </div>
      </div>
      )}
      {(!hasStrategicMixPrefill || showStrategicSetupEditor) && (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic Intent Summary</h3>
        {intentSummary.type === 'warning' ? (
          <p className="text-sm text-amber-700">{intentSummary.text}</p>
        ) : (
          <div className="text-sm text-gray-700">{intentSummary.text}</div>
        )}
      </div>
      )}
      <div className="space-y-3">
        {mixPreFilled ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 max-w-xs">
            <div className="text-xs text-teal-700 mb-1">Intelligence Source</div>
            <div className="text-sm font-semibold text-teal-900">Hybrid Intelligence</div>
            <div className="text-[11px] text-teal-700 mt-1">Selected in Intelligent Mix</div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Intelligence Source</label>
            <select
              value={insightSource}
              onChange={(e) => setInsightSource(e.target.value as 'hybrid' | 'api' | 'llm')}
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="hybrid">Hybrid Intelligence</option>
              <option value="api">API Intelligence</option>
              <option value="llm">AI Strategic Engine</option>
            </select>
          </div>
        )}

        {/* Always-visible missing fields list */}
        {!isExecutionFormComplete && requiredExecutionFields.missing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <p className="font-semibold mb-1">Complete these to generate themes:</p>
            <ul className="space-y-0.5 text-xs">
              {requiredExecutionFields.missing.map((label) => (
                <li key={label} className="flex items-center gap-1.5">
                  <span className="text-amber-500 font-bold">›</span> {label}
                </li>
              ))}
            </ul>
            {!mixPreFilled && (
              <button
                type="button"
                onClick={focusFirstMissingExecutionField}
                className="mt-1.5 text-xs font-medium text-amber-700 underline"
              >
                Jump to first missing field
              </button>
            )}
          </div>
        )}

        {/* Generate button — prominent when ready, amber action when fields missing */}
        <button
          type="button"
          onClick={handleRunClick}
          disabled={isSubmitting}
          className={`w-full sm:w-auto px-8 py-3 text-base font-semibold rounded-xl transition-all shadow-sm ${
            isSubmitting
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : isExecutionFormComplete
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md'
                : 'bg-amber-500 text-white hover:bg-amber-600'
          }`}
        >
          {isSubmitting ? 'Generating…' : isExecutionFormComplete ? '✦ Generate Strategic Themes' : 'Generate Strategic Themes'}
        </button>
      </div>
    </>
  );
}
