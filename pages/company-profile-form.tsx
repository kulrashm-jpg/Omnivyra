import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import type { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import { joinList, splitToList } from './company-profile.types';

type ProfileState = ReturnType<typeof useCompanyProfileState>;

export default function CompanyProfileForm({ d }: { d: ProfileState }) {
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
    handleIntelligenceSettingChange,
    handleMarketPulseSettingArrayChange,
    handleMarketPulseSettingChange,
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

  const marketPulseSettings = activeProfile.report_settings?.market_pulse ?? {};
  const intelligenceSettings = activeProfile.report_settings?.intelligence ?? {};

  return (
    <>
      <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-6 mt-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Company Profile</h1>
            <p className="text-sm text-gray-600">
              Keep your company profile current for trend relevance and recommendations.
            </p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <div>Last refined: {lastRefined}</div>
            <div>
              Confidence: {completionPercent(uiConfidence)}%
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div>
                Profile completion:{' '}
                {completionPercent(
                  overallProfileCompletion ?? uiOverallProfileCompletion
                )}
                %
              </div>
              {canViewStrategicSections && (
                <div>
                  Problem & Transformation:{' '}
                  {completionPercent(
                    problemTransformationCompletion ?? uiProblemTransformationCompletion
                  )}
                  %
                </div>
              )}
            </div>
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
          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 space-y-3">
            <div className="font-semibold">Latest Refinement Insights</div>
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
            {latestRefinement.missing_fields_questions &&
              latestRefinement.missing_fields_questions.length > 0 && (
                <details className="bg-white rounded border border-indigo-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Missing fields</summary>
                  <div className="mt-2 space-y-3 text-xs text-gray-700">
                    {latestRefinement.missing_fields_questions.map((question, index) => (
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

        {isLoading ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
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
              <div>
                <label className="text-sm font-medium text-gray-700">Company Name</label>
                <input
                  value={activeProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Industry</label>
                <input
                  value={activeProfile.industry || ''}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.industry_list, activeProfile.industry)}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <input
                  value={activeProfile.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.category_list, activeProfile.category)}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Website URL</label>
                <input
                  value={activeProfile.website_url || ''}
                  onChange={(e) => handleChange('website_url', e.target.value)}
                  onBlur={(e) => normalizeUrlField('website_url', e.target.value)}
                  placeholder="example.com"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI refinement crawls this website, your social profiles, blog, and any additional profiles to enrich all fields below.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">LinkedIn</label>
                <input
                  value={activeProfile.linkedin_url || ''}
                  onChange={(e) => handleChange('linkedin_url', e.target.value)}
                  placeholder="https://linkedin.com/company/yourpage"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Facebook</label>
                <input
                  value={activeProfile.facebook_url || ''}
                  onChange={(e) => handleChange('facebook_url', e.target.value)}
                  placeholder="https://facebook.com/yourpage"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Instagram</label>
                <input
                  value={activeProfile.instagram_url || ''}
                  onChange={(e) => handleChange('instagram_url', e.target.value)}
                  placeholder="https://instagram.com/yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">X (Twitter)</label>
                <input
                  value={activeProfile.x_url || ''}
                  onChange={(e) => handleChange('x_url', e.target.value)}
                  placeholder="https://x.com/yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">YouTube</label>
                <input
                  value={activeProfile.youtube_url || ''}
                  onChange={(e) => handleChange('youtube_url', e.target.value)}
                  placeholder="https://youtube.com/@yourchannel"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">TikTok</label>
                <input
                  value={activeProfile.tiktok_url || ''}
                  onChange={(e) => handleChange('tiktok_url', e.target.value)}
                  placeholder="https://tiktok.com/@yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Reddit</label>
                <input
                  value={activeProfile.reddit_url || ''}
                  onChange={(e) => handleChange('reddit_url', e.target.value)}
                  placeholder="https://reddit.com/r/yourcommunity"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Blog / Website Page</label>
                <input
                  value={activeProfile.blog_url || ''}
                  onChange={(e) => handleChange('blog_url', e.target.value)}
                  placeholder="https://example.com/blog"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Geography</label>
                <input
                  value={activeProfile.geography || ''}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.geography_list, activeProfile.geography)}
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-slate-50">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Company Facts</h3>
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
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Founded year</label>
                  <input
                    value={companyFacts.founded_year || ''}
                    onChange={(e) => handleCompanyFactChange('founded_year', e.target.value)}
                    placeholder="e.g. 2022"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Revenue range</label>
                  <input
                    value={companyFacts.revenue_range || ''}
                    onChange={(e) => handleCompanyFactChange('revenue_range', e.target.value)}
                    placeholder="e.g. $1M-$5M"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-500">
                Last confirmed: {profileReview.last_confirmed_at ? new Date(profileReview.last_confirmed_at).toLocaleDateString() : 'Not confirmed yet'}
                {' · '}
                Next due: {profileReview.next_confirmation_due_at ? new Date(profileReview.next_confirmation_due_at).toLocaleDateString() : 'After first admin confirmation'}
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Additional Digital Assets</h3>
                {isEditing && (
                  <button
                    type="button"
                    onClick={addOtherSocial}
                    className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-xs"
                  >
                    + Add
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-2">Add any other digital presence — communities (Slack, Discord, Circle), profile pages (Crunchbase, G2, Clutch), newsletters, podcasts, or other links. Refine with AI will crawl these too.</p>
              {(activeProfile.other_social_links || []).length === 0 && (
                <div className="text-xs text-gray-500">No additional profiles added.</div>
              )}
              <div className="space-y-2">
                {(activeProfile.other_social_links || []).map((item, index) => (
                  <div key={`social-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                      value={item?.label || ''}
                      onChange={(e) => updateOtherSocial(index, 'label', e.target.value)}
                      placeholder="Label (e.g. Pinterest)"
                      className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={item?.url || ''}
                      onChange={(e) => updateOtherSocial(index, 'url', e.target.value)}
                      placeholder="https://..."
                      className="md:col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => removeOtherSocial(index)}
                        className="md:col-span-1 text-xs text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Products & Services</label>
              <textarea
                value={activeProfile.products_services || ''}
                onChange={(e) => handleChange('products_services', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.products_services_list, activeProfile.products_services)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Target Audience</label>
              <textarea
                value={activeProfile.target_audience || ''}
                onChange={(e) => handleChange('target_audience', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.target_audience_list, activeProfile.target_audience)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={activeProfile.brand_voice || ''}
                onChange={(e) => handleChange('brand_voice', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.brand_voice_list, activeProfile.brand_voice)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Goals</label>
              <textarea
                value={activeProfile.goals || ''}
                onChange={(e) => handleChange('goals', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.goals_list, activeProfile.goals)}
              </div>
            </div>
            {canViewStrategicSections && (
              <div>
                <label className="text-sm font-medium text-gray-700">Competitors</label>
                <textarea
                  value={activeProfile.competitors || ''}
                  onChange={(e) => handleChange('competitors', e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.competitors_list, activeProfile.competitors)}
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
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Content Themes</label>
              <textarea
                value={activeProfile.content_themes || ''}
                onChange={(e) => handleChange('content_themes', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.content_themes_list, activeProfile.content_themes)}
              </div>
            </div>

            <div className="border-t pt-6 mt-6">
              {isRefining ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
                    <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {REFINE_STEPS[(refineStep - 1) % REFINE_STEPS.length]}
                  </div>
                  <div className="flex gap-1">
                    {REFINE_STEPS.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                          i < refineStep ? 'bg-indigo-500' : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">Step {refineStep} of {REFINE_STEPS.length} — this usually takes 20–45 seconds</p>
                </div>
              ) : (
                <button
                  onClick={refineProfile}
                  disabled={isSaving}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Refine with AI
                </button>
              )}
            </div>

            <div className="border-t pt-6 mt-6">
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
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Pricing model</label>
                  <input
                    value={activeProfile.pricing_model || ''}
                    onChange={(e) => handleChange('pricing_model', e.target.value)}
                    placeholder="e.g. subscription, usage-based"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales motion</label>
                  <input
                    value={activeProfile.sales_motion || ''}
                    onChange={(e) => handleChange('sales_motion', e.target.value)}
                    placeholder="e.g. self-serve, sales-led"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Avg deal size</label>
                  <input
                    value={activeProfile.avg_deal_size || ''}
                    onChange={(e) => handleChange('avg_deal_size', e.target.value)}
                    placeholder="e.g. $5k, $50k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales cycle</label>
                  <input
                    value={activeProfile.sales_cycle || ''}
                    onChange={(e) => handleChange('sales_cycle', e.target.value)}
                    placeholder="e.g. 2 weeks, 3 months"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Key metrics</label>
                  <input
                    value={activeProfile.key_metrics || ''}
                    onChange={(e) => handleChange('key_metrics', e.target.value)}
                    placeholder="e.g. MRR, CAC, LTV"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {activeProfile.last_edited_by === 'user' && (
                <p className="text-xs text-gray-500 mt-2">
                  Last edited by you; refinement will not overwrite locked commercial fields.
                </p>
              )}
            </div>

            {canViewStrategicSections && (
            <div className="border-t pt-6 mt-6">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Market Pulse Defaults</h3>
              <p className="text-sm text-gray-600 mb-4">
                Business context used to make Market Pulse more relevant and less noisy. Market focus comes from
                <span className="font-medium text-gray-800"> Geography</span> and competitors come from
                <span className="font-medium text-gray-800"> Competitors</span> in the main company profile, so this section only keeps the extra strategic signals.
              </p>
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus Source</div>
                  <div className="mt-1">{joinList(activeProfile.geography_list, activeProfile.geography) || 'Not set'}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Competitor Source</div>
                  <div className="mt-1">{joinList(activeProfile.competitors_list, activeProfile.competitors) || 'Not set'}</div>
                </div>
              </div>
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
            </div>
            )}

            {canViewStrategicSections && (
            <div className="border-t pt-6 mt-6">
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
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Campaign focus</label>
                  <input
                    value={activeProfile.campaign_focus || ''}
                    onChange={(e) => handleChange('campaign_focus', e.target.value)}
                    placeholder="What campaigns typically focus on"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
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
            <div className="border-t pt-6 mt-6">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Intelligence Operating Target</h3>
              <p className="text-sm text-gray-600 mb-4">
                This is the target the <strong>Intelligence</strong> page should optimize against. Set the main objective, the target metric, and the time horizon so the page can tell whether the company is behind, on track, or capable of surpassing the goal.
              </p>
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
            </div>
            )}

            {canViewStrategicSections && (
            <div className="border-t pt-6 mt-6">
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

            {latestRefinement?.missing_fields_questions &&
              latestRefinement.missing_fields_questions.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-amber-900">
                    Help us improve your company profile
                  </div>
                  {latestRefinement.missing_fields_questions.map((question, index) => {
                    const selected = missingFieldAnswers[question.field] || [];
                    return (
                      <div key={`${question.field}-${index}`} className="space-y-1">
                        <label className="text-xs font-medium text-amber-900">
                          {question.question}
                        </label>
                        {question.allow_multiple ? (
                          <select
                            multiple
                            value={selected}
                            onChange={(event) => {
                              const values = Array.from(event.target.selectedOptions).map(
                                (option) => option.value
                              );
                              handleMissingAnswer(question.field, values);
                            }}
                            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            {question.options?.map((option) => (
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
                            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            <option value="">Select an option</option>
                            {question.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            {activeProfile.social_profiles && activeProfile.social_profiles.length > 0 && (
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-800 mb-2">Discovered Social Profiles</div>
                <ul className="text-xs text-gray-600 space-y-1">
                  {activeProfile.social_profiles.map((entry, index) => (
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

            <div className="flex items-center gap-3 pt-2 border-t mt-6">
              {isEditing ? (
                <>
                  <button
                    onClick={saveProfile}
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
          </div>
        )}
      </div>
    </>
  );
}
