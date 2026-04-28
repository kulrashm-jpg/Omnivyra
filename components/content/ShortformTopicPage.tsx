'use client';

import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';

type FormatOption = {
  value: string;
  label: string;
  description: string;
  wordRange?: string;
};

type Props = {
  contentType: 'post';
  pageTitle: string;
  heading: string;
  subtitle: string;
  accentSurfaceClassName: string;
  accentButtonClassName: string;
  accentTextClassName: string;
  backPath: string;
  templatePath: string;
  defaultFormat: string;
  formatOptions: FormatOption[];
};

function parseWordTarget(wordRange: string | undefined, fallback: number) {
  if (!wordRange) return fallback;
  const matches = wordRange.match(/\d[\d,]*/g);
  if (!matches || matches.length === 0) return fallback;
  const values = matches
    .map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return fallback;
  return Math.max(...values);
}

export default function ShortformTopicPage({
  contentType,
  pageTitle,
  heading,
  subtitle,
  accentSurfaceClassName,
  accentButtonClassName,
  accentTextClassName,
  backPath,
  templatePath,
  defaultFormat,
  formatOptions,
}: Props) {
  const router = useRouter();
  const { user, isLoading, selectedCompanyId } = useCompanyContext();
  const selectedFormat = typeof router.query.format === 'string' ? router.query.format : defaultFormat;
  const selectedFormatOption = formatOptions.find((option) => option.value === selectedFormat);
  const targetWords = useMemo(
    () => parseWordTarget(selectedFormatOption?.wordRange, 180),
    [selectedFormatOption?.wordRange],
  );

  const [topic, setTopic] = useState('');
  const [strategicNote, setStrategicNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  const handleContinue = async () => {
    if (!topic.trim()) return;

    if (contentType === 'post') {
      if (!selectedCompanyId) {
        setError('Select a company before generating a post.');
        return;
      }

      setSubmitting(true);
      setError('');
      try {
        const response = await fetch('/api/posts/generate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: selectedCompanyId,
            topic: topic.trim(),
            platform: 'linkedin',
            template_name: selectedFormatOption?.label || selectedFormat,
            extra_instruction: strategicNote.trim() || undefined,
          }),
        });

        const rawResult = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            (rawResult as { error?: string }).error || 'Failed to generate post',
          );
        }

        const prefillToken = `post_prefill_${Date.now()}`;
        sessionStorage.setItem(
          prefillToken,
          JSON.stringify({
            output: normalizePostGenerationResult(rawResult),
            source: 'post_direct_topic',
            topic: topic.trim(),
            platform: 'linkedin',
            template_name: selectedFormatOption?.label || selectedFormat,
          }),
        );

        await router.push({
          pathname: '/posts/result',
          query: { prefill: prefillToken },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to generate post right now.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    void router.push({
      pathname: templatePath,
      query: {
        format: selectedFormat,
        target_words: String(targetWords),
        prefill_source: `${contentType}_direct_topic`,
        prefill_topic: topic.trim(),
        prefill_reason: strategicNote.trim() || `Directly entered ${contentType} topic.`,
      },
    });
  };

  if (isLoading) {
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
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Direct Topic Entry
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{heading}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">{subtitle}</p>
            </div>

            <button
              onClick={() => router.push(backPath)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/92 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Format</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedFormatOption?.label || selectedFormat}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Target Depth</p>
                <p className="mt-2 text-sm text-slate-600">{targetWords}+ words or equivalent shortform depth</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next Step</p>
                <p className="mt-2 text-sm text-slate-600">
                  {contentType === 'post'
                    ? 'Your topic will go straight into post generation so you can review the finished draft immediately.'
                    : 'You will choose a template before refining the final brief and generating the output.'}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">Topic or angle</label>
                <textarea
                  rows={3}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Describe the post angle you want to create."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">Strategic note</label>
                <textarea
                  rows={3}
                  value={strategicNote}
                  onChange={(event) => setStrategicNote(event.target.value)}
                  placeholder="Optional: add buyer context, campaign purpose, or the business takeaway this piece should reinforce."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
              <p className={`text-sm ${accentTextClassName}`}>
                Keep the topic concrete. Specific inputs produce sharper hooks, cleaner structure, and stronger platform fit.
              </p>

              {error ? (
                <p className="w-full text-sm text-red-600">{error}</p>
              ) : null}

              <button
                type="button"
                disabled={!topic.trim() || submitting}
                onClick={() => void handleContinue()}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${accentButtonClassName}`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating post
                  </>
                ) : (
                  <>
                    {contentType === 'post' ? 'Generate post' : 'Continue to templates'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
