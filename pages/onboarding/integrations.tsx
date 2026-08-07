'use client';

/**
 * /onboarding/integrations — the canonical Integration Experience (ONBOARD-006).
 *
 * ONE server-derived overview of every integration: what exists, what is
 * connected, what is missing, what is recommended, what depends on what, and
 * what to connect next. It consumes the EXISTING onboarding journey authority
 * through useOnboardingJourney (no new endpoint/API/OAuth) and maps it into the
 * canonical read-model (buildIntegrationExperience). It renders through the ONE
 * reusable IntegrationCard and computes nothing — Platform Ready and every
 * status/dependency come from the authority.
 */

import { useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useOnboardingJourney } from '../../hooks/useOnboardingJourney';
import { buildIntegrationExperience } from '../../lib/integrations/integrationExperience';
import IntegrationCard from '../../components/onboarding/IntegrationCard';

export default function IntegrationExperiencePage() {
  const { journey, loading, error } = useOnboardingJourney();
  const experience = useMemo(() => buildIntegrationExperience(journey), [journey]);

  return (
    <>
      <Head><title>Integrations | Omnivyra</title></Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
            <Link href="/"><img width={465} height={144} src="/logo.webp" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/onboarding/journey" className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">Back to setup</Link>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Integrations</h1>
          <p className="mt-2 text-sm text-[#6B7C93]">
            Connect the tools you already use. Everything below reflects your live setup — connect what’s recommended next, and see what each integration unlocks.
          </p>

          {/* Progress + Platform Ready — read straight from the authority (§7). */}
          {!loading && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-[#6B7C93]">
                <span>{experience.platformReady ? 'Platform ready' : 'Setup in progress'}</span>
                <span>{experience.completionPercentage}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all" style={{ width: `${experience.completionPercentage}%` }} />
              </div>
            </div>
          )}

          {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="mt-8 text-sm text-[#6B7C93]">Loading your integrations…</p>}

          {!loading && (
            <div className="mt-6 space-y-9">
              {/* §5 Next recommended */}
              {experience.nextRecommended.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0A66C2]">Next recommended</h2>
                  <div className="space-y-3">
                    {experience.nextRecommended.map((it) => <IntegrationCard key={it.id} integration={it} highlighted />)}
                  </div>
                </section>
              )}

              {/* §5 Recently connected */}
              {experience.recentlyConnected.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Recently connected</h2>
                  <div className="space-y-3">
                    {experience.recentlyConnected.map((it) => <IntegrationCard key={it.id} integration={it} />)}
                  </div>
                </section>
              )}

              {/* Full canonical catalog, grouped by category (§2) */}
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">All integrations</h2>
                <div className="space-y-6">
                  {experience.categories.map((group) => (
                    <div key={group.category}>
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#9AA7B8]">{group.category}</h3>
                      <div className="space-y-3">
                        {group.integrations.map((it) => <IntegrationCard key={it.id} integration={it} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* §5 Platform benefits (deterministic) */}
              <section className="rounded-2xl border border-gray-100 bg-white p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">What connecting unlocks</h2>
                <ul className="mt-2 space-y-1">
                  {experience.platformBenefits.map((b) => (
                    <li key={b} className="text-xs text-[#0B1F33]/75"><span aria-hidden className="text-emerald-600">✦ </span>{b}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
