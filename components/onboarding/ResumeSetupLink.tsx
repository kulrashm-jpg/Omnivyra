'use client';

/**
 * ResumeSetupLink — the global "Resume setup" entry point (ONBOARD-002 §4).
 *
 * A compact chip that appears wherever it is mounted (header, command center)
 * for any authenticated user whose onboarding is incomplete. It reuses the single
 * journey hook (no duplicated resume logic) and always points at the ONE canonical
 * journey. Renders nothing when the journey is loading or Platform Ready.
 */

import Link from 'next/link';
import { useOnboardingJourney, isOnboardingIncomplete, CANONICAL_JOURNEY_HREF } from '../../hooks/useOnboardingJourney';

export default function ResumeSetupLink({ className = '' }: { className?: string }) {
  const { journey, loading } = useOnboardingJourney();
  if (loading || !isOnboardingIncomplete(journey)) return null;

  const pct = journey?.readiness.completionPercentage ?? 0;
  return (
    <Link
      href={CANONICAL_JOURNEY_HREF}
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 ${className}`}
      aria-label="Resume setup"
      title="Finish setting up Omnivyra"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Resume setup{pct > 0 ? ` · ${pct}%` : ''}
    </Link>
  );
}
