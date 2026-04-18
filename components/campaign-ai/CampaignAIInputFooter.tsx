import React from 'react';
import { Loader2, Send } from 'lucide-react';
import ChatVoiceButton from '../ChatVoiceButton';
import { PlanActionBar } from './PlanActionBar';

type CampaignAIInputFooterProps = {
  messages: Array<{ id: number; type: string; message: string }>;
  isWeeklyPlanMessage: (message: string) => boolean;
  hasViewedPlanMessageId: number | null;
  structuredPlan: unknown | null;
  hasGeneratedPlanInSession: boolean;
  isBusy: boolean;
  governanceLocked?: boolean;
  structuredPlanMessageId: number | null;
  viewPlan: (message?: string, messageId?: number) => void;
  commitPlan: (message?: string) => void;
  saveAIContentForPlan: (message: string, structuredPlan?: unknown) => void;
  activeTab: string;
  context?: string;
  hasPreviousQuestion: boolean;
  quickPickBackIndex: number;
  aiMessageIndices: number[];
  onBackToRecommendation?: (() => void) | undefined;
  handleQuickPickBack: () => void;
  handleQuickPickBackDeeper: () => void;
  newMessage: string;
  inputClearKey: number;
  setInputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  setNewMessage: (value: string) => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  displayTopic: string;
  isRecsChat: boolean;
  onVoiceTranscription: (text: string) => void;
  onSend: () => void;
  isLoading: boolean;
};

export function CampaignAIInputFooter({
  messages,
  isWeeklyPlanMessage,
  hasViewedPlanMessageId,
  structuredPlan,
  hasGeneratedPlanInSession,
  isBusy,
  governanceLocked,
  structuredPlanMessageId,
  viewPlan,
  commitPlan,
  saveAIContentForPlan,
  activeTab,
  context,
  hasPreviousQuestion,
  quickPickBackIndex,
  aiMessageIndices,
  onBackToRecommendation,
  handleQuickPickBack,
  handleQuickPickBackDeeper,
  newMessage,
  inputClearKey,
  setInputRef,
  setNewMessage,
  handleKeyPress,
  displayTopic,
  isRecsChat,
  onVoiceTranscription,
  onSend,
  isLoading,
}: CampaignAIInputFooterProps) {
  const lastPlanMessage = [...messages].reverse().find((m) => m.type === 'ai' && isWeeklyPlanMessage(m.message));
  const hasViewedPlan = lastPlanMessage && hasViewedPlanMessageId === lastPlanMessage.id;
  const hasPlanActions = Boolean(lastPlanMessage || structuredPlan || hasGeneratedPlanInSession);
  const showsBackButton = activeTab === 'chat' &&
    (context?.toLowerCase().includes('campaign-planning') ||
      context?.toLowerCase().includes('12week-plan') ||
      context?.toLowerCase().includes('blueprint-plan') ||
      context?.toLowerCase().includes('campaign-recommendations')) &&
    hasPreviousQuestion;

  return (
    <div className="p-4 border-t border-gray-200">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <PlanActionBar
          hasPlanActions={hasPlanActions}
          hasViewedPlan={Boolean(hasViewedPlan)}
          isBusy={isBusy}
          governanceLocked={governanceLocked}
          structuredPlan={structuredPlan}
          lastPlanMessage={lastPlanMessage ? { id: lastPlanMessage.id, message: lastPlanMessage.message } : null}
          structuredPlanMessageId={structuredPlanMessageId}
          hasGeneratedPlanInSession={hasGeneratedPlanInSession}
          onViewPlan={viewPlan}
          onCommitPlan={commitPlan}
          onSaveForLater={saveAIContentForPlan}
        />
      </div>
      {showsBackButton && (
        <div className="mb-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (quickPickBackIndex === 0) {
                handleQuickPickBack();
              } else {
                handleQuickPickBackDeeper();
              }
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {quickPickBackIndex >= 1 && aiMessageIndices.length - 1 - quickPickBackIndex <= 0 && onBackToRecommendation
              ? '← Back to strategic card'
              : '← Back'}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          key={inputClearKey}
          ref={setInputRef}
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={`Virality helps you promote "${displayTopic}"...`}
          className={`flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-all duration-200 ${isRecsChat ? 'focus:ring-emerald-500' : 'focus:ring-indigo-500'}`}
          disabled={isBusy}
        />
        <ChatVoiceButton
          onTranscription={onVoiceTranscription}
          disabled={isBusy}
          context="campaign-chat"
          className="p-3 rounded-lg"
        />
        <button
          onClick={onSend}
          disabled={!newMessage.trim() || isBusy}
          className={`p-3 disabled:opacity-50 text-white rounded-lg transition-colors ${isRecsChat ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
