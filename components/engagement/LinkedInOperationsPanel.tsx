import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';

type LinkedInOverview = {
  connected: boolean;
  activeAccountCount: number;
  publishedPosts: number;
  syncCandidates: number;
  rawComments: number;
  inboxThreads: number;
  inboxMessages: number;
  dmThreads: number;
  dmMessages: number;
  latestPublishedAt: string | null;
  latestInboxActivityAt: string | null;
  blockers: string[];
};

type LinkedInSyncResult = {
  processedPosts: number;
  ingestedComments: number;
  failedPosts: number;
  syncedAt: string;
  threadsAfterSync: number;
};

interface LinkedInOperationsPanelProps {
  loading: boolean;
  syncing: boolean;
  surfaceActionBusy?: 'sales_navigator' | 'recruiter' | null;
  error: string | null;
  surfaceActionStatus?: string | null;
  overview: LinkedInOverview | null;
  lastSyncResult: LinkedInSyncResult | null;
  extensionAuthenticated: boolean;
  browserAssistAvailable: boolean;
  browserTabOpen: boolean;
  browserMessagingTabOpen: boolean;
  browserFeedTabOpen: boolean;
  browserSalesNavigatorTabOpen: boolean;
  browserRecruiterTabOpen: boolean;
  onRefresh: () => void;
  onSyncNow: () => Promise<void>;
  onRunBrowserAssist: (() => Promise<void>) | null;
  onCaptureSalesNavigator?: (() => Promise<void>) | null;
  onCaptureRecruiter?: (() => Promise<void>) | null;
}

