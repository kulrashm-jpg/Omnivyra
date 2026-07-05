import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
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
  const { user, userName, userRole, selectedCompanyName, selectedCompanyId, isLoading, authChecked } = useCompanyContext();
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
    () => (setupSignals ? evaluateCapabilityRegistry(SETUP_REGISTRY, setupSignals) : EMPTY_CAPABILITY_EVALUATION),
    [setupSignals],
  );
  const [readinessSignals, setReadinessSignals] = useState<ReadinessSignals | null>(null);
  const readinessEvaluation = useMemo(
    () => (readinessSignals ? evaluateCapabilityRegistry(READINESS_REGISTRY, readinessSignals) : EMPTY_CAPABILITY_EVALUATION),
    [readinessSignals],
  );
  const [masterySignals, setMasterySignals] = useState<MasterySignals | null>(null);
  const masteryEvaluation = useMemo(
    () => (masterySignals ? evaluateCapabilityRegistry(MASTERY_REGISTRY, masterySignals) : EMPTY_CAPABILITY_EVALUATION),
    [masterySignals],
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
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    try {
      const getJson = (path: string) =>
        fetch(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } }).catch(() => null);
      const cid = encodeURIComponent(selectedCompanyId);
      const [
        data,
        profileResponse,
        companyApiConfigResponse,
        externalApisResponse,
        socialStatusResponse,
        teamSummaryResponse,
        subscriptionResponse,
        websiteSnapshotResponse,
        blogsResponse,
        creatorAssetsResponse,
        templateCollectionsResponse,
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
        getJson(`/api/user/subscription?company_id=${cid}`),
        getJson(`/api/website-intelligence/canonical?company_id=${cid}`),
        getJson(`/api/blogs?company_id=${cid}`),
        getJson(`/api/creator-assets?company_id=${cid}`),
        getJson(`/api/creator-templates/collections?company_id=${cid}`),
        getJson(`/api/automation/config?organization_id=${cid}`),
        getJson(`/api/campaigns?companyId=${cid}`),
        getJson(`/api/reports?company_id=${cid}`),
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
        const [companyApiConfigData, externalApisData, socialStatusData, teamSummaryData, subscriptionData, websiteSnapshotData, blogsData, creatorAssetsData, templateCollectionsData, automationConfigData, campaignsData, reportsData, telemetryProvidersData] = await Promise.all([
          companyApiConfigResponse?.ok ? companyApiConfigResponse.json() : Promise.resolve(null),
          externalApisResponse?.ok ? externalApisResponse.json() : Promise.resolve(null),
          socialStatusResponse?.ok ? socialStatusResponse.json() : Promise.resolve(null),
          teamSummaryResponse?.ok ? teamSummaryResponse.json() : Promise.resolve(null),
          subscriptionResponse?.ok ? subscriptionResponse.json() : Promise.resolve(null),
          websiteSnapshotResponse?.ok ? websiteSnapshotResponse.json() : Promise.resolve(null),
          blogsResponse?.ok ? blogsResponse.json() : Promise.resolve(null),
          creatorAssetsResponse?.ok ? creatorAssetsResponse.json() : Promise.resolve(null),
          templateCollectionsResponse?.ok ? templateCollectionsResponse.json() : Promise.resolve(null),
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
        // Assemble canonical, capability-aware Setup signals (no scoring here —
        // that lives in the engine). Channels come from social_accounts; Team
        // from the membership-summary endpoint readable by every member.
        setSetupSignals(
          buildSetupSignals({
            profile: profileData?.profile ?? null,
            features: data.features,
            socialAccounts: Array.isArray(socialStatusData?.accounts) ? socialStatusData.accounts : null,
            teamSummary:
              teamSummaryData && typeof teamSummaryData.memberCount === 'number'
                ? { ownerExists: Boolean(teamSummaryData.ownerExists), memberCount: teamSummaryData.memberCount }
                : null,
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
            socialAccounts: Array.isArray(socialStatusData?.accounts) ? socialStatusData.accounts : null,
            websiteSnapshot: websiteSnapshotData?.snapshot ?? null,
            blogsCount: Array.isArray(blogsData?.blogs) ? blogsData.blogs.length : null,
            mediaCount: Array.isArray(creatorAssetsData?.assets) ? creatorAssetsData.assets.length : null,
            templatesCount: Array.isArray(templateCollectionsData?.collections) ? templateCollectionsData.collections.length : null,
            automation:
              automationConfigData && typeof automationConfigData.enabled === 'boolean'
                ? {
                    enabled: Boolean(automationConfigData.enabled),
                    autoReply: Boolean(automationConfigData.auto_reply_enabled),
                    autoDm: Boolean(automationConfigData.auto_dm_enabled),
                  }
                : null,
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
            blogsCount: Array.isArray(blogsData?.blogs) ? blogsData.blogs.length : null,
            campaignsCount: Array.isArray(campaignsData?.campaigns) ? campaignsData.campaigns.length : null,
            reportsCount: Array.isArray(reportsData?.reports) ? reportsData.reports.length : null,
            mediaCount: Array.isArray(creatorAssetsData?.assets) ? creatorAssetsData.assets.length : null,
            templatesCount: Array.isArray(templateCollectionsData?.collections) ? templateCollectionsData.collections.length : null,
            teamSummary:
              teamSummaryData && typeof teamSummaryData.memberCount === 'number'
                ? { memberCount: teamSummaryData.memberCount }
                : null,
            automation:
              automationConfigData && typeof automationConfigData.enabled === 'boolean'
                ? {
                    enabled: Boolean(automationConfigData.enabled),
                    autoReply: Boolean(automationConfigData.auto_reply_enabled),
                    autoDm: Boolean(automationConfigData.auto_dm_enabled),
                  }
                : null,
            websiteSnapshot: websiteSnapshotData?.snapshot ?? null,
            telemetry: telemetryProvidersData?.signals ?? null,
          }),
        );
      } else {
        setProfileStatus(null);
      }
    } catch (err) {
      console.warn('[command-center] Could not load readiness data:', err);
    }
  }, [authChecked, selectedCompanyId, user?.userId]);

  useEffect(() => {
    if (!authChecked || !user?.userId) return;

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
  }, [authChecked, user?.userId]);

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
      try {
        const response = await fetch(`/api/user/subscription?company_id=${selectedCompanyId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          setUserTier(data.data?.tier || 'free');
          return;
        }

        console.warn('[command-center] Failed to load subscription tier');
        setUserTier('free');
      } catch (err) {
        console.error('[command-center] Failed to load subscription tier:', err);
        setUserTier('free');
      }
    };

    void loadUserTier();
  }, [authChecked, selectedCompanyId, user?.userId]);

  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const fetchReportStatus = async (): Promise<'free_available' | 'generating' | 'used' | null> => {
      try {
        if (cancelled) return null;

        const response = await apiFetch(`/api/reports?company_id=${selectedCompanyId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok || cancelled) return null;

        const data = await response.json();
        if (cancelled) return null;

        const nextState = {
          reportState: (data.reportState || 'free_available') as 'free_available' | 'generating' | 'used',
          hasGeneratingReport: Boolean(data.hasGeneratingReport),
          hasFreeReportUsed: Boolean(data.hasFreeReportUsed),
        };
        setReportCardStatus(nextState);
        return nextState.reportState;
      } catch (error) {
        console.error('[command-center] Failed to load report card state:', error);
        return null;
      }
    };

    void fetchReportStatus().then((state) => {
      if (cancelled || state !== 'generating') return;
      pollHandle = setInterval(async () => {
        const nextState = await fetchReportStatus();
        if (nextState !== 'generating' && pollHandle) {
          clearInterval(pollHandle);
          pollHandle = null;
        }
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
    };
  }, [authChecked, selectedCompanyId, user?.userId]);

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

  const _ef1 = !authChecked || isLoading;

  if (!user?.userId) {
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
