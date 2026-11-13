import React from 'react';
import { Loader2 } from 'lucide-react';
import AIGenerationProgress from '../AIGenerationProgress';
import { getWeeklyPlanTimingByWeeks, isFinalPlanSubmissionMessage } from './chatHelpers';

export function CampaignAITypingState(props: any) {
  const {
    isTyping,
    activeTab,
    messages,
    modeLoading,
    campaignData,
    initialPlan,
    planAbortRef,
    isSchedulingPlan,
    isLoading,
    isRecsChat,
    selectedProvider,
  } = props;

  if (!isTyping || activeTab !== 'chat') return null;

  const lastUserMsg = [...messages].filter((m) => m.type === 'user').pop()?.message ?? '';
  const isFinalPlanRequest = modeLoading.generate_plan && isFinalPlanSubmissionMessage(lastUserMsg);

  if (isFinalPlanRequest) {
    const weeksMatch = lastUserMsg.match(/(?:proceed with|use)\s*(\d+)\s*weeks?|(\d+)\s*weeks?/i);
    const weeksNum = weeksMatch
      ? parseInt(weeksMatch[1] || weeksMatch[2] || '0', 10)
      : (campaignData as { duration_weeks?: number } | undefined)?.duration_weeks ?? initialPlan?.weeks?.length ?? 12;
    const resolvedWeeks = Math.min(12, Math.max(2, Number.isFinite(weeksNum) && weeksNum > 0 ? weeksNum : 12));
    const planTiming = getWeeklyPlanTimingByWeeks(resolvedWeeks);
    const finalMessage = `Creating ${resolvedWeeks}-week plan`;

    return (
      <div className="flex justify-start w-full px-1 sm:px-2">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message={finalMessage}
            expectedSeconds={planTiming.expectedSeconds}
            maxSecondsHint={planTiming.maxSecondsHint}
            onCancel={() => planAbortRef.current?.abort()}
            // Mirrors /api/campaigns/ai/plan (generate_plan) + runCampaignAiPlanExecutor:
            // moderate + load campaign/version/planning inputs, resolve assist context,
            // runWithContext (AI), evaluateGeneratedPlan + calendar conflict check,
            // saveAiCampaignPlan / saveDraftBlueprint. The AI step takes the remaining time.
            // (The old rotating messages named sub-steps that aren't separate stages.)
            stages={[
              { label: 'Reading your campaign and answers', etaSeconds: 4 },
              { label: 'Gathering your company context', etaSeconds: 6 },
              `Writing the ${resolvedWeeks}-week plan with AI`,
              { label: 'Checking the plan and your calendar', etaSeconds: 5 },
              { label: 'Saving the plan', etaSeconds: 3 },
            ]}
          />
        </div>
      </div>
    );
  }

  if (isSchedulingPlan) {
    return (
      <div className="flex justify-start w-full px-1 sm:px-2">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message="Scheduling structured plan"
            expectedSeconds={45}
            maxSecondsHint={90}
            // Mirrors /api/campaigns/[id]/schedule-structured-plan: governance + blueprint
            // checks, scheduler lock, saveCampaignBlueprintFromLegacy, scheduleStructuredPlan;
            // then the client re-fetches the plan (useStructuredPlanScheduling).
            stages={[
              { label: 'Checking the plan can be scheduled', etaSeconds: 4 },
              { label: 'Saving the blueprint', etaSeconds: 4 },
              'Placing posts on your calendar',
              { label: 'Refreshing your plan', etaSeconds: 3 },
            ]}
          />
        </div>
      </div>
    );
  }

  if (modeLoading.generate_plan || modeLoading.refine_day || modeLoading.platform_customize) {
    const isRefineDay = modeLoading.refine_day;
    const isPlatformCustomize = modeLoading.platform_customize;
    const message = isRefineDay
      ? 'Refining selected day'
      : isPlatformCustomize
        ? 'Customizing platform content'
        : 'Refining campaign inputs';
    // Mirrors /api/campaigns/ai/plan for each mode (runCampaignAiPlanExecutor loads the
    // campaign + context, then the AI call), then the client saves the chat message
    // (saveCampaignMessage) before the loading flag clears. generate_plan here is the
    // conversational gathering turn (runGatherPhaseGate decides the next question).
    // The AI step takes the remaining time.
    const stages = isRefineDay
      ? [{ label: 'Reading your plan', etaSeconds: 5 }, 'Rewriting the day with AI', { label: 'Saving', etaSeconds: 3 }]
      : isPlatformCustomize
        ? [{ label: 'Reading your plan', etaSeconds: 5 }, 'Tailoring content for each platform', { label: 'Saving', etaSeconds: 3 }]
        : [{ label: 'Reading your answers', etaSeconds: 4 }, 'Working out the next question', { label: 'Saving', etaSeconds: 2 }];

    return (
      <div className="flex justify-start w-full px-1 sm:px-2">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message={message}
            expectedSeconds={isRefineDay ? 60 : isPlatformCustomize ? 45 : 30}
            maxSecondsHint={120}
            onCancel={() => planAbortRef.current?.abort()}
            stages={stages}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start w-full px-1 sm:px-2">
      <div className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg min-w-0">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Loader2 className={`h-4 w-4 animate-spin ${isRecsChat ? 'text-emerald-500' : 'text-indigo-500'}`} />
          ) : (
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
          )}
          <span className="text-sm text-gray-600">
            {selectedProvider === 'demo'
              ? 'Demo AI is analyzing campaign data...'
              : selectedProvider === 'gpt'
                ? 'AI Assistant is learning from past campaigns...'
                : 'Claude is reasoning with campaign context...'}
          </span>
        </div>
      </div>
    </div>
  );
}
