/**
 * Campaign Engagement Inbox
 * SYSTEM 2: Displays engagement signals from campaign activities.
 * Data source: GET /api/engagement/campaign-signals
 */

import Head from 'next/head';
import type { useEngagementInboxPage } from '@/features/engagement-inbox/hooks/useEngagementInboxPage';
import FiltersPanel from '@/features/engagement-inbox/components/FiltersPanel';
import SignalsList from '@/features/engagement-inbox/components/SignalsList';
import SignalDetailPanel from '@/features/engagement-inbox/components/SignalDetailPanel';
import SuggestionPanel from '@/features/engagement-inbox/components/SuggestionPanel';
import IntelligencePanel from '@/features/engagement-inbox/components/IntelligencePanel';
import ReplyComposer from '@/features/engagement-inbox/components/ReplyComposer';
import ActionBar from '@/features/engagement-inbox/components/ActionBar';

type S = ReturnType<typeof useEngagementInboxPage>;

export default function EngagementInboxView({
  state,
  actions,
}: {
  state: S['state'];
  actions: S['actions'];
}) {
  return (
    <>
      <Head>
        <title>Campaign Engagement Inbox</title>
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Campaign Engagement Inbox</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Conversations and signals from your campaign activities
          </p>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <FiltersPanel
            campaigns={state.campaigns}
            campaignId={state.campaignId}
            platform={state.platform}
            signalType={state.signalType}
            timeRange={state.timeRange}
            setCampaignId={actions.setCampaignId}
            setPlatform={actions.setPlatform}
            setSignalType={actions.setSignalType}
            setTimeRange={actions.setTimeRange}
          />

          <SignalsList
            signals={state.signals}
            loading={state.loading}
            selectedSignal={state.selectedSignal}
            onSelect={actions.selectSignal}
          />

          <aside className="w-96 bg-white flex flex-col shrink-0">
            {state.selectedSignal ? (
              <>
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">Conversation detail</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <SignalDetailPanel
                    signal={state.selectedSignal}
                    onStatusChange={actions.handleSignalStatusUpdate}
                  />
                  <div className="pt-4 space-y-2">
                    <SuggestionPanel
                      suggestion={state.suggestion}
                      suggestionModel={state.suggestionModel}
                      suggestionBusy={state.suggestionBusy}
                      suggestionError={state.suggestionError}
                      onGenerate={actions.handleGenerateResponse}
                      onAccept={actions.acceptSuggestion}
                      onDismiss={actions.dismissSuggestion}
                    />
                    <IntelligencePanel
                      intelligence={state.intelligence}
                      intelligenceBusy={state.intelligenceBusy}
                      onTryRecommendation={actions.tryRecommendation}
                    />
                  </div>
                  <ReplyComposer
                    replyText={state.replyText}
                    replying={state.replying}
                    replyError={state.replyError}
                    replySuccess={state.replySuccess}
                    intelligence={state.intelligence}
                    onChange={actions.handleReplyTextChange}
                    onSend={actions.handleReply}
                  />
                  <ActionBar
                    signal={state.selectedSignal}
                    bookmarkBusy={state.bookmarkBusy}
                    leadBusy={state.leadBusy}
                    crmBusy={state.crmBusy}
                    actionNotice={state.actionNotice}
                    onBookmark={actions.toggleBookmark}
                    onMarkAsLead={actions.markAsLead}
                    onExportToCRM={actions.handleCRMExport}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-gray-500 text-sm">
                Select a signal to view details
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
