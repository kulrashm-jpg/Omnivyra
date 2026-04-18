import { useEffect } from 'react';
import type { ChatMessage, RecommendationContext } from './types';
import { getCampaignChatStorageKey, getPlanningFormStorageKey, loadCampaignMessages } from './campaignChatStorage';
import { buildGenericWelcome, buildRecommendationWelcome } from './planningWelcomeHelpers';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type Params = {
  campaignId?: string;
  campaignData?: any;
  context: string | undefined;
  recommendationContext?: RecommendationContext | null;
  initialPlan?: { weeks: any[] } | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  forceFreshPlanningThread?: boolean;
  configuredPlatformKeys: string[];
  getFirstUnansweredGatherKey: () => string | null;
  hasAnsweredPlanningKey: (key: string) => boolean;
  getFirstQuestion: () => string;
  autoTriggerPlanRef: React.MutableRefObject<boolean>;
  freshThreadAppliedRef: React.MutableRefObject<Set<string>>;
  selectedProvider: 'gpt' | 'claude' | 'demo';
  getProviderName: (provider: 'gpt' | 'claude' | 'demo') => string;
  planningSelectedPlatforms: string[];
  setPlanningSelectedPlatforms: Setter<string[]>;
  setPlanningPlatformContentRequests: Setter<Record<string, Record<string, string>>>;
  setPlanningCrossPlatformSharingEnabled: Setter<boolean>;
  setPlanningCrossPlatformScheduleMode: Setter<'same_time' | 'staggered' | 'ai_recommended'>;
  setMessages: Setter<ChatMessage[]>;
};

