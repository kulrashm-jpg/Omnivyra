/** CompanyProfileForm — thin composition: controller hook + babel-verified section slices.
 *  All state/handlers in useCompanyProfileFormController; JSX in SectionsA/B/C. */
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
import CompanyProfileFormSectionsA from './CompanyProfileFormSectionsA';
import CompanyProfileFormSectionsB from './CompanyProfileFormSectionsB';
import CompanyProfileFormSectionsC from './CompanyProfileFormSectionsC';

export default function CompanyProfileForm({ d }: { d: ProfileState }) {
  const f = useCompanyProfileFormController(d);
  const {
    REFINE_STEPS, REFINE_STEP_DELAYS, actionableRefinementQuestions, activeProfile, addIdentityGuidance,
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
    targetCustomerPendingSave, toTitleCase, topCompetitorScore, uiConfidence, uiConfidenceScored,
    uiProblemTransformationCompletion, uiUnifiedCompletion, understandingDraft,
    unifiedCompetitorIntelligence, unifiedCompetitorOpportunities, unifiedCompetitors, updateActiveProfile,
    updateGuidedCompetitor, updateIntelligenceContext, updateOtherSocial, uploadBrandAsset, user,
    userGuidance, userRole,
  } = f;
  return (
    <>
      <div className="mx-auto mt-6 max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">Company Profile</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Keep your company profile current for trend relevance, recommendations, and Content Architect planning.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Last refined</div>
              <div className="mt-1 font-medium text-slate-900">{lastRefined}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard
              label="Profile confidence"
              value={uiConfidenceScored ? `${completionPercent(uiConfidence)}%` : 'Not yet scored'}
              tone="indigo"
            />
            <StatCard
              label="Overall completion"
              value={`${completionPercent(uiUnifiedCompletion)}%`}
            />
            <StatCard
              label="Intelligence readiness"
              value={`${completionPercent(intelligenceReadiness?.score ?? 0)}%`}
              tone="amber"
            />
            {canViewStrategicSections && (
              <StatCard
                label="Problem & transformation"
                value={`${completionPercent(
                  problemTransformationCompletion ?? uiProblemTransformationCompletion
                )}%`}
              />
            )}
            <StatCard
              label="Editing mode"
              value={isEditing ? 'Editing' : 'Viewing saved profile'}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-4">
            {[
              ['1', 'Source intake', 'Website, social accounts, public proof'],
              ['2', 'AI profile', 'Industry, audience, competitors, themes'],
              ['3', 'Guided chat', 'Customer, context, marketing, transformation'],
              ['4', 'Operating targets', 'Market Pulse and intelligence goals'],
            ].map(([step, title, detail]) => (
              <div key={step} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">Step {step}</div>
                <div className="mt-1 font-semibold text-slate-950">{title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
              </div>
            ))}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm p-3">
            {errorMessage}
          </div>
        )}
        {notFound && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3">
            Company profile not found. Please create one.
          </div>
        )}
        {successMessage && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm p-3">
            {successMessage}
          </div>
        )}

        {latestRefinement && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 text-sm text-indigo-900 space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-slate-900">Latest Refinement Insights</div>
              <div className="text-sm text-slate-600">
                Review the latest AI changes first, then open sources or unanswered questions only if you need deeper context.
              </div>
            </div>
            {latestRefinement.changed_fields && latestRefinement.changed_fields.length > 0 ? (
              <div>
                <div className="text-xs uppercase text-indigo-700 mb-2">Fields Updated</div>
                <ul className="list-disc list-inside space-y-1">
                  {latestRefinement.changed_fields.map((field) => (
                    <li key={field.field}>
                      <span className="font-medium">{field.field}</span> → {String(field.after)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-indigo-700">
                No field changes detected in the latest refinement.
              </div>
            )}
            {latestRefinement.source_summaries && latestRefinement.source_summaries.length > 0 && (
              <details className="bg-white rounded border border-indigo-200 p-3">
                <summary className="cursor-pointer text-sm font-medium">Sources used</summary>
                <div className="mt-2 space-y-2 text-xs text-gray-700">
                  {Array.from(
                    new Map(
                      latestRefinement.source_summaries.map((source) => [source.url, source])
                    ).values()
                  ).map((source, index) => (
                    <div key={`website_page-${source.url}-${index}`}>
                      <div className="font-semibold">{source.label}</div>
                      <div className="text-gray-500">{source.url}</div>
                      <div className="mt-1">{source.summary}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {actionableRefinementQuestions.length > 0 && (
                <details className="bg-white rounded border border-indigo-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Missing fields</summary>
                  <div className="mt-2 space-y-3 text-xs text-gray-700">
                    {actionableRefinementQuestions.map((question, index) => (
                      <div key={`missing-${question.field}-${index}`} className="space-y-1">
                        <div className="font-semibold">{question.field}</div>
                        <div>{question.question}</div>
                        <div className="text-gray-500">
                          Options: {question.options?.join(', ') || 'N/A'}
                        </div>
                        {question.allow_multiple && (
                          <div className="text-gray-400">Multiple selections allowed</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
          </div>
        )}

        {isLoading || isOnboardingResolving ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <div className="space-y-6">
            <CompanyProfileFormSectionsA f={f} />
            {showOnboardingContinuation ? (
              <>
                <CompanyProfileFormSectionsB f={f} />
                <CompanyProfileFormSectionsC f={f} />
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                Add optional social links, then refine with AI to reveal the generated company profile sections and continue to business details.
              </div>
            )}

            {showOnboardingContinuation && discoveredSocialProfiles.length > 0 && (
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-800 mb-2">Discovered Social Profiles</div>
                <ul className="text-xs text-gray-600 space-y-1">
                  {discoveredSocialProfiles.map((entry, index) => (
                    <li key={`${entry.platform}-${entry.url}-${index}`}>
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {entry.platform}: {entry.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showStandardProfileActions && (
            <div className="flex items-center gap-3 pt-2 border-t mt-6">
              {isEditing ? (
                <>
                  <button
                    onClick={() => { void saveProfile(); }}
                    disabled={isSaving || isRefining}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setDraftProfile(profile || activeProfile);
                      updateActiveProfile(profile || activeProfile);
                    }}
                    disabled={isSaving}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-200"
                >
                  Edit Profile
                </button>
              )}
            </div>
            )}
          </div>
        )}
      </div>
      <GuidedChatPanel
        title="Define target customer"
        description="Capture customer segment, ICP, pricing, sales motion, and commercial details through guided questions."
        open={targetCustomerPanelOpen}
        messages={targetCustomerMessages}
        input={targetCustomerInput}
        loading={targetCustomerLoading}
        onInputChange={setTargetCustomerInput}
        onSend={() => { void sendTargetCustomerMessage(); }}
        onClose={() => {
          setTargetCustomerPanelOpen(false);
          setTargetCustomerLoading(false);
        }}
        renderAssistantMessage={renderProblemTransformationAssistantMessage}
        extraActions={targetCustomerPendingSave ? (
          <button
            type="button"
            onClick={() => { void confirmSaveTargetCustomer(); }}
            disabled={isSaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      />
      <GuidedChatPanel
        title="Campaign purpose"
        description="Capture campaign objective, monetization intent, problem domains, and positioning angle."
        open={campaignPurposePanelOpen}
        messages={campaignPurposeMessages}
        input={campaignPurposeInput}
        loading={campaignPurposeLoading}
        onInputChange={setCampaignPurposeInput}
        onSend={() => { void sendCampaignPurposeMessage(); }}
        onClose={() => {
          setCampaignPurposePanelOpen(false);
          setCampaignPurposeLoading(false);
        }}
      />
      <GuidedChatPanel
        title="Marketing intelligence"
        description="Refine channels, content strategy, campaign focus, positioning, messages, advantages, and growth priorities."
        open={marketingIntelligencePanelOpen}
        messages={marketingIntelligenceMessages}
        input={marketingIntelligenceInput}
        loading={marketingIntelligenceChatLoading}
        onInputChange={setMarketingIntelligenceInput}
        onSend={() => { void sendMarketingIntelligenceMessage(); }}
        onClose={() => {
          setMarketingIntelligencePanelOpen(false);
          setMarketingIntelligenceChatLoading(false);
        }}
        extraActions={marketingIntelligencePendingSave ? (
          <button
            type="button"
            onClick={() => { void confirmSaveMarketingIntelligence(); }}
            disabled={isSaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      />
      <GuidedChatPanel
        title="Competitive intelligence"
        description="I'll share my read on your company, then map your direct competitors with their domains — confirm to save."
        open={competitorChatOpen}
        messages={competitorChatMessages}
        input={competitorChatInput}
        loading={competitorChatLoading}
        onInputChange={setCompetitorChatInput}
        onSend={() => { void sendCompetitorMessage(); }}
        onClose={() => { setCompetitorChatOpen(false); }}
        extraActions={competitorPendingSave && competitorPendingSave.length > 0 ? (
          <button
            type="button"
            onClick={() => { void confirmSaveCompetitors(); }}
            disabled={isSaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save competitors'}
          </button>
        ) : null}
      />
      <GuidedChatPanel
        title="Context intelligence"
        description="Capture markets, dependencies, workforce, regulatory exposure, and technology context for better relevance filtering."
        open={contextIntelligencePanelOpen}
        messages={contextIntelligenceMessages}
        input={contextIntelligenceInput}
        loading={contextIntelligenceChatLoading}
        onInputChange={setContextIntelligenceInput}
        onSend={() => { void sendContextIntelligenceMessage(); }}
        onClose={() => {
          setContextIntelligencePanelOpen(false);
          setContextIntelligenceChatLoading(false);
        }}
        extraActions={contextIntelligencePendingSave ? (
          <button
            type="button"
            onClick={() => { void confirmSaveContextIntelligence(); }}
            disabled={intelligenceContextSaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {intelligenceContextSaving ? 'Saving…' : 'Save context'}
          </button>
        ) : null}
      />
      <GuidedChatPanel
        title="Problem and transformation"
        description="Refine the problem, symptoms, transformation, mechanism, and authority domains."
        open={problemTransformationInferPanelOpen}
        messages={problemTransformationInferMessages}
        input={problemTransformationInferInput}
        loading={problemTransformationInferLoading}
        onInputChange={setProblemTransformationInferInput}
        onSend={() => { void sendProblemTransformationRefineMessage(); }}
        onClose={() => {
          setProblemTransformationInferPanelOpen(false);
          setProblemTransformationInferLoading(false);
        }}
        extraActions={pendingProblemTransformationUpdates ? (
          <button
            type="button"
            onClick={() => { void sendProblemTransformationRefineMessage('apply'); }}
            disabled={problemTransformationInferLoading || isSaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Apply & save'}
          </button>
        ) : null}
      />
    </>
  );
}

