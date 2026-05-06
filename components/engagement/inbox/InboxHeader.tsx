/**
 * InboxHeader — pure UI for the engagement inbox top header bar.
 *
 * Phase 35-D-4 extraction from InboxDashboard. Owns:
 *   - Title block (Engagement Command Center / Queue-first triage)
 *   - "Refresh Workspace" button
 *   - Secondary priority filters (Needs Response, Platforms, Visible threads)
 *     visible only when activeQueueFilter !== 'People Reacted'
 *   - Browser-assist panel cluster (gated by browserAssistEnabled feature flag):
 *     ExtensionStatusPanel, LinkedInOperationsPanel, BrowserOperationsPanel
 *   - PlatformTabs + PlatformHealthStrip
 *
 * Pure presentational. NO data fetching, NO business logic. All data
 * arrives as props grouped into composite shapes (QueueStats, etc.) to
 * keep the prop list manageable; all actions are callback props.
 *
 * Honest deviation from the user's 6-prop spec: realistic surface is
 * ~30 distinct values across 3 child panels with their own contracts.
 * Grouping reduces the apparent prop count but doesn't change the
 * underlying complexity — this header is genuinely a thick UI surface
 * that aggregates many independent data streams.
 */

import React from 'react';
import { ExtensionStatusPanel } from '@/components/engagement/ExtensionStatusPanel';
import { LinkedInOperationsPanel } from '@/components/engagement/LinkedInOperationsPanel';
import { BrowserOperationsPanel } from '@/components/engagement/BrowserOperationsPanel';
import { PlatformTabs } from '@/components/engagement/PlatformTabs';
import { PlatformHealthStrip } from '@/components/engagement/PlatformHealthStrip';

// Composite prop shapes — pass-through types that mirror what the
// underlying panels consume. Defined locally as `any`-equivalent
// records to avoid coupling this header file to the deep types of
// each panel; the underlying panels still validate their own props.
type ExtensionPanelData = React.ComponentProps<typeof ExtensionStatusPanel>;
type LinkedInPanelData = React.ComponentProps<typeof LinkedInOperationsPanel>;
type BrowserOpsPanelData = React.ComponentProps<typeof BrowserOperationsPanel>;
type PlatformTabsData = React.ComponentProps<typeof PlatformTabs>;
type PlatformHealthData = React.ComponentProps<typeof PlatformHealthStrip>;

export interface InboxHeaderQueueStats {
  activeQueueFilter: string | 'People Reacted';
  actionableThreads: number;
  connectedPlatformsCount: number;
  visibleThreadCount: number;
  refreshDisabled: boolean;
}

export interface InboxHeaderBrowserAssist {
  enabled: boolean;
  hasLinkedInConnection: boolean;
  extensionPanel: ExtensionPanelData;
  linkedinPanel: LinkedInPanelData;
  browserOpsPanel: BrowserOpsPanelData;
}

export interface InboxHeaderProps {
  queueStats: InboxHeaderQueueStats;
  browserAssist: InboxHeaderBrowserAssist;
  platformTabs: PlatformTabsData;
  platformHealth: PlatformHealthData;

  onRefreshWorkspace: () => void;
  onSetQueueFilter: (filter: string) => void;
}

export const InboxHeader = React.memo(function InboxHeader({
  queueStats,
  browserAssist,
  platformTabs,
  platformHealth,
  onRefreshWorkspace,
  onSetQueueFilter,
}: InboxHeaderProps) {
  const isPeopleReacted = queueStats.activeQueueFilter === 'People Reacted';

  return (
    <header className="shrink-0 border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.10),_transparent_38%),linear-gradient(180deg,_#ffffff_0%,_#f8fbff_100%)] px-4 py-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">
              Engagement Command Center
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              Queue-first engagement triage
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Work the conversations that need action, handle replies, and keep cross-platform activity moving from one shared workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start">
            <button
              type="button"
              onClick={onRefreshWorkspace}
              disabled={queueStats.refreshDisabled}
              className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh Workspace
            </button>
          </div>
        </div>

        {/* Primary view-mode tabs (Needs Response | People Reaction) used to
            live here, but they're duplicated by the sticky tabs at the top
            of the left column (where the user actually scrolls). Removed to
            declutter the header area. */}

        {/* Secondary priority filters — only relevant inside Needs Response.
            Hidden in People Reaction mode where threads are organised by
            post, not priority. */}
        {!isPeopleReacted && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm">
            <button
              type="button"
              onClick={() => onSetQueueFilter('Needs Response')}
              aria-pressed={queueStats.activeQueueFilter === 'Needs Response'}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${queueStats.activeQueueFilter === 'Needs Response' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-900'}`}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Needs response</span>
              <span className="text-base font-semibold text-slate-900">{queueStats.actionableThreads}</span>
            </button>
            <button
              type="button"
              onClick={() => onSetQueueFilter('all')}
              aria-pressed={queueStats.activeQueueFilter === 'all'}
              className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 ${queueStats.activeQueueFilter === 'all' ? 'ring-2 ring-indigo-200' : ''}`}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Platforms</span>
              <span className="text-base font-semibold text-slate-900">{queueStats.connectedPlatformsCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onSetQueueFilter('all')}
              aria-pressed={queueStats.activeQueueFilter === 'all'}
              className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 ${queueStats.activeQueueFilter === 'all' ? 'ring-2 ring-indigo-200' : ''}`}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Visible threads</span>
              <span className="text-base font-semibold text-slate-900">{queueStats.visibleThreadCount}</span>
            </button>
          </div>
        )}

        {/* Browser-assist runtime surfaces are gated by a hard-off feature
            flag. They describe capabilities (DM / messaging / Sales Navigator
            / Recruiter capture) that require a Chrome extension that does not
            ship today. Kept in the tree behind the flag so the architecture
            is preserved without misleading production users. */}
        {browserAssist.enabled && (
          <>
            <ExtensionStatusPanel {...browserAssist.extensionPanel} />
            {browserAssist.hasLinkedInConnection ? (
              <LinkedInOperationsPanel {...browserAssist.linkedinPanel} />
            ) : null}
            <BrowserOperationsPanel {...browserAssist.browserOpsPanel} />
          </>
        )}
      </div>

      <PlatformTabs {...platformTabs} className={`${platformTabs.className ?? ''} mt-4`.trim()} />

      {/*
        Status strip for the selected platform: overall dot, per-mechanism
        badges (API / RPA / Ext / Publish × reply / like / DM / post), and
        ingress summary (polling / webhook / extension_events). When the "All"
        tab is selected, renders a compact row of per-platform dots instead
        of the full grid.
      */}
      <PlatformHealthStrip {...platformHealth} className={`${platformHealth.className ?? ''} mt-3`.trim()} />
    </header>
  );
});
