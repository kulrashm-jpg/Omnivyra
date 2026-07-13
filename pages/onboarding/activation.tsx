'use client';

/**
 * /onboarding/activation — the Platform Activation Experience (ONBOARD-007).
 *
 * After onboarding, this is the natural transition into using the platform: it
 * explains what is already active, what capabilities are available, what remains
 * optional, and what additional value can still be unlocked. It consumes the
 * EXISTING onboarding journey authority through useOnboardingJourney (no new
 * endpoint/API/onboarding change) and maps it into the canonical activation
 * read-model (buildPlatformActivation). It computes nothing — Platform Ready and
 * every capability status come from existing authorities.
 */

import { useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useOnboardingJourney } from '../../hooks/useOnboardingJourney';
import { buildPlatformActivation } from '../../lib/activation/platformActivation';
import ActivationDashboard from '../../components/onboarding/ActivationDashboard';

export default function PlatformActivationPage() {
  const { journey, loading, error } = useOnboardingJourney();
  const activation = useMemo(() => buildPlatformActivation(journey), [journey]);

  return (
    <>
      <Head><title>Platform activation | Omnivyra</title></Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/command-center" className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">Go to dashboard</Link>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Your platform is activating</h1>
          <p className="mt-2 text-sm text-[#6B7C93]">
            Here’s what’s already working, what each capability needs, and the optional steps that unlock even more.
          </p>

          {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="mt-8 text-sm text-[#6B7C93]">Loading your platform status…</p>}

          {!loading && (
            <div className="mt-6">
              <ActivationDashboard activation={activation} />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
