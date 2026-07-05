import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { joinList, splitToList } from './company-profile.types';
import { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import { ProblemTransformationPanel, CreateCompanyModal } from './company-profile-panels';
import CompanyProfileForm from './company-profile-form';
import { isValidCanonicalWebsite } from '../utils/companyProfileValidation';

export default function CompanyProfilePage() {
  const d = useCompanyProfileState();
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
    draftProfile,
    errorMessage,
    fetchWithAuth,
    filteredCompanies,
    generateMarketingIntelligence,
    handleChange,
    handleChangeArray,
    handleCompanyFactChange,
    handleCreateCompany,
    handleMissingAnswer,
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
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
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
    openProblemTransformationPanel,
    openRefineProblemTransformationPanel,
    openTargetCustomerPanel,
    overallProfileCompletion,
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
    router,
    saveProblemTransformation,
    saveProfile,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
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
    successMessage,
    targetCustomerInput,
    targetCustomerLoading,
    targetCustomerMessages,
    targetCustomerPanelOpen,
    toTitleCase,
    uiConfidence,
    uiOverallProfileCompletion,
    uiProblemTransformationCompletion,
    updateActiveProfile,
    updateOtherSocial,
    user,
    userRole,
  } = d;

  // Setup "Complete with AI" links land here with ?ai_refine=1 — auto-start the
  // Refine-with-AI chat once so the AI gathers the missing profile info, then
  // strip the param so a refresh/back doesn't re-fire it.
  const aiRefineTriggeredRef = React.useRef(false);
  React.useEffect(() => {
    if (aiRefineTriggeredRef.current) return;
    if (!router?.isReady) return;
    if (router.query?.ai_refine !== '1') return;
    if (isLoading || !companyId) return;
    aiRefineTriggeredRef.current = true;
    // Assess the prerequisite: Refine-with-AI researches the company from its
    // website, so it's only useful once a valid website is connected.
    if (isValidCanonicalWebsite(activeProfile?.website_url)) {
      // Website connected → let the AI research + run the guided refinement.
      void Promise.resolve(refineProfile?.());
    } else {
      // No website → refine has nothing to research. Open editing and guide the
      // user to add the website first (the unlock for AI completion), instead of
      // firing a refine that would immediately fail.
      setIsEditing?.(true);
      setSuccessMessage?.('Add your website below so AI can research your company, then use “Refine with AI” to complete the rest.');
    }
    const rest = { ...router.query };
    delete rest.ai_refine;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
  }, [router?.isReady, router?.query, isLoading, companyId, refineProfile, activeProfile?.website_url, setIsEditing, setSuccessMessage, router]);

  return (
    <div className="min-h-screen bg-gray-50">
      {showCompanyFactReviewPrompt && isCompanyAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-amber-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  Company Admin Confirmation
                </div>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  Review your company facts
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Competitor intelligence now uses team size, founded year, and revenue range. Please confirm these company facts every 6 months so reports stay aligned to the right peer set.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompanyFactReviewPrompt(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Close company facts reminder"
              >
                ×
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div>Team size: <span className="font-medium">{companyFacts.team_size || 'Missing'}</span></div>
              <div className="mt-1">Founded year: <span className="font-medium">{companyFacts.founded_year || 'Missing'}</span></div>
              <div className="mt-1">Revenue range: <span className="font-medium">{companyFacts.revenue_range || 'Missing'}</span></div>
              <div className="mt-3 text-xs text-slate-500">
                {profileReview.next_confirmation_due_at
                  ? `Due since ${new Date(profileReview.next_confirmation_due_at).toLocaleDateString()}.`
                  : 'No admin confirmation recorded yet.'}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCompanyFactReviewPrompt(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Remind me later
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  setShowCompanyFactReviewPrompt(false);
                }}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Review now
              </button>
            </div>
          </div>
        </div>
      )}
      <CompanyProfileForm d={d} />

      {/* Guided chat panels for target-customer, campaign-purpose, marketing-intelligence,
          context-intelligence and problem-transformation are rendered once by the form
          (GuidedChatPanel). The duplicate CompanyProfileChatPanel set was removed to stop
          two overlapping panels opening for the same flow. */}

      <ProblemTransformationPanel
        open={problemTransformationPanelOpen}
        onClose={() => !problemTransformationLoading && setProblemTransformationPanelOpen(false)}
        loading={problemTransformationLoading}
        questions={problemTransformationQuestions}
        answers={problemTransformationAnswers}
        onAnswerChange={(i, v) => {
          const next = [...problemTransformationAnswers];
          next[i] = v;
          setProblemTransformationAnswers(next);
        }}
        onSave={saveProblemTransformation}
      />

      {refinementHistory.length > 0 && (
        <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-6 mt-6 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Refinement History</h2>
          <div className="space-y-2 text-sm">
            {refinementHistory.map((entry) => (
              <div key={entry.id || entry.created_at} className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown time'}
                </div>
                <div className="mt-1">
                  {(entry.changed_fields || []).length} fields updated
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateCompanyModal
        open={showCreateCompanyModal && canCreateCompany}
        onClose={() => { setShowCreateCompanyModal(false); setCreateCompanyError(null); }}
        form={createCompanyForm}
        onFormChange={(updates) => setCreateCompanyForm((p) => ({ ...p, ...updates }))}
        onSubmit={handleCreateCompany}
        loading={createCompanyLoading}
        error={createCompanyError}
      />
    </div>
  );
}