function formatRelativeTimestamp(value: string | null) {
  if (!value) return 'Not yet';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function StatusPill({
  tone,
  label,
}: {
  tone: 'green' | 'amber' | 'slate';
  label: string;
}) {
  const styles =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles}`}>
      {label}
    </span>
  );
}

export function LinkedInOperationsPanel({
  loading,
  syncing,
  surfaceActionBusy = null,
  error,
  surfaceActionStatus = null,
  overview,
  lastSyncResult,
  extensionAuthenticated,
  browserAssistAvailable,
  browserTabOpen,
  browserMessagingTabOpen,
  browserFeedTabOpen,
  browserSalesNavigatorTabOpen,
  browserRecruiterTabOpen,
  onRefresh,
  onSyncNow,
  onRunBrowserAssist,
  onCaptureSalesNavigator,
  onCaptureRecruiter,
}: LinkedInOperationsPanelProps) {
  const blockers = overview?.blockers ?? [];
  const browserSurfaceActive =
    browserMessagingTabOpen ||
    browserSalesNavigatorTabOpen ||
    browserRecruiterTabOpen;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
              <PlatformIcon platform="linkedin" size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
                LinkedIn Operations
              </p>
              <h3 className="text-xl font-semibold text-slate-900">
                Run engagement from OmniVyra
              </h3>
            </div>
          </div>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            This workspace now treats the company LinkedIn connection as the primary path.
            OmniVyra can pull comment activity from published LinkedIn posts into the unified inbox,
            while the browser extension stays available as a fallback for browser-assisted coverage,
            including LinkedIn messaging capture, Sales Navigator lead workflows, and Recruiter candidate workflows.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill
              tone={overview?.connected ? 'green' : 'amber'}
              label={overview?.connected ? 'Company connection ready' : 'Company connection missing'}
            />
            <StatusPill
              tone={overview && overview.syncCandidates > 0 ? 'green' : 'amber'}
              label={
                overview && overview.syncCandidates > 0
                  ? 'Backend sync ready'
                  : 'Backend sync needs published LinkedIn posts'
              }
            />
            <StatusPill
              tone={browserAssistAvailable && browserSurfaceActive ? 'green' : browserAssistAvailable ? 'amber' : 'slate'}
              label={
                browserAssistAvailable && browserMessagingTabOpen
                  ? 'Browser fallback live'
                  : browserAssistAvailable && browserSalesNavigatorTabOpen
                    ? 'Sales Navigator fallback live'
                    : browserAssistAvailable && browserRecruiterTabOpen
                      ? 'Recruiter fallback live'
                  : browserAssistAvailable
                    ? browserFeedTabOpen || browserTabOpen
                      ? 'Messaging tab needed for DM actions'
                      : 'Browser fallback available'
                    : 'Browser fallback unavailable'
              }
            />
            <StatusPill
              tone={extensionAuthenticated ? 'green' : 'amber'}
              label={extensionAuthenticated ? 'Extension authenticated' : 'Extension needs auth'}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Refresh LinkedIn
          </button>
          <button
            type="button"
            onClick={() => void onSyncNow()}
            disabled={loading || syncing}
            className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing LinkedIn…' : 'Sync LinkedIn now'}
          </button>
          {onRunBrowserAssist ? (
            <button
              type="button"
              onClick={() => void onRunBrowserAssist()}
              disabled={loading || syncing || !browserAssistAvailable}
              className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run browser assist
            </button>
          ) : null}
          {onCaptureSalesNavigator ? (
            <button
              type="button"
              onClick={() => void onCaptureSalesNavigator()}
              disabled={loading || syncing || surfaceActionBusy !== null || !browserSalesNavigatorTabOpen}
              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {surfaceActionBusy === 'sales_navigator' ? 'Capturing leads...' : 'Capture Sales Navigator'}
            </button>
          ) : null}
          {onCaptureRecruiter ? (
            <button
              type="button"
              onClick={() => void onCaptureRecruiter()}
              disabled={loading || syncing || surfaceActionBusy !== null || !browserRecruiterTabOpen}
              className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {surfaceActionBusy === 'recruiter' ? 'Capturing candidates...' : 'Capture Recruiter'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connected accounts</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overview?.activeAccountCount ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">LinkedIn accounts currently available for this company.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Published posts</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overview?.publishedPosts ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">LinkedIn posts published from OmniVyra in the last 30 days.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Raw comments</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overview?.rawComments ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">LinkedIn comments already pulled into OmniVyra storage.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Inbox threads</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overview?.inboxThreads ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Unified LinkedIn conversations ready for triage here.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">DM threads</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overview?.dmThreads ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">LinkedIn direct-message threads captured into OmniVyra.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">What works in this view</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            OmniVyra can already use the company LinkedIn connection to ingest comments on published
            LinkedIn posts and turn them into inbox threads. Centralized reply coverage is still partial,
            so the extension remains available as a browser-assisted fallback where LinkedIn requires it.
          </p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Last published LinkedIn post</p>
              <p className="mt-1">{formatRelativeTimestamp(overview?.latestPublishedAt ?? null)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Last LinkedIn inbox activity</p>
              <p className="mt-1">{formatRelativeTimestamp(overview?.latestInboxActivityAt ?? null)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Browser surface</p>
              <p className="mt-1">
                {browserMessagingTabOpen
                  ? 'LinkedIn Messaging is open'
                  : browserSalesNavigatorTabOpen
                    ? 'Sales Navigator is open'
                    : browserRecruiterTabOpen
                      ? 'Recruiter is open'
                  : browserFeedTabOpen
                    ? 'LinkedIn feed is open'
                    : browserTabOpen
                      ? 'A LinkedIn tab is open'
                      : 'No LinkedIn tab detected'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Sales Navigator</p>
              <p className="mt-1">
                {browserSalesNavigatorTabOpen
                  ? 'Surface is open and browser fallback can attach to lead workflows.'
                  : 'Open Sales Navigator to activate lead-specific browser assistance.'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Recruiter</p>
              <p className="mt-1">
                {browserRecruiterTabOpen
                  ? 'Surface is open and browser fallback can attach to candidate workflows.'
                  : 'Open Recruiter to activate recruiter-specific browser assistance.'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Sync-ready posts</p>
              <p className="mt-1">{overview?.syncCandidates ?? 0} post(s) can be pulled right now.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">Inbox messages</p>
              <p className="mt-1">{overview?.inboxMessages ?? 0} LinkedIn message records are in OmniVyra.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">DM messages</p>
              <p className="mt-1">{overview?.dmMessages ?? 0} LinkedIn DMs have been normalized into the inbox.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">Current blockers</p>
          {error ? (
            <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>
          ) : blockers.length > 0 ? (
            <div className="mt-3 space-y-2">
              {blockers.map((blocker) => (
                <div key={blocker} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  {blocker}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-emerald-700">
              LinkedIn is in a healthy operating state for published-post engagement sync.
            </p>
          )}

          {surfaceActionStatus ? (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
              {surfaceActionStatus}
            </div>
          ) : null}

          {lastSyncResult ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <p className="font-medium text-emerald-900">Last sync result</p>
              <p className="mt-1">
                Processed {lastSyncResult.processedPosts} post(s), ingested {lastSyncResult.ingestedComments} comment(s),
                and left {lastSyncResult.threadsAfterSync} LinkedIn thread(s) ready in the inbox.
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                {formatRelativeTimestamp(lastSyncResult.syncedAt)}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
