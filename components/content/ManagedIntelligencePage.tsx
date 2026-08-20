'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, BarChart2, FileText, Lightbulb, Loader2, PenLine, Sparkles, Target, TrendingUp } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import AIBlogCardModal from '../blog/AIBlogCardModal';
import { getDepthLabel, getFormatLabel, parseWordTarget } from './managed-intelligence/recommendations';
import { useManagedIntelligenceData } from './managed-intelligence/useManagedIntelligenceData';
import { PRIORITY_STYLES, type CreationModeFlavor, type ManagedIntelligenceProps as Props, type RecommendationCard } from './managed-intelligence/types';
import { buildOutlineContentBlocks } from '../../lib/blog/blogOutlineSkeleton';
import { buildShortformManualStub } from '../../lib/content/shortformManualStub';
import SuggestWithAIPanel from './SuggestWithAIPanel';
import { toGenerationInput, type ContentSuggestion } from '../../lib/content/contentSuggestionContract';

type CreationModeKind = 'ai' | 'outline' | 'manual' | 'starter';

export default function ManagedIntelligencePage({
  contentType,
  pageTitle,
  eyebrow,
  heading,
  icon,
  accentClassName,
  accentSurfaceClassName,
  backPath,
  createPath,
  templatePath,
  generatePath,
  formatOptions,
  defaultFormat,
  creationModePicker,
}: Props) {
  const router = useRouter();
  const { selectedCompanyId, selectedCompanyName, user, isLoading: authLoading } = useCompanyContext();
  const selectedFormat = typeof router.query.format === 'string' ? router.query.format : defaultFormat;
  const selectedFormatOption = formatOptions.find((option) => option.value === selectedFormat);
  const formatLabel = getFormatLabel(formatOptions, selectedFormat);
  const targetWords = parseWordTarget(selectedFormatOption?.wordRange, contentType === 'story' ? 1500 : 2000);
  const depthLabel = getDepthLabel(targetWords);
  const [creationMode, setCreationMode] = useState<CreationModeKind>('ai');
  const pickerEnabled = creationModePicker?.enabled === true;
  const pickerFlavor: CreationModeFlavor = creationModePicker?.flavor ?? 'longform';
  const pickerEditorPath = creationModePicker?.editorPath ?? '';

  const {
    loading,
    companyName,
    companyContext,
    existingItems,
    cards,
    cardSuggestions,
    suggestionsLoading,
    isAIModalOpen,
    setIsAIModalOpen,
    setCustomCards,
    buildCardBundle,
    publishedCount,
    draftCount,
    totalViews,
    topPerforming,
    actionItems,
  } = useManagedIntelligenceData({
    contentType,
    formatLabel,
    targetWords,
    depthLabel,
    selectedCompanyId,
    selectedCompanyName,
  });

  const normalizePostGenerationResult = (result: any) => {
    const generatedContent = typeof result?.platform_variant?.generated_content === 'string'
      ? result.platform_variant.generated_content
      : '';
    const masterContent = typeof result?.master_content?.content === 'string'
      ? result.master_content.content
      : '';
    const variantFailed =
      typeof result?.platform_variant?.generation_status === 'string' &&
      result.platform_variant.generation_status.toLowerCase() === 'failed';
    const placeholderDetected =
      generatedContent.includes('[PLATFORM ADAPTATION FAILED]') ||
      generatedContent.trim() === 'Based on master content.';

    if ((!variantFailed && !placeholderDetected) || !masterContent.trim()) {
      return result;
    }

    return {
      ...result,
      platform_variant: {
        ...result.platform_variant,
        generated_content: masterContent,
        generation_status: 'generated',
        adaptation_trace: {
          ...result.platform_variant?.adaptation_trace,
          adaptation_reason: 'Used master content fallback because platform adaptation failed.',
          actual_length_used: masterContent.length,
        },
      },
    };
  };

  const generatePostFromIdea = async (input: {
    topic: string;
    intent?: string;
    tone?: string;
    reason?: string;
    source: string;
  }) => {
    if (!selectedCompanyId) {
      throw new Error('Select a company before generating a post.');
    }

    const response = await fetch('/api/posts/generate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: selectedCompanyId,
        topic: input.topic,
        platform: 'linkedin',
        intent: input.intent,
        tone: input.tone || undefined,
        template_name: formatLabel,
        extra_instruction: input.reason || undefined,
      }),
    });

    const rawResult = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        (rawResult as { error?: string }).error || 'Failed to generate post',
      );
    }

    const result = normalizePostGenerationResult(rawResult);
    const prefillToken = `post_prefill_${Date.now()}`;
    try {
      sessionStorage.setItem(
        prefillToken,
        JSON.stringify({
          output: result,
          source: input.source,
          topic: input.topic,
          platform: 'linkedin',
          template_name: formatLabel,
        }),
      );
    } catch {
      // Ignore storage issues and still attempt navigation.
    }

    await router.push({
      pathname: '/posts/result',
      query: { prefill: prefillToken },
    });
  };

  /**
   * P1.6 — the single accept path for an AI-produced card.
   *
   * Extracted verbatim from AIBlogCardModal's `onCardCreated` so that "Suggest
   * with AI" reuses the EXISTING generation input instead of opening a parallel
   * pipeline: posts go through `generatePostFromIdea()` → /api/posts/generate →
   * runPostGeneration, everything else through the same template prefill route.
   */
  const acceptAiCard = async (card: {
    topic: string;
    reason?: string;
    intent: RecommendationCard['intent'];
    tone?: string;
    priority?: 'high' | 'medium' | 'low';
  }) => {
    const token = `ai_card_${contentType.replace(/[^a-z]/g, '_')}_${Date.now()}`;
    try {
      sessionStorage.setItem(token, JSON.stringify(card));
    } catch {
      // Ignore storage issues here and continue through route prefills.
    }

    setCustomCards((previous) => [
      {
        topic: card.topic,
        reason: card.reason || 'Custom recommendation created with AI chat.',
        intent: card.intent,
        priority: card.priority || 'medium',
      },
      ...previous,
    ]);

    if (contentType === 'post') {
      await generatePostFromIdea({
        topic: card.topic,
        intent: card.intent,
        tone: card.tone,
        reason: card.reason,
        source: 'post_ai_card',
      });
      return;
    }

    void router.push({
      pathname: templatePath,
      query: {
        format: selectedFormat,
        prefill_source: `${contentType.replace('-', '_')}_ai_card`,
        prefill_topic: card.topic,
        prefill_reason: card.reason || '',
        prefill_priority: card.priority || 'medium',
        prefill_intent: card.intent,
        prefill_tone: card.tone || '',
        prefill_card: token,
      },
    });
  };

  /**
   * P1.6 — Accept & Continue. `toGenerationInput` maps the suggestion onto the
   * existing card shape; from there the flow is byte-identical to accepting an
   * AI chat card. Note `platform_guidance` is intentionally dropped by that
   * mapper, so an accepted suggestion cannot make the master draft
   * platform-specific.
   */
  const acceptSuggestion = async (suggestion: ContentSuggestion) => {
    await acceptAiCard(toGenerationInput(suggestion));
  };

  // G18: navigate to editor with an outline prefill stub (no API call).
  const openEditorWithOutline = () => {
    if (!pickerEditorPath) return;
    const token = `${contentType.replace(/[^a-z]/g, '_')}_outline_prefill_${Date.now()}`;
    const stub = {
      output: {
        title: '',
        excerpt: '',
        content_html: '',
        tags: [],
        category: '',
        seo_meta_title: '',
        seo_meta_description: '',
        key_insights: [],
        content_blocks: buildOutlineContentBlocks(contentType.replace('-', ' ')),
      },
      source: `${contentType.replace('-', '_')}_creation_mode_picker_outline`,
      target_word_count: targetWords,
      format_type: selectedFormat,
      template_name: 'Outline starter',
    };
    try {
      sessionStorage.setItem(token, JSON.stringify(stub));
    } catch {
      // sessionStorage write failure is non-fatal — editor will fall back to blank.
    }
    void router.push({ pathname: pickerEditorPath, query: { prefill: token, format: selectedFormat } });
  };

  // G18: open the editor with no prefill — pure blank manual mode (longform).
  const openEditorBlank = () => {
    if (!pickerEditorPath) return;
    void router.push({ pathname: pickerEditorPath, query: { format: selectedFormat } });
  };

  // G18.3 — shortform manual mode (Posts): land on ShortformResultPage with a
  // sentinel-marked empty stub. The result page detects creation_mode='manual'
  // and renders a "Continue to scheduler" CTA. The scheduler is where editing
  // actually happens (ShortformResultPage is a viewer, not an editor).
  const openShortformManualResult = () => {
    if (!pickerEditorPath) return;
    const token = `${contentType.replace(/[^a-z]/g, '_')}_manual_stub_${Date.now()}`;
    const stub = buildShortformManualStub({
      platform: 'linkedin',
      topic: `New ${contentType} draft`,
      formatFamily: selectedFormat,
    });
    try {
      sessionStorage.setItem(token, JSON.stringify(stub));
    } catch {
      // sessionStorage write failure is non-fatal — result page will show the
      // standard empty state with a Create CTA. User can retry.
    }
    void router.push({ pathname: pickerEditorPath, query: { prefill: token, format: selectedFormat } });
  };

  // P1.8 — only AUTH blocks first render. The company-library and profile reads
  // behind `loading` are enrichment for the Recommended Cards section, and used
  // to hold the whole page — including the creation-mode picker, both entry
  // cards and Suggest with AI — behind a full-screen spinner. They now resolve
  // in place while the page is already interactive.
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle} | Omnivyra</title>
      </Head>

      <div className={`min-h-screen bg-gradient-to-br ${accentSurfaceClassName} p-6`}>
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-xs text-gray-500">{eyebrow}</p>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <span>{icon}</span>
                <span>{heading}</span>
                <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-purple-700 shadow-sm">
                  {formatLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm">
                  {targetWords.toLocaleString()}+ words
                </span>
              </h1>
            </div>
            <Link href={backPath} className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          {pickerEnabled && (
            <div className="mb-6 rounded-2xl border border-gray-200 bg-white/90 p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-gray-900">How do you want to start?</p>
              <div className={`grid gap-3 ${pickerFlavor === 'longform' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                <button
                  type="button"
                  onClick={() => setCreationMode('ai')}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    creationMode === 'ai'
                      ? `border-violet-300 bg-violet-50 text-violet-900 shadow-sm`
                      : `border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50/60`
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <p className="text-sm font-semibold">Generate with AI</p>
                  </div>
                  <p className="mt-2 text-sm leading-6">
                    Use AI Chat or pick a recommended card to generate the full {contentType.replace('-', ' ')}.
                  </p>
                </button>

                {pickerFlavor === 'longform' && (
                  <button
                    type="button"
                    onClick={() => setCreationMode('outline')}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      creationMode === 'outline'
                        ? `border-violet-300 bg-violet-50 text-violet-900 shadow-sm`
                        : `border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50/60`
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-violet-500" />
                      <p className="text-sm font-semibold">Start from outline</p>
                    </div>
                    <p className="mt-2 text-sm leading-6">
                      Land in the editor with a 5-section structural outline ready to fill in.
                    </p>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setCreationMode('manual')}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    creationMode === 'manual'
                      ? `border-violet-300 bg-violet-50 text-violet-900 shadow-sm`
                      : `border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50/60`
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <PenLine className="h-4 w-4 text-violet-500" />
                    <p className="text-sm font-semibold">Write my own</p>
                  </div>
                  <p className="mt-2 text-sm leading-6">
                    Skip AI entirely. Open a blank editor and write the {contentType.replace('-', ' ')} yourself.
                  </p>
                </button>

                <button
                  type="button"
                  disabled
                  title="Curated starter pieces coming soon."
                  className="cursor-not-allowed rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-4 text-left opacity-70"
                >
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-500">Use a starter</p>
                    <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                      Soon
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-500">
                    Pick a curated starter and edit it. Available in a later release.
                  </p>
                </button>
              </div>

              {creationMode === 'outline' && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-sm text-violet-700">
                    Lands in the editor with a structural 5-section scaffold. No AI generation.
                  </p>
                  <button
                    type="button"
                    onClick={openEditorWithOutline}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
                  >
                    <FileText className="h-4 w-4" />
                    Open editor with outline
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {creationMode === 'manual' && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-sm text-violet-700">
                    {pickerFlavor === 'longform'
                      ? 'Opens a blank editor — no prefill, no AI, no outline.'
                      : 'Posts are edited in the scheduler. We will take you to the result page and then through to the scheduler where you write per-platform content.'}
                  </p>
                  <button
                    type="button"
                    onClick={pickerFlavor === 'longform' ? openEditorBlank : openShortformManualResult}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
                  >
                    <PenLine className="h-4 w-4" />
                    {pickerFlavor === 'longform' ? 'Open blank editor' : 'Open result → scheduler'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {creationMode === 'starter' && (
                <div className="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-500">
                  Curated starter pieces are not available yet. Pick another mode above.
                </div>
              )}
            </div>
          )}

          {(!pickerEnabled || creationMode === 'ai') && (
          <>
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setIsAIModalOpen(true)}
              className="rounded-2xl border border-fuchsia-200 bg-white/90 p-5 text-left shadow-sm transition hover:border-fuchsia-300 hover:shadow-md"
            >
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Create with AI Chat</h2>
              <p className="mt-1 text-sm text-gray-600">
                Describe your idea and AI will refine it into a stronger {contentType.replace('-', ' ')} brief before you choose the final template.
              </p>
            </button>

            <button
              type="button"
              onClick={() => void router.push({ pathname: generatePath, query: { format: selectedFormat } })}
              className="rounded-2xl border border-gray-200 bg-white/90 p-5 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md"
            >
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                <Lightbulb className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Write Your Own Topic</h2>
              <p className="mt-1 text-sm text-gray-600">
                Skip recommendations and go straight to the draft builder with your own angle and structure choices.
              </p>
            </button>
          </div>

          {/* P1.6 — sits directly under the two entry cards, so "Create with AI"
              is immediately followed by a concrete recommendation rather than a
              blank prompt. Accept feeds the existing generation flow. */}
          {selectedCompanyId ? (
            <SuggestWithAIPanel
              companyId={selectedCompanyId}
              contentType={contentType}
              formatLabel={formatLabel}
              accentClassName={accentClassName}
              onAccept={acceptSuggestion}
            />
          ) : null}

          <section className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              <h2 className="text-base font-bold uppercase tracking-wide text-gray-900">Recommended Cards</h2>
            </div>

            <div className="space-y-4">
              {loading ? (
                <div data-testid="managed-intelligence-library-loading" className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading your company context and existing library...
                </div>
              ) : null}

              {suggestionsLoading ? (
                <div className="flex items-center gap-2 text-xs text-violet-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading AI suggestions for each card based on target depth...
                </div>
              ) : null}

              {cards.map((card, index) => (
                <div key={`${card.topic}-${index}`} className="rounded-2xl border border-gray-200 bg-white/95 p-5 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <h3 className="text-lg font-semibold text-gray-900">{card.topic}</h3>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${PRIORITY_STYLES[card.priority]}`}>
                      {card.priority}
                    </span>
                  </div>

                  <p className="text-sm leading-relaxed text-gray-600">{card.reason}</p>

                  <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Company Context</p>
                    <p className="mt-1 text-sm text-gray-700">
                      {companyContext || `Shape this ${contentType.replace('-', ' ')} around your market, audience, and brand point of view.`}
                    </p>

                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Current Content</p>
                    <p className="mt-1 text-sm text-gray-700">
                      {existingItems.length > 0
                        ? `Existing ${contentType.replace('-', ' ')} library: ${existingItems.slice(0, 3).map((item) => item.title).join(' · ')}${existingItems.length > 3 ? ' · ...' : ''}`
                        : `No ${contentType.replace('-', ' ')} pieces yet. This is a good time to set the quality bar with a strong first asset.`}
                    </p>

                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Writing Direction</p>
                    <p className="mt-1 text-sm text-gray-700">
                      Use a modern, decision-useful structure with clearer substance, stronger specificity, and less generic filler.
                    </p>

                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Target Depth</p>
                    <p className="mt-1 text-sm text-gray-700">
                      {targetWords.toLocaleString()}+ words · {depthLabel} · built for the selected {formatLabel.toLowerCase()} format
                    </p>
                  </div>

                  {cardSuggestions[index] ? (
                    <div className="mt-4 space-y-3">
                      {cardSuggestions[index].uniqueness_directive_options.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Uniqueness Directive</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cardSuggestions[index].uniqueness_directive_options.map((option, optionIndex) => (
                              <span key={`ud-${index}-${optionIndex}`} className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] text-purple-700">
                                {option}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {cardSuggestions[index].must_include_points_options.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Must-Include Points</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cardSuggestions[index].must_include_points_options.map((option, optionIndex) => (
                              <span key={`mi-${index}-${optionIndex}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] text-indigo-700">
                                {option}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-2">
                        {cardSuggestions[index].campaign_objective_options.length > 0 ? (
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Campaign Objective</p>
                            <div className="flex flex-wrap gap-1.5">
                              {cardSuggestions[index].campaign_objective_options.map((option, optionIndex) => (
                                <span key={`co-${index}-${optionIndex}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
                                  {option}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {cardSuggestions[index].trend_context_options.length > 0 ? (
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Trend Context</p>
                            <div className="flex flex-wrap gap-1.5">
                              {cardSuggestions[index].trend_context_options.map((option, optionIndex) => (
                                <span key={`tc-${index}-${optionIndex}`} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                                  {option}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (contentType === 'post') {
                          void generatePostFromIdea({
                            topic: card.topic,
                            intent: card.intent,
                            reason: card.reason,
                            source: 'post_intelligence_card',
                          });
                          return;
                        }

                        const bundleToken = `${contentType.replace(/[^a-z]/g, '_')}_bundle_${Date.now()}`;
                        try {
                          sessionStorage.setItem(bundleToken, JSON.stringify(buildCardBundle(card, index)));
                        } catch {
                          // Ignore storage issues and still pass the visible prefill values through routing.
                        }

                        void router.push({
                          pathname: templatePath,
                          query: {
                            format: selectedFormat,
                            prefill_source: `${contentType.replace('-', '_')}_intelligence_card`,
                            prefill_topic: card.topic,
                            prefill_reason: card.reason,
                            prefill_priority: card.priority,
                            prefill_intent: card.intent,
                            prefill_bundle: bundleToken,
                          },
                        });
                      }}
                      className={`inline-flex items-center gap-1.5 text-sm font-semibold ${accentClassName}`}
                    >
                      {contentType === 'post' ? 'Generate this post' : 'Write this'} <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          </>
          )}

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 bg-white/95 p-5 shadow-sm">
              <h2 className="mb-4 text-base font-bold text-gray-900">Action Items</h2>
              <div className="space-y-3">
                {actionItems.map((item, index) => (
                  <div key={index} className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 text-sm text-gray-700">
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Link href={createPath} className="text-sm font-medium text-gray-600 hover:text-gray-900">
                  Change format selection
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white/95 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-indigo-600" />
                <h2 className="text-base font-bold text-gray-900">Performance Snapshot</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Published</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{publishedCount}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Drafts</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{draftCount}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Views</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{totalViews}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-gray-600">
                {topPerforming
                  ? `Top existing piece: ${topPerforming.title}`
                  : `No performance history yet. Use the card + template flow to create the first strong benchmark for this content type.`}
              </p>
            </section>
          </div>
        </div>
      </div>

      {selectedCompanyId ? (
        <AIBlogCardModal
          isOpen={isAIModalOpen}
          onClose={() => setIsAIModalOpen(false)}
          companyId={selectedCompanyId}
          companyName={companyName}
          companyContext={companyContext}
          existingTopics={existingItems.map((item) => item.title)}
          contentLabel={contentType.replace('-', ' ')}
          contentType={contentType}
          contentModeLabel={formatLabel}
          onCardCreated={acceptAiCard}
        />
      ) : null}
    </>
  );
}
