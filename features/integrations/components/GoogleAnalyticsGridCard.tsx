import { BarChart3, RefreshCw } from 'lucide-react';
import type { GoogleAnalyticsStatusResponse } from '../types';
import { formatDateTime } from '../utils';

export interface GoogleAnalyticsGridCardProps {
  isAdmin: boolean;
  gaStatus: GoogleAnalyticsStatusResponse | null;
  gaLoading: boolean;
  gaError: string | null;
  gaNotice: string | null;
  gaConnecting: boolean;
  gaSyncing: boolean;
  onConnect: () => Promise<void>;
  onForceSync: () => Promise<void>;
}

export default function GoogleAnalyticsGridCard({
  isAdmin,
  gaStatus,
  gaLoading,
  gaError,
  gaNotice,
  gaConnecting,
  gaSyncing,
  onConnect,
  onForceSync: handleForceSync,
}: GoogleAnalyticsGridCardProps) {
  const status = gaStatus?.status ?? 'not_connected';
  const isConnected = ['connected', 'waiting_for_data', 'ready', 'low_data'].includes(status);
  const isError = status === 'error';

  // Single source of truth for the badge in the card's top-right corner.
  // Reflects the user's actual connection state — no separate "Live now"
  // marketing badge, since pairing it with "Not connected" creates conflicting
  // signals on the same card.
  const badgeClass =
    status === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'low_data'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'waiting_for_data'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : status === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : status === 'property_selection'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-gray-200 bg-gray-50 text-gray-600';

  const badgeLabel = gaLoading && !gaStatus
    ? 'Loading...'
    : status === 'ready'
      ? 'Connected'
      : status === 'waiting_for_data'
        ? 'Syncing'
        : status === 'low_data'
          ? 'No data yet'
          : status === 'error'
            ? 'Error'
            : status === 'property_selection'
              ? 'Select property'
              : 'Not connected';

  return (
    <div
      id="google-analytics-section"
      className="flex h-full flex-col rounded-2xl border border-amber-200 bg-white p-5 shadow-sm ring-1 ring-amber-100"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Google Analytics</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Connect your Google Analytics account to track traffic, user behavior, and performance insights.
        </p>
      </div>

      <div className="mb-5 space-y-2">
        {['Sessions and traffic sources', 'Page views and engagement', 'Conversion events'].map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-gray-600">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="mb-4 space-y-2 text-xs">
        {gaStatus?.property?.name && (
          <div className="text-gray-500">
            Property: <span className="font-medium text-gray-700">{gaStatus.property.name}</span>
          </div>
        )}
        {gaStatus?.last_sync && (
          <div className="text-gray-500">Last sync: {formatDateTime(gaStatus.last_sync)}</div>
        )}
        {(gaError || (isError && gaStatus?.message)) && (
          <div className="max-h-16 overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 leading-5 text-red-700">
            {gaError || gaStatus?.message}
          </div>
        )}
        {!gaError && gaNotice && (
          <div className="max-h-16 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 leading-5 text-blue-700">
            {gaNotice}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="mt-auto flex flex-wrap gap-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={() => void onConnect()}
              disabled={gaConnecting || gaLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${gaConnecting ? 'animate-spin' : ''}`} />
              {gaStatus?.reconnect_required ? 'Reconnect Google Analytics' : 'Connect Google Analytics'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleForceSync()}
              disabled={gaSyncing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${gaSyncing ? 'animate-spin' : ''}`} />
              {gaSyncing ? 'Syncing...' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
