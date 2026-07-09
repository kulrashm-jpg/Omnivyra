/** CompanyProfileFormSectionsA — verbatim JSX slice of the company-profile form (babel-verified sibling range 861-1300). */
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

export default function CompanyProfileFormSectionsA({ f }: { f: ReturnType<typeof useCompanyProfileFormController> }) {
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
              title="Please Provide This Information"
              description="Provide the company website and public URLs AI should use. The generated company profile sections appear below after refinement."
            >
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-gray-700">Website URL</label>
                  <input
                    value={activeProfile.website_url || ''}
                    readOnly={!canEditWebsiteUrl}
                    aria-readonly={!canEditWebsiteUrl}
                    onChange={(e) => {
                      if (canEditWebsiteUrl) handleChange('website_url', e.target.value);
                    }}
                    onBlur={(e) => {
                      if (canEditWebsiteUrl) normalizeUrlField('website_url', e.target.value);
                    }}
                    placeholder="https://yourcompany.com"
                    className={`mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ${
                      canEditWebsiteUrl
                        ? 'bg-white text-slate-900'
                        : 'bg-slate-100 text-slate-600 cursor-not-allowed'
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {isPrivilegedWebsiteEditor
                      ? 'Super admin and ContentArchi can update the canonical website. Other users can add social URLs but cannot edit this website.'
                      : canEditWebsiteUrl
                      ? "Enter your company website (e.g. https://yourcompany.com). We'll verify it and use it as the canonical AI refinement source. It locks once saved."
                      : activeProfile.website_url
                      ? 'Locked from company setup. For work emails, this is derived from the verified email domain and used as the canonical AI refinement source.'
                      : 'No canonical website is available. This should only happen for a super-admin approved exception; ask a super admin to add or approve the website before AI refinement.'}
                  </p>
                </div>

                <details className="rounded-xl border border-slate-200 bg-white p-4" open={isOnboardingPreRefine}>
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Social Accounts & Digital Footprint</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Add LinkedIn, Facebook, Instagram, YouTube, blogs, newsletters, directories, communities, or other public URLs in one place. Refine with AI will also crawl the website and fill social accounts it discovers.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {socialPreviewAccounts.map((account) => (
                          <span
                            key={account.field}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                              account.value
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}
                            title={account.value || `Add ${account.label}`}
                          >
                            {account.label}{account.value ? ' added' : ' pending'}
                          </span>
                        ))}
                      </div>
                    </div>
                  </summary>
                  <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {SOCIAL_ACCOUNT_FIELDS.map((account) => (
                        <div key={account.field}>
                          <label className="text-sm font-medium text-gray-700">{account.label}</label>
                          <input
                            value={String(activeProfile[account.field] || '')}
                            onChange={(e) => handleChange(account.field, e.target.value)}
                            onBlur={(e) => normalizeUrlField(account.field, e.target.value)}
                            placeholder={account.placeholder}
                            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-800">Other public URLs</div>
                          <p className="mt-1 text-xs text-slate-500">Use this for blogs, newsletters, Crunchbase, G2, Clutch, podcasts, communities, or profile pages.</p>
                        </div>
                        <button
                          type="button"
                          onClick={addOtherSocial}
                          className="rounded bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-50"
                        >
                          + Add URL
                        </button>
                      </div>
                      {(activeProfile.other_social_links || []).length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-gray-500">
                          No additional public URLs added.
                        </div>
                      )}
                      <div className="space-y-2">
                        {(activeProfile.other_social_links || []).map((item, index) => (
                          <div key={`intake-social-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-5">
                            <input
                              value={item?.label || ''}
                              onChange={(e) => updateOtherSocial(index, 'label', e.target.value)}
                              placeholder="Label (e.g. Crunchbase)"
                              className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <input
                              value={item?.url || ''}
                              onChange={(e) => updateOtherSocial(index, 'url', e.target.value)}
                              placeholder="https://..."
                              className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => removeOtherSocial(index)}
                                className="text-xs font-medium text-red-600"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>

              </div>
            </SectionCard>

            <SectionCard
              title="Brand Assets"
              description="Upload official logo and favicon assets after source intake so downstream content has the right brand marks."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(['logo_url', 'favicon_url'] as BrandAssetField[]).map((field) => {
                  const spec = BRAND_ASSET_SPECS[field];
                  const assetUrl = activeProfile[field] || '';
                  const isUploading = brandAssetUploading[field];
                  const uploadError = brandAssetErrors[field];
                  const inputId = `brand-asset-${field}`;

                  return (
                    <div key={field} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{spec.label}</div>
                          <div className="mt-1 text-xs text-slate-500">{spec.helper}</div>
                          <div className="mt-1 text-xs font-medium text-slate-700">{spec.recommendedSize}</div>
                        </div>
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {assetUrl ? (
                            <img
                              src={assetUrl}
                              alt={spec.label}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
                              {field === 'logo_url' ? 'Logo' : 'Icon'}
                            </div>
                          )}
                        </div>
                      </div>

                      <input
                        id={inputId}
                        type="file"
                        accept={BRAND_ASSET_ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          void uploadBrandAsset(field, event.target.files?.[0] ?? null);
                          event.currentTarget.value = '';
                        }}
                      />

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={inputId}
                          className={`inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium ${
                            !isUploading
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {isUploading ? 'Uploading...' : assetUrl ? `Replace ${spec.label}` : `Upload ${spec.label}`}
                        </label>
                        {assetUrl && isEditing && (
                          <button
                            type="button"
                            onClick={() => clearBrandAsset(field)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        )}
                        {assetUrl && (
                          <a
                            href={assetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Open asset
                          </a>
                        )}
                      </div>

                      {uploadError && (
                        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {uploadError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            {renderOnboardingRefineAction()}

            {showOnboardingContinuation && (
              <SectionCard
                title="Guided Capture"
                description="Use chat when a section needs business judgment instead of website extraction. Each flow writes back to its own section for review before saving."
                accent="indigo"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {([
                    ['Customer', 'ICP and sales model', openTargetCustomerPanel,
                      Boolean(String(activeProfile.target_audience ?? '').trim() || (activeProfile.target_audience_list ?? []).length)],
                    ['Marketing', 'Positioning and campaigns', openMarketingIntelligencePanel,
                      Boolean(String(activeProfile.brand_positioning ?? '').trim() || String(activeProfile.campaign_focus ?? '').trim())],
                    ['Transformation', 'Problem and authority', openRefineProblemTransformationPanel,
                      Boolean(String(activeProfile.core_problem_statement ?? '').trim() || String(activeProfile.desired_transformation ?? '').trim())],
                  ] as Array<[string, string, () => void, boolean]>).map(([label, detail, action, done]) => (
                    <button
                      key={String(label)}
                      type="button"
                      onClick={action}
                      className="rounded-xl border border-indigo-100 bg-white px-4 py-3 text-left shadow-sm hover:border-indigo-300"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-950">{label}</div>
                        <StatusChip done={done} doneLabel="Captured" pendingLabel="Add details" />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{detail}</div>
                    </button>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="AI-Populated Company Profile"
              description={
                isOnboardingPreRefine
                  ? 'These fields appear after AI refinement uses the website and public URLs above.'
                  : 'Start with company identity, official links, and core firmographic context so Content Architect has a reliable working base.'
              }
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={isOnboardingPreRefine ? 'md:col-span-2' : ''}>
                <label className="text-sm font-medium text-gray-700">Company</label>
                {canSelectMultipleCompanies && (
                  <input
                    type="text"
                    placeholder="Search companies..."
                    value={companySearchFilter}
                    onChange={(e) => setCompanySearchFilter(e.target.value)}
                    className="mt-1 mb-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                )}
                <select
                  value={companyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCompanyId(nextId);
                    setCompanyId(nextId);
                    updateActiveProfile({ ...activeProfile, company_id: nextId });
                  }}
                  disabled={(!isAdmin && !isContentArchitect) || isCompanyLoading}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Select company</option>
                  {filteredCompanies.map((company) => (
                    <option key={company.company_id} value={company.company_id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                {canCreateCompany && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateCompanyModal(true)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      + Create new company
                    </button>
                  </div>
                )}
                {companyId && (isAdmin || isContentArchitect) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href="/campaigns"
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      View campaigns &amp; weekly/daily plans →
                    </Link>
                  </div>
                )}
                {!isAdmin && !isContentArchitect && selectedCompanyName && (
                  <div className="text-xs text-gray-500 mt-1">Company locked for your role.</div>
                )}
                {isCompanyAdmin && companies.length > 0 && !companyId && (
                  <div className="text-xs text-amber-600 mt-1">Select your company above to view limited profile and go to campaigns.</div>
                )}
                {companyId && (
                  <div className="mt-3 pt-2 border-t border-gray-100">
                    <label className="text-sm font-medium text-gray-500 block mb-1">Company ID</label>
                    <div className="flex items-center gap-2">
                      <code
                        className="text-xs bg-gray-100 text-gray-800 px-2 py-1.5 rounded font-mono truncate flex-1"
                        title={companyId}
                      >
                        {companyId}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(companyId);
                            setCompanyIdCopied(true);
                            setTimeout(() => setCompanyIdCopied(false), 2000);
                          }
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
                      >
                        {companyIdCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Use this ID to open this company from Content Architect search or share the profile link.</p>
                  </div>
                )}
              </div>
              {/* View/Edit mode indicator */}
              {!isEditing && (
                <div className="col-span-full flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Viewing saved profile — click <strong className="text-gray-700 mx-1">Edit Profile</strong> below to make changes.
                </div>
              )}
              {!isOnboardingPreRefine && (
              <div>
                <label className="text-sm font-medium text-gray-700">Company Name</label>
                <input
                  value={activeProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {!isEditing && <SavedHint value={activeProfile.name} />}
              </div>
              )}
              {!isOnboardingPreRefine && (
                <>
              <div>
                <label className="text-sm font-medium text-gray-700">Industry</label>
                <input
                  value={displayFieldValue(activeProfile.industry, activeProfile.industry_list)}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {!isEditing && <SavedHint value={displayFieldValue(activeProfile.industry, activeProfile.industry_list)} />}
                {renderInlineRefinementQuestions('industry')}
                {industryReview?.conflict && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="font-semibold">Industry review needed</div>
                    <div className="mt-1">
                      User profile industry is <span className="font-medium">{industryReview.user_industry || 'not set'}</span>, while website/social evidence suggests <span className="font-medium">{industryReview.ai_suggested_industry || 'a different industry'}</span>.
                    </div>
                    {industryReview.ai_suggested_industry ? (
                      <button
                        type="button"
                        onClick={() => handleChange('industry', industryReview.ai_suggested_industry || '')}
                        className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
                      >
                        Use AI-suggested industry
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <input
                  value={displayFieldValue(activeProfile.category, activeProfile.category_list)}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {!isEditing && <SavedHint value={displayFieldValue(activeProfile.category, activeProfile.category_list)} />}
                {renderInlineRefinementQuestions('category')}
              </div>
                </>
              )}
              {!isOnboardingPreRefine && businessClassification && (
                <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">Business Classification</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                      Business model: {formatBusinessClassificationLabel(businessClassification.level_1)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                      Type: {formatBusinessClassificationLabel(businessClassification.level_2)}
                    </span>
                    {(businessClassification.level_3 || []).slice(0, 2).map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700"
                      >
                        Domain: {formatBusinessClassificationLabel(domain)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!isOnboardingPreRefine && (
              <div>
                <label className="text-sm font-medium text-gray-700">Geography</label>
                <input
                  value={displayFieldValue(activeProfile.geography, activeProfile.geography_list)}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {!isEditing && <SavedHint value={displayFieldValue(activeProfile.geography, activeProfile.geography_list)} />}
                {renderInlineRefinementQuestions('geography')}
            </div>
              )}
            </div>
            </SectionCard>
    </>
  );
}
