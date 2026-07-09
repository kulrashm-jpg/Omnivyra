/** useCompanyProfileFormController — ALL state/effects/handlers of the company-profile form,
 *  extracted VERBATIM. Sections consume it via ReturnType (inferred contract). */
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

export function useCompanyProfileFormController(d: ProfileState) {
  const {
    REFINE_STEPS,
    REFINE_STEP_DELAYS,
    activeProfile,
    addOtherSocial,
    calculateProblemTransformationCompletion,
    calculateProfileCompletion,
    campaignPurposeInput,
    campaignPurposeLoading,
    campaignPurposeMessages,
    campaignPurposePanelOpen,
    canCreateCompany,
    canSelectMultipleCompanies,
    canViewStrategicSections,
    canonicalFieldLabel,
    companies,
    companyFacts,
    companyId,
    companyIdCopied,
    companySearchFilter,
    completionPercent,
    createCompanyError,
    createCompanyForm,
    createCompanyLoading,
    contextIntelligenceChatLoading,
    contextIntelligenceInput,
    contextIntelligenceMessages,
    contextIntelligencePendingSave,
    confirmSaveContextIntelligence,
    targetCustomerPendingSave,
    confirmSaveTargetCustomer,
    marketingIntelligencePendingSave,
    confirmSaveMarketingIntelligence,
    contextIntelligencePanelOpen,
    contextQuality,
    draftProfile,
    enrichmentLoading,
    enrichmentReviewingId,
    enrichmentSuggestions,
    errorMessage,
    fetchWithAuth,
    filteredCompanies,
    generateMarketingIntelligence,
    handleChange,
    handleChangeArray,
    handleCompanyFactChange,
    handleIntelligenceSettingChange,
    handleMarketPulseSettingArrayChange,
    handleMarketPulseSettingChange,
    handleCreateCompany,
    handleMissingAnswer,
    intelligenceContext,
    intelligenceContextLoading,
    intelligenceContextSaving,
    intelligenceReadiness,
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
    isOnboardingMode,
    isOnboardingResolving,
    isLoading,
    isRefining,
    isSaving,
    lastFetchError,
    lastFetchStatus,
    lastRefined,
    latestRefinement,
    marketingIntelligenceChatLoading,
    marketingIntelligenceInput,
    marketingIntelligenceLoading,
    marketingIntelligenceMessages,
    marketingIntelligencePanelOpen,
    missingFieldAnswers,
    normalizeFieldKey,
    normalizeUrlField,
    notFound,
    notifyCompanyProfileUpdated,
    onboardingContinuationVisible,
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
    openContextIntelligencePanel,
    openProblemTransformationPanel,
    openRefineProblemTransformationPanel,
    openTargetCustomerPanel,
    pendingProblemTransformationUpdates,
    problemTransformationAnswers,
    problemTransformationCompletion,
    problemTransformationInferInput,
    problemTransformationInferLoading,
    problemTransformationInferMessages,
    problemTransformationInferPanelOpen,
    problemTransformationLoading,
    problemTransformationPanelOpen,
    problemTransformationQuestions,
    profile,
    profileReview,
    profileReviewDue,
    refineProfile,
    refineStep,
    refinementHistory,
    refreshCompanies,
    removeOtherSocial,
    renderProblemTransformationAssistantMessage,
    reviewIntelligenceEnrichment,
    runIntelligenceEnrichment,
    router,
    saveProblemTransformation,
    saveIntelligenceContext,
    saveProfile,
    openCompetitorChat,
    sendCompetitorMessage,
    confirmSaveCompetitors,
    competitorChatOpen,
    setCompetitorChatOpen,
    competitorChatMessages,
    competitorChatInput,
    setCompetitorChatInput,
    competitorChatLoading,
    competitorSuggestions,
    competitorPendingSave,
    competitorUnderstanding,
    saveCompetitorUnderstanding,
    saveUserGuidance,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
    sendContextIntelligenceMessage,
    sendProblemTransformationRefineMessage,
    sendTargetCustomerMessage,
    setCampaignPurposeInput,
    setCampaignPurposeLoading,
    setCampaignPurposeMessages,
    setCampaignPurposePanelOpen,
    setCompanyId,
    setCompanyIdCopied,
    setCompanySearchFilter,
    setCreateCompanyError,
    setCreateCompanyForm,
    setCreateCompanyLoading,
    setDraftProfile,
    setErrorMessage,
    setIsEditing,
    setIsLoading,
    setIsRefining,
    setIsSaving,
    setLastFetchError,
    setLastFetchStatus,
    setLatestRefinement,
    setMarketingIntelligenceChatLoading,
    setMarketingIntelligenceInput,
    setMarketingIntelligenceLoading,
    setMarketingIntelligenceMessages,
    setMarketingIntelligencePanelOpen,
    setContextIntelligenceChatLoading,
    setContextIntelligenceInput,
    setContextIntelligenceMessages,
    setContextIntelligencePanelOpen,
    setMissingFieldAnswers,
    setNotFound,
    setOverallProfileCompletion,
    setPendingProblemTransformationUpdates,
    setProblemTransformationAnswers,
    setProblemTransformationCompletion,
    setProblemTransformationInferInput,
    setProblemTransformationInferLoading,
    setProblemTransformationInferMessages,
    setProblemTransformationInferPanelOpen,
    setProblemTransformationLoading,
    setProblemTransformationPanelOpen,
    setProblemTransformationQuestions,
    setProfile,
    setRefineStep,
    setRefinementHistory,
    setSelectedCompanyId,
    setShowCompanyFactReviewPrompt,
    setShowCreateCompanyModal,
    setSuccessMessage,
    setTargetCustomerInput,
    setTargetCustomerLoading,
    setTargetCustomerMessages,
    setTargetCustomerPanelOpen,
    showCompanyFactReviewPrompt,
    showCreateCompanyModal,
    skipOnboardingRefinement,
    successMessage,
    targetCustomerInput,
    targetCustomerLoading,
    targetCustomerMessages,
    targetCustomerPanelOpen,
    toTitleCase,
    uiConfidence,
    uiUnifiedCompletion,
    uiProblemTransformationCompletion,
    updateActiveProfile,
    updateIntelligenceContext,
    updateOtherSocial,
    user,
    userRole,
  } = d;

  // Editable "company understanding" draft — synced from the persisted value, editable by the user.
  const [understandingDraft, setUnderstandingDraft] = React.useState<string>(competitorUnderstanding || '');
  const [savingUnderstanding, setSavingUnderstanding] = React.useState(false);
  React.useEffect(() => { setUnderstandingDraft(competitorUnderstanding || ''); }, [competitorUnderstanding]);

  const [factsLookupLoading, setFactsLookupLoading] = React.useState(false);
  const fillFactsFromWikidata = async () => {
    if (!companyId) return;
    setFactsLookupLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/company-facts-lookup?companyId=${encodeURIComponent(companyId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const data = (await response.json().catch(() => null)) as
        | { facts?: { founded_year?: string | null; team_size?: string | null; revenue_range?: string | null }; matched_label?: string | null }
        | null;
      if (!response.ok || !data) throw new Error('Lookup failed');
      const facts = data.facts || {};
      const filled: string[] = [];
      // Only fill blanks — never overwrite what the user already entered.
      if (!companyFacts.founded_year && facts.founded_year) { handleCompanyFactChange('founded_year', facts.founded_year); filled.push('founded year'); }
      if (!companyFacts.team_size && facts.team_size) { handleCompanyFactChange('team_size', facts.team_size); filled.push('team size'); }
      if (!companyFacts.revenue_range && facts.revenue_range) { handleCompanyFactChange('revenue_range', facts.revenue_range); filled.push('revenue range'); }
      setIsEditing(true);
      setSuccessMessage(
        filled.length > 0
          ? `Filled ${filled.join(', ')} from Wikidata${data.matched_label ? ` (${data.matched_label})` : ''}. Review, add anything missing, then Save.`
          : 'No public firmographics found on Wikidata for this company — please fill these facts in manually, then Save.',
      );
    } catch (e) {
      setErrorMessage((e as Error).message || 'Could not look up company facts.');
    } finally {
      setFactsLookupLoading(false);
    }
  };

  const marketPulseSettings = activeProfile.report_settings?.market_pulse ?? {};
  const marketAlternativeLabels = (marketPulseSettings.market_alternatives ?? [])
    .slice(0, 3)
    .map((item) => [item.name, item.domain, item.category].filter(Boolean).join(' - '))
    .filter(Boolean);
  const competitorDetails = (marketPulseSettings.competitor_details ?? []).slice(0, 3);
  const competitorQuality = marketPulseSettings.competitor_quality ?? null;
  const unifiedCompetitorIntelligence = marketPulseSettings.unified_competitor_intelligence ?? null;
  const unifiedCompetitors = (unifiedCompetitorIntelligence?.competitors ?? []).slice(0, 5);
  const unifiedCompetitorOpportunities = (unifiedCompetitorIntelligence?.opportunities ?? []).slice(0, 3);
  const competitorScoreThreshold = Number(competitorQuality?.threshold ?? 85);
  const topCompetitorScore = competitorQuality?.highest_score ?? (
    competitorDetails.length
      ? Math.max(...competitorDetails.map((item) => Number(item.score ?? 0)))
      : null
  );
  const competitorThresholdMet = competitorQuality?.threshold_met ?? (
    topCompetitorScore != null ? topCompetitorScore >= competitorScoreThreshold : null
  );
  const displayedCompetitorText =
    joinList(activeProfile.competitors_list, activeProfile.competitors) ||
    competitorDetails.map((competitor) => competitor.name).filter(Boolean).join(', ');
  const lowConfidenceDomainContext = !competitorThresholdMet && (
    Boolean(marketPulseSettings.provider_type) ||
    Boolean(marketPulseSettings.domain_role) ||
    Boolean(marketPulseSettings.operating_model) ||
    Boolean((marketPulseSettings.solution_domains ?? []).length) ||
    marketAlternativeLabels.length > 0
  );
  const businessClassification =
    activeProfile.business_classification && typeof activeProfile.business_classification === 'object'
      ? activeProfile.business_classification
      : null;
  const filledSocialAccounts = SOCIAL_ACCOUNT_FIELDS
    .map((account) => ({
      ...account,
      value: String(activeProfile[account.field] || '').trim(),
    }))
    .filter((account) => account.value.length > 0);
  const socialPreviewAccounts = [
    ...filledSocialAccounts,
    ...SOCIAL_ACCOUNT_FIELDS.filter(
      (account) => !filledSocialAccounts.some((filled) => filled.field === account.field)
    ).map((account) => ({ ...account, value: '' })),
  ].slice(0, 2);
  const primarySocialKeys = new Set(
    SOCIAL_ACCOUNT_FIELDS
      .map((account) => {
        const normalized = normalizeProfileSocialUrl(String(activeProfile[account.field] || ''));
        return normalized ? `${account.platform}:${normalized}` : null;
      })
      .filter((key): key is string => Boolean(key)),
  );
  const discoveredSocialProfiles = dedupeSocialProfiles(activeProfile.social_profiles)
    .filter((entry) => !primarySocialKeys.has(`${entry.platform}:${entry.url}`));
  const hasValidCanonicalWebsite = React.useMemo(() => {
    return isValidCanonicalWebsite(activeProfile.website_url);
  }, [activeProfile.website_url]);
  const showOnboardingContinuation = !isOnboardingMode
    ? !isOnboardingResolving
    : onboardingContinuationVisible;
  const showStandardProfileActions = !isOnboardingMode || onboardingContinuationVisible;
  const isOnboardingPreRefine = isOnboardingMode && !showOnboardingContinuation;
  const intelligenceSettings = activeProfile.report_settings?.intelligence ?? {};
  const userGuidance = activeProfile.report_settings?.user_guidance ?? null;
  const industryReview = activeProfile.report_settings?.industry_review ?? null;
  const isPrivilegedWebsiteEditor = ['SUPER_ADMIN', 'CONTENT_ARCHITECT'].includes(String(userRole || '').toUpperCase());
  // Soft fallback: in onboarding, if no canonical website was auto-derived from the
  // verified work-email domain (e.g. the domain hosts no resolvable website), let the
  // user provide their own instead of being stuck on a read-only field. The server
  // (/api/company-profile) validates it and locks it once set — mirrored here.
  const canEditWebsiteUrl = isPrivilegedWebsiteEditor || (isOnboardingMode && !activeProfile.website_url);
  const guidedCompetitors = userGuidance?.competitors ?? [];
  const pinnedGuidedCompetitors = guidedCompetitors.filter((competitor) =>
    ['pinned', 'user_added', 'restored'].includes(competitor.state)
  );
  const rejectedGuidedCompetitors = guidedCompetitors.filter((competitor) =>
    ['rejected', 'removed'].includes(competitor.state)
  );
  // Below-field competitive-intelligence card: prefer fresh chat suggestions, else
  // the persisted user-guided competitors (with domains) so it survives reloads.
  const persistedCompetitorIntel = pinnedGuidedCompetitors
    .map((c) => ({ name: c.name, domain: c.domain ?? undefined, offering: c.rationale ?? undefined }))
    .filter((c) => c.name);
  const competitorIntelToShow = competitorSuggestions.length > 0 ? competitorSuggestions : persistedCompetitorIntel;
  const [guidedCompetitorName, setGuidedCompetitorName] = React.useState('');
  const [guidedCompetitorNote, setGuidedCompetitorNote] = React.useState('');
  const [identityGuidanceNote, setIdentityGuidanceNote] = React.useState('');
  const displayFieldValue = React.useCallback(
    (primary?: string | null, extracted?: string[] | null) => joinList(extracted, primary) || '',
    [],
  );
  const guidanceCompetitorKey = (value?: string | null) =>
    String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const saveGuidanceDraft = (
    nextGuidance: NonNullable<CompanyProfile['report_settings']>['user_guidance'],
    action: string,
    target?: string | null,
  ) => saveUserGuidance(nextGuidance ?? null, action, target);
  const updateGuidedCompetitor = (
    name: string,
    state: 'user_added' | 'pinned' | 'rejected' | 'removed' | 'restored',
    rationale?: string | null,
  ) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    const key = guidanceCompetitorKey(normalizedName);
    const existing = guidedCompetitors.filter((competitor) => guidanceCompetitorKey(competitor.name) !== key);
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      competitors: [
        ...existing,
        {
          name: normalizedName,
          state,
          source: state === 'rejected' || state === 'removed' ? 'rejected' : 'user_guided',
          rationale: rationale?.trim() || null,
          updated_at: new Date().toISOString(),
        },
      ],
    }, `competitor_${state}`, normalizedName);
  };
  const approveStrategicField = (
    section: 'positioning' | 'differentiation' | 'messaging',
    field: 'brand_positioning' | 'competitive_advantages' | 'key_messages',
  ) => {
    const value = String(activeProfile[field] || '').trim();
    if (!value) return;
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      messaging: {
        ...(userGuidance?.messaging || {}),
        [section]: {
          ai_value: value,
          approved_value: value,
          status: 'approved',
          updated_at: new Date().toISOString(),
        },
      },
    }, `approve_${section}`, field);
  };
  const addIdentityGuidance = () => {
    const text = identityGuidanceNote.trim();
    if (!text) return;
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      guidance_notes: [
        ...(userGuidance?.guidance_notes || []),
        {
          id: `guidance-${Date.now()}`,
          text,
          category: 'identity',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ],
    }, 'add_identity_guidance', 'identity');
    setIdentityGuidanceNote('');
  };
  const actionableRefinementQuestions = React.useMemo(() => {
    const questions = latestRefinement?.missing_fields_questions ?? [];
    const seen = new Set<string>();

    return questions.filter((question) => {
      if (!question?.field || !question?.question) return false;
      if (!questionMatchesAnyInlineField(question)) return false;

      const key = normalizeQuestionFieldKey(`${question.field}:${question.question}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [latestRefinement]);

  const getRefinementQuestionsForField = React.useCallback(
    (fieldKey: InlineQuestionFieldKey) =>
      actionableRefinementQuestions.filter((question) =>
        questionMatchesInlineField(question, fieldKey)
      ),
    [actionableRefinementQuestions],
  );
  const [brandAssetUploading, setBrandAssetUploading] = React.useState<Record<BrandAssetField, boolean>>({
    logo_url: false,
    favicon_url: false,
  });
  const [brandAssetErrors, setBrandAssetErrors] = React.useState<Record<BrandAssetField, string | null>>({
    logo_url: null,
    favicon_url: null,
  });

  const setBrandAssetError = (field: BrandAssetField, message: string | null) => {
    setBrandAssetErrors((prev) => ({ ...prev, [field]: message }));
  };

  const clearBrandAsset = (field: BrandAssetField) => {
    if (!isEditing) {
      setIsEditing(true);
    }
    updateActiveProfile({ ...activeProfile, [field]: '' });
    setBrandAssetError(field, null);
    setSuccessMessage(`${BRAND_ASSET_SPECS[field].label} removed. Click Save Profile to persist the change.`);
  };

  const uploadBrandAsset = async (field: BrandAssetField, file: File | null) => {
    if (!file) return;
    if (!isEditing) {
      setIsEditing(true);
    }
    if (!user?.userId) {
      setBrandAssetError(field, 'Your session is missing a user id, so upload is unavailable right now.');
      return;
    }

    const spec = BRAND_ASSET_SPECS[field];
    const normalizedType = file.type.toLowerCase();
    const isAllowedType = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(normalizedType);
    if (!isAllowedType) {
      setBrandAssetError(field, 'Only PNG, JPG, or WebP images are supported here.');
      return;
    }
    if (file.size > spec.maxBytes) {
      setBrandAssetError(field, `${spec.label} must be ${formatFileSize(spec.maxBytes)} or smaller.`);
      return;
    }

    setBrandAssetError(field, null);
    setBrandAssetUploading((prev) => ({ ...prev, [field]: true }));

    try {
      const preparedAsset = await prepareTransparentBrandAsset(file, field);
      const { width, height } = preparedAsset;

      const formData = new FormData();
      formData.append('file', preparedAsset.file);
      formData.append('width', String(width));
      formData.append('height', String(height));

      const response = await fetchWithAuth('/api/media/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = Array.isArray(data?.details) && data.details.length > 0
          ? data.details.join(', ')
          : (typeof data?.message === 'string' && data.message.trim())
            ? data.message.trim()
            : (typeof data?.error === 'string' && data.error.trim())
              ? data.error.trim()
              : null;
        throw new Error(detail || `Failed to upload ${spec.label.toLowerCase()}.`);
      }

      const fileUrl =
        data?.data?.file_url ||
        data?.data?.storage_url ||
        data?.file_url ||
        data?.storage_url;
      if (!fileUrl) {
        throw new Error('Upload completed but no file URL was returned.');
      }

      const nextProfile = { ...activeProfile, [field]: fileUrl };
      updateActiveProfile(nextProfile);

      if (!companyId) {
        throw new Error('Select a company before uploading brand assets.');
      }

      const saveResponse = await fetchWithAuth('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          company_id: companyId,
          [field]: fileUrl,
        }),
      });
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) {
        const detail =
          (typeof saveData?.error === 'string' && saveData.error.trim())
            ? saveData.error.trim()
            : (typeof saveData?.details === 'string' && saveData.details.trim())
              ? saveData.details.trim()
              : `Failed to save ${spec.label.toLowerCase()} to the company profile.`;
        throw new Error(detail);
      }

      const persistedProfile = saveData?.profile || nextProfile;
      updateActiveProfile(persistedProfile);
      setDraftProfile(persistedProfile);
      setProfile(persistedProfile);
      setNotFound(false);
      notifyCompanyProfileUpdated(persistedProfile?.company_id || companyId);
      setSuccessMessage(
        preparedAsset.autoRemovedBackground
          ? `${spec.label} uploaded, converted to a transparent PNG, and saved to this company profile.`
          : `${spec.label} uploaded and saved to this company profile.`,
      );
    } catch (error) {
      setBrandAssetError(
        field,
        error instanceof Error ? error.message : `Failed to upload ${spec.label.toLowerCase()}.`,
      );
    } finally {
      setBrandAssetUploading((prev) => ({ ...prev, [field]: false }));
    }
  };

  const renderInlineRefinementQuestions = (fieldKey: InlineQuestionFieldKey) => {
    const questions = getRefinementQuestionsForField(fieldKey);
    if (questions.length === 0) return null;

    return (
      <div className="mt-2 space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
        {questions.map((question, index) => {
          const selected = missingFieldAnswers[question.field] || [];
          const options = (question.options ?? []).filter(Boolean);

          return (
            <div key={`${fieldKey}-${question.field}-${index}`} className="space-y-1">
              <div className="text-xs font-medium text-indigo-900">{question.question}</div>
              {options.length > 0 ? (
                question.allow_multiple ? (
                  <select
                    multiple
                    value={selected}
                    onChange={(event) => {
                      const values = Array.from(event.target.selectedOptions).map(
                        (option) => option.value
                      );
                      handleMissingAnswer(question.field, values);
                    }}
                    className="w-full rounded-md border border-indigo-100 bg-white px-2 py-1 text-xs text-slate-800"
                  >
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={selected[0] || ''}
                    onChange={(event) =>
                      handleMissingAnswer(
                        question.field,
                        event.target.value ? [event.target.value] : []
                      )
                    }
                    className="w-full rounded-md border border-indigo-100 bg-white px-2 py-1 text-xs text-slate-800"
                  >
                    <option value="">Select an option</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <div className="text-xs text-indigo-700">
                  Type the answer directly in this field.
                </div>
              )}
              {options.length > 0 && selected.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-slate-500">Selected:</span>
                  {selected.map((value) => (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white"
                    >
                      {value}
                      <button
                        type="button"
                        onClick={() => handleMissingAnswer(question.field, selected.filter((v) => v !== value))}
                        className="leading-none text-indigo-100 hover:text-white"
                        aria-label={`Remove ${value}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderOnboardingRefineAction = () => (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
      {isRefining ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
            <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Saving social links and enriching from your website
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-500" />
          </div>
          <p className="text-xs text-slate-600">This can take a short moment. The website remains locked and will not be overwritten.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-slate-900">Refine company profile with AI</h3>
            <p className="mt-1 text-sm text-slate-600">
              Share the company website and any public social URLs first. AI will use those sources to generate category, industry details, audience, positioning, products, content themes, and follow-up questions.
            </p>
            {!hasValidCanonicalWebsite && (
              <p className="mt-2 text-xs font-medium text-rose-700">A valid company website is required before refinement.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
            <button
              type="button"
              onClick={refineProfile}
              disabled={isSaving || isRefining || !hasValidCanonicalWebsite}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refine with AI
            </button>
            {isOnboardingMode && (
              <button
                type="button"
                onClick={skipOnboardingRefinement}
                disabled={isSaving || isRefining}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return {
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
  };
}
