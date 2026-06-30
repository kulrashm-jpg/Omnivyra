import React from 'react';
import Head from 'next/head';
import LeadCaptureForm from './LeadCaptureForm';
import { LEAD_CAPTURE_INTENTS, type LeadIntent } from '@/lib/website/leadCaptureConfig';

/** Shared lead-capture page experience — the four entry points reuse this + the one form. */
export default function LeadCaptureExperience({ intent }: { intent: LeadIntent }) {
  const cfg = LEAD_CAPTURE_INTENTS[intent];
  return (
    <>
      <Head><title>{cfg.cta} | OmniVyra</title></Head>
      <main className="min-h-screen bg-gradient-to-b from-[#EEF6FF] to-white px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
          <div className="lg:pt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0A66C2]">{cfg.cta}</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-[#0B1F33] sm:text-4xl">{cfg.heading}</h1>
            <p className="mt-4 max-w-md text-base text-[#3C5066]">{cfg.subheading}</p>
            <ul className="mt-6 space-y-2 text-sm text-[#3C5066]">
              <li>• Unified lead intelligence across every source</li>
              <li>• Attribution and journey captured automatically</li>
              <li>• A specialist follows up on your goals</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-[#D7E7F8] bg-white p-6 shadow-[0_24px_60px_rgba(10,102,194,0.12)] sm:p-8">
            <LeadCaptureForm intent={intent} />
          </div>
        </div>
      </main>
    </>
  );
}
