/** BoltCombinedStrategyPage — thin composition (relocated out of pages/). */
/**
 * Command Center → BOLT (Combined) Strategy Builder
 *
 * Combines text-based formats (post, article, newsletter, short_story, white_paper)
 * and creator-dependent formats (video, reel, carousel, image, podcast, short, story)
 * in a single campaign. AI plans across both, pipeline runs in combined mode.
 *
 * View options: Week Plan, Daily Plan, Schedule (same as BOLT Text).
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { getSelectableAudienceLabels } from '../../lib/shared/audience/audienceRegistry';
import { COMBINED_DURATION_OPTIONS, MAX_CAMPAIGN_DURATION_WEEKS } from '../../lib/shared/campaignDuration';
import { getSupportedPlatformsForFormat } from '../../lib/shared/bolt/contentPlatformAssignment';
import { buildAssignmentExplanation, buildAssignmentDecisions } from '../../lib/shared/intelligence/assignmentExplanation';
import { AssignmentSummary } from '../../components/bolt/AssignmentSummary';
import { ProgressCard } from '../../components/bolt/ProgressCard';
import { getProgressPipeline } from '../../lib/shared/bolt/progressModel';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { BoltCampaignChat } from '../../components/bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from '../../components/BOLTProgressModal';
import BoltPlatformPicker from '../../components/bolt/BoltPlatformPicker';
import { useBoltPlatformPicker } from '../../hooks/useBoltPlatformPicker';
import PageLoader from '../../components/PageLoader';
import { useBoltCombinedStrategyController, AUDIENCE_OPTIONS, CREATOR_FORMATS, DURATION_OPTIONS, GOAL_OPTIONS, INTELLIGENCE_SOURCES, STRATEGIC_FOCUS_OPTIONS, type SharingMode, StrategyCard, TEXT_FORMATS, TONE_OPTIONS, TagInput, VIEW_OPTIONS } from './BoltCombinedStrategyController';

export default function BoltCombinedStrategyPage() {
  const f = useBoltCombinedStrategyController();
  const {
    guardLoading, guardRedirect,
    allFormats, allFrequency, applyCampaignBlueprint, applySuggestion, assignmentDecisions, assignmentExplanation, audience,
    authChecked, campaignStartDate, canGenerate, cards, cardsRef, companyId, confirmingCard, contentFormatsKey, creatorFormats,
    creatorFrequency, description, duration, execError, execProgress, execStartedAt, executing, formatCapable, genError, generating,
    goals, handleCardSelect, handleConfirmLaunch, handleGenerate, hasGenerated, isAuthenticated, isLoading, offerings, outcomeView,
    platformPicker, router, selectedIds, selectedPlatforms, setAudience, setCampaignStartDate, setCards, setConfirmingCard,
    setCreatorFormats, setCreatorFreq, setCreatorFrequency, setDescription, setDuration, setExecError, setExecProgress,
    setExecStartedAt, setExecuting, setGenError, setGenerating, setGoals, setHasGenerated, setOfferings, setOutcomeView,
    setSelectedIds, setSelectedPlatforms, setSharingMode, setShowChat, setShowDecisions, setStrategicFocus, setSuggestions,
    setSuggestionsLoading, setTextFormats, setTextFreq, setTextFrequency, setThemeSource, setTone, setTopic, sharingMode, showChat,
    showDecisions, strategicFocus, suggestions, suggestionsLoading, textFormats, textFrequency, themeSource, toggleAudience,
    toggleCreatorFormat, toggleFocus, toggleGoal, togglePlatform, toggleTextFormat, toggleTone, tone, topic, user
  } = f;
  if (guardLoading) return <PageLoader message="Loading BOLT…" />;
  if (guardRedirect) return <PageLoader message="Redirecting…" statuses={[]} />;
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
            <span className="text-3xl">🔀</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Intelligent Mix Campaign Builder</h1>
              <p className="text-sm font-medium text-gray-600">Text + Creator Campaign</p>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">AI + Creator</span>
          </div>
          <p className="text-gray-500 text-sm">Run text-based AI content and creator-dependent media in a single coordinated campaign.</p>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-5 items-start">

          {/* LEFT: Form */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">

            {/* Topic */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Campaign Topic <span className="text-red-400">*</span></label>
              <p className="text-xs text-gray-400 mb-2">What is this campaign about?</p>
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
                placeholder="e.g. Q3 product launch combining thought leadership posts and behind-the-scenes videos…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 placeholder:text-gray-300" />
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mt-4 mb-1">Description</label>
              <p className="text-xs text-gray-400 mb-2">A 1–2 sentence campaign blurb (optional).</p>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="e.g. A focused push delivering actionable insights to help marketing teams execute with clarity…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 placeholder:text-gray-300" />
            </div>

            {/* Goal + Audience */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Goal</label>
                  {goals.length > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{goals.length} selected</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_OPTIONS.map((g) => (
                    <button key={g} type="button" onClick={() => toggleGoal(g)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${goals.includes(g) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-200 hover:bg-violet-50/40'}`}>
                      {goals.includes(g) && '✓ '}{g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Target Audience</label>
                <p className="text-xs text-gray-400 mb-3">Who should this campaign reach?</p>
                <div className="flex flex-wrap gap-1.5">
                  {AUDIENCE_OPTIONS.map((a) => (
                    <button key={a} type="button" onClick={() => toggleAudience(a)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${audience.includes(a) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                      {audience.includes(a) && '✓ '}{a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tone */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Tone</label>
                {tone.length > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{tone.length} selected</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTone(t)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${tone.includes(t) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                    {tone.includes(t) && '✓ '}{t}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategic Focus */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Strategic Focus</label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {STRATEGIC_FOCUS_OPTIONS.map((f) => (
                  <button key={f} type="button" onClick={() => toggleFocus(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${strategicFocus.includes(f) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                    {strategicFocus.includes(f) && '✓ '}{f}
                  </button>
                ))}
              </div>
            </div>

            {/* Offerings */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Offerings / Products</label>
              <p className="text-xs text-gray-400 mb-2">Type and press Enter.</p>
              <TagInput tags={offerings} onChange={setOfferings} placeholder="e.g. SaaS Tool, Brand Story, Tutorial Series…" />
            </div>

            {/* Content Formats — two columns: text left, creator right */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Content Formats</label>
              <div className="grid grid-cols-2 gap-4">
                {/* Text */}
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">✍️ Text <span className="font-normal text-gray-400">(max 2)</span></p>
                  <div className="flex flex-col gap-1.5">
                    {TEXT_FORMATS.map((fmt) => {
                      const sel = textFormats.includes(fmt.value);
                      const capable = formatCapable[fmt.value] !== false;
                      return (
                        <div key={fmt.value} className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => toggleTextFormat(fmt.value)}
                            disabled={!sel && (textFormats.length >= 2 || !capable)}
                            title={!capable ? `No connected platform supports ${fmt.label}. Connect a compatible platform to enable it.` : fmt.hint}
                            className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border-2 font-medium transition-all text-left disabled:opacity-40 ${sel ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'}`}>
                            <span>{fmt.icon}</span>{fmt.label}
                          </button>
                          {sel && (
                            <div className="flex items-center gap-1.5 pl-1">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">×/wk</span>
                              <button type="button" onClick={() => setTextFreq(fmt.value, -1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                              <span className="text-xs font-bold text-amber-700 w-4 text-center">{textFrequency[fmt.value] ?? 3}</span>
                              <button type="button" onClick={() => setTextFreq(fmt.value, 1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Creator */}
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-2">🎬 Creator <span className="font-normal text-gray-400">(max 2)</span></p>
                  <div className="flex flex-col gap-1.5">
                    {CREATOR_FORMATS.map((fmt) => {
                      const sel = creatorFormats.includes(fmt.value);
                      const capable = formatCapable[fmt.value] !== false;
                      return (
                        <div key={fmt.value} className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => toggleCreatorFormat(fmt.value)}
                            disabled={!sel && (creatorFormats.length >= 2 || !capable)}
                            title={!capable ? `No connected platform supports ${fmt.label}. Connect a compatible platform to enable it.` : fmt.hint}
                            className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border-2 font-medium transition-all text-left disabled:opacity-40 ${sel ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/40'}`}>
                            <span>{fmt.icon}</span>{fmt.label}
                          </button>
                          {sel && (
                            <div className="flex items-center gap-1.5 pl-1">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">×/wk</span>
                              <button type="button" onClick={() => setCreatorFreq(fmt.value, -1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                              <span className="text-xs font-bold text-blue-700 w-4 text-center">{creatorFrequency[fmt.value] ?? 3}</span>
                              <button type="button" onClick={() => setCreatorFreq(fmt.value, 1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Duration + Intelligence Source */}
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="p-5">
                <label htmlFor="combined-duration" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Duration</label>
                <select
                  id="combined-duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full py-2 px-3 text-sm font-semibold rounded-xl border-2 border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400">
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Intelligence Source</label>
                <div className="flex flex-col gap-1.5">
                  {INTELLIGENCE_SOURCES.map((src) => (
                    <button key={src.value} type="button" onClick={() => setThemeSource(src.value)}
                      className={`flex flex-col items-start text-left px-2.5 py-2 rounded-xl border-2 transition-all ${themeSource === src.value ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50/40'}`}>
                      <span className="text-xs font-semibold">{src.label}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">{src.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content Sharing */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Content Sharing</label>
                <span className="text-[10px] text-gray-400">— how content is distributed across platforms</span>
              </div>
              <div className="flex gap-2">
                {([
                  { value: 'shared' as SharingMode, label: 'Shared',     icon: '🔗', hint: 'Same post on all platforms' },
                  { value: 'unique' as SharingMode, label: 'Unique',     icon: '✦',  hint: 'Distinct content per platform' },
                  { value: 'ai'     as SharingMode, label: 'AI Decides', icon: '🤖', hint: 'AI chooses best mix' },
                ] as const).map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setSharingMode(opt.value)}
                    className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl border-2 text-center transition-all ${sharingMode === opt.value ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50/40'}`}>
                    <span className="text-base leading-none">{opt.icon}</span>
                    <span className="text-[11px] font-bold mt-1">{opt.label}</span>
                    <span className="text-[9px] text-gray-400 leading-tight">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Platforms — capability-aware picker (Round-6: strategy-mix = registry union) */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <BoltPlatformPicker
                accent="violet"
                loading={platformPicker.loading}
                blocked={platformPicker.blocked}
                supported={platformPicker.supported}
                hidden={platformPicker.hidden}
                selected={selectedPlatforms}
                onToggle={togglePlatform}
                hint="Intelligent Mix targets every connected platform that's registered for publishing."
                emptyMessage="No registered platforms connected yet. Connect your social accounts to enable Intelligent Mix."
              />
            </div>

            {/* Assignment Summary — read-only explainability (6G-2). What was
                supported / restricted / removed, and why (canonical authority). */}
            {assignmentDecisions.length > 0 && (
              <div className="px-5 pt-4 pb-4 border-t border-gray-100">
                <button type="button" onClick={() => setShowDecisions((v) => !v)}
                  className="w-full flex items-center justify-between text-left">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Assignment Summary</span>
                  <span className="text-gray-400 text-xs">{showDecisions ? '▲' : '▼'}</span>
                </button>
                {showDecisions && (
                  <div className="mt-3">
                    <AssignmentSummary decisions={assignmentDecisions} />
                  </div>
                )}
              </div>
            )}

            {/* Campaign Start Date */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="combined-start-date" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Start Date</label>
                <span className="text-[10px] text-gray-400">— when should the campaign begin?</span>
              </div>
              <input id="combined-start-date" type="date" value={campaignStartDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setCampaignStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
            </div>

            {/* View In */}
            <div className="px-5 pt-4 pb-2 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">View In</label>
              <div className="flex gap-2">
                {VIEW_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" name="combinedOutcomeView" value={opt.value}
                      checked={outcomeView === opt.value} onChange={() => setOutcomeView(opt.value)}
                      className="accent-violet-500 w-3.5 h-3.5" />
                    <span className={`text-xs font-medium ${outcomeView === opt.value ? 'text-violet-700' : 'text-gray-600'}`}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Generate */}
            <div className="p-5 bg-violet-50/60 rounded-b-2xl">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate || generating}
                className={`w-full py-3 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${canGenerate && !generating ? 'bg-violet-500 hover:bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {generating ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating Strategy Cards…</>
                ) : hasGenerated ? '🔀 Regenerate Intelligent Mix Cards' : '🔀 Generate Intelligent Mix Cards'}
              </button>
              {!canGenerate && !generating && <p className="text-xs text-gray-400 text-center mt-2">Enter a campaign topic to get started</p>}
            </div>
          </div>

          {/* RIGHT: Suggestions + Chat */}
          <div className="w-[36%] flex-shrink-0 flex flex-col gap-4">
            <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
              <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Campaign Suggestions</h3>
                {suggestionsLoading && <div className="animate-spin h-3.5 w-3.5 border-2 border-violet-400 border-t-transparent rounded-full" />}
              </div>
              {suggestions.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {suggestions.slice(0, 4).map((s) => (
                    <button key={s.id} type="button" onClick={() => applySuggestion(s)}
                      className="w-full text-left px-4 py-3 hover:bg-violet-50/60 transition-colors group">
                      <div className="text-xs font-semibold text-gray-800 group-hover:text-violet-700 leading-snug">{s.suggested_campaign_title || s.topic}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-400">{s.suggested_duration}w</span>
                        {s.opportunity_score != null && <span className="text-[10px] font-semibold text-violet-600">{Math.round(s.opportunity_score * 100)}% match</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : !suggestionsLoading ? (
                <p className="text-xs text-gray-400 px-4 py-4">No suggestions yet — enter a topic above.</p>
              ) : null}
            </div>

            <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowChat((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-violet-50/40 transition-colors">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">AI Campaign Chat</span>
                <span className="text-gray-400 text-xs">{showChat ? '▲' : '▼'}</span>
              </button>
              {showChat && companyId && (
                <div className="border-t border-gray-100">
                  <BoltCampaignChat
                    companyId={companyId}
                    // Parity context with BOLT Text / Creator — the shared
                    // /api/bolt/campaign-chat endpoint folds these into the
                    // grounding prompt so suggestions are company-, strategy-,
                    // and execution-aware (not generic clarification questions).
                    context={{
                      topic,
                      description,
                      goals,
                      tone,
                      audience: audience.join(', '),
                      strategicFocus,
                      selectedPlatforms,
                      selectedFormats: [...textFormats, ...creatorFormats],
                      formatFrequency: { ...textFrequency, ...creatorFrequency },
                      duration,
                      outcomeView,
                    }}
                    requestBlueprint
                    onApplySuggestion={applyCampaignBlueprint}
                  />
                </div>
              )}
            </div>

            {genError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{genError}</div>
            )}
            {execError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{execError}</div>
            )}
          </div>
        </div>

        {/* Strategy Cards */}
        {hasGenerated && (
          <div ref={cardsRef} className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Choose Your Strategy</h2>
              <span className="text-xs text-gray-500">{cards.length} options generated</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cards.map((card, idx) => (
                <StrategyCard
                  key={card.id} card={card} index={idx}
                  selected={selectedIds.includes(card.id)}
                  boltProgress={selectedIds.includes(card.id) ? execProgress : null}
                  execStartedAt={execStartedAt} anyExecuting={executing}
                  onSelect={() => handleCardSelect(card.id)}
                />
              ))}
            </div>
            {executing && (
              <p className="text-xs text-center text-gray-400 mt-2">
                {outcomeView === 'schedule' ? '🔀 BOLT is building your campaign — hang tight.' : '🔀 BOLT is crafting your combined campaign.'}
              </p>
            )}
          </div>
        )}

      </div>
    </div>

    {/* Confirm Modal */}
    {confirmingCard && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-full overflow-hidden">
          <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-6 py-4 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🔀</span>
              <h2 className="text-white font-bold text-base">Confirm BOLT Launch</h2>
            </div>
            <p className="text-violet-100 text-xs">Review your inputs before launching. BOLT will build exactly this.</p>
          </div>

          <div className="overflow-y-auto flex-1">
            <div className="px-6 pt-5 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Strategy</p>
              <p className="text-sm font-bold text-gray-900 leading-snug">{confirmingCard.title}</p>
              {confirmingCard.summary && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{confirmingCard.summary}</p>}
            </div>

            <div className="px-6 py-3 space-y-3">
              {/* Content Plan */}
              <div className="bg-violet-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600 mb-2">Content Plan</p>
                {allFormats.length > 0 ? (
                  <div className="space-y-1.5">
                    {textFormats.length > 0 && (
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">✍️ Text</p>
                    )}
                    {textFormats.map((fmt) => {
                      const meta = TEXT_FORMATS.find((f) => f.value === fmt);
                      const freq = textFrequency[fmt] ?? 3;
                      return (
                        <div key={fmt} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 font-medium">{meta?.icon} {meta?.label ?? fmt}</span>
                          <span className="text-amber-700 font-bold">{freq}×/wk × {duration}wk = <strong>{freq * duration}</strong></span>
                        </div>
                      );
                    })}
                    {creatorFormats.length > 0 && (
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mt-2">🎬 Creator</p>
                    )}
                    {creatorFormats.map((fmt) => {
                      const meta = CREATOR_FORMATS.find((f) => f.value === fmt);
                      const freq = creatorFrequency[fmt] ?? 3;
                      return (
                        <div key={fmt} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 font-medium">{meta?.icon} {meta?.label ?? fmt}</span>
                          <span className="text-blue-700 font-bold">{freq}×/wk × {duration}wk = <strong>{freq * duration}</strong></span>
                        </div>
                      );
                    })}
                    <div className="border-t border-violet-200 pt-1.5 mt-1.5 flex justify-between text-xs font-bold">
                      <span className="text-gray-600">Total</span>
                      <span className="text-violet-800">
                        {allFormats.reduce((s, f) => s + (allFrequency[f] ?? 3), 0)}×/wk × {duration}wk = {allFormats.reduce((s, f) => s + (allFrequency[f] ?? 3) * duration, 0)} pieces
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No formats selected — AI will decide the mix.</p>
                )}
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Goals</p>
                  {goals.length > 0 ? goals.map((g) => <p key={g} className="text-gray-700 font-medium">🎯 {g}</p>) : <p className="text-gray-400 italic">None selected</p>}
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Audience</p>
                  {audience.length > 0 ? <p className="text-gray-700 font-medium">👥 {audience.slice(0, 2).join(', ')}{audience.length > 2 ? ` +${audience.length - 2}` : ''}</p> : <p className="text-gray-400 italic">Not specified</p>}
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Output</p>
                  <p className="text-gray-700 font-medium">{outcomeView === 'daily_plan' ? '📅 Daily Plan' : outcomeView === 'schedule' ? '🗓️ Schedule' : '📋 Week Plan'}</p>
                </div>
                <div className="bg-violet-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400 mb-1.5">Mode</p>
                  <p className="text-violet-700 font-medium">🔀 Text + Creator</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Sharing</p>
                  <p className="text-gray-700 font-medium">{sharingMode === 'shared' ? '🔗 Shared' : sharingMode === 'unique' ? '✦ Unique' : '🤖 AI decides'}</p>
                </div>
              </div>

              {(goals.length === 0 || audience.length === 0 || allFormats.length === 0) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                  <strong>⚠️ Some inputs are not set:</strong>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {goals.length === 0 && <li>No goal selected — AI will choose a default</li>}
                    {audience.length === 0 && <li>No audience selected — AI will target a general audience</li>}
                    {allFormats.length === 0 && <li>No format selected — AI will decide the mix</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 px-6 pb-6 pt-2 flex-shrink-0 border-t border-gray-100">
            <button type="button" onClick={() => setConfirmingCard(null)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              ← Go Back
            </button>
            <button type="button" onClick={handleConfirmLaunch}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl bg-violet-500 hover:bg-violet-600 text-white transition-colors">
              Confirm &amp; Launch ⚡
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
