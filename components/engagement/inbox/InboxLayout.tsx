/**
 * InboxLayout — pure layout shell for the engagement inbox 3-column grid.
 *
 * Phase 35-D-3 extraction from InboxDashboard. Owns:
 *   - 3-column responsive grid (left: threads, center: conversation,
 *     right: assistant on desktop only)
 *   - Mobile tab visibility (hides columns based on mobileTab state)
 *   - Tablet drawer for the assistant panel (md:flex lg:hidden)
 *   - Mobile-fullscreen assistant section (md:hidden when active)
 *
 * Three separate `rightPanel*` slots are intentional: the original code
 * mounted three separate AIEngagementAssistant instances (desktop /
 * drawer / mobile), each with slightly different callback wiring (the
 * drawer instance closes itself on filter; desktop and mobile do not).
 * Preserving three slots keeps that behavior exact.
 *
 * Pure presentational. NO state, NO fetch, NO mutation. State (mobileTab,
 * aiDrawerOpen) is owned by the consumer (InboxDashboard) and passed
 * through as props.
 */

import React from 'react';

export interface InboxLayoutProps {
  threadList: React.ReactNode;
  conversation: React.ReactNode;
  rightPanelDesktop: React.ReactNode;
  rightPanelDrawer: React.ReactNode;
  rightPanelMobile: React.ReactNode;
  mobileTab: 'threads' | 'conversation' | 'assistant';
  aiDrawerOpen: boolean;
  onAiDrawerToggle: () => void;
  onAiDrawerClose: () => void;
}

export const InboxLayout = React.memo(function InboxLayout({
  threadList,
  conversation,
  rightPanelDesktop,
  rightPanelDrawer,
  rightPanelMobile,
  mobileTab,
  aiDrawerOpen,
  onAiDrawerToggle,
  onAiDrawerClose,
}: InboxLayoutProps) {
  return (
    <div className="flex min-h-[56vh] flex-1 flex-col overflow-visible md:min-h-[60vh] md:flex-row lg:h-[calc(100vh-20rem)]">
      <section
        className={`flex flex-col overflow-hidden border-r border-slate-200 bg-white ${
          mobileTab !== 'threads' ? 'hidden md:flex' : 'flex'
        } md:min-w-0 md:max-w-[360px] md:flex-[0_0_30%]`}
      >
        {threadList}
      </section>

      <section
        className={`relative flex flex-col overflow-hidden border-r border-slate-200 bg-slate-50 ${
          mobileTab !== 'conversation' ? 'hidden md:flex' : 'flex'
        } md:min-w-0 md:flex-[0_0_45%]`}
      >
        {conversation}
      </section>

      <section className="hidden min-w-[240px] shrink-0 flex-[0_0_25%] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 lg:flex">
        {rightPanelDesktop}
      </section>

      <div className="hidden shrink-0 items-center border-l border-slate-200 px-2 md:flex lg:hidden">
        <button
          type="button"
          onClick={onAiDrawerToggle}
          className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Copilot {aiDrawerOpen ? 'Hide' : 'Open'}
        </button>
      </div>

      {aiDrawerOpen && (
        <div className="fixed inset-0 z-50 hidden md:block lg:hidden" aria-modal>
          <div
            className="absolute inset-0 bg-black/30"
            onClick={onAiDrawerClose}
          />
          <div className="absolute right-0 top-0 bottom-0 flex w-full max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <span className="font-medium">Engagement Copilot</span>
              <button
                type="button"
                onClick={onAiDrawerClose}
                className="p-1 text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {rightPanelDrawer}
            </div>
          </div>
        </div>
      )}

      <section
        className={`flex flex-col overflow-hidden bg-slate-50 md:hidden ${
          mobileTab !== 'assistant' ? 'hidden' : 'flex'
        }`}
      >
        {rightPanelMobile}
      </section>
    </div>
  );
});
