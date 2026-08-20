import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchSubscriptionOnce } from './subscriptionFetcher';
import { fetchReportsOnce } from './reportsFetcher';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { ApiFetchError } from '../lib/swr/swrClient';
import { getVisibleCards, CommandCenterCard, Requirement, CardState } from '../config/commandCenterCards';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '../lib/apiFetch';
import {
  fetchReadinessData,
  getCardStateFromFeatures,
  generateDynamicRequirements,
  FeatureStatus,
  ReadinessData,
} from '../backend/services/commandCenterReadinessService';
import {
  computeMonetizationState,
  MonetizationState,
  UserContext,
} from '../backend/services/monetizationTriggersService';
import {
  logCommandCenterViewed,
  logCardClicked,
  logCommandCenterDismissed,
} from '../lib/analytics/commandCenterEvents';
import { getCardHoverMessage } from '../components/command-center/preflightHelpers';
import { buildSetupSignals } from '../lib/setup/buildSetupSignals';
import { SETUP_REGISTRY, type SetupSignals } from '../config/setupRegistry';
import { onSetupChanged } from '../lib/setup/setupEvents';
import { buildReadinessSignals } from '../lib/readiness/buildReadinessSignals';
import { READINESS_REGISTRY, type ReadinessSignals } from '../config/readinessRegistry';
import { buildMasterySignals } from '../lib/mastery/buildMasterySignals';
import { MASTERY_REGISTRY, type MasterySignals } from '../config/masteryRegistry';
import { evaluateCapabilityRegistry, type CapabilityEvaluation } from '../lib/shared/capabilityRegistry';

const EMPTY_CAPABILITY_EVALUATION: CapabilityEvaluation = {
  categories: [],
  overallPercent: 0,
  summary: { completedCount: 0, inProgressCount: 0, totalCount: 0 },
};

export type ReportCardApiState = {
  reportState?: string;
  hasGeneratingReport?: boolean;
  hasFreeReportUsed?: boolean;
};

/**
 * OPT-005 Phase 2B — the report-card read as an SWR entry (exported for
 * direct testing; useCommandCenterCore consumes it below).
 *
 * Polling parity: refreshInterval is data-dependent — 5000 ms ONLY while
 * reportState === 'generating', 0 otherwise (the old setInterval polled at
 * the same cadence and stopped on the same condition).
 *
 * OPT-002 integration correction: /api/reports ships a private 30 s HTTP
 * cache. While a report is generating, the fetcher passes cache:'no-store'
 * so the 5 s progress poll sees LIVE state; normal loads keep the browser
 * cache. No route or header changes.
 */
