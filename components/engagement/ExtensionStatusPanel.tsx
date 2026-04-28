import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getPlatformLabel } from '@/utils/platformIcons';

type PlatformRow = {
  platform: string;
  connected: boolean;
  workspaceEnabled: boolean;
  browserEnabled: boolean;
  hasOpenTab: boolean;
  openTabCount: number;
  hasMessagingTab?: boolean;
  hasFeedTab?: boolean;
  hasSalesNavigatorTab?: boolean;
  hasRecruiterTab?: boolean;
};

interface ExtensionStatusPanelProps {
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  orgId?: string | null;
  userLabel?: string | null;
  runtimeId?: string | null;
  version?: string | null;
  platforms: PlatformRow[];
  updatingPlatform?: string | null;
  onRefresh: () => void;
  onTogglePlatform: (platform: string, enabled: boolean) => Promise<void>;
}

function getPlatformStateMeta(platform: PlatformRow, authenticated: boolean) {
  if (!platform.workspaceEnabled) {
    return {
      dot: 'bg-slate-400',
      label: 'Off in workspace'
    };
  }

  if (!platform.browserEnabled) {
    return {
      dot: 'bg-amber-500',
      label: 'Browser toggle off'
    };
  }

  if (!authenticated) {
    return {
      dot: 'bg-amber-500',
      label: 'Needs auth'
    };
  }

  if (platform.hasOpenTab) {
    if (platform.platform === 'linkedin' && platform.hasMessagingTab) {
      return {
        dot: 'bg-emerald-500',
        label: 'Messaging tab active'
      };
    }

    if (platform.platform === 'linkedin' && platform.hasSalesNavigatorTab) {
      return {
        dot: 'bg-emerald-500',
        label: 'Sales Navigator tab active'
      };
    }

    if (platform.platform === 'linkedin' && platform.hasRecruiterTab) {
      return {
        dot: 'bg-emerald-500',
        label: 'Recruiter tab active'
      };
    }

    if (platform.platform === 'linkedin' && platform.hasFeedTab) {
      return {
        dot: 'bg-amber-500',
        label: 'Feed tab active'
      };
    }

    if (platform.hasMessagingTab) {
      return {
        dot: 'bg-emerald-500',
        label: 'Messaging surface active'
      };
    }

    if (platform.hasFeedTab) {
      return {
        dot: 'bg-amber-500',
        label: 'Feed surface active'
      };
    }

    return {
      dot: 'bg-emerald-500',
      label: `${platform.openTabCount} tab${platform.openTabCount === 1 ? '' : 's'} active`
    };
  }

  return {
    dot: 'bg-amber-500',
    label: 'Enabled, no tab open'
  };
}

export function ExtensionStatusPanel({
  loading,
  error,
  authenticated,
  orgId,
  userLabel,
  runtimeId,
  version,
  platforms,
  updatingPlatform,
  onRefresh,
  onTogglePlatform
}: ExtensionStatusPanelProps) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${error ? 'bg-red-500' : authenticated ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <p className="text-sm font-semibold text-slate-900">Omnivyra Extension</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${error ? 'bg-red-50 text-red-700' : authenticated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {error ? 'Disconnected' : authenticated ? 'Connected' : 'Needs sign-in'}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {error
              ? 'The Engagement Center cannot currently reach the browser extension on this page.'
              : authenticated
                ? 'The browser extension is connected and ready to manage supported social platforms.'
                : 'The extension is reachable, but it still needs to be authenticated to Omnivyra.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Org: <strong className="text-slate-700">{orgId || 'Unknown'}</strong></span>
            <span>User: <strong className="text-slate-700">{userLabel || 'Unknown'}</strong></span>
            <span>Runtime: <strong className="text-slate-700">{runtimeId || 'Unavailable'}</strong></span>
            <span>Version: <strong className="text-slate-700">{version || 'Unavailable'}</strong></span>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Refresh extension
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {platforms.map((platform) => {
          const meta = getPlatformStateMeta(platform, authenticated);
          const label = getPlatformLabel(platform.platform);
          const isUpdating = updatingPlatform === platform.platform;

          return (
            <div
              key={platform.platform}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={platform.platform} size={16} />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{label}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      <span>{meta.label}</span>
                    </div>
                  </div>
                </div>

                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={platform.workspaceEnabled}
                    disabled={isUpdating}
                    onChange={(event) => void onTogglePlatform(platform.platform, event.target.checked)}
                  />
                  <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
                </label>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {platform.connected
                  ? platform.browserEnabled
                    ? platform.platform === 'linkedin' && platform.hasMessagingTab
                      ? 'Connected for this company. LinkedIn Messaging is open and browser fallback is ready for DM actions.'
                      : platform.platform === 'linkedin' && platform.hasFeedTab
                        ? 'Connected for this company. A LinkedIn feed tab is open, but DM actions still need LinkedIn Messaging.'
                        : platform.platform === 'linkedin' && platform.hasSalesNavigatorTab
                          ? 'Connected for this company. Sales Navigator is open and ready for browser-assisted lead workflows.'
                          : platform.platform === 'linkedin' && platform.hasRecruiterTab
                            ? 'Connected for this company. Recruiter is open and ready for browser-assisted candidate workflows.'
                        : platform.hasMessagingTab
                          ? `Connected for this company. ${label} messaging surface is open and browser fallback is ready.`
                          : platform.hasFeedTab
                            ? `Connected for this company. ${label} feed surface is open.`
                        : 'Connected for this company and available in the browser extension.'
                    : 'Connected for this company, but disabled in the browser extension.'
                  : 'Not connected for this company yet.'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
