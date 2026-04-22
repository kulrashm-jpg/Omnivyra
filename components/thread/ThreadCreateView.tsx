'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { THREAD_FORMATS } from '../../lib/thread/threadFlow';
import { getThreadIntelligenceLink } from '../../lib/thread/threadLinks';

export default function ThreadCreateView() {
  const router = useRouter();
  const { user, isLoading } = useCompanyContext();

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
        <title>Create Thread | OmniVyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <Link href="/command-center/content" className="mb-8 inline-flex text-sm text-gray-600 transition hover:text-gray-900">
            &larr; Back
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Thread Creation
                </p>
                <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-gray-900">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-100 bg-violet-50 text-xl text-violet-700">
                    T
                  </span>
                  Create a Thread
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  A thread should unfold one idea across a sequence, not behave like one long post. Choose the structure that best matches the arc you want to deliver, then we will move straight into a thread-specific briefing and sequence build.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">Sequence first</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Use Case</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">Manual or engagement</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">What We Optimize</p>
                <p className="mt-1 text-sm text-gray-700">Hook, progression, and payoff across the full sequence instead of one standalone post.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Execution Model</p>
                <p className="mt-1 text-sm text-gray-700">Manual planned thread first. Engagement-driven continuation will take over when there is live interaction.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">What Happens Next</p>
                <p className="mt-1 text-sm text-gray-700">You will set the angle, one intent, and the destination platform, then generate a full thread sequence.</p>
              </div>
            </div>
          </div>

          <div className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Choose Your Thread Shape</p>
            <p className="mt-1 text-sm text-gray-600">Keep this decision simple. The structure should match how you want the reader to move through the sequence.</p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {THREAD_FORMATS.map((format) => (
              <button
                key={format.value}
                type="button"
                onClick={() => void router.push(getThreadIntelligenceLink({ format: format.value }))}
                className="group flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white/92 p-6 text-left shadow-[0_8px_28px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-[0_18px_40px_rgba(15,23,42,0.10)]"
              >
                <div className="mb-4 h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500" />
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Format</p>
                    <h2 className="mt-2 text-xl font-semibold text-gray-900">{format.label}</h2>
                  </div>
                  <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                    {format.threadLength}
                  </span>
                </div>

                <p className="min-h-[84px] text-sm leading-7 text-gray-600">{format.description}</p>

                <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Best When</p>
                  <p className="mt-1 text-sm text-gray-700">{format.hook}</p>
                </div>

                <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-violet-700 transition group-hover:gap-3">
                  Continue with this thread shape
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