export function useReportCardPoll(companyId: string | null) {
  const generatingRef = useRef(false);

  const fetcher = useCallback(async (url: string) => {
    try {
      // Shared with the readiness wave via singleFlight. The no-store flag is
      // part of the flight key, so a generating poll never joins a
      // cache-eligible flight and vice versa.
      const result = await fetchReportsOnce(companyId ?? '', {
        noStore: generatingRef.current,
        url,
      });
      if (result.outcome === 'ok') return result.json as ReportCardApiState;
      if (result.outcome === 'non_ok') throw new ApiFetchError(url, result.status);
      throw result.error;
    } catch (error) {
      console.error('[command-center] Failed to load report card state:', error);
      throw error;
    }
  }, [companyId]);

  const { data } = useSWR<ReportCardApiState>(
    companyId ? `/api/reports?company_id=${companyId}` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest && (latest.reportState || 'free_available') === 'generating' ? 5000 : 0,
      // Global dedupingInterval is 15s — larger than the 5s generating poll,
      // which would throttle it. Pin a smaller window so the poll cadence is
      // exactly the old setInterval's 5s.
      dedupingInterval: 2000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  useEffect(() => {
    generatingRef.current = (data?.reportState || 'free_available') === 'generating';
  }, [data]);

  return data ?? null;
}

// ── Retain-last-good input cache ───────────────────────────────────────────────
//
// Setup / Readiness / Mastery are recomputed on the client from ~14 parallel live
// fetches (mount, setup events, window focus, tab-visible). When any fetch is slow
// or errors it returns null, its factor drops out, and the score visibly moves.
// To keep scores STABLE, the last successfully-loaded value for each input is cached
// per company; a transient null keeps the previous value instead of dropping it.
// Fully fail-soft — any storage error just falls back to the fresh value.
function readStableInputs(companyId: string): Record<string, unknown> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(`cc-stable-inputs:${companyId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function writeStableInputs(companyId: string, inputs: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`cc-stable-inputs:${companyId}`, JSON.stringify(inputs));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}
/** Merge fresh over cached: a non-null fresh value wins and is remembered; a null
 *  (failed fetch) retains the last-good cached value. Returns the stabilised set. */
function stabiliseInputs(companyId: string, fresh: Record<string, unknown>): Record<string, any> {
  const cached = readStableInputs(companyId);
  const stable: Record<string, any> = {};
  for (const key of Object.keys(fresh)) {
    stable[key] = fresh[key] != null ? fresh[key] : cached[key] ?? null;
  }
  writeStableInputs(companyId, stable);
  return stable;
}

// ── Monotonic score ratchet ────────────────────────────────────────────────────
//
// Once a capability is set up / used / a skill acquired, its score must never go
// DOWN. Per-factor maxima are cached per company + registry; each evaluation floors
// factors at their prior max and persists the new maxima. Fail-soft.
function readRatchet(companyId: string, key: string): Record<string, number> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(`cc-ratchet:${key}:${companyId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeRatchet(companyId: string, key: string, maxes: Record<string, number>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`cc-ratchet:${key}:${companyId}`, JSON.stringify(maxes));
  } catch {
    /* non-fatal */
  }
}
function evaluateWithRatchet<S>(
  registry: Parameters<typeof evaluateCapabilityRegistry<S>>[0],
  signals: S,
  companyId: string,
  key: string,
): CapabilityEvaluation {
  const prior = readRatchet(companyId, key);
  const evaluation = evaluateCapabilityRegistry(registry, signals, prior);
  // Persist the new per-factor maxima (available factors only — a transient
  // unavailable never lowers a stored max).
  const next: Record<string, number> = { ...prior };
  for (const cat of evaluation.categories) {
    for (const f of cat.factors) {
      if (f.available) next[f.id] = Math.max(next[f.id] ?? 0, f.score);
    }
  }
  writeRatchet(companyId, key, next);
  return evaluation;
}

type EnhancedCardProps = Omit<CommandCenterCard, 'state' | 'requirements' | 'badge'> & {
  state: CardState;
  badge?: 'FREE_AVAILABLE' | 'GENERATING' | 'USED';
  requirements: Requirement[];
  hoverMessage?: string | null;
  ctaLabel: string;
  ctaDisabled?: boolean;
  showSpinner?: boolean;
  hint?: string;
  monetization?: MonetizationState;
  onClick: (route: string, cardState: CardState) => void;
  onAnalytics: (cardId: string) => void;
  onMonetizationClick?: (upgradePath: string) => void;
  onRequirementClick?: (helpLink: string) => void;
};

export function useCommandCenter() {
  const router = useRouter();
  const { user, userName, userRole, selectedCompanyName, selectedCompanyId, isLoading, authChecked, authUserId } = useCompanyContext();
  const [showAgain, setShowAgain] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [visibleCards, setVisibleCards] = useState<CommandCenterCard[]>([]);
  const [enhancedCards, setEnhancedCards] = useState<EnhancedCardProps[]>([]);
  const [readinessScore, setReadinessScore] = useState(0);
  const [eventsSent, setEventsSent] = useState(false);
  const [features, setFeatures] = useState<FeatureStatus[]>([]);
  const [readinessData, setReadinessData] = useState<ReadinessData | null>(null);
  const [userTier, setUserTier] = useState<'free' | 'starter' | 'pro'>('free');
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<{ missingSections?: string[] | null; score?: number | null; connectedPlatforms?: string[] | null; configuredApis?: string[] | null } | null>(null);
  const [reportCardStatus, setReportCardStatus] = useState<{
    reportState: 'free_available' | 'generating' | 'used';
    hasGeneratingReport: boolean;
    hasFreeReportUsed: boolean;
  } | null>(null);

  const [setupSignals, setSetupSignals] = useState<SetupSignals | null>(null);
  const setupEvaluation = useMemo(
    () =>
      setupSignals && selectedCompanyId
        ? evaluateWithRatchet(SETUP_REGISTRY, setupSignals, selectedCompanyId, 'setup')
        : EMPTY_CAPABILITY_EVALUATION,
    [setupSignals, selectedCompanyId],
  );
  const [readinessSignals, setReadinessSignals] = useState<ReadinessSignals | null>(null);
  const readinessEvaluation = useMemo(
    () =>
      readinessSignals && selectedCompanyId
        ? evaluateWithRatchet(READINESS_REGISTRY, readinessSignals, selectedCompanyId, 'readiness')
        : EMPTY_CAPABILITY_EVALUATION,
    [readinessSignals, selectedCompanyId],
  );
  const [masterySignals, setMasterySignals] = useState<MasterySignals | null>(null);
  const masteryEvaluation = useMemo(
    () =>
      masterySignals && selectedCompanyId
        ? evaluateWithRatchet(MASTERY_REGISTRY, masterySignals, selectedCompanyId, 'mastery')
        : EMPTY_CAPABILITY_EVALUATION,
    [masterySignals, selectedCompanyId],
  );
  const setupPct = setupEvaluation.overallPercent;
  const setupSummary = setupEvaluation.summary;
  // Readiness + Mastery both derive from canonical registries via the shared
  // engine (adoption-based Mastery, no feature-usage). Rings + summaries use the
  // evaluations, not legacy feature-weighted sections / backend score.
  const readinessPct = readinessEvaluation.overallPercent;
  const readinessSummary = readinessEvaluation.summary;
  const masteryPct = masteryEvaluation.overallPercent;
  const masterySummary = masteryEvaluation.summary;
  const loadReadiness = useCallback(async () => {
    // Identity gate accepts EITHER principal shape. Every request in this wave
    // is keyed solely on selectedCompanyId — none consumes a user id — so the
    // gate only needs to know that an authenticated principal exists.
    //
    // `authUserId` is the JWT sub, decoded from the token already in hand, and
    // is ready at shell-ready time; `user.userId` is DB-backed and only lands
    // once /api/company-profile?mode resolves. Requiring the latter held this
    // wave for a measured ~7.3s after the shell was usable and the company was
    // known.
    //
    // Both are required, not just authUserId: cookie-authenticated principals
    // (legacy super-admin, content architect) have no bearer token, so their
    // authUserId is permanently null while user.userId carries a synthetic id.
    // Gating on authUserId alone would never release this wave for them.
    if (!authChecked || (!authUserId && !user?.userId) || !selectedCompanyId) return;

    try {
      const getJson = (path: string) =>
        fetch(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } }).catch(() => null);
      const cid = encodeURIComponent(selectedCompanyId);
      // Shared with loadUserTier via singleFlight — started here so it is still
      // in flight alongside the wave, not serialized behind it.
      const subscriptionPromise = fetchSubscriptionOnce(selectedCompanyId);
      const [
        data,
        profileResponse,
        companyApiConfigResponse,
        externalApisResponse,
        socialStatusResponse,
        teamSummaryResponse,
        websiteSnapshotResponse,
        blogsResponse,
        creatorAssetsResponse,
        templateCollectionsResponse,
        userTemplatesResponse,
        blockTemplatesResponse,
        automationConfigResponse,
        campaignsResponse,
        reportsResponse,
        telemetryProvidersResponse,
      ] = await Promise.all([
        fetchReadinessData(selectedCompanyId),
        getJson(`/api/company-profile?companyId=${cid}&includeCompleteness=1`),
        getJson(`/api/external-apis/company-config?companyId=${cid}`),
        getJson(`/api/external-apis?companyId=${cid}`),
        getJson(`/api/social-accounts/status?companyId=${cid}`),
        getJson(`/api/company/team-summary?companyId=${cid}`),
        getJson(`/api/website-intelligence/canonical?company_id=${cid}`),
        getJson(`/api/blogs?company_id=${cid}`),
        getJson(`/api/creator-assets?company_id=${cid}`),
        getJson(`/api/creator-templates/collections?company_id=${cid}`),
        getJson(`/api/creator-templates/user?company_id=${cid}`),
        getJson(`/api/block-templates?company_id=${cid}`),
        getJson(`/api/automation/config?organization_id=${cid}`),
        getJson(`/api/campaigns?companyId=${cid}`),
        // Shared with the SWR poll above. Mapped to the { ok, json } shape the
        // parse stage below already expects, so failure still becomes null.
        fetchReportsOnce(selectedCompanyId).then((r) =>
          r.outcome === 'ok'
            ? { ok: true as const, json: async () => r.json }
            : null,
        ),
        // Canonical telemetry provider results — Mastery prefers these over the
        // proxy counts when telemetry is live; falls back to proxies while dark.
        getJson(`/api/telemetry/providers?companyId=${cid}&scope=mastery`),
      ]);
      if (!data) {
        console.warn('[command-center] Readiness data unavailable — defaulting to 0%');
        return;
      }

      setFeatures(data.features);
      setReadinessData(data.readiness);
      setReadinessScore(data.readiness.score);
      if (profileResponse?.ok) {
        const profileData = await profileResponse.json();
        const [companyApiConfigData, externalApisData, socialStatusData, teamSummaryData, websiteSnapshotData, blogsData, creatorAssetsData, templateCollectionsData, userTemplatesData, blockTemplatesData, automationConfigData, campaignsData, reportsData, telemetryProvidersData] = await Promise.all([
          companyApiConfigResponse?.ok ? companyApiConfigResponse.json() : Promise.resolve(null),
          externalApisResponse?.ok ? externalApisResponse.json() : Promise.resolve(null),
          socialStatusResponse?.ok ? socialStatusResponse.json() : Promise.resolve(null),
          teamSummaryResponse?.ok ? teamSummaryResponse.json() : Promise.resolve(null),
          websiteSnapshotResponse?.ok ? websiteSnapshotResponse.json() : Promise.resolve(null),
          blogsResponse?.ok ? blogsResponse.json() : Promise.resolve(null),
          creatorAssetsResponse?.ok ? creatorAssetsResponse.json() : Promise.resolve(null),
          templateCollectionsResponse?.ok ? templateCollectionsResponse.json() : Promise.resolve(null),
          userTemplatesResponse?.ok ? userTemplatesResponse.json() : Promise.resolve(null),
          blockTemplatesResponse?.ok ? blockTemplatesResponse.json() : Promise.resolve(null),
          automationConfigResponse?.ok ? automationConfigResponse.json() : Promise.resolve(null),
          campaignsResponse?.ok ? campaignsResponse.json() : Promise.resolve(null),
          reportsResponse?.ok ? reportsResponse.json() : Promise.resolve(null),
          telemetryProvidersResponse?.ok ? telemetryProvidersResponse.json() : Promise.resolve(null),
        ]);
        const apiCatalog = (externalApisData?.apis || [])
          .filter((api: any) => api?.id)
          .map((api: any) => ({
            id: api.id as string,
            name: (api.name || api.display_name || api.source_name || api.platform_name || api.id) as string,
          }));
        const apiNameById = new Map<string, string>(apiCatalog.map((a: { id: string; name: string }) => [a.id, a.name]));
        const configuredApiIds = new Set<string>(
          (companyApiConfigData?.configs || [])
            .filter((row: any) => row?.enabled !== false)
            .map((row: any) => row.api_source_id)
            .filter(Boolean),
        );
        const configuredApis = [...configuredApiIds].map((id) => apiNameById.get(id) || id);
        // NOTE: profile-URL connected list is retained ONLY for profileStatus,
        // which feeds Readiness/Mastery + preflight (unchanged). Setup channels
        // now use the canonical social-accounts connection endpoint below.
        const connectedPlatforms = [
          profileData?.profile?.linkedin_url ? 'LinkedIn' : null,
          profileData?.profile?.facebook_url ? 'Facebook' : null,
          profileData?.profile?.instagram_url ? 'Instagram' : null,
          profileData?.profile?.x_url ? 'X' : null,
          profileData?.profile?.youtube_url ? 'YouTube' : null,
          profileData?.profile?.tiktok_url ? 'TikTok' : null,
          profileData?.profile?.reddit_url ? 'Reddit' : null,
          profileData?.profile?.pinterest_url ? 'Pinterest' : null,
          profileData?.profile?.whatsapp_url ? 'WhatsApp' : null,
        ].filter(Boolean) as string[];
        setProfileStatus({
          missingSections: profileData?.completeness?.missing_sections ?? null,
          score: typeof profileData?.overall_profile_completion === 'number' ? profileData.overall_profile_completion : null,
          connectedPlatforms,
          configuredApis,
        });
        // Retain-last-good: stabilise every flaky input against transient fetch
        // failures. A null from a slow/errored endpoint keeps the previously loaded
        // value, so the score never drops on a hiccup (see stabiliseInputs).
        const freshAutomation =
          automationConfigData && typeof automationConfigData.enabled === 'boolean'
            ? {
                enabled: Boolean(automationConfigData.enabled),
                autoReply: Boolean(automationConfigData.auto_reply_enabled),
                autoDm: Boolean(automationConfigData.auto_dm_enabled),
              }
            : null;
        const stable = stabiliseInputs(selectedCompanyId, {
          socialAccounts: Array.isArray(socialStatusData?.accounts) ? socialStatusData.accounts : null,
          blogsCount: Array.isArray(blogsData?.blogs) ? blogsData.blogs.length : null,
          campaignsCount: Array.isArray(campaignsData?.campaigns) ? campaignsData.campaigns.length : null,
          reportsCount: Array.isArray(reportsData?.reports) ? reportsData.reports.length : null,
          mediaCount: Array.isArray(creatorAssetsData?.assets) ? creatorAssetsData.assets.length : null,
          // Count ANY saved template — creator-template collections, individual creator
          // templates, AND blog/block templates ("Your Templates" on /blogs/template). Saving
          // one of any kind should score the factor ("done once = scored").
          templatesCount: (() => {
            const cols = Array.isArray(templateCollectionsData?.collections) ? templateCollectionsData.collections.length : null;
            const usr = Array.isArray(userTemplatesData?.templates) ? userTemplatesData.templates.length : null;
            const blk = Array.isArray(blockTemplatesData?.templates) ? blockTemplatesData.templates.length : null;
            return cols === null && usr === null && blk === null ? null : (cols ?? 0) + (usr ?? 0) + (blk ?? 0);
          })(),
          websiteSnapshot: websiteSnapshotData?.snapshot ?? null,
          automation: freshAutomation,
          teamSummary:
            teamSummaryData && typeof teamSummaryData.memberCount === 'number'
              ? { ownerExists: Boolean(teamSummaryData.ownerExists), memberCount: teamSummaryData.memberCount }
              : null,
          telemetry: telemetryProvidersData?.signals ?? null,
        });
        const sSocialAccounts = (stable.socialAccounts as any[] | null) ?? null;
        const sWebsiteSnapshot = (stable.websiteSnapshot as any) ?? null;
        const sAutomation = (stable.automation as { enabled: boolean; autoReply: boolean; autoDm: boolean } | null) ?? null;
        const sTeam = (stable.teamSummary as { ownerExists: boolean; memberCount: number } | null) ?? null;
        const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

        // Assemble canonical, capability-aware Setup signals (no scoring here —
        // that lives in the engine). Channels come from social_accounts; Team
        // from the membership-summary endpoint readable by every member.
        const subscriptionResult = await subscriptionPromise;
        const subscriptionData: any =
          subscriptionResult.outcome === 'ok' ? (subscriptionResult.json as any) : null;
        setSetupSignals(
          buildSetupSignals({
            profile: profileData?.profile ?? null,
            features: data.features,
            socialAccounts: sSocialAccounts,
            teamSummary: sTeam,
            apiCatalog,
            configuredApiIds,
            apiCatalogAvailable: Boolean(externalApisResponse?.ok),
            subscriptionTier:
              subscriptionData?.data?.tier ?? subscriptionData?.data?.plan_key ?? null,
          }),
        );
        // Canonical, capability-aware Readiness signals (client-side engine,
        // Setup architecture). Channels from social_accounts; profile audience.
        setReadinessSignals(
          buildReadinessSignals({
            profile: profileData?.profile ?? null,
            features: data.features,
            socialAccounts: sSocialAccounts,
            websiteSnapshot: sWebsiteSnapshot,
            blogsCount: num(stable.blogsCount),
            mediaCount: num(stable.mediaCount),
            templatesCount: num(stable.templatesCount),
            automation: sAutomation,
          }),
        );
        // Canonical, adoption-based Mastery signals (client-side shared engine).
        // Real artifacts only (published content, campaigns, reports, assets,
        // templates, team, automation) — no feature-usage.
        setMasterySignals(
          buildMasterySignals({
            profile: profileData?.profile ?? null,
            // Latched feature-completion flags — mastery credits ever-used
            // capabilities forever, independent of current artifact counts.
            features: data.features,
            blogsCount: num(stable.blogsCount),
            campaignsCount: num(stable.campaignsCount),
            reportsCount: num(stable.reportsCount),
            mediaCount: num(stable.mediaCount),
            templatesCount: num(stable.templatesCount),
            teamSummary: sTeam ? { memberCount: sTeam.memberCount } : null,
            automation: sAutomation,
            websiteSnapshot: sWebsiteSnapshot,
            telemetry: telemetryProvidersData?.signals ?? null,
          }),
        );
      } else {
        setProfileStatus(null);
      }
    } catch (err) {
      console.warn('[command-center] Could not load readiness data:', err);
    }
  }, [authChecked, authUserId, selectedCompanyId, user?.userId]);

  useEffect(() => {
    if (!authChecked || !authUserId) return;

    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/user/preferences', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          setShowAgain(data.preferences?.command_center_pinned ?? true);
          return;
        }

        setShowAgain(true);
      } catch (err) {
        console.error('[command-center] Failed to load preferences:', err);
        setShowAgain(true);
      }
    };

    void loadPreferences();
  }, [authChecked, authUserId]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    const refresh = () => {
      void loadReadiness();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadReadiness();
      }
    };

    // PRIMARY sync: canonical Setup events (immediate refresh on any Setup-
    // changing action). onSetupChanged also bridges the legacy
    // 'company-profile-updated' event, so it is the single subscription point.
    const unsubscribe = onSetupChanged(refresh);

    // FALLBACK ONLY: focus + visibility recover state after events missed while
    // the tab was backgrounded. They are not the primary synchronization path.
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refreshOnVisible);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refreshOnVisible);
      }
    };
  }, [loadReadiness]);

  useEffect(() => {
    return;

    const loadReadinessLegacy = async () => {
      try {
        const data = await fetchReadinessData(selectedCompanyId);
        if (!data) {
          console.warn('[command-center] Readiness data unavailable — defaulting to 0%');
          return;
        }

        setFeatures(data.features);
        setReadinessData(data.readiness);
        setReadinessScore(data.readiness.score);
      } catch (err) {
        console.warn('[command-center] Could not load readiness data:', err);
      }
    };

    void loadReadinessLegacy();
  }, [authChecked, selectedCompanyId, user?.userId]);

  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    const loadUserTier = async () => {
      // Same request the readiness wave needs. Shared through singleFlight, so
      // whichever effect asks first starts it and both settle together — this
      // one still resolves on its own timing rather than waiting for the wave.
      const result = await fetchSubscriptionOnce(selectedCompanyId);

      if (result.outcome === 'ok') {
        const data = result.json as { data?: { tier?: 'free' | 'starter' | 'pro' } } | null;
        setUserTier(data?.data?.tier || 'free');
        return;
      }

      if (result.outcome === 'non_ok') {
        console.warn('[command-center] Failed to load subscription tier');
      } else {
        console.error('[command-center] Failed to load subscription tier:', result.error);
      }
      setUserTier('free');
    };

    void loadUserTier();
  }, [authChecked, selectedCompanyId, user?.userId]);

  // OPT-005 Phase 2B: reports read via the SWR poll hook above; the state
  // shape and update path (setReportCardStatus) are unchanged.
  const reportCardApiState = useReportCardPoll(
    authChecked && user?.userId && selectedCompanyId ? selectedCompanyId : null
  );
  useEffect(() => {
    if (!reportCardApiState) return;
    setReportCardStatus({
      reportState: (reportCardApiState.reportState || 'free_available') as 'free_available' | 'generating' | 'used',
      hasGeneratingReport: Boolean(reportCardApiState.hasGeneratingReport),
      hasFreeReportUsed: Boolean(reportCardApiState.hasFreeReportUsed),
    });
  }, [reportCardApiState]);

  useEffect(() => {
    if (!userRole) return;

    const cards = getVisibleCards(userRole);
    setVisibleCards(cards);

    const enhanced = cards.map((card) => {
      const cardState = features.length > 0 ? getCardStateFromFeatures(card.id, features) : 'not_started';
      const requirements = features.length > 0 ? generateDynamicRequirements(card.id, features) : card.requirements || [];
      const ctaLabel =
        cardState === 'not_started'
          ? 'Start Setup'
          : cardState === 'in_progress'
            ? 'Continue Setup'
            : card.cta || 'Open';

      let effectiveState = cardState;
      let effectiveCtaLabel = ctaLabel;
      let badge: 'FREE_AVAILABLE' | 'GENERATING' | 'USED' | undefined;
      let ctaDisabled = false;
      let showSpinner = false;

      if (card.id === 'reports' && reportCardStatus) {
        effectiveState =
          reportCardStatus.reportState === 'generating'
            ? 'in_progress'
            : reportCardStatus.reportState === 'used'
              ? 'ready'
              : 'not_started';

        badge =
          reportCardStatus.reportState === 'generating'
            ? 'GENERATING'
            : reportCardStatus.reportState === 'used'
              ? 'USED'
              : 'FREE_AVAILABLE';

        effectiveCtaLabel =
          reportCardStatus.reportState === 'generating'
            ? 'Generating...'
            : reportCardStatus.reportState === 'used'
              ? 'Generate report'
              : 'Generate report';

        ctaDisabled = reportCardStatus.reportState === 'generating';
        showSpinner = reportCardStatus.reportState === 'generating';
      } else if (card.id === 'reports') {
        badge = features.find((feature) => feature.key === 'report_generated')?.status === 'completed' ? 'USED' : 'FREE_AVAILABLE';
      }

      const userContext: UserContext = {
        userId: user?.userId || '',
        tier: userTier,
        reportsGenerated: features.find((feature) => feature.key === 'report_generated')?.status === 'completed' ? 1 : 0,
        campaignsCreated: features.find((feature) => feature.key === 'campaign_created')?.status === 'completed' ? 1 : 0,
      };

      return {
        ...card,
        state: effectiveState,
        badge,
        requirements,
        ctaLabel: effectiveCtaLabel,
        hoverMessage: getCardHoverMessage(card.id, features, profileStatus),
        ctaDisabled,
        showSpinner,
        monetization: computeMonetizationState(card.id, features, userContext),
      } as EnhancedCardProps;
    });

    setEnhancedCards(enhanced);
  }, [features, profileStatus, reportCardStatus, user?.userId, userRole, userTier]);

  useEffect(() => {
    if (authChecked && user?.userId && userRole && !eventsSent) {
      setEventsSent(true);
      void logCommandCenterViewed(user.userId, userRole, true, readinessScore, enhancedCards.length);
    }
  }, [authChecked, enhancedCards.length, eventsSent, readinessScore, user?.userId, userRole]);

  const handleTogglePinning = useCallback(async (checked: boolean) => {
    const previousState = showAgain;
    try {
      setIsSaving(true);
      setShowAgain(checked);

      if (user?.userId) {
        void logCommandCenterDismissed(user.userId, !checked);
      }

      const response = await fetch('/api/user/preferences/command-center', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command_center_pinned: checked }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save preference');
      }

      setLoadingError(null);
    } catch (err) {
      console.error('[command-center] Failed to save preference:', err);
      setShowAgain(previousState);
      setLoadingError('Failed to save preference. Please try again.');
      setTimeout(() => setLoadingError(null), 5000);
    } finally {
      setIsSaving(false);
    }
  }, [showAgain, user?.userId]);

  const handleCardClick = useCallback((route: string, _cardState?: CardState) => {
    router.push(route);
  }, [router]);

  const handleCardAnalytics = useCallback((cardId: string) => {
    const card = enhancedCards.find((item) => item.id === cardId);
    if (user?.userId && card) {
      void logCardClicked(user.userId, cardId, card.state, userRole || undefined, selectedCompanyId || undefined);
    }
  }, [enhancedCards, selectedCompanyId, user?.userId, userRole]);

  const handleGoToDashboard = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  const handleMonetizationClick = useCallback((ctaRoute: string) => {
    if (user?.userId) {
      console.log('[monetization] User clicked upgrade CTA:', ctaRoute);
    }
  }, [user?.userId]);

  const handleRequirementClick = useCallback((helpLink: string) => {
    router.push(helpLink);
  }, [router]);

  // P1.9 - first render needs AUTHENTICATION, not company resolution.
  // authUserId comes from the session JWT sub already held by the browser, so
  // the shell paints while /api/company-profile?mode=list is still in flight.
  // It is an identity signal only: company-scoped work below still requires
  // selectedCompanyId, and the server re-verifies every request.
  const _ef1 = !authChecked || !authUserId;

  if (!authUserId) {
    return { _ef1: true } as ReturnType<typeof useCommandCenter>;
  }

  const companyName = selectedCompanyName || 'Virality';
  const rawName = userName || 'there';
  const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  return {
    _ef1,
    authChecked,
    companyName,
    displayName,
    enhancedCards,
    eventsSent,
    features,
    handleCardAnalytics,
    handleCardClick,
    handleGoToDashboard,
    handleMonetizationClick,
    handleRequirementClick,
    handleTogglePinning,
    isLoading,
    isSaving,
    loadingError,
    masteryPct,
    masteryEvaluation,
    masterySummary,
    profileStatus,
    rawName,
    readinessData,
    readinessScore: readinessPct,
    readinessEvaluation,
    readinessSummary,
    reportCardStatus,
    router,
    selectedCompanyId,
    selectedCompanyName,
    setEnhancedCards,
    setEventsSent,
    setFeatures,
    setIsSaving,
    setLoadingError,
    setReadinessData,
    setReadinessScore,
    setReportCardStatus,
    setShowAgain,
    setUserTier,
    setVisibleCards,
    setupPct,
    setupEvaluation,
    setupSummary,
    showAgain,
    user,
    userName,
    userRole,
    userTier,
    visibleCards,
  };
}
