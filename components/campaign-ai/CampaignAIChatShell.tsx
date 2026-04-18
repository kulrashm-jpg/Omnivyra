import React from 'react';
import { BookOpen, Maximize2, Minimize2, Settings, X } from 'lucide-react';
import { CampaignAIInfoPanels } from './CampaignAIInfoPanels';
import { CampaignAIInputFooter } from './CampaignAIInputFooter';
import { CampaignAIMessageList } from './CampaignAIMessageList';
import { CampaignAINonChatContent } from './CampaignAINonChatContent';
import { CampaignAITypingState } from './CampaignAITypingState';
import { ExistingPlanBanner } from './ExistingPlanBanner';
import { PlanOverviewOverlay } from './PlanOverviewOverlay';
import { PlanPreviewModal } from './PlanPreviewModal';
import { SchedulePlanConfirmModal } from './SchedulePlanConfirmModal';

export function CampaignAIChatShell(props: any) {
  const {
    isOpen,
    standalone,
    isFullscreen,
    isRecsChat,
    displayTopic,
    showLearning,
    setShowLearning,
    showSettings,
    setShowSettings,
    setIsFullscreen,
    onMinimize,
    onClose,
    campaignLearnings,
    selectedProvider,
    handleProviderChange,
    uiErrorMessage,
    uiSuccessMessage,
    activeTab,
    retrievePlanData,
    isRetrievePlanLoading,
    isParsingSavedPlan,
    resolvedCompanyId,
    campaignId,
    loadSavedPlanAndEdit,
    loadCommittedPlanAndEdit,
    nonChatContentProps,
    messageListProps,
    typingStateProps,
    messagesEndRef,
    planOverviewProps,
    planPreviewProps,
    scheduleConfirmProps,
    inputFooterProps,
  } = props;

  if (!isOpen && !standalone) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !standalone) {
      e.stopPropagation();
      onClose?.();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`flex flex-col ${standalone ? 'h-full w-full min-h-0' : `fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex ${isFullscreen ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-2 sm:p-4'}`}`}
      onClick={standalone ? undefined : handleBackdropClick}
    >
      <div
        className={`bg-white flex flex-col flex-1 min-h-0 ${standalone ? 'h-full w-full shadow-none rounded-none' : `shadow-2xl ${isFullscreen ? 'h-full w-full max-w-none rounded-none' : 'w-[min(95vw,90rem)] h-[min(90vh,calc(100vh-1rem))] min-w-[20rem] min-h-[20rem] rounded-2xl'}`}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`text-white p-4 flex items-center justify-between ${isFullscreen ? 'rounded-none' : 'rounded-t-2xl'} ${isRecsChat ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
          <div>
            <h3 className="text-lg font-semibold">Campaign AI Assistant</h3>
            <p className={`text-sm ${isRecsChat ? 'text-emerald-100' : 'text-indigo-100'}`}>{displayTopic}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowLearning(!showLearning)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="View Campaign Learnings"
            >
              <BookOpen className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMinimize?.(); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Minimize"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose?.(); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <CampaignAIInfoPanels
          showLearning={showLearning}
          showSettings={showSettings}
          campaignLearnings={campaignLearnings}
          selectedProvider={selectedProvider}
          onProviderChange={handleProviderChange}
        />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {uiErrorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
              {uiErrorMessage}
            </div>
          )}
          {uiSuccessMessage && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
              {uiSuccessMessage}
            </div>
          )}

          <ExistingPlanBanner
            activeTab={activeTab}
            retrievePlanData={retrievePlanData}
            isRetrievePlanLoading={isRetrievePlanLoading}
            isParsingSavedPlan={isParsingSavedPlan}
            resolvedCompanyId={resolvedCompanyId}
            campaignId={campaignId}
            onLoadSavedPlanAndEdit={loadSavedPlanAndEdit}
            onLoadCommittedPlanAndEdit={loadCommittedPlanAndEdit}
          />

          {activeTab !== 'chat' ? (
            <CampaignAINonChatContent {...nonChatContentProps} />
          ) : (
            <>
              <CampaignAIMessageList {...messageListProps} />
              <CampaignAITypingState {...typingStateProps} />
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <PlanOverviewOverlay {...planOverviewProps} />
        <PlanPreviewModal {...planPreviewProps} />
        <SchedulePlanConfirmModal {...scheduleConfirmProps} />
        <CampaignAIInputFooter {...inputFooterProps} />
      </div>
    </div>
  );
}
