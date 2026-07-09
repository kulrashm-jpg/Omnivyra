/** Part 2/2 of BoltStrategyView.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * Command Center → BOLT (Text) Strategy Builder
 *
 * Layout:
 *   Top two-column: Left = form inputs | Right = suggestions + AI chat
 *   Below (full-width): Generated strategy cards in 3-column grid + confirm modal
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import { BoltCampaignChat } from './bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from './BOLTProgressModal';
import { ProgressCard } from './bolt/ProgressCard';
import { getProgressPipeline } from '../lib/shared/bolt/progressModel';
import { UpgradePrompt } from './monetization';
import { saveCampaignResume } from '../lib/campaignResumeStore';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';
import { PLATFORM_LABELS } from '../lib/shared/platforms';
import { FORMAT_REQUIRED_PLATFORMS } from '../lib/shared/bolt/formatPlatformBinding';
import { BOLT_DURATION_OPTIONS } from '../lib/shared/campaignDuration';
import BoltPlatformPicker from './bolt/BoltPlatformPicker';

import { type OutcomeView, type SharingMode, CONTENT_FORMATS, DURATION_OPTIONS, GOAL_OPTIONS, TONE_OPTIONS, AUDIENCE_HINT_EXAMPLES, STRATEGIC_FOCUS_OPTIONS, INTELLIGENCE_SOURCES, TagInput, StrategyCard } from './BoltStrategyViewWidgets';

function CampaignBriefSection({
  topic, description, goals, tone, audienceText,
  setTopic, setDescription, toggleGoal, toggleTone, setAudienceText,
}: {
  topic: string;
  description: string;
  goals: string[];
  tone: string[];
  audienceText: string;
  setTopic: (v: string) => void;
  setDescription: (v: string) => void;
  toggleGoal: (g: string) => void;
  toggleTone: (t: string) => void;
  setAudienceText: (v: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [compact, setCompact] = useState(false);

  const filledCount =
    (topic.trim() ? 1 : 0) +
    (description.trim() ? 1 : 0) +
    (goals.length > 0 ? 1 : 0) +
    (tone.length > 0 ? 1 : 0) +
    (audienceText.trim() ? 1 : 0);

  return (
    <div className="bg-white">
      {/* Header — click to toggle open. Always shows fill count so users
          know how much intent context the planner is getting. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-amber-50/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-base">📝</span>
          <div className="text-left">
            <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Campaign Brief</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Tell BOLT what, why, who, and how — only Topic is required.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            {filledCount}/5 filled
          </span>
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className={`border-t border-gray-100 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCompact((v) => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-600 underline"
              title={compact ? 'Expand spacing' : 'Compact (denser layout)'}
            >
              {compact ? '↕ Expand' : '↕ Compact'}
            </button>
          </div>

          {/* Topic — only required field */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Campaign Topic <span className="text-red-400">*</span>
            </label>
            <p className="text-[11px] text-gray-400 mb-1.5">What is this campaign about?</p>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={compact ? 2 : 3}
              placeholder="e.g. Launch AI-powered analytics tool for e-commerce brands…"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-gray-300"
            />
          </div>

          {/* Description — optional. AI suggestion-apply fills this. */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Campaign Description <span className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-gray-400 mb-1.5">A 1–2 sentence blurb — what the campaign delivers and to whom.</p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Show e-commerce teams how AI-powered analytics surface hidden revenue leaks they can fix in a week."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-gray-300"
            />
          </div>

          {/* Goal — multi-select chips. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Campaign Goal <span className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">(optional)</span>
              </label>
              {goals.length > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {goals.length} selected
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-1.5">Why does this campaign exist? Pick any that apply.</p>
            <div className="flex flex-wrap gap-1.5">
              {GOAL_OPTIONS.map((g) => (
                <button key={g} type="button" onClick={() => toggleGoal(g)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                    goals.includes(g)
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                  }`}>
                  {goals.includes(g) && '✓ '}{g}
                </button>
              ))}
            </div>
          </div>

          {/* Tone — multi-select chips. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Tone <span className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">(optional)</span>
              </label>
              {tone.length > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {tone.length} selected
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-1.5">How should it sound? You can mix styles (e.g. Bold + Educational).</p>
            <div className="flex flex-wrap gap-1.5">
              {TONE_OPTIONS.map((t) => (
                <button key={t} type="button" onClick={() => toggleTone(t)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                    tone.includes(t)
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                  }`}>
                  {tone.includes(t) && '✓ '}{t}
                </button>
              ))}
            </div>
          </div>

          {/* Audience — free-form textarea. */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Target Audience <span className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-gray-400 mb-1.5">
              Who is this campaign intended for? Free-form — examples:{' '}
              <span className="text-gray-500 italic">
                {AUDIENCE_HINT_EXAMPLES.join(' · ')}
              </span>
            </p>
            <textarea
              value={audienceText}
              onChange={(e) => setAudienceText(e.target.value)}
              rows={compact ? 1 : 2}
              placeholder="e.g. Series-A SaaS founders selling into mid-market HR teams"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-gray-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */
import type { useBoltStrategy } from '../hooks/useBoltStrategy';
type S = ReturnType<typeof useBoltStrategy>;
export default function BoltStrategyView({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    acceptedSuggestions,
    resetCampaignMemory,
    applyChatSuggestion,
    applySuggestion,
    audienceText,
    authChecked,
    campaignStartDate,
    canGenerate,
    cards,
    cardsRef,
    confirmingCard,
    contentFormats,
    contentJobProgress,
    description,
    duration,
    execError,
    execProgress,
    execStartedAt,
    executing,
    formatFrequency,
    genError,
    generating,
    goals,
    handleCardSelect,
    handleConfirmLaunch,
    conflictPrompt,
    resolveConflictDecision,
    handleGenerate,
    hasGenerated,
    isLoading,
    offerings,
    outcomeView,
    router,
    companyId,
    selectedIds,
    setAudienceText,
    setCampaignStartDate,
    setCards,
    setConfirmingCard,
    setContentFormats,
    setContentJobProgress,
    setDescription,
    setDuration,
    setExecError,
    setExecProgress,
    setExecStartedAt,
    setExecuting,
    setFormatFrequency,
    setFreq,
    setGenError,
    setGenerating,
    setGoals,
    setHasGenerated,
    setOfferings,
    setOutcomeView,
    setSelectedIds,
    setSharingMode,
    setShowChat,
    setStrategicFocus,
    setSuggestions,
    setSuggestionsLoading,
    setThemeSource,
    setTopic,
    sharingMode,
    showChat,
    availablePlatforms,
    selectedPlatforms,
    togglePlatform,
    platformsLoading,
    platformHidden,
    platformBlocked,
    sourceContentToken,
    sourcePayload,
    strategicFocus,
    suggestions,
    suggestionsLoading,
    themeSource,
    tone,
    toggleTone,
    toggleFocus,
    toggleFormat,
    toggleGoal,
    topic,
    user,
  } = d;

    return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Back */}
        <button onClick={() => router.push('/command-center/campaigns')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Campaign Modes
        </button>

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-3xl">⚡</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">BOLT (Text) Strategy Builder</h1>
              <p className="text-sm font-medium text-gray-600">AI Automated Campaign</p>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">AI Automated</span>
          </div>
          <p className="text-gray-500 text-sm">Describe your campaign. BOLT generates strategy options — select one to proceed to execution.</p>
        </div>

        {/* ── Top two-column: Form | Suggestions + Chat ── */}
        {sourcePayload && (
          <div className="rounded-2xl border border-gray-200 bg-amber-50/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Source Content Loaded</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-xs text-gray-600">
              We prefilled the campaign topic from this {sourcePayload.contentType}. Adjust it if you want a broader campaign angle.
            </p>
          </div>
        )}
        <div className="flex gap-5 items-start">

          {/* LEFT: Form */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">

            {/* ─── Campaign Brief ──────────────────────────────────────
                Single intent surface — replaces the old separate Goal +
                Audience sections. Topic is the only required field; everything
                else is optional and feeds the AI planner as additional intent
                context (see hooks/useBoltStrategy.tsx → handleConfirmLaunch
                where executionConfig + sourceStrategicTheme.campaign_brief
                are assembled).

                The block is collapsible so advanced users can hide it once
                filled, but defaults to open so first-time users see every
                field at a glance. */}
            <CampaignBriefSection
              topic={topic}
              description={description}
              goals={goals}
              tone={tone}
              audienceText={audienceText}
              setTopic={setTopic}
              setDescription={setDescription}
              toggleGoal={toggleGoal}
              toggleTone={toggleTone}
              setAudienceText={setAudienceText}
            />

            {/* Strategic Focus */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Strategic Focus</label>
              <p className="text-xs text-gray-400 mb-3">Select all angles that should guide this campaign.</p>
              <div className="flex flex-wrap gap-1.5">
                {STRATEGIC_FOCUS_OPTIONS.map((f) => (
                  <button key={f} type="button" onClick={() => toggleFocus(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                      strategicFocus.includes(f) ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50'
                    }`}>
                    {strategicFocus.includes(f) && '✓ '}{f}
                  </button>
                ))}
              </div>
            </div>

            {/* Offerings */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Offerings / Products</label>
              <p className="text-xs text-gray-400 mb-2">What should BOLT highlight? Type and press Enter.</p>
              <TagInput tags={offerings} onChange={setOfferings} placeholder="e.g. Analytics Dashboard, Free Trial…" />
            </div>

            {/* Format + Duration + Source */}
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                  Content Format <span className="font-normal text-gray-400">(select up to 2)</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {CONTENT_FORMATS.filter((fmt) => {
                    // While platforms are still loading, render the full list
                    // so the chips don't flicker. Once loaded, hide formats
                    // whose required platform isn't in the effective campaign
                    // platform set — e.g. Tweet disappears unless X is going
                    // to be used for this campaign.
                    //
                    // Effective set = user's explicit selection. If the user
                    // hasn't picked any platform yet (selectedPlatforms empty
                    // → planner falls back to all supported, see the warning
                    // banner in BoltPlatformPicker), we treat the connected
                    // set as effective so Tweet shows whenever X is connected.
                    if (platformsLoading) return true;
                    const required = FORMAT_REQUIRED_PLATFORMS[fmt.value];
                    if (!required) return true;
                    const effective = selectedPlatforms.length > 0
                      ? selectedPlatforms
                      : availablePlatforms;
                    return required.some((p) => effective.includes(p));
                  }).map((fmt) => {
                    const selected = contentFormats.includes(fmt.value);
                    const freq = formatFrequency[fmt.value] ?? 3;
                    return (
                      <div key={fmt.value} className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => toggleFormat(fmt.value)}
                          disabled={!selected && contentFormats.length >= 2}
                          className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg border font-medium transition-all text-left disabled:opacity-40 ${
                            selected ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                          }`}>
                          <span className="text-sm">{fmt.icon}</span>{fmt.label}
                        </button>
                        {selected && (
                          <div className="flex items-center gap-1 pl-0.5">
                            <span className="text-[9px] text-gray-400 font-semibold">×/wk</span>
                            <button type="button" onClick={() => setFreq(fmt.value, -1)}
                              className="w-4 h-4 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-[10px] font-bold leading-none">−</button>
                            <span className="text-[11px] font-bold text-amber-700 w-3 text-center">{freq}</span>
                            <button type="button" onClick={() => setFreq(fmt.value, 1)}
                              className="w-4 h-4 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-[10px] font-bold leading-none">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Duration</label>
                <div className="flex flex-col gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setDuration(opt.value)}
                      className={`py-2 text-xs font-semibold rounded-xl border-2 transition-all ${
                        duration === opt.value ? 'border-amber-400 bg-amber-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Intelligence Source</label>
                <div className="flex flex-col gap-1.5">
                  {INTELLIGENCE_SOURCES.map((src) => (
                    <button key={src.value} type="button" onClick={() => setThemeSource(src.value)}
                      className={`flex flex-col items-start text-left px-2.5 py-2 rounded-xl border-2 transition-all ${
                        themeSource === src.value ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                      }`}>
                      <span className="text-xs font-semibold">{src.label}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">{src.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content Sharing Mode */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Content Sharing</label>
                <span className="text-[10px] text-gray-400">— how content is distributed across platforms</span>
              </div>
              <div className="flex gap-2">
                {([
                  { value: 'shared' as SharingMode, label: 'Shared', icon: '🔗', hint: 'Same post on all platforms' },
                  { value: 'unique' as SharingMode, label: 'Unique', icon: '✦', hint: 'Distinct content per platform' },
                  { value: 'ai'     as SharingMode, label: 'AI Decides', icon: '🤖', hint: 'AI chooses best mix' },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSharingMode(opt.value)}
                    className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl border-2 text-center transition-all ${
                      sharingMode === opt.value
                        ? 'border-amber-400 bg-amber-50 text-amber-900'
                        : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                    }`}
                  >
                    <span className="text-base leading-none">{opt.icon}</span>
                    <span className="text-[11px] font-bold mt-1">{opt.label}</span>
                    <span className="text-[9px] text-gray-400 leading-tight">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Platforms — capability-aware picker (Round-6 Phase 4 shared component) */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <BoltPlatformPicker
                accent="amber"
                loading={platformsLoading}
                blocked={platformBlocked}
                supported={availablePlatforms}
                hidden={platformHidden ?? []}
                selected={selectedPlatforms}
                onToggle={togglePlatform}
                emptyMessage="No text-compatible platforms connected yet. Add social links in company settings to target specific platforms."
              />
            </div>

            {/* Campaign Start Date */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="bolt-start-date" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Start Date</label>
                <span className="text-[10px] text-gray-400">— when should content start going out?</span>
              </div>
              <input
                id="bolt-start-date"
                type="date"
                value={campaignStartDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setCampaignStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
              />
            </div>

            {/* View in row */}
            <div className="px-5 pt-4 pb-2 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">View In</label>
              <div className="flex gap-2">
                {[
                  { value: 'week_plan' as OutcomeView, label: 'Weekly' },
                  { value: 'daily_plan' as OutcomeView, label: 'Daily' },
                  { value: 'schedule'  as OutcomeView, label: 'Schedule' },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="outcomeView"
                      value={opt.value}
                      checked={outcomeView === opt.value}
                      onChange={() => setOutcomeView(opt.value)}
                      className="accent-amber-500 w-3.5 h-3.5"
                    />
                    <span className={`text-xs font-medium ${outcomeView === opt.value ? 'text-amber-700' : 'text-gray-600'}`}>
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <div className="p-5 bg-amber-50/60 rounded-b-2xl">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate || generating}
                className={`w-full py-3 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${
                  canGenerate && !generating ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                {generating ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>Generating Strategy Cards…</>
                ) : hasGenerated ? '✨ Regenerate BOLT Strategy Cards' : '✨ Generate BOLT Strategy Cards'}
              </button>
              {!canGenerate && !generating && (
                <p className="text-xs text-gray-400 text-center mt-2">Enter a campaign topic to get started</p>
              )}
              {canGenerate && !generating && (
                <p className="text-[11px] text-amber-600/70 text-center mt-1.5">Uses ~40 credits per generation</p>
              )}
            </div>
          </div>

          {/* RIGHT: Suggestions + AI Chat */}
          <div className="w-[36%] flex-shrink-0 flex flex-col gap-4">

            {/* Suggestions */}
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Campaign Suggestions</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Click any to pre-fill your topic</p>
                </div>
                {suggestionsLoading && (
                  <svg className="animate-spin w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                )}
              </div>
              <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                {suggestionsLoading && suggestions.length === 0 && (
                  <p className="text-xs text-gray-400 py-4 text-center">Loading suggestions…</p>
                )}
                {!suggestionsLoading && suggestions.length === 0 && (
                  <p className="text-xs text-gray-400 py-4 text-center">No suggestions available yet.</p>
                )}
                {suggestions.map((s) => (
                  <button key={s.id} type="button" onClick={() => applySuggestion(s)}
                    className="w-full text-left rounded-xl border border-amber-100 bg-amber-50/60 hover:bg-amber-100/70 hover:border-amber-300 transition-all p-3 group">
                    <p className="text-xs font-semibold text-amber-900 line-clamp-2">{s.suggested_campaign_title}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{s.topic}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] bg-white border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full font-medium">{s.suggested_duration}w</span>
                      {s.opportunity_score !== null && <span className="text-[10px] text-gray-400">Score: {s.opportunity_score}</span>}
                      <span className="ml-auto text-[10px] text-amber-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">Use this →</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Chat */}
            <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowChat((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-base">💬</span>
                  <div className="text-left">
                    <p className="text-xs font-bold text-gray-800">AI Chat — Refine Your Topic</p>
                    <p className="text-[11px] text-gray-400">Ask AI to suggest or improve campaign ideas</p>
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{showChat ? '▲' : '▼'}</span>
              </button>
              {showChat && (
                <div className="border-t border-gray-100 flex flex-col" style={{ height: '320px' }}>
                  <BoltCampaignChat
                    companyId={companyId}
                    context={{
                      topic,
                      description,
                      goals,
                      tone,
                      audience: audienceText,
                      strategicFocus,
                      duration,
                      // Execution-awareness so the AI doesn't suggest
                      // campaign shapes the planner can't deliver.
                      selectedPlatforms,
                      selectedFormats: contentFormats,
                      formatFrequency,
                      outcomeView,
                    }}
                    onApplySuggestion={applyChatSuggestion}
                    acceptedSuggestions={acceptedSuggestions}
                    onResetMemory={resetCampaignMemory}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Strategy Cards — full-width below form ── */}
        {(hasGenerated || generating) && (
          <div ref={cardsRef}>

            {/* Section header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {generating ? 'Generating your strategy options…' : `${cards.length} Strategy Options`}
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {generating ? 'BOLT is crafting unique campaign angles for you.' : executing ? 'BOLT is building your campaign — hang tight.' : 'Select a strategy to launch BOLT in the chosen view.'}
                </p>
              </div>
              {hasGenerated && !generating && (
                <button type="button" onClick={handleGenerate}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors">
                  ↺ Regenerate
                </button>
              )}
            </div>

            {genError && (
              genError.includes('free plan') || genError.includes('credits') || genError.includes('COST_BLOCKED') ? (
                <UpgradePrompt
                  context="credits_depleted"
                  achievement={`Strategy generated with ${cards.length} options`}
                  unlockMessage="Upgrade to unlock full AI-powered campaign generation."
                  onUpgrade={() => window.location.href = '/pricing'}
                  onContinue={() => setGenError(null)}
                  className="mb-4"
                />
              ) : (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
                  <strong>Error:</strong> {genError}
                </div>
              )
            )}

            {generating && (
              <div className="grid grid-cols-3 gap-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border-2 border-gray-100 bg-white overflow-hidden animate-pulse">
                    <div className="h-32 bg-gray-100" />
                    <div className="p-5 space-y-3">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-2 bg-gray-100 rounded w-full" />
                      <div className="h-2 bg-gray-100 rounded w-5/6" />
                      <div className="h-2 bg-gray-100 rounded w-4/6" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {execError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
                <strong>BOLT Error:</strong> {execError}
              </div>
            )}

            {!generating && cards.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cards.map((card, i) => (
                  <StrategyCard
                    key={card.id}
                    card={card}
                    index={i}
                    selected={selectedIds.includes(card.id)}
                    boltProgress={selectedIds.includes(card.id) ? execProgress : null}
                    execStartedAt={execStartedAt}
                    anyExecuting={executing}
                    contentJobProgress={selectedIds.includes(card.id) ? contentJobProgress : null}
                    onSelect={() => handleCardSelect(card.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>

    {/* ── Pre-execution confirmation modal ────────────────────────────────── */}

    {confirmingCard && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-4">
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⚡</span>
              <h2 className="text-white font-bold text-base">Confirm BOLT Launch</h2>
            </div>
            <p className="text-amber-100 text-xs">Review your inputs before we start. BOLT will build exactly this.</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Strategy being launched */}
          <div className="px-6 pt-5 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Strategy</p>
            <p className="text-sm font-bold text-gray-900 leading-snug">{confirmingCard.title}</p>
            {confirmingCard.summary && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{confirmingCard.summary}</p>
            )}
          </div>

          {/* Execution plan table */}
          <div className="px-6 py-3 space-y-3">
            {/* Content formats + frequency */}
            <div className="bg-amber-50 rounded-xl p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">Content Plan</p>
              {contentFormats.length > 0 ? (
                <div className="space-y-1.5">
                  {contentFormats.map((fmt) => {
                    const fmtMeta = CONTENT_FORMATS.find((f) => f.value === fmt);
                    const freq = formatFrequency[fmt] ?? 3;
                    const total = freq * duration;
                    return (
                      <div key={fmt} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-gray-700 font-medium">{fmtMeta?.icon} {fmtMeta?.label ?? fmt}</span>
                        <span className="text-amber-700 font-bold">{freq}×/wk × {duration}wk = <strong>{total} pieces</strong></span>
                      </div>
                    );
                  })}
                  <div className="border-t border-amber-200 pt-1.5 mt-1.5 flex justify-between gap-3 text-xs font-bold">
                    <span className="text-gray-600">Total</span>
                    <span className="text-amber-800">
                      {contentFormats.reduce((sum, f) => sum + (formatFrequency[f] ?? 3), 0)}×/wk ×
                      {' '}{duration}wk = {contentFormats.reduce((sum, f) => sum + (formatFrequency[f] ?? 3) * duration, 0)} pieces
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">No format selected — AI will decide content types.</p>
              )}
            </div>

            {/* Goals, audience, distribution */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Goals</p>
                {goals.length > 0
                  ? goals.map((g) => <p key={g} className="text-gray-700 font-medium">🎯 {g}</p>)
                  : <p className="text-gray-400 italic">None selected</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Audience</p>
                {audienceText.trim()
                  ? <p className="text-gray-700 font-medium leading-snug">👥 {audienceText.length > 80 ? `${audienceText.slice(0, 78)}…` : audienceText}</p>
                  : <p className="text-gray-400 italic">Not specified</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Tone</p>
                {tone.length > 0
                  ? <p className="text-gray-700 font-medium">🎙️ {tone.join(', ')}</p>
                  : <p className="text-gray-400 italic">Not specified</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Duration</p>
                <p className="text-gray-700 font-medium">📆 {duration} week{duration !== 1 ? 's' : ''}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Start Date</p>
                <p className="text-gray-700 font-medium">🗓️ {campaignStartDate || 'Today'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Sharing</p>
                <p className="text-gray-700 font-medium">
                  {sharingMode === 'shared' ? '🔗 Shared across platforms' : sharingMode === 'unique' ? '✦ Unique per platform' : '🤖 AI decides'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Output</p>
                <p className="text-gray-700 font-medium">
                  {outcomeView === 'schedule' ? '🗓️ Campaign Calendar' : outcomeView === 'daily_plan' ? '📅 Daily Plan' : '📋 Week Plan'}
                </p>
              </div>
            </div>

            {/* Warning if any key input is missing */}
            {(goals.length === 0 || !audienceText.trim() || contentFormats.length === 0) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                <strong>⚠️ Some inputs are not set:</strong>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {goals.length === 0 && <li>No campaign goal selected — AI will choose a default</li>}
                  {!audienceText.trim() && <li>No audience specified — AI will target a general audience</li>}
                  {contentFormats.length === 0 && <li>No content format selected — AI will decide the mix</li>}
                </ul>
                <p className="mt-1.5 text-yellow-700">You can go back and fill these in, or confirm to proceed with AI defaults.</p>
              </div>
            )}
          </div>

          </div>

          {/* Actions */}
          <div className="flex shrink-0 gap-3 border-t border-gray-100 bg-white px-6 pb-6 pt-4">
            <button
              type="button"
              onClick={() => setConfirmingCard(null)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← Go Back
            </button>
            <button
              type="button"
              onClick={() => handleConfirmLaunch()}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition-colors"
            >
              Confirm &amp; Launch ⚡
            </button>
          </div>
        </div>
      </div>
    )}

    {conflictPrompt && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
          <div className="rounded-t-2xl bg-amber-500 px-5 py-3 text-white">
            <div className="text-sm font-bold">⚠ Already scheduled on these platforms</div>
            <div className="text-xs opacity-90">Another campaign already has posts on some of your target days.</div>
          </div>
          <div className="max-h-64 overflow-y-auto px-5 py-3">
            <ul className="space-y-1 text-sm text-slate-700">
              {conflictPrompt.conflicts.slice(0, 12).map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium capitalize text-slate-900">{c.platform}</span>
                  <span className="text-slate-500">{c.date}</span>
                  {c.content_type ? <span className="text-slate-400">· {c.content_type}</span> : null}
                  <span className="text-indigo-600">({c.campaign_name})</span>
                </li>
              ))}
              {conflictPrompt.conflicts.length > 12 ? (
                <li className="text-xs text-slate-400">…and {conflictPrompt.conflicts.length - 12} more</li>
              ) : null}
            </ul>
          </div>
          <div className="border-t border-slate-100 px-5 py-3">
            <div className="mb-2 text-xs font-medium text-slate-500">How should I handle it?</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => resolveConflictDecision('avoid')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Move mine to a free day</button>
              <button type="button" onClick={() => resolveConflictDecision('skip')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Skip the clashing pieces</button>
              <button type="button" onClick={() => resolveConflictDecision('override')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Post anyway</button>
              <button type="button" onClick={() => resolveConflictDecision('cancel')} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


