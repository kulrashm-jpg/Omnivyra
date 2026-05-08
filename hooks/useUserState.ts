/**
 * useUserState — Single source of truth for the user's journey position.
 *
 * Returns one of five states that determine what the user sees:
 *   no_data       → No website / no report — needs to analyze first
 *   has_report    → Report exists — ready to create content
 *   has_content   → Content created — ready to launch campaigns
 *   has_campaign  → Campaign exists — ready to engage
 *   has_engagement → Engagement active — full platform user
 *
 * Every UI component should read from this hook to decide what to show.
 * This replaces fragmented checks like readinessScore, features[], card states.
 */
import { useState, useEffect, useMemo } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchReadinessData } from '../lib/shared/commandCenterReadinessService';
import type { FeatureStatus } from '../lib/shared/commandCenterReadinessService';

export type UserJourneyState =
  | 'loading'
  | 'no_data'
  | 'has_report'
  | 'has_content'
  | 'has_campaign'
  | 'has_engagement';

export interface UserStateInfo {
  /** Current position in the journey */
  state: UserJourneyState;
  /** Whether the state is still being determined */
  loading: boolean;
  /** Step number (1-5, for progress display) */
  stepNumber: number;
  /** Human-readable description of current state */
  label: string;
  /** What the user should do next */
  nextAction: string;
  /** Route for the next action */
  nextRoute: string;
  /** Raw feature statuses from backend */
  features: FeatureStatus[];
  /** Refresh the state from the backend */
  refresh: () => void;
}

/** Derive journey state from feature scores */
function deriveState(features: FeatureStatus[]): UserJourneyState {
  const score = (key: string) => features.find((f) => f.key === key)?.score ?? 0;

  // Check in reverse order (most advanced first)
  if (score('social_accounts_connected') > 0 && score('campaign_published') > 0) {
    return 'has_engagement';
  }
  if (score('campaign_created') > 0) {
    return 'has_campaign';
  }
  if (score('blog_created') > 0) {
    return 'has_content';
  }
  if (score('report_generated') > 0) {
    return 'has_report';
  }
  return 'no_data';
}

const STATE_META: Record<UserJourneyState, { step: number; label: string; nextAction: string; nextRoute: string }> = {
  loading:        { step: 0, label: 'Loading…',           nextAction: '',                          nextRoute: '' },
  no_data:        { step: 1, label: 'Getting started',    nextAction: 'Analyze your website',      nextRoute: '/reports' },
  has_report:     { step: 2, label: 'Report ready',       nextAction: 'Create your first content', nextRoute: '/command-center/content' },
  has_content:    { step: 3, label: 'Content created',    nextAction: 'Launch a campaign',          nextRoute: '/command-center/campaigns' },
  has_campaign:   { step: 4, label: 'Campaign active',    nextAction: 'Monitor engagement',         nextRoute: '/command-center/engagement' },
  has_engagement: { step: 5, label: 'Fully active',       nextAction: 'View dashboard',             nextRoute: '/dashboard' },
};

export function useUserState(): UserStateInfo {
  const { selectedCompanyId, authChecked, isAuthenticated } = useCompanyContext();
  const [features, setFeatures] = useState<FeatureStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const loadState = async () => {
    if (!selectedCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchReadinessData(selectedCompanyId);
      if (data?.features) {
        setFeatures(data.features);
      }
    } catch (err) {
      console.warn('[useUserState] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authChecked || !isAuthenticated || !selectedCompanyId) return;
    loadState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isAuthenticated, selectedCompanyId]);

  const state = useMemo(() => (loading ? 'loading' as const : deriveState(features)), [loading, features]);
  const meta = STATE_META[state];

  return {
    state,
    loading,
    stepNumber: meta.step,
    label: meta.label,
    nextAction: meta.nextAction,
    nextRoute: meta.nextRoute,
    features,
    refresh: loadState,
  };
}


