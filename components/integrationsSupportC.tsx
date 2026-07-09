/** Part 3/4 of integrations.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  Files,
  Globe,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Rss,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { emitSetupChanged } from '../lib/setup/setupEvents';

import { type GoogleAnalyticsStatusResponse, type GoogleSearchConsoleStatusResponse, type TrackingAssistResponse } from './integrationsSupportA';

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not synced yet';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Not synced yet';
  return timestamp.toLocaleString();
}

export function GoogleAnalyticsGridCard({
  isAdmin,
  gaStatus,
  gaLoading,
  gaError,
  gaNotice,
  gaConnecting,
  gaSyncing,
  onConnect,
  onForceSync: handleForceSync,
}: {
  isAdmin: boolean;
  gaStatus: GoogleAnalyticsStatusResponse | null;
  gaLoading: boolean;
  gaError: string | null;
  gaNotice: string | null;
  gaConnecting: boolean;
  gaSyncing: boolean;
  onConnect: () => Promise<void>;
  onForceSync: () => Promise<void>;
}) {
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

export function GoogleSearchConsoleGridCard({
  isAdmin,
  gscStatus,
  loading,
  error,
  notice,
  connecting,
  syncing,
  onConnect,
  onForceSync,
  onDisconnect,
}: {
  isAdmin: boolean;
  gscStatus: GoogleSearchConsoleStatusResponse | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  connecting: boolean;
  syncing: boolean;
  onConnect: () => Promise<void>;
  onForceSync: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const status = gscStatus?.status ?? 'setup_required';
  const isReady = status === 'ready';
  const canSync = ['connected', 'waiting_for_data', 'ready', 'low_data', 'limited_coverage'].includes(status);
  const needsConnect = ['setup_required', 'not_connected', 'error'].includes(status);
  const badgeClass =
    isReady
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'property_selection'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'waiting_for_data'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : status === 'limited_coverage'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
          : status === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : status === 'property_unverified' || status === 'domain_mapping_required'
              ? 'border-orange-200 bg-orange-50 text-orange-700'
            : 'border-gray-200 bg-gray-50 text-gray-600';
  const badgeLabel = loading && !gscStatus
    ? 'Loading...'
    : isReady
      ? 'Ready for Reports'
      : status === 'property_selection'
        ? 'Select Search Console Property'
        : status === 'waiting_for_data'
          ? 'Syncing Search Data'
          : status === 'limited_coverage'
            ? 'Limited Coverage'
            : status === 'property_unverified'
              ? 'Property Not Verified'
              : status === 'domain_mapping_required'
                ? 'Domain Mapping Required'
          : status === 'error'
            ? 'Reconnect Required'
            : 'Search Console Setup Required';

  return (
    <div
      id="google-search-console-section"
      className="flex h-full flex-col rounded-2xl border border-sky-200 bg-white p-5 shadow-sm ring-1 ring-sky-100"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
          <Search className="h-5 w-5" />
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Google Search Console</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Connect verified search properties for organic queries, landing pages, clicks, and impressions.
        </p>
      </div>

      <div className="mb-5 space-y-2">
        {['Search queries and landing pages', 'Clicks, impressions, CTR, and position', 'Verified site ownership'].map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-gray-600">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="mb-4 space-y-2 text-xs">
        {gscStatus?.property?.name && (
          <div className="text-gray-500">
            Property: <span className="font-medium text-gray-700">{gscStatus.property.name}</span>
          </div>
        )}
        {gscStatus?.last_sync && (
          <div className="text-gray-500">Last sync: {formatDateTime(gscStatus.last_sync)}</div>
        )}
        {(error || (status === 'error' && gscStatus?.message)) && (
          <div className="max-h-16 overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 leading-5 text-red-700">
            {error || gscStatus?.message}
          </div>
        )}
        {!error && notice && (
          <div className="max-h-16 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 leading-5 text-blue-700">
            {notice}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="mt-auto flex flex-wrap gap-2">
          {needsConnect ? (
            <button
              type="button"
              onClick={() => void onConnect()}
              disabled={connecting || loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
              {gscStatus?.reconnect_required ? 'Reconnect Search Console' : 'Connect Search Console'}
            </button>
          ) : canSync ? (
            <button
              type="button"
              onClick={() => void onForceSync()}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          ) : null}
          {gscStatus?.property && (
            <button
              type="button"
              onClick={() => void onDisconnect()}
              disabled={syncing || connecting || loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function GoogleAnalyticsHelperPanel({
  gaStatus,
  gaSelectingProperty,
  selectedPropertyId,
  scriptAssistOpen,
  scriptAssistLoading,
  scriptAssistError,
  scriptAssistForm,
  scriptAssistResult,
  onSelectedPropertyChange,
  onSelectProperty,
  onToggleScriptAssist,
  onScriptAssistInput,
  onGenerateScriptAssist,
}: {
  gaStatus: GoogleAnalyticsStatusResponse | null;
  gaSelectingProperty: boolean;
  selectedPropertyId: string;
  scriptAssistOpen: boolean;
  scriptAssistLoading: boolean;
  scriptAssistError: string | null;
  scriptAssistForm: { website_url: string; platform: string };
  scriptAssistResult: TrackingAssistResponse | null;
  onSelectedPropertyChange: (value: string) => void;
  onSelectProperty: () => Promise<void>;
  onToggleScriptAssist: () => void;
  onScriptAssistInput: (key: 'website_url' | 'platform', value: string) => void;
  onGenerateScriptAssist: () => Promise<void>;
}) {
  const properties = gaStatus?.properties || [];
  const showPropertySelection = gaStatus?.status === 'property_selection';

  // Hide the helper panel entirely when there's nothing for the user to do.
  if (!showPropertySelection && !scriptAssistOpen && !scriptAssistResult) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Need Help Setting Up Tracking?</h3>
            <p className="text-sm text-gray-600">Optional. Use this when Google Analytics is connected but your site is not yet sending data.</p>
          </div>
          <button
            type="button"
            onClick={onToggleScriptAssist}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open setup help
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showPropertySelection && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Choose the Google Analytics property to sync</h3>
            <p className="text-sm text-gray-600">No manual configuration is needed beyond selecting the property you want Omnivyra to use.</p>
          </div>
          {properties.length === 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              No GA properties found
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={selectedPropertyId}
                onChange={(event) => onSelectedPropertyChange(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="">Select a property</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}{property.account_id ? ` · Account ${property.account_id}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onSelectProperty()}
                disabled={!selectedPropertyId || gaSelectingProperty}
                className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {gaSelectingProperty ? 'Saving...' : 'Use this property'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Need Help Setting Up Tracking?</h3>
            <p className="text-sm text-gray-600">Optional. Use this when Google Analytics is connected but your site is not yet sending data.</p>
          </div>
          <button
            type="button"
            onClick={onToggleScriptAssist}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {scriptAssistOpen ? 'Hide setup help' : 'Open setup help'}
          </button>
        </div>

        {scriptAssistOpen && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="url"
                value={scriptAssistForm.website_url}
                onChange={(event) => onScriptAssistInput('website_url', event.target.value)}
                placeholder="https://yourwebsite.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <select
                value={scriptAssistForm.platform}
                onChange={(event) => onScriptAssistInput('platform', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="wordpress">WordPress</option>
                <option value="shopify">Shopify</option>
                <option value="custom">Custom</option>
                <option value="webflow">Webflow</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void onGenerateScriptAssist()}
              disabled={scriptAssistLoading}
              className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {scriptAssistLoading ? 'Generating...' : 'Generate setup help'}
            </button>

            {scriptAssistError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{scriptAssistError}</div>
            )}

            {scriptAssistResult && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 lg:col-span-2">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Suggested GA Script</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-gray-700">{scriptAssistResult.script}</pre>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Placement</div>
                    <div className="space-y-2 text-sm text-gray-600">
                      {scriptAssistResult.placement_instructions.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Validation</div>
                    <div className="space-y-2 text-sm text-gray-600">
                      {scriptAssistResult.validation_steps.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function GoogleSearchConsoleHelperPanel({
  gscStatus,
  selecting,
  selectedPropertyId,
  onSelectedPropertyChange,
  onSelectProperty,
}: {
  gscStatus: GoogleSearchConsoleStatusResponse | null;
  selecting: boolean;
  selectedPropertyId: string;
  onSelectedPropertyChange: (value: string) => void;
  onSelectProperty: () => Promise<void>;
}) {
  const properties = gscStatus?.properties || [];
  const showPropertySelection = gscStatus?.status === 'property_selection';
  if (!showPropertySelection) return null;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Choose the Search Console property to sync</h3>
        <p className="text-sm text-gray-600">Select the verified website property Omnivyra should use for organic search signals.</p>
      </div>
      {properties.length === 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          No Search Console properties found
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={selectedPropertyId}
            onChange={(event) => onSelectedPropertyChange(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="">Select a property</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}{property.account_id ? ` - ${property.account_id}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void onSelectProperty()}
            disabled={!selectedPropertyId || selecting}
            className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {selecting ? 'Saving...' : 'Use this property'}
          </button>
        </div>
      )}
    </div>
  );
}