export function useCampaignAiThreadBootstrap({
  campaignId,
  campaignData,
  context,
  recommendationContext,
  initialPlan,
  prefilledPlanning,
  collectedPlanningContext,
  forceFreshPlanningThread,
  configuredPlatformKeys,
  getFirstUnansweredGatherKey,
  hasAnsweredPlanningKey,
  getFirstQuestion,
  autoTriggerPlanRef,
  freshThreadAppliedRef,
  selectedProvider,
  getProviderName,
  planningSelectedPlatforms,
  setPlanningSelectedPlatforms,
  setPlanningPlatformContentRequests,
  setPlanningCrossPlatformSharingEnabled,
  setPlanningCrossPlatformScheduleMode,
  setMessages,
}: Params) {
  useEffect(() => {
    if (!campaignId || !campaignData) return;

    const initializeCampaignThread = async () => {
      try {
      const contextKey = `${campaignId}:${String(context || 'general').toLowerCase()}`;
      const isPlanningContext =
        context?.toLowerCase().includes('campaign-planning') ||
        context?.toLowerCase().includes('12week-plan') ||
        context?.toLowerCase().includes('blueprint-plan');
      const freshThreadSessionKey = `campaign_chat_fresh_applied_${contextKey}`;
      const wasFreshAppliedInSession =
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem(freshThreadSessionKey) === '1';
      const shouldForceFreshNow =
        forceFreshPlanningThread &&
        isPlanningContext &&
        !freshThreadAppliedRef.current.has(contextKey) &&
        !wasFreshAppliedInSession;

      if (shouldForceFreshNow && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(getCampaignChatStorageKey(context, campaignId));
          window.sessionStorage.removeItem(getPlanningFormStorageKey(campaignId));
          window.sessionStorage.setItem(freshThreadSessionKey, '1');
        } catch (e) {
          console.warn('Could not clear saved chat draft', e);
        }
        freshThreadAppliedRef.current.add(contextKey);
      }

      let existingMessages = shouldForceFreshNow ? [] : await loadCampaignMessages(context, campaignId);
      const isRecsContext = context?.toLowerCase().includes('campaign-recommendations');
      if (isRecsContext && initialPlan?.weeks?.length && existingMessages.length > 0) {
        const firstAi = existingMessages.find((m) => m.type === 'ai')?.message ?? '';
        if (firstAi.includes('Generate recommendations first')) existingMessages = [];
      }

      if (existingMessages.length === 0) {
        const durationWeeks = campaignData?.duration_weeks ?? initialPlan?.weeks?.length ?? 12;
        let welcomeText: string;
        const isRecommendationsContext = context?.toLowerCase().includes('campaign-recommendations');
        if (isRecommendationsContext) {
          welcomeText = initialPlan?.weeks?.length
            ? `Hello! I'm your expert consultant for **improving this campaign's plan**. You've got recommendations loaded.\n\nI'll ask a few quick questions first to focus our work-scope (all weeks or specific week), interest areas (topics, content types, geo focus, scheduling, target customer, etc.), and what's missing from a content manager standpoint. Once you answer, I'll refine accordingly. When you're satisfied, apply the agreed changes to your campaign.\n\n**Would you like to improve all weeks, or focus on a specific week (or weeks)?**`
            : `Hello! I'm your expert consultant for **vetting and refining recommendations**. Generate recommendations first (click "Generate Recommendations" above), then I'll help you improve them by scope (all weeks or specific weeks), topics, content types, geo focus, and more.`;
        } else if (initialPlan?.weeks?.length && (context?.toLowerCase().includes('12week-plan') || context?.toLowerCase().includes('blueprint-plan'))) {
          welcomeText = `Hello! You're refining your **${durationWeeks}-week campaign plan**. I won't ask questions-just describe the changes you want (e.g., "Add topic X to Week 1", "Change Week 2 theme to...", "Add 2 LinkedIn posts to Week 3"). I'll apply them and return the updated plan.`;
        } else if (recommendationContext && (recommendationContext.target_regions?.length || recommendationContext.context_payload)) {
          welcomeText = buildRecommendationWelcome({
            campaignData,
            recommendationContext,
            prefilledPlanning,
            configuredPlatformKeys,
            getFirstUnansweredGatherKey,
            hasAnsweredPlanningKey,
            getFirstQuestion,
            onAutoTriggerPlan: () => {
              autoTriggerPlanRef.current = true;
            },
          });
        } else {
          welcomeText = buildGenericWelcome(
            campaignData?.name || 'this campaign',
            prefilledPlanning,
            getFirstUnansweredGatherKey,
            getFirstQuestion
          );
        }

        setMessages([{
          id: Date.now(),
          type: 'ai',
          message: welcomeText,
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId,
        }]);
      } else {
        setMessages(existingMessages);
      }

      let restoredSharingFromStorage = false;
      let restoredPlatformsFromStorage = false;
      if (typeof window !== 'undefined' && campaignId && isPlanningContext) {
        try {
          const formKey = getPlanningFormStorageKey(campaignId);
          const saved = window.sessionStorage.getItem(formKey);
          if (saved) {
            const parsed = JSON.parse(saved) as {
              platformContentRequests?: Record<string, Record<string, string>>;
              crossPlatformSharing?: boolean;
              scheduleMode?: string;
              planningSelectedPlatforms?: string[];
            };
            if (parsed?.platformContentRequests && typeof parsed.platformContentRequests === 'object' && Object.keys(parsed.platformContentRequests).length > 0) {
              setPlanningPlatformContentRequests(parsed.platformContentRequests);
            }
            if (Array.isArray(parsed?.planningSelectedPlatforms) && parsed.planningSelectedPlatforms.length > 0) {
              const restored = parsed.planningSelectedPlatforms
                .map((p) => String(p).toLowerCase().replace(/^twitter$/i, 'x').trim())
                .filter(Boolean)
                .filter((p, index, arr) => arr.indexOf(p) === index)
                .filter((p) => configuredPlatformKeys.length === 0 || configuredPlatformKeys.includes(p));
              if (restored.length > 0) {
                setPlanningSelectedPlatforms(restored);
                restoredPlatformsFromStorage = true;
              }
            }
            if (typeof parsed?.crossPlatformSharing === 'boolean') {
              setPlanningCrossPlatformSharingEnabled(parsed.crossPlatformSharing);
              restoredSharingFromStorage = true;
            }
            if (parsed?.scheduleMode === 'same_time' || parsed?.scheduleMode === 'staggered' || parsed?.scheduleMode === 'ai_recommended') {
              setPlanningCrossPlatformScheduleMode(parsed.scheduleMode);
            }
          }
        } catch (e) {
          console.warn('Could not restore planning form state', e);
        }
      }

      if (!restoredSharingFromStorage) {
        const crossFromPrefilled = (prefilledPlanning as any)?.cross_platform_sharing;
        const crossFromCollected = (collectedPlanningContext as any)?.cross_platform_sharing;
        const cross = crossFromPrefilled ?? crossFromCollected;
        if (cross != null && typeof cross === 'object' && 'enabled' in cross) {
          setPlanningCrossPlatformSharingEnabled(Boolean((cross as { enabled?: boolean }).enabled));
        }
      }

      if (!restoredPlatformsFromStorage) {
        const raw = (prefilledPlanning as any)?.platforms ?? (collectedPlanningContext as any)?.platforms;
        const platforms = (() => {
          if (Array.isArray(raw)) return raw.map((p: any) => String(p ?? '').toLowerCase().trim()).filter(Boolean);
          if (typeof raw === 'string' && raw.trim()) return raw.split(/[,\s]+/).map((p) => p.toLowerCase().trim()).filter(Boolean);
          return [];
        })();
        const filteredPlatforms = Array.from(new Set(platforms.map((p) => (p === 'twitter' ? 'x' : p))))
          .filter((p) => configuredPlatformKeys.length === 0 || configuredPlatformKeys.includes(p));
        if (filteredPlatforms.length > 0 && planningSelectedPlatforms.length === 0) {
          setPlanningSelectedPlatforms(filteredPlatforms);
        }
      }
      } catch (err) {
        console.warn('[campaign-chat] Failed to initialize thread:', err instanceof Error ? err.message : err);
      }
    };

    void initializeCampaignThread();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stable: re-init only when campaign/context identity changes, not on every callback recreation
  }, [
    campaignId,
    context,
    forceFreshPlanningThread,
    selectedProvider,
  ]);
}
