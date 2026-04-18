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
  const { user, isLoading } = useCompanyContext();
  const selectedFormat = typeof router.query.format === 'string' ? router.query.format : defaultFormat;
  const selectedFormatOption = formatOptions.find((option) => option.value === selectedFormat);
  const targetWords = useMemo(
    () => parseWordTarget(selectedFormatOption?.wordRange, 180),
    [selectedFormatOption?.wordRange],
  );

  const [topic, setTopic] = useState('');
  const [strategicNote, setStrategicNote] = useState('');

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
                <p className="mt-2 text-sm text-slate-600">You will choose a template before refining the final brief and generating the output.</p>
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

              <button
                type="button"
                disabled={!topic.trim()}
                onClick={() =>
                  void router.push({
                    pathname: templatePath,
                    query: {
                      format: selectedFormat,
                      target_words: String(targetWords),
                      prefill_source: `${contentType}_direct_topic`,
                      prefill_topic: topic.trim(),
                      prefill_reason: strategicNote.trim() || `Directly entered ${contentType} topic.`,
                    },
                  })
                }
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${accentButtonClassName}`}
              >
                Continue to templates
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
