'use client';

/**
 * useOnboardingJourney — the single client hook over the canonical onboarding
 * journey authority (ONBOARD-002 §4/§5/§7).
 *
 * It reads the server-derived truth from GET /api/onboarding/journey and computes
 * NOTHING itself — `platformReady`, stage statuses, progress, and required actions
 * are all authored by the backend (onboardingJourneyService). Every onboarding
 * surface (dashboard card, header resume link, command center) consumes THIS hook,
 * so there is one fetch shape and no duplicated resume logic. Refresh/relogin resume
 * identically because the journey is derived, not stored on the client.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

export type JourneyStageStatus =
  | 'not_started' | 'pending' | 'in_progress' | 'completed'
  | 'skipped' | 'dismissed' | 'blocked';

/** Provider/social state for integration stages (§6). */
export type ProviderState =
  | 'connected' | 'detected' | 'pending' | 'expired' | 'reconnect_required' | 'failed';

/** Deterministic setup guidance for a stage (§4). */
export interface StageGuidance {
  /** What becomes available once this stage is completed. */
  unlocks: string;
  /** What stays blocked/unavailable until this stage is completed. */
  blockedWithout: string;
}

/** A stage's dependency, resolved to a human-readable title + met flag (§3). */
export interface StageDependency {
  id: string;
  title: string;
  met: boolean;
}

export interface JourneyStage {
  id: string;
  title: string;
  why: string;
  mandatory: boolean;
  skippable: boolean;
  dismissible: boolean;
  dependsOn: string[];
  href: string;
  status: JourneyStageStatus;
  detail: string | null;
  /** Provider breakdown for integration stages (social / analytics). */
  providers?: Array<{ platform: string; state: ProviderState }>;
  /** Rough effort estimate in minutes (§2). */
  estimatedMinutes?: number;
  /** Human-readable dependencies with resolution state (§2/§3). */
  dependencies?: StageDependency[];
  /** Deterministic "unlocks / blocked without" guidance (§4). */
  guidance?: StageGuidance;
}

export interface JourneyReadiness {
  platformReady: boolean;
  reason: string;
  blockingItems: Array<{ id: string; title: string }>;
  remainingItems: Array<{ id: string; title: string }>;
  completionPercentage: number;
  estimatedRemainingTime: string;
  recommendations: Array<{ id: string; title: string; why: string; href: string }>;
}

export interface OnboardingJourney {
  companyId: string | null;
  stages: JourneyStage[];
  currentStep: string; // JourneyStageId | 'platform_ready'
  platformReady: boolean;
  readiness: JourneyReadiness;
}

export interface UseOnboardingJourney {
  journey: OnboardingJourney | null;
  loading: boolean;
  error: string | null;
  /** Refetch the server-derived journey (after a stage action, etc.). */
  refresh: () => Promise<void>;
  /** The one canonical destination for continuing/resuming onboarding. */
  resumeHref: string;
}

/** THE canonical onboarding destination — everything converges here (§2). */
export const CANONICAL_JOURNEY_HREF = '/onboarding/journey';

// ── request coalescing ────────────────────────────────────────────────────────
// This hook is consumed by more than one component on the same page (the dashboard
// onboarding card AND the global-header resume link), and each mount previously
// fired its own GET /api/onboarding/journey — a heavy server build (~25 DB reads)
// duplicated on every authenticated page load. Share ONE in-flight request across
// concurrent mounts so the page makes a single call. In-flight ONLY (cleared the
// moment the request settles) → every logical refresh, including after a stage
// action, still fetches fresh data; only truly-concurrent duplicate GETs are merged.
// No caching, no behavior change — purely request de-duplication.
interface JourneyFetchResult { data: OnboardingJourney | null; error: string | null }

let inFlightJourney: Promise<JourneyFetchResult> | null = null;

function loadJourneyShared(): Promise<JourneyFetchResult> {
  if (!inFlightJourney) {
    inFlightJourney = apiFetch('/api/onboarding/journey')
      .then(async (res): Promise<JourneyFetchResult> =>
        res.ok
          ? { data: (await res.json()) as OnboardingJourney, error: null }
          : { data: null, error: 'Could not load onboarding progress.' },
      )
      .catch((): JourneyFetchResult => ({ data: null, error: 'Network error loading onboarding.' }))
      .finally(() => { inFlightJourney = null; });
  }
  return inFlightJourney;
}

export function useOnboardingJourney(): UseOnboardingJourney {
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadJourneyShared();
    if (result.error) {
      setError(result.error);
    } else {
      setJourney(result.data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { journey, loading, error, refresh, resumeHref: CANONICAL_JOURNEY_HREF };
}

/** True when the user still has onboarding to do (server-derived). */
export function isOnboardingIncomplete(journey: OnboardingJourney | null): boolean {
  return !!journey && !journey.platformReady;
}
