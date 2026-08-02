import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { isLeadIntent, LEAD_CAPTURE_INTENTS } from '@/lib/website/leadCaptureConfig';
import MarketingPageMeta from '@/components/seo/MarketingPageMeta';

export default function ThankYouPage() {
  const router = useRouter();
  const intent = typeof router.query.intent === 'string' && isLeadIntent(router.query.intent) ? router.query.intent : null;
  const message = intent ? LEAD_CAPTURE_INTENTS[intent].confirmation.message : 'Thanks for reaching out — we’ll be in touch shortly.';

  return (
    <>
      {/* noindex: post-submission confirmation page — no search value. */}
      <MarketingPageMeta
        title="Thank you | OmniVyra"
        description="Thanks for reaching out to Omnivyra — our team will be in touch shortly."
        path="/thank-you"
        noindex
      />
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#EEF6FF] to-white px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-[#D7E7F8] bg-white p-10 text-center shadow-[0_24px_60px_rgba(10,102,194,0.12)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#1E9E5A] text-3xl text-white">✓</div>
          <h1 className="text-2xl font-bold text-[#0B1F33]">You’re all set</h1>
          <p className="mt-3 text-sm text-[#3C5066]">{message}</p>
          <Link href="/" className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#0A66C2] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0857A8]">
            Back to home
          </Link>
        </div>
      </main>
    </>
  );
}
