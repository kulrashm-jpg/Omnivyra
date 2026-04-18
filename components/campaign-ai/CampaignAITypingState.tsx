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
            rotatingMessages={[
              'Validating your inputs...',
              `Structuring ${resolvedWeeks} weeks...`,
              'Building weekly themes...',
              'Assigning content types...',
              finalMessage,
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
            rotatingMessages={[
              'Applying schedule...',
              'Updating calendar...',
              'Finishing schedule...',
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
    const rotatingMessages = isRefineDay
      ? ['Loading week...', 'Generating day content...', 'Applying refinements...']
      : isPlatformCustomize
        ? ['Loading platforms...', 'Customizing per platform...', 'Applying changes...']
        : ['Reading your answers...', 'Structuring next steps...', 'Preparing next question...'];

    return (
      <div className="flex justify-start w-full px-1 sm:px-2">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message={message}
            expectedSeconds={isRefineDay ? 60 : isPlatformCustomize ? 45 : 30}
            maxSecondsHint={120}
            onCancel={() => planAbortRef.current?.abort()}
            rotatingMessages={rotatingMessages}
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
