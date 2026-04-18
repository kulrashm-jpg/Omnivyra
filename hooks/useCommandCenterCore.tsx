import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { getVisibleCards, CommandCenterCard, Requirement, CardState } from '../config/commandCenterCards';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
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
import {
  buildMasterySections,
  buildReadinessSections,
  buildSetupSections,
  scoreSections,
  summarizeSections,
} from './commandCenterScoreModel';
import { getCardHoverMessage } from '../components/command-center/preflightHelpers';

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

  const setupSections = useMemo(() => buildSetupSections(features), [features]);
  const readinessSections = useMemo(() => buildReadinessSections(features), [features]);
  const masterySections = useMemo(() => buildMasterySections(features), [features]);
  const setupPct = useMemo(() => scoreSections(setupSections), [setupSections]);
  const masteryPct = useMemo(() => scoreSections(masterySections), [masterySections]);
  const setupSummary = useMemo(() => summarizeSections(setupSections), [setupSections]);
  const readinessSummary = useMemo(
    () =>
      readinessData
        ? {
            completedCount: readinessData.completedFeatures,
            inProgressCount: Math.max(readinessData.totalFeatures - readinessData.completedFeatures, 0),
            totalCount: readinessData.totalFeatures,
          }
        : summarizeSections(readinessSections),
    [readinessData, readinessSections],
  );
  const masterySummary = useMemo(() => summarizeSections(masterySections), [masterySections]);
  const loadReadiness = useCallback(async () => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    try {
      const [data, profileResponse, companyApiConfigResponse, externalApisResponse] = await Promise.all([
        fetchReadinessData(selectedCompanyId),
        fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=1`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null),
        fetch(`/api/external-apis/company-config?companyId=${encodeURIComponent(selectedCompanyId)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null),
        fetch(`/api/external-apis?companyId=${encodeURIComponent(selectedCompanyId)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null),
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
        const [companyApiConfigData, externalApisData] = await Promise.all([
          companyApiConfigResponse?.ok ? companyApiConfigResponse.json() : Promise.resolve(null),
          externalApisResponse?.ok ? externalApisResponse.json() : Promise.resolve(null),
        ]);
        const apiNameById = new Map<string, string>();
        (externalApisData?.apis || []).forEach((api: any) => {
          if (api?.id) {
            apiNameById.set(api.id, api.name || api.display_name || api.source_name || api.platform_name || api.id);
          }
        });
        const configuredApis = (companyApiConfigData?.configs || []).filter((row: any) => row?.enabled !== false).map((row: any) => apiNameById.get(row.api_source_id) || row.api_source_id).filter(Boolean);
        setProfileStatus({
          missingSections: profileData?.completeness?.missing_sections ?? null,
          score: typeof profileData?.overall_profile_completion === 'number' ? profileData.overall_profile_completion : null,
          connectedPlatforms: [profileData?.profile?.linkedin_url ? 'LinkedIn' : null, profileData?.profile?.facebook_url ? 'Facebook' : null, profileData?.profile?.instagram_url ? 'Instagram' : null, profileData?.profile?.x_url ? 'X' : null, profileData?.profile?.youtube_url ? 'YouTube' : null, profileData?.profile?.tiktok_url ? 'TikTok' : null, profileData?.profile?.reddit_url ? 'Reddit' : null].filter(Boolean),
          configuredApis,
        });
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

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refresh);
      window.addEventListener('company-profile-updated', refresh as EventListener);
      document.addEventListener('visibilitychange', refreshOnVisible);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('company-profile-updated', refresh as EventListener);
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
        const token = await getAuthToken();
        if (!token || cancelled) return null;

        const response = await fetch(`/api/reports?company_id=${selectedCompanyId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    masterySections,
    masterySummary,
    profileStatus,
    rawName,
    readinessData,
    readinessScore,
    readinessSections,
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
    setupSections,
    setupSummary,
    showAgain,
    user,
    userName,
    userRole,
    userTier,
    visibleCards,
  };
}
