'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, BarChart2, Lightbulb, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import AIBlogCardModal from '../blog/AIBlogCardModal';
import { getDepthLabel, getFormatLabel, parseWordTarget } from './managed-intelligence/recommendations';
import { useManagedIntelligenceData } from './managed-intelligence/useManagedIntelligenceData';
import { PRIORITY_STYLES, type ManagedIntelligenceProps as Props } from './managed-intelligence/types';

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
}: Props) {
  const router = useRouter();
  const { selectedCompanyId, selectedCompanyName, user, isLoading: authLoading } = useCompanyContext();
  const selectedFormat = typeof router.query.format === 'string' ? router.query.format : defaultFormat;
  const selectedFormatOption = formatOptions.find((option) => option.value === selectedFormat);
  const formatLabel = getFormatLabel(formatOptions, selectedFormat);
  const targetWords = parseWordTarget(selectedFormatOption?.wordRange, contentType === 'story' ? 1500 : 2000);
  const depthLabel = getDepthLabel(targetWords);

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

  if (authLoading || loading) {
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

          <section className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              <h2 className="text-base font-bold uppercase tracking-wide text-gray-900">Recommended Cards</h2>
            </div>

            <div className="space-y-4">
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
          onCardCreated={async (card) => {
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
          }}
        />
      ) : null}
    </>
  );
}
