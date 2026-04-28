import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getPlatformLabel } from '@/utils/platformIcons';

type BrowserPlatform = {
  platform: string;
  browserEnabled: boolean;
  hasOpenTab: boolean;
  hasMessagingTab?: boolean;
  hasFeedTab?: boolean;
};

interface BrowserOperationsPanelProps {
  loading: boolean;
  authenticated: boolean;
  platforms: BrowserPlatform[];
  busyPlatform?: string | null;
  statusByPlatform?: Record<string, string | null>;
  errorByPlatform?: Record<string, string | null>;
  onRunBrowserAssist: (platform: string) => Promise<void>;
}

function getSurfaceLabel(platform: BrowserPlatform) {
  if (platform.hasMessagingTab) return 'Messaging surface active';
  if (platform.hasFeedTab) return 'Feed surface active';
  if (platform.hasOpenTab) return 'Tab active';
  return 'No tab open';
}

function getSurfaceDescription(platform: BrowserPlatform) {
  const label = getPlatformLabel(platform.platform);
  if (!platform.browserEnabled) {
    return `${label} is connected for this company, but browser fallback is disabled in the extension.`;
  }
  if (platform.hasMessagingTab) {
    return `${label} messaging is open and ready for browser-assisted reply and like actions.`;
  }
  if (platform.hasFeedTab) {
    return `${label} feed is open. Open the messaging surface when you need DM-style actions.`;
  }
  if (platform.hasOpenTab) {
    return `${label} is open in the browser. Open the exact messaging surface when you need thread actions.`;
  }
  return `Open ${label} in the browser to activate browser-assisted fallback for this platform.`;
}

export function BrowserOperationsPanel({
  loading,
  authenticated,
  platforms,
  busyPlatform = null,
  statusByPlatform = {},
  errorByPlatform = {},
  onRunBrowserAssist,
}: BrowserOperationsPanelProps) {
  if (platforms.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">
          Browser Operations
        </p>
        <h3 className="text-xl font-semibold text-slate-900">
          Run cross-platform engagement from Omnivyra
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Use the authenticated browser session as the fallback lane for platforms where API coverage is partial.
          When a supported messaging or feed surface is open, Omnivyra can attach browser-assisted workflows
          without pushing you back into manual console work.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {platforms.map((platform) => {
          const label = getPlatformLabel(platform.platform);
          const statusMessage = statusByPlatform[platform.platform];
          const errorMessage = errorByPlatform[platform.platform];
          const isBusy = busyPlatform === platform.platform;
          const canRun = authenticated && platform.browserEnabled;

          return (
            <div
              key={platform.platform}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <PlatformIcon platform={platform.platform} size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className="mt-1 text-xs text-slate-500">{getSurfaceLabel(platform)}</p>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-500">
                {getSurfaceDescription(platform)}
              </p>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRunBrowserAssist(platform.platform)}
                  disabled={loading || isBusy || !canRun}
                  className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? `Running ${label}...` : `Run ${label} browser assist`}
                </button>
              </div>

              {statusMessage ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
                  {statusMessage}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                  {errorMessage}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
