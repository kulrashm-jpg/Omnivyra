/** CompanyProfileFormSectionsC — verbatim JSX slice of the company-profile form (babel-verified sibling range 1728-2416). */
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

export default function CompanyProfileFormSectionsC({ f }: { f: ReturnType<typeof useCompanyProfileFormController> }) {
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
            <CompanyStrategyProfileCard
              companyId={companyId || activeProfile.company_id}
              profile={activeProfile}
              latestRefinement={latestRefinement}
              fetchWithAuth={fetchWithAuth}
              onProfileUpdated={updateActiveProfile}
              onNotifyUpdated={notifyCompanyProfileUpdated}
              onSuccess={setSuccessMessage}
              onError={setErrorMessage}
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Commercial Strategy</h3>
              <p className="text-sm text-gray-600 mb-4">
                Define your target customer and commercial model. These fields are locked from AI overwrite once you save.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openTargetCustomerPanel}
                  className="px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium hover:bg-indigo-200"
                >
                  Define Target Customer
                </button>
              </div>
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign Purpose & Strategic Intent</h4>
                {activeProfile.campaign_purpose_intent ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Primary Objective:</span>{' '}
                      {activeProfile.campaign_purpose_intent.primary_objective || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Campaign Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.campaign_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Monetization Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.monetization_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Dominant Problems:</span>{' '}
                      {(activeProfile.campaign_purpose_intent.dominant_problem_domains ?? []).length > 0
                        ? activeProfile.campaign_purpose_intent.dominant_problem_domains!.join(', ')
                        : '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Positioning Angle:</span>{' '}
                      {activeProfile.campaign_purpose_intent.brand_positioning_angle || '—'}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openCampaignPurposePanel}
                    className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-200"
                  >
                    Define Strategic Purpose
                  </button>
                )}
                {!isEditing && activeProfile.campaign_purpose_intent && (
                  <SavedHint value={[
                    activeProfile.campaign_purpose_intent.primary_objective,
                    activeProfile.campaign_purpose_intent.campaign_intent,
                    activeProfile.campaign_purpose_intent.monetization_intent,
                    activeProfile.campaign_purpose_intent.brand_positioning_angle,
                    ...(activeProfile.campaign_purpose_intent.dominant_problem_domains ?? []),
                  ].filter(Boolean).join(', ')} />
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Target customer segment</label>
                  <input
                    value={activeProfile.target_customer_segment || ''}
                    onChange={(e) => handleChange('target_customer_segment', e.target.value)}
                    placeholder="e.g. SMB, enterprise"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.target_customer_segment} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Ideal customer profile</label>
                  <textarea
                    value={activeProfile.ideal_customer_profile || ''}
                    onChange={(e) => handleChange('ideal_customer_profile', e.target.value)}
                    placeholder="1–2 sentences"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.ideal_customer_profile} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Pricing model</label>
                  <input
                    value={activeProfile.pricing_model || ''}
                    onChange={(e) => handleChange('pricing_model', e.target.value)}
                    placeholder="e.g. subscription, usage-based"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.pricing_model} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales motion</label>
                  <input
                    value={activeProfile.sales_motion || ''}
                    onChange={(e) => handleChange('sales_motion', e.target.value)}
                    placeholder="e.g. self-serve, sales-led"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.sales_motion} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Avg deal size</label>
                  <input
                    value={activeProfile.avg_deal_size || ''}
                    onChange={(e) => handleChange('avg_deal_size', e.target.value)}
                    placeholder="e.g. $5k, $50k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.avg_deal_size} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales cycle</label>
                  <input
                    value={activeProfile.sales_cycle || ''}
                    onChange={(e) => handleChange('sales_cycle', e.target.value)}
                    placeholder="e.g. 2 weeks, 3 months"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.sales_cycle} />}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Key metrics</label>
                  <input
                    value={activeProfile.key_metrics || ''}
                    onChange={(e) => handleChange('key_metrics', e.target.value)}
                    placeholder="e.g. MRR, CAC, LTV"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.key_metrics} />}
                </div>
              </div>
              {activeProfile.last_edited_by === 'user' && (
                <p className="text-xs text-gray-500 mt-2">
                  Last edited by you; refinement will not overwrite locked commercial fields.
                </p>
              )}
            </div>

            {(canViewStrategicSections || isCompanyAdmin) && (
              <IntelligenceContextSections
                context={intelligenceContext}
                readiness={intelligenceReadiness}
                loading={intelligenceContextLoading}
                saving={intelligenceContextSaving}
                isEditing={isEditing}
                quality={contextQuality}
                suggestions={enrichmentSuggestions}
                enrichmentLoading={enrichmentLoading}
                enrichmentReviewingId={enrichmentReviewingId}
                onChange={updateIntelligenceContext}
                onSave={() => { void saveIntelligenceContext(); }}
                onRunEnrichment={() => { void runIntelligenceEnrichment(); }}
                onOpenGuidedCapture={openContextIntelligencePanel}
                onReviewSuggestion={(suggestionId, action) => { void reviewIntelligenceEnrichment(suggestionId, action); }}
                onRequestEdit={() => setIsEditing(true)}
              />
            )}

            {canViewStrategicSections && (
            <SectionCard
              title="Market Pulse Defaults"
              description="Business context used to make Market Pulse more relevant and less noisy — market focus comes from Geography and competitors from Competitors above; this only keeps the extra strategic signals."
              collapsible
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Business model</label>
                  <input
                    value={marketPulseSettings.business_model || ''}
                    onChange={(e) => handleMarketPulseSettingChange('business_model', e.target.value)}
                    placeholder="e.g. SaaS, services, marketplace"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Provider type</label>
                  <input
                    value={marketPulseSettings.provider_type || ''}
                    onChange={(e) => handleMarketPulseSettingChange('provider_type', e.target.value)}
                    placeholder="e.g. AI-powered solution provider"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Domain role</label>
                  <input
                    value={marketPulseSettings.domain_role || ''}
                    onChange={(e) => handleMarketPulseSettingChange('domain_role', e.target.value)}
                    placeholder="e.g. AI-powered problem-solution provider"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Operating model</label>
                  <input
                    value={marketPulseSettings.operating_model || ''}
                    onChange={(e) => handleMarketPulseSettingChange('operating_model', e.target.value)}
                    placeholder="e.g. AI software platform"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Solution domains</label>
                  <textarea
                    value={joinList(marketPulseSettings.solution_domains)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('solution_domains', e.target.value)}
                    placeholder="Comma-separated: mental clarity, decision support"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Market alternatives</label>
                  <textarea
                    value={marketAlternativeLabels.join(', ')}
                    readOnly
                    placeholder="Generated during refinement"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Core offerings</label>
                  <textarea
                    value={joinList(marketPulseSettings.core_offerings)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('core_offerings', e.target.value)}
                    placeholder="Comma-separated: recruitment services, visa support"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Growth priorities</label>
                  <textarea
                    value={joinList(marketPulseSettings.growth_priorities)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('growth_priorities', e.target.value)}
                    placeholder="Comma-separated: expansion, partnerships, demand growth"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Partnership priorities</label>
                  <textarea
                    value={joinList(marketPulseSettings.partnership_priorities)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('partnership_priorities', e.target.value)}
                    placeholder="Comma-separated: channel partners, integration partners"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Critical hiring functions</label>
                  <textarea
                    value={joinList(marketPulseSettings.critical_hiring_functions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('critical_hiring_functions', e.target.value)}
                    placeholder="Comma-separated: engineering, delivery, immigration consultants"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Regulatory / policy sensitivity</label>
                  <textarea
                    value={joinList(marketPulseSettings.regulatory_policy_sensitivity)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('regulatory_policy_sensitivity', e.target.value)}
                    placeholder="Comma-separated: visas, labor laws, data privacy"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Default Market Pulse categories</label>
                  <textarea
                    value={joinList(marketPulseSettings.default_categories)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('default_categories', e.target.value)}
                    placeholder="Comma-separated: competitor_moves, growth_expansion"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Preferred regions</label>
                  <textarea
                    value={joinList(marketPulseSettings.preferred_regions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('preferred_regions', e.target.value)}
                    placeholder="Comma-separated: US, CA, UK"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Exclusions</label>
                  <textarea
                    value={joinList(marketPulseSettings.exclusions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('exclusions', e.target.value)}
                    placeholder="Comma-separated: crypto, consumer retail, LATAM"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </SectionCard>
            )}

            {canViewStrategicSections && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Marketing Intelligence</h3>
              <p className="text-sm text-gray-600 mb-4">
                AI-generated marketing insights from your profile and commercial strategy. Use <strong>Refine with AI</strong> to answer guided questions in a chat, or <strong>Generate Marketing Intelligence</strong> to fill from profile in one shot. Save to persist and lock from refinement overwrite.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openMarketingIntelligencePanel}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-sm font-medium hover:bg-emerald-200 disabled:opacity-50"
                >
                  Refine with AI
                </button>
                <button
                  type="button"
                  onClick={generateMarketingIntelligence}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  {marketingIntelligenceLoading ? 'Generating...' : 'Generate Marketing Intelligence'}
                </button>
              </div>
              {marketingIntelligenceLoading && (
                <div className="mb-4">
                  <AIGenerationProgress
                    isActive={true}
                    message="Generating marketing intelligence…"
                    expectedSeconds={50}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Marketing channels</label>
                  <input
                    value={activeProfile.marketing_channels || ''}
                    onChange={(e) => handleChange('marketing_channels', e.target.value)}
                    placeholder="e.g. social, email, events"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.marketing_channels} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Content strategy</label>
                  <textarea
                    value={activeProfile.content_strategy || ''}
                    onChange={(e) => handleChange('content_strategy', e.target.value)}
                    placeholder="High-level content approach"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.content_strategy} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Campaign focus</label>
                  <input
                    value={activeProfile.campaign_focus || ''}
                    onChange={(e) => handleChange('campaign_focus', e.target.value)}
                    placeholder="What campaigns typically focus on"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.campaign_focus} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Key messages</label>
                  <textarea
                    value={activeProfile.key_messages || ''}
                    onChange={(e) => handleChange('key_messages', e.target.value)}
                    placeholder="Core messages to convey"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.key_messages} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Brand positioning</label>
                  <textarea
                    value={activeProfile.brand_positioning || ''}
                    onChange={(e) => handleChange('brand_positioning', e.target.value)}
                    placeholder="How the brand wants to be perceived"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.brand_positioning} />}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Competitive advantages</label>
                  <textarea
                    value={activeProfile.competitive_advantages || ''}
                    onChange={(e) => handleChange('competitive_advantages', e.target.value)}
                    placeholder="Differentiators vs competitors"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {!isEditing && <SavedHint value={activeProfile.competitive_advantages} />}
                </div>
                <div className="md:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-indigo-950">AI messaging corrections</div>
                      <div className="text-xs text-indigo-800">Approve or guide the generated identity so future refinement keeps the intended positioning.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => approveStrategicField('messaging', 'key_messages')}
                        disabled={!String(activeProfile.key_messages || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve messages
                      </button>
                      <button
                        type="button"
                        onClick={() => approveStrategicField('positioning', 'brand_positioning')}
                        disabled={!String(activeProfile.brand_positioning || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve positioning
                      </button>
                      <button
                        type="button"
                        onClick={() => approveStrategicField('differentiation', 'competitive_advantages')}
                        disabled={!String(activeProfile.competitive_advantages || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve differentiation
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      value={identityGuidanceNote}
                      onChange={(e) => setIdentityGuidanceNote(e.target.value)}
                      placeholder="Example: avoid corporate tone, publication-first, target operators not startups"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addIdentityGuidance}
                      disabled={!identityGuidanceNote.trim() || isSaving}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Add guidance
                    </button>
                  </div>
                  {(userGuidance?.guidance_notes?.length || Object.keys(userGuidance?.messaging || {}).length) ? (
                    <div className="mt-2 text-xs text-indigo-900">
                      Saved guidance active for future refinement.
                    </div>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Growth priorities</label>
                  <textarea
                    value={activeProfile.growth_priorities || ''}
                    onChange={(e) => handleChange('growth_priorities', e.target.value)}
                    placeholder="Marketing/growth priorities"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            )}

            {canViewStrategicSections && (
            <SectionCard
              title="Intelligence Operating Target"
              description="The target the Intelligence page optimizes against — set the main objective, target metric, and time horizon so it can tell whether the company is behind, on track, or ahead."
              collapsible
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Primary objective</label>
                  <select
                    value={intelligenceSettings.primary_objective || ''}
                    onChange={(e) => handleIntelligenceSettingChange('primary_objective', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select objective</option>
                    <option value="authority_growth">Authority growth</option>
                    <option value="engagement_growth">Engagement growth</option>
                    <option value="lead_generation">Lead generation</option>
                    <option value="pipeline_growth">Pipeline growth</option>
                    <option value="revenue_acceleration">Revenue acceleration</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Primary target metric</label>
                  <select
                    value={intelligenceSettings.primary_target_metric || ''}
                    onChange={(e) => handleIntelligenceSettingChange('primary_target_metric', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select metric</option>
                    <option value="qualified_leads">Qualified leads</option>
                    <option value="active_leads">Active leads</option>
                    <option value="engagement_rate">Engagement rate</option>
                    <option value="campaigns_ready_to_scale">Campaigns ready to scale</option>
                    <option value="content_velocity">Content velocity</option>
                    <option value="authority_depth">Authority depth</option>
                    <option value="pipeline_value">Pipeline value</option>
                    <option value="revenue">Revenue</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Target value</label>
                  <input
                    value={intelligenceSettings.target_value || ''}
                    onChange={(e) => handleIntelligenceSettingChange('target_value', e.target.value)}
                    placeholder="e.g. 30 leads, 12 opportunities, $100k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Time horizon</label>
                  <select
                    value={intelligenceSettings.time_horizon || 'monthly'}
                    onChange={(e) => handleIntelligenceSettingChange('time_horizon', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Target note</label>
                  <textarea
                    value={intelligenceSettings.target_note || ''}
                    onChange={(e) => handleIntelligenceSettingChange('target_note', e.target.value)}
                    placeholder="Explain what success looks like, what kind of leads matter, or what commercial outcome should improve."
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </SectionCard>
            )}

            {canViewStrategicSections && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Problem & Transformation</h3>
              <p className="text-sm text-gray-600 mb-4">
                Core problem, pain symptoms, and desired transformation used for recommendation alignment.
                <br />
                <strong>Fill with AI</strong> asks guided questions and structures answers.
                <strong> Refine with AI</strong> suggests improvements and applies only after your agreement.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openInferProblemTransformationPanel}
                  disabled={!companyId || problemTransformationInferLoading}
                  className="px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium hover:bg-indigo-200 disabled:opacity-50"
                >
                  Infer from Profile
                </button>
                <button
                  type="button"
                  onClick={openProblemTransformationPanel}
                  disabled={!companyId || problemTransformationLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  Fill with AI
                </button>
                <button
                  type="button"
                  onClick={openRefineProblemTransformationPanel}
                  disabled={!companyId || problemTransformationInferLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  Refine with AI
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Core Problem Statement</label>
                  <textarea
                    value={activeProfile.core_problem_statement || ''}
                    onChange={(e) => handleChange('core_problem_statement', e.target.value)}
                    placeholder="One sentence: the core problem you solve"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Pain Symptoms</label>
                  <textarea
                    value={joinList(activeProfile.pain_symptoms)}
                    onChange={(e) => handleChangeArray('pain_symptoms', e.target.value)}
                    placeholder="Comma-separated: scope creep, delays, resource conflicts"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Awareness Gap</label>
                  <input
                    value={activeProfile.awareness_gap || ''}
                    onChange={(e) => handleChange('awareness_gap', e.target.value)}
                    placeholder="What target audience doesn't yet know"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Problem Impact</label>
                  <input
                    value={activeProfile.problem_impact || ''}
                    onChange={(e) => handleChange('problem_impact', e.target.value)}
                    placeholder="Business impact of the problem"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Life With Problem</label>
                  <textarea
                    value={activeProfile.life_with_problem || ''}
                    onChange={(e) => handleChange('life_with_problem', e.target.value)}
                    placeholder="Current state before solution"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Life After Solution</label>
                  <textarea
                    value={activeProfile.life_after_solution || ''}
                    onChange={(e) => handleChange('life_after_solution', e.target.value)}
                    placeholder="Desired state with solution"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Desired Transformation</label>
                  <textarea
                    value={activeProfile.desired_transformation || ''}
                    onChange={(e) => handleChange('desired_transformation', e.target.value)}
                    placeholder="Transformation you enable"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Transformation Mechanism</label>
                  <input
                    value={activeProfile.transformation_mechanism || ''}
                    onChange={(e) => handleChange('transformation_mechanism', e.target.value)}
                    placeholder="How you achieve the transformation"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Authority Domains</label>
                  <textarea
                    value={joinList(activeProfile.authority_domains)}
                    onChange={(e) => handleChangeArray('authority_domains', e.target.value)}
                    placeholder="Comma-separated: project management, agile, prioritization"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            )}
    </>
  );
}
