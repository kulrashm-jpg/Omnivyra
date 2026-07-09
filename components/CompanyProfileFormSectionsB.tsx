/** CompanyProfileFormSectionsB — verbatim JSX slice of the company-profile form (babel-verified sibling range 1304-1726). */
/** Part 3/3 of company-profile-form.tsx — verbatim split (barrel preserved; importers unchanged). */
import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import CompanyStrategyProfileCard from '../components/company/CompanyStrategyProfileCard';
import type { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import type {
  CompanyContextIntelligence,
  CompanyDependency,
  CompanyGeographicExposure,
  CompanyProfile,
  CompanyRegulatoryExposure,
  CompanyRevenueSegment,
  CompanyTechnologyDependency,
  CompanyWorkforceProfile,
} from '../pages/company-profile.types';
import { dedupeSocialProfiles, joinList, normalizeProfileSocialUrl, splitToList } from '../pages/company-profile.types';
import { isValidCanonicalWebsite } from '../utils/companyProfileValidation';

import { type ProfileState, type BrandAssetField, type InlineQuestionFieldKey, normalizeQuestionFieldKey, questionMatchesInlineField, questionMatchesAnyInlineField, formatBusinessClassificationLabel, BRAND_ASSET_SPECS, BRAND_ASSET_ACCEPT, SOCIAL_ACCOUNT_FIELDS, formatFileSize, prepareTransparentBrandAsset, StatCard, SectionCard, GuidedChatPanel } from './companyProfileFormSupportA';
import { StatusChip, SavedHint, IntelligenceContextSections } from './companyProfileFormSupportB';
import { useCompanyProfileFormController } from './companyProfileFormController';

export default function CompanyProfileFormSectionsB({ f }: { f: ReturnType<typeof useCompanyProfileFormController> }) {
  const {
    d, REFINE_STEPS, REFINE_STEP_DELAYS, actionableRefinementQuestions, activeProfile, addIdentityGuidance,
    addOtherSocial, approveStrategicField, brandAssetErrors, brandAssetUploading, businessClassification,
    calculateProblemTransformationCompletion, calculateProfileCompletion, campaignPurposeInput,
    campaignPurposeLoading, campaignPurposeMessages, campaignPurposePanelOpen, canCreateCompany,
    canEditWebsiteUrl, canSelectMultipleCompanies, canViewStrategicSections, canonicalFieldLabel,
    clearBrandAsset, companies, companyFacts, companyId, companyIdCopied, companySearchFilter,
    competitorChatInput, competitorChatLoading, competitorChatMessages, competitorChatOpen,
    competitorDetails, competitorIntelToShow, competitorPendingSave, competitorQuality,
    competitorScoreThreshold, competitorSuggestions, competitorThresholdMet, competitorUnderstanding,
    completionPercent, confirmSaveCompetitors, confirmSaveContextIntelligence,
    confirmSaveMarketingIntelligence, confirmSaveTargetCustomer, contextIntelligenceChatLoading,
    contextIntelligenceInput, contextIntelligenceMessages, contextIntelligencePanelOpen,
    contextIntelligencePendingSave, contextQuality, createCompanyError, createCompanyForm,
    createCompanyLoading, discoveredSocialProfiles, displayFieldValue, displayedCompetitorText,
    draftProfile, enrichmentLoading, enrichmentReviewingId, enrichmentSuggestions, errorMessage,
    factsLookupLoading, fetchWithAuth, fillFactsFromWikidata, filledSocialAccounts, filteredCompanies,
    generateMarketingIntelligence, getRefinementQuestionsForField, guidanceCompetitorKey,
    guidedCompetitorName, guidedCompetitorNote, guidedCompetitors, handleChange, handleChangeArray,
    handleCompanyFactChange, handleCreateCompany, handleIntelligenceSettingChange,
    handleMarketPulseSettingArrayChange, handleMarketPulseSettingChange, handleMissingAnswer,
    hasValidCanonicalWebsite, identityGuidanceNote, industryReview, intelligenceContext,
    intelligenceContextLoading, intelligenceContextSaving, intelligenceReadiness, intelligenceSettings,
    isAdmin, isAuthenticated, isCompanyAdmin, isCompanyLoading, isContentArchitect, isEditing, isLoading,
    isOnboardingMode, isOnboardingPreRefine, isOnboardingResolving, isPrivilegedWebsiteEditor, isRefining,
    isSaving, lastFetchError, lastFetchStatus, lastRefined, latestRefinement, lowConfidenceDomainContext,
    marketAlternativeLabels, marketPulseSettings, marketingIntelligenceChatLoading,
    marketingIntelligenceInput, marketingIntelligenceLoading, marketingIntelligenceMessages,
    marketingIntelligencePanelOpen, marketingIntelligencePendingSave, missingFieldAnswers,
    normalizeFieldKey, normalizeUrlField, notFound, notifyCompanyProfileUpdated,
    onboardingContinuationVisible, openCampaignPurposePanel, openCompetitorChat,
    openContextIntelligencePanel, openInferProblemTransformationPanel, openMarketingIntelligencePanel,
    openProblemTransformationPanel, openRefineProblemTransformationPanel, openTargetCustomerPanel,
    pendingProblemTransformationUpdates, persistedCompetitorIntel, pinnedGuidedCompetitors,
    primarySocialKeys, problemTransformationAnswers, problemTransformationCompletion,
    problemTransformationInferInput, problemTransformationInferLoading, problemTransformationInferMessages,
    problemTransformationInferPanelOpen, problemTransformationLoading, problemTransformationPanelOpen,
    problemTransformationQuestions, profile, profileReview, profileReviewDue, refineProfile, refineStep,
    refinementHistory, refreshCompanies, rejectedGuidedCompetitors, removeOtherSocial,
    renderInlineRefinementQuestions, renderOnboardingRefineAction,
    renderProblemTransformationAssistantMessage, reviewIntelligenceEnrichment, router,
    runIntelligenceEnrichment, saveCompetitorUnderstanding, saveGuidanceDraft, saveIntelligenceContext,
    saveProblemTransformation, saveProfile, saveUserGuidance, savingUnderstanding, selectedCompanyId,
    selectedCompanyName, sendCampaignPurposeMessage, sendCompetitorMessage, sendContextIntelligenceMessage,
    sendMarketingIntelligenceMessage, sendProblemTransformationRefineMessage, sendTargetCustomerMessage,
    setBrandAssetError, setBrandAssetErrors, setBrandAssetUploading, setCampaignPurposeInput,
    setCampaignPurposeLoading, setCampaignPurposeMessages, setCampaignPurposePanelOpen, setCompanyId,
    setCompanyIdCopied, setCompanySearchFilter, setCompetitorChatInput, setCompetitorChatOpen,
    setContextIntelligenceChatLoading, setContextIntelligenceInput, setContextIntelligenceMessages,
    setContextIntelligencePanelOpen, setCreateCompanyError, setCreateCompanyForm, setCreateCompanyLoading,
    setDraftProfile, setErrorMessage, setFactsLookupLoading, setGuidedCompetitorName,
    setGuidedCompetitorNote, setIdentityGuidanceNote, setIsEditing, setIsLoading, setIsRefining,
    setIsSaving, setLastFetchError, setLastFetchStatus, setLatestRefinement,
    setMarketingIntelligenceChatLoading, setMarketingIntelligenceInput, setMarketingIntelligenceLoading,
    setMarketingIntelligenceMessages, setMarketingIntelligencePanelOpen, setMissingFieldAnswers,
    setNotFound, setOverallProfileCompletion, setPendingProblemTransformationUpdates,
    setProblemTransformationAnswers, setProblemTransformationCompletion,
    setProblemTransformationInferInput, setProblemTransformationInferLoading,
    setProblemTransformationInferMessages, setProblemTransformationInferPanelOpen,
    setProblemTransformationLoading, setProblemTransformationPanelOpen, setProblemTransformationQuestions,
    setProfile, setRefineStep, setRefinementHistory, setSavingUnderstanding, setSelectedCompanyId,
    setShowCompanyFactReviewPrompt, setShowCreateCompanyModal, setSuccessMessage, setTargetCustomerInput,
    setTargetCustomerLoading, setTargetCustomerMessages, setTargetCustomerPanelOpen, setUnderstandingDraft,
    showCompanyFactReviewPrompt, showCreateCompanyModal, showOnboardingContinuation,
    showStandardProfileActions, skipOnboardingRefinement, socialPreviewAccounts, successMessage,
    targetCustomerInput, targetCustomerLoading, targetCustomerMessages, targetCustomerPanelOpen,
    targetCustomerPendingSave, toTitleCase, topCompetitorScore, uiConfidence,
    uiProblemTransformationCompletion, uiUnifiedCompletion, understandingDraft,
    unifiedCompetitorIntelligence, unifiedCompetitorOpportunities, unifiedCompetitors, updateActiveProfile,
    updateGuidedCompetitor, updateIntelligenceContext, updateOtherSocial, uploadBrandAsset, user,
    userGuidance, userRole,
  } = f;
  return (
    <>
            <SectionCard
              title="Company Facts"
              description="These confirmed business facts support competitor analysis, market positioning, and downstream recommendation quality."
            >
            <div className="border rounded-xl p-4 bg-slate-50">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500">
                    These are firmographic facts used in competitor intelligence and should be confirmed by a company admin every 6 months.
                  </p>
                </div>
                <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                  profileReviewDue ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {profileReviewDue ? 'Admin confirmation due' : 'Admin confirmed'}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Team size</label>
                  <input
                    value={companyFacts.team_size || ''}
                    onChange={(e) => handleCompanyFactChange('team_size', e.target.value)}
                    placeholder="e.g. 11-50"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={companyFacts.team_size} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Founded year</label>
                  <input
                    value={companyFacts.founded_year || ''}
                    onChange={(e) => handleCompanyFactChange('founded_year', e.target.value)}
                    placeholder="e.g. 2022"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={companyFacts.founded_year} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Revenue range</label>
                  <input
                    value={companyFacts.revenue_range || ''}
                    onChange={(e) => handleCompanyFactChange('revenue_range', e.target.value)}
                    placeholder="e.g. $1M-$5M"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={companyFacts.revenue_range} />}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void fillFactsFromWikidata(); }}
                  disabled={factsLookupLoading}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 disabled:opacity-50"
                >
                  {factsLookupLoading ? 'Checking Wikidata…' : 'Fill from Wikidata'}
                </button>
                <span className="text-[11px] text-gray-500">Pulls founded year / size / revenue from public data where available; fill the rest in yourself.</span>
              </div>
              <div className="mt-3 text-xs text-gray-500">
                Last confirmed: {profileReview.last_confirmed_at ? new Date(profileReview.last_confirmed_at).toLocaleDateString() : 'Not confirmed yet'}
                {' · '}
                Next due: {profileReview.next_confirmation_due_at ? new Date(profileReview.next_confirmation_due_at).toLocaleDateString() : 'After first admin confirmation'}
              </div>
            </div>
            </SectionCard>

            <SectionCard
              title="Messaging & Audience"
              description="These are the main inputs Content Architect will keep revisiting when building messaging, themes, and competitor-aware campaign directions."
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Products & Services</label>
              <textarea
                value={displayFieldValue(activeProfile.products_services, activeProfile.products_services_list)}
                onChange={(e) => handleChange('products_services', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={displayFieldValue(activeProfile.products_services, activeProfile.products_services_list)} />}
              {renderInlineRefinementQuestions('products_services')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Target Audience</label>
              <textarea
                value={displayFieldValue(activeProfile.target_audience, activeProfile.target_audience_list)}
                onChange={(e) => handleChange('target_audience', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={displayFieldValue(activeProfile.target_audience, activeProfile.target_audience_list)} />}
              {renderInlineRefinementQuestions('target_audience')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={displayFieldValue(activeProfile.brand_voice, activeProfile.brand_voice_list)}
                onChange={(e) => handleChange('brand_voice', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={displayFieldValue(activeProfile.brand_voice, activeProfile.brand_voice_list)} />}
              {renderInlineRefinementQuestions('brand_voice')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Goals</label>
              <textarea
                value={displayFieldValue(activeProfile.goals, activeProfile.goals_list)}
                onChange={(e) => handleChange('goals', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={displayFieldValue(activeProfile.goals, activeProfile.goals_list)} />}
              {renderInlineRefinementQuestions('goals')}
            </div>
            {(canViewStrategicSections || isCompanyAdmin) && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-gray-700">Competitors</label>
                  <button
                    type="button"
                    onClick={() => { void openCompetitorChat(); }}
                    disabled={competitorChatLoading}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {competitorChatLoading ? 'Thinking…' : '✨ Suggest with AI'}
                  </button>
                </div>
                <textarea
                  value={displayedCompetitorText}
                  onChange={(e) => handleChange('competitors', e.target.value)}
                  rows={2}
                  placeholder="Same-category product competitors, comma-separated"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {competitorIntelToShow.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-indigo-900">Competitive intelligence</div>
                      {competitorPendingSave && competitorPendingSave.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 whitespace-nowrap">Not saved yet</span>
                          <button
                            type="button"
                            onClick={() => { void confirmSaveCompetitors(); }}
                            disabled={isSaving}
                            className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50 whitespace-nowrap"
                          >
                            {isSaving ? 'Saving…' : 'Save competitors'}
                          </button>
                        </div>
                      ) : (
                        <StatusChip done doneLabel="Saved — shows next time" />
                      )}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {competitorIntelToShow.map((c) => (
                        <li key={c.name} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium text-slate-800">{c.name}</span>
                          {c.domain ? (
                            <a
                              href={`https://${c.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              {c.domain}
                            </a>
                          ) : null}
                          {c.offering ? <span className="text-slate-500">— {c.offering}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(competitorDetails.length > 0 || lowConfidenceDomainContext) ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        Top match: {topCompetitorScore != null ? `${Math.round(topCompetitorScore)}%` : 'Not scored'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${
                        competitorThresholdMet ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {competitorThresholdMet ? `${Math.round(competitorScoreThreshold)}%+ match` : `Below ${Math.round(competitorScoreThreshold)}%`}
                      </span>
                    </div>
                    {competitorDetails.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {competitorDetails.map((competitor) => (
                        <span
                          key={competitor.name}
                          className="rounded-full border border-slate-200 bg-white px-2 py-1"
                        >
                          {competitor.name}: {Math.round(Number(competitor.score ?? 0))}%
                          {!competitorThresholdMet && competitor.domain ? (
                            <span className="ml-1 text-slate-500">({competitor.domain})</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                    ) : null}
                    {lowConfidenceDomainContext ? (
                      <div className="mt-2">
                        <div className="font-semibold text-slate-800">Domain context</div>
                        <div className="mt-1 space-y-1">
                          {marketPulseSettings.provider_type ? <div>Provider type: {marketPulseSettings.provider_type}</div> : null}
                          {marketPulseSettings.domain_role ? <div>Domain role: {marketPulseSettings.domain_role}</div> : null}
                          {marketPulseSettings.operating_model ? <div>Operating model: {marketPulseSettings.operating_model}</div> : null}
                          {(marketPulseSettings.solution_domains ?? []).length > 0 ? (
                            <div>Solution domains: {(marketPulseSettings.solution_domains ?? []).join(', ')}</div>
                          ) : null}
                          {marketAlternativeLabels.length > 0 ? (
                            <div>Expanded context: {marketAlternativeLabels.join(', ')}</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* Cumulative company understanding — refined in chat on save, editable here, seeds the next session. */}
                <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">Company understanding</div>
                    <StatusChip done={Boolean(competitorUnderstanding)} doneLabel="Saved" pendingLabel="Not set" />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    The cumulative read of your company that seeds competitor intelligence. It&apos;s refined when you save competitors from the chat — and you can edit it here; a manual edit is kept and won&apos;t be overwritten by the AI.
                  </p>
                  <textarea
                    value={understandingDraft}
                    onChange={(e) => setUnderstandingDraft(e.target.value)}
                    rows={3}
                    placeholder="Run “Suggest with AI” to establish this, or write it yourself…"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={savingUnderstanding || understandingDraft.trim() === (competitorUnderstanding || '').trim()}
                      onClick={async () => { setSavingUnderstanding(true); await saveCompetitorUnderstanding(understandingDraft); setSavingUnderstanding(false); }}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {savingUnderstanding ? 'Saving…' : 'Save understanding'}
                    </button>
                    {competitorUnderstanding && understandingDraft.trim() === competitorUnderstanding.trim() ? (
                      <span className="text-xs font-medium text-blue-600">✓ Saved — seeds your next competitor session</span>
                    ) : null}
                  </div>
                </div>
                {unifiedCompetitorIntelligence ? (
                  <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/70 p-3 text-xs text-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-sky-950">Live competitor intelligence</div>
                        <div className="mt-0.5 text-sky-800">{unifiedCompetitorIntelligence.summary}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 font-semibold ${
                        unifiedCompetitorIntelligence.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : unifiedCompetitorIntelligence.status === 'limited'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {unifiedCompetitorIntelligence.status}
                      </span>
                    </div>
                    {unifiedCompetitors.length > 0 ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {unifiedCompetitors.map((competitor) => (
                          <div key={`${competitor.domain || competitor.name}-unified`} className="rounded-lg border border-sky-100 bg-white p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold text-slate-900">{competitor.name}</div>
                                <div className="text-slate-500">{competitor.domain || 'Profile competitor'}</div>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                                {competitor.confidence}
                              </span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-slate-700">
                              <div>Visibility: {competitor.scores.visibility_share}</div>
                              <div>Threat: {competitor.scores.discoverability_threat}</div>
                              <div>Authority gap: {competitor.scores.authority_gap}</div>
                              <div>Lead intent: {competitor.scores.commercial_overlap}</div>
                            </div>
                            <div className="mt-1 text-slate-500">
                              {competitor.sources.join(', ')} · {competitor.freshness}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-lg border border-sky-100 bg-white px-2 py-2 text-slate-600">
                        No verified live competitor overlap yet.
                      </div>
                    )}
                    {unifiedCompetitorOpportunities.length > 0 ? (
                      <div className="mt-3">
                        <div className="font-semibold text-sky-950">Competitor opportunities</div>
                        <div className="mt-2 space-y-2">
                          {unifiedCompetitorOpportunities.map((opportunity) => (
                            <div key={opportunity.id} className="rounded-lg border border-sky-100 bg-white px-2 py-2">
                              <div className="font-semibold text-slate-900">{opportunity.title}</div>
                              <div className="mt-1 text-slate-700">{opportunity.recommendation}</div>
                              <div className="mt-1 text-slate-500">
                                Priority {opportunity.priority_score} · {opportunity.confidence} confidence
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-indigo-950">AI competitor corrections</div>
                      <div className="text-xs text-indigo-800">Pin real competitors or mark weak suggestions so future refinement uses the signal.</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                    <input
                      value={guidedCompetitorName}
                      onChange={(e) => setGuidedCompetitorName(e.target.value)}
                      placeholder="Competitor name or domain"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <input
                      value={guidedCompetitorNote}
                      onChange={(e) => setGuidedCompetitorNote(e.target.value)}
                      placeholder="Why it matters, optional"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateGuidedCompetitor(guidedCompetitorName, 'pinned', guidedCompetitorNote);
                        setGuidedCompetitorName('');
                        setGuidedCompetitorNote('');
                      }}
                      disabled={!guidedCompetitorName.trim() || isSaving}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Pin
                    </button>
                  </div>
                  {competitorDetails.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {competitorDetails.map((competitor) => (
                        <span key={`guide-${competitor.name}`} className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-2 py-1 text-xs text-indigo-900">
                          {competitor.name}
                          <button
                            type="button"
                            onClick={() => updateGuidedCompetitor(competitor.name, 'pinned', competitor.rationale || null)}
                            className="font-semibold text-emerald-700"
                          >
                            Pin
                          </button>
                          <button
                            type="button"
                            onClick={() => updateGuidedCompetitor(competitor.name, 'rejected', 'Marked irrelevant by user.')}
                            className="font-semibold text-rose-700"
                          >
                            Reject
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {(pinnedGuidedCompetitors.length > 0 || rejectedGuidedCompetitors.length > 0) && (
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-indigo-900 md:grid-cols-2">
                      <div>
                        <div className="font-semibold">Pinned</div>
                        <div className="mt-1">{pinnedGuidedCompetitors.map((competitor) => competitor.name).join(', ') || 'None'}</div>
                      </div>
                      <div>
                        <div className="font-semibold">Rejected</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {rejectedGuidedCompetitors.length === 0 ? 'None' : rejectedGuidedCompetitors.map((competitor) => (
                            <button
                              key={`restore-${competitor.name}`}
                              type="button"
                              onClick={() => updateGuidedCompetitor(competitor.name, 'restored', 'Restored by user.')}
                              className="rounded-full border border-indigo-200 bg-white px-2 py-1"
                            >
                              Restore {competitor.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700">Unique Value</label>
              <textarea
                value={activeProfile.unique_value || ''}
                onChange={(e) => handleChange('unique_value', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={activeProfile.unique_value} />}
              {renderInlineRefinementQuestions('unique_value')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Content Themes</label>
              <textarea
                value={displayFieldValue(activeProfile.content_themes, activeProfile.content_themes_list)}
                onChange={(e) => handleChange('content_themes', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {!isEditing && <SavedHint value={displayFieldValue(activeProfile.content_themes, activeProfile.content_themes_list)} />}
              {renderInlineRefinementQuestions('content_themes')}
            </div>
            </div>
            </SectionCard>
    </>
  );
}
