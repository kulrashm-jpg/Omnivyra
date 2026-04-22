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
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';

type IntegrationType = 'lead_webhook' | 'wordpress' | 'custom_blog_api';
type IntegrationStatus = 'connected' | 'failed' | 'pending';
type FocusArea = 'website' | 'data';

interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface CategoryCard {
  id: string;
  focus: FocusArea;
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  badgeClassName: string;
  items: string[];
  actions: IntegrationAction[];
}

type IntegrationAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void; tone?: 'secondary' };

type GoogleAnalyticsCardStatus =
  | 'not_connected'
  | 'property_selection'
  | 'connected'
  | 'waiting_for_data'
  | 'ready'
  | 'low_data'
  | 'error';

type GoogleAnalyticsStatusResponse = {
  connected: boolean;
  property: {
    id: string;
    name: string;
    account_id: string | null;
  } | null;
  status: GoogleAnalyticsCardStatus;
  message: string;
  last_sync: string | null;
  events_last_30_days?: number;
  properties?: Array<{
    id: string;
    name: string;
    account_id: string | null;
    active: boolean;
  }>;
  reconnect_required?: boolean;
};

type TrackingAssistResponse = {
  status: 'ok';
  script: string;
  placement_instructions: string[];
  validation_steps: string[];
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const focus = typeof context.query.focus === 'string' ? context.query.focus : '';
  if (focus === 'website' || focus === 'data') {
    return { props: {} };
  }

  const query = new URLSearchParams();
  query.set('focus', 'website');
  for (const [key, value] of Object.entries(context.query)) {
    if (key === 'focus' || value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
      continue;
    }
    query.set(key, value);
  }

  return {
    redirect: {
      destination: `/integrations?${query.toString()}`,
      permanent: false,
    },
  };
};

const TYPE_LABELS: Record<IntegrationType, string> = {
  lead_webhook: 'Lead Webhook',
  wordpress: 'WordPress',
  custom_blog_api: 'Custom Blog API',
};

const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  lead_webhook: <Plug className="h-5 w-5" />,
  wordpress: <Globe className="h-5 w-5" />,
  custom_blog_api: <Rss className="h-5 w-5" />,
};

const TYPE_COLORS: Record<IntegrationType, string> = {
  lead_webhook: 'bg-emerald-100 text-emerald-700',
  wordpress: 'bg-blue-100 text-blue-700',
  custom_blog_api: 'bg-violet-100 text-violet-700',
};

const STATUS_BADGE: Record<IntegrationStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="h-3.5 w-3.5" /> },
};

const CONFIG_FIELDS: Record<IntegrationType, { key: string; label: string; placeholder: string; type?: string; hint?: string }[]> = {
  lead_webhook: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://your-crm.com/webhooks/leads', hint: 'Receives POST with { name, email, phone, source }' },
    { key: 'secret', label: 'Secret (optional)', placeholder: 'my-secret-key', hint: 'Sent as X-Webhook-Secret header' },
  ],
  wordpress: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://myblog.com' },
    { key: 'username', label: 'WordPress Username', placeholder: 'admin' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: 'Generate in WordPress under Users > Profile > Application Passwords' },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Endpoint URL', placeholder: 'https://api.myblog.com/posts' },
    { key: 'api_key', label: 'API Key', placeholder: 'sk-...', type: 'password' },
    { key: 'auth_header', label: 'Auth Header (optional)', placeholder: 'Authorization', hint: 'Defaults to Authorization: Bearer <api_key>' },
  ],
};

interface ModalProps {
  mode: 'create' | 'edit';
  initial?: Partial<Integration>;
  onClose: () => void;
  onSave: (data: { type: IntegrationType; name: string; config: Record<string, string> }) => Promise<void>;
}

function IntegrationModal({ mode, initial, onClose, onSave }: ModalProps) {
  const [type, setType] = useState<IntegrationType>(initial?.type || 'lead_webhook');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, string>>(initial?.config || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = CONFIG_FIELDS[type];

  const handleTypeChange = (nextType: IntegrationType) => {
    setType(nextType);
    setConfig({});
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    const requiredField = fields.find((field) => !field.placeholder.includes('optional') && !config[field.key]);
    if (requiredField) {
      setError(`${requiredField.label} is required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ type, name: name.trim(), config });
    } catch (err: any) {
      setError(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{mode === 'create' ? 'Add Integration' : 'Edit Integration'}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {mode === 'create' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Integration Type</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((integrationType) => (
                  <button
                    key={integrationType}
                    type="button"
                    onClick={() => handleTypeChange(integrationType)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      type === integrationType
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className={`rounded p-1 ${TYPE_COLORS[integrationType]}`}>{TYPE_ICONS[integrationType]}</span>
                    <span>{TYPE_LABELS[integrationType]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`e.g. ${TYPE_LABELS[type]} - Production`}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-3">
            <div className="border-t border-gray-100 pt-3 text-sm font-medium text-gray-700">Connection Settings</div>
            {fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
                <input
                  type={field.type || 'text'}
                  value={config[field.key] || ''}
                  onChange={(event) => setConfig((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {field.hint && <p className="mt-1 text-xs text-gray-500">{field.hint}</p>}
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto">
              {saving ? 'Saving...' : mode === 'create' ? 'Add Integration' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ConnectionCardProps {
  integration: Integration;
  isAdmin: boolean;
  onEdit: (integration: Integration) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testing: boolean;
}

function ConnectionCard({ integration, isAdmin, onEdit, onDelete, onTest, testing }: ConnectionCardProps) {
  const badge = STATUS_BADGE[integration.status];
  const lastTested = integration.last_tested_at ? new Date(integration.last_tested_at).toLocaleString() : 'Never';

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`shrink-0 rounded-lg p-2 ${TYPE_COLORS[integration.type]}`}>{TYPE_ICONS[integration.type]}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{integration.name}</div>
            <div className="text-xs text-gray-500">{TYPE_LABELS[integration.type]}</div>
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      <div className="space-y-0.5 text-xs text-gray-500">
        <div>Last tested: {lastTested}</div>
        {integration.last_error && integration.status === 'failed' && (
          <div className="truncate text-red-600" title={integration.last_error}>
            Error: {integration.last_error}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1">
          <button
            onClick={() => onTest(integration.id)}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            Test
          </button>
          <button
            onClick={() => onEdit(integration)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={() => onDelete(integration.id)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyConnections({
  title,
  actions,
}: {
  title: string;
  actions: IntegrationAction[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
      <p>{title}</p>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          {actions.map((action) =>
            'href' in action ? (
              <a key={action.label} href={action.href} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </a>
            ) : (
              <button key={action.label} onClick={action.onClick} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CategoryAction({ action }: { action: IntegrationAction }) {
  if ('href' in action) {
    return (
      <a
        href={action.href}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        {action.label}
        <ArrowRight className="h-4 w-4" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
        action.tone === 'secondary'
          ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          : 'bg-gray-900 text-white hover:bg-gray-800'
      }`}
    >
      {action.label}
    </button>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not synced yet';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Not synced yet';
  return timestamp.toLocaleString();
}

function GoogleAnalyticsSetupCard({
  isAdmin,
  gaStatus,
  gaLoading,
  gaError,
  gaNotice,
  gaConnecting,
  gaSelectingProperty,
  selectedPropertyId,
  scriptAssistOpen,
  scriptAssistLoading,
  scriptAssistError,
  scriptAssistForm,
  scriptAssistResult,
  onConnect,
  onSelectedPropertyChange,
  onSelectProperty,
  onToggleScriptAssist,
  onScriptAssistInput,
  onGenerateScriptAssist,
}: {
  isAdmin: boolean;
  gaStatus: GoogleAnalyticsStatusResponse | null;
  gaLoading: boolean;
  gaError: string | null;
  gaNotice: string | null;
  gaConnecting: boolean;
  gaSelectingProperty: boolean;
  selectedPropertyId: string;
  scriptAssistOpen: boolean;
  scriptAssistLoading: boolean;
  scriptAssistError: string | null;
  scriptAssistForm: { website_url: string; platform: string };
  scriptAssistResult: TrackingAssistResponse | null;
  onConnect: () => Promise<void>;
  onSelectedPropertyChange: (value: string) => void;
  onSelectProperty: () => Promise<void>;
  onToggleScriptAssist: () => void;
  onScriptAssistInput: (key: 'website_url' | 'platform', value: string) => void;
  onGenerateScriptAssist: () => Promise<void>;
}) {
  const properties = gaStatus?.properties || [];
  const showPropertySelection = gaStatus?.status === 'property_selection';
  const connectedState = gaStatus?.status && ['connected', 'waiting_for_data', 'ready', 'low_data'].includes(gaStatus.status);

  return (
    <section id="google-analytics-section" className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Google Analytics</h2>
              <p className="text-sm text-gray-500">Click connect, choose a property, and OmniVyra handles the rest.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full border px-2.5 py-1 font-medium ${
              gaStatus?.status === 'ready'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : gaStatus?.status === 'low_data'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : gaStatus?.status === 'waiting_for_data'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : gaStatus?.status === 'error'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600'
            }`}>
              {gaStatus?.status || 'not_connected'}
            </span>
            {gaStatus?.property?.name && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-medium text-gray-600">
                Property: {gaStatus.property.name}
              </span>
            )}
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-medium text-gray-600">
              Last sync: {formatDateTime(gaStatus?.last_sync)}
            </span>
          </div>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={gaConnecting || gaLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${gaConnecting ? 'animate-spin' : ''}`} />
            {gaStatus?.reconnect_required ? 'Reconnect Google Analytics' : 'Connect Google Analytics'}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {gaLoading && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Loading Google Analytics status...
          </div>
        )}

        {gaConnecting && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Connecting Google Analytics...
          </div>
        )}

        {gaNotice && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {gaNotice}
          </div>
        )}

        {gaError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {gaError}
          </div>
        )}

        {gaStatus && !gaLoading && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="text-sm font-medium text-gray-900">{gaStatus.message}</div>
            <div className="mt-1 text-sm text-gray-600">
              {gaStatus.status === 'ready' && `Events in last 30 days: ${gaStatus.events_last_30_days || 0}`}
              {gaStatus.status === 'low_data' && 'Not enough data yet'}
              {gaStatus.status === 'waiting_for_data' && 'Collecting analytics data (may take a few hours)'}
              {gaStatus.status === 'not_connected' && 'No API keys or technical setup are required from the Company Admin.'}
              {gaStatus.status === 'error' && 'Reconnect to refresh access and continue syncing.'}
            </div>
          </div>
        )}

        {showPropertySelection && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Choose the Google Analytics property to sync</h3>
              <p className="text-sm text-gray-600">No manual configuration is needed beyond selecting the property you want OmniVyra to use.</p>
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

        {connectedState && gaStatus?.property && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Property</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{gaStatus.property.name}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Status</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">Active</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Last Sync</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{formatDateTime(gaStatus.last_sync)}</div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Need Help Setting Up Tracking?</h3>
              <p className="text-sm text-gray-600">Optional only. Use this when Google Analytics is connected but your site is not sending data yet.</p>
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
    </section>
  );
}

export default function IntegrationsPage() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const router = useRouter();
  const companyId = selectedCompanyId || '';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toUpperCase());
  const focusParam = typeof router.query.focus === 'string' ? router.query.focus : '';
  const focus: FocusArea = focusParam === 'data' ? 'data' : 'website';

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; integration?: Integration } | null>(null);
  const [gaStatus, setGaStatus] = useState<GoogleAnalyticsStatusResponse | null>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaError, setGaError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [scriptAssistOpen, setScriptAssistOpen] = useState(false);
  const [scriptAssistLoading, setScriptAssistLoading] = useState(false);
  const [scriptAssistError, setScriptAssistError] = useState<string | null>(null);
  const [scriptAssistResult, setScriptAssistResult] = useState<TrackingAssistResponse | null>(null);
  const [scriptAssistForm, setScriptAssistForm] = useState({ website_url: '', platform: 'wordpress' });

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load');
      }
      setIntegrations(data.integrations || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadGoogleAnalyticsStatus = useCallback(async () => {
    if (!companyId) {
      setGaStatus(null);
      return;
    }

    setGaLoading(true);
    setGaError(null);
    try {
      const response = await fetchWithAuth(`/api/analytics/status?companyId=${encodeURIComponent(companyId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load Google Analytics status');
      }
      setGaStatus(data);
      if (data?.property?.id) {
        setSelectedPropertyId(data.property.id);
      } else {
        setSelectedPropertyId('');
      }
    } catch (err: any) {
      setGaError(err?.message || 'Failed to load Google Analytics status');
    } finally {
      setGaLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    void loadGoogleAnalyticsStatus();
  }, [load, loadGoogleAnalyticsStatus]);

  useEffect(() => {
    if (!router.isReady) return;
    if (focusParam !== 'website' && focusParam !== 'data') {
      void router.replace('/integrations?focus=website', undefined, { shallow: true });
      return;
    }
    const error = typeof router.query.error === 'string' ? router.query.error : '';
    const gaConnected = typeof router.query.ga4 === 'string' ? router.query.ga4 : '';

    if (error === 'oauth_failed') {
      setGaNotice('Failed to connect Google Analytics');
    } else if (error === 'no_properties_found') {
      setGaNotice('No GA properties found');
    } else if (gaConnected === 'connected') {
      setGaNotice('Google Analytics connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else {
      setGaNotice(null);
    }
  }, [router.isReady, router.query.error, router.query.ga4, loadGoogleAnalyticsStatus]);

  const handleConnectGoogleAnalytics = async () => {
    if (!companyId) return;
    setGaConnecting(true);
    setGaError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/connect/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          returnTo: '/integrations?focus=data',
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      setGaError(err?.message || 'Failed to connect Google Analytics');
      setGaConnecting(false);
    }
  };

  const handleSelectGoogleAnalyticsProperty = async () => {
    if (!companyId || !selectedPropertyId) return;
    setGaSelectingProperty(true);
    setGaError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          propertyId: selectedPropertyId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      setGaNotice('Google Analytics property selected.');
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGaError(err?.message || 'Failed to connect Google Analytics');
    } finally {
      setGaSelectingProperty(false);
    }
  };

  const handleGenerateTrackingAssist = async () => {
    setScriptAssistLoading(true);
    setScriptAssistError(null);
    setScriptAssistResult(null);
    try {
      const response = await fetch('/api/analytics/tracking-assist', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scriptAssistForm),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to generate tracking help');
      }
      setScriptAssistResult(data);
    } catch (err: any) {
      setScriptAssistError(err?.message || 'Failed to generate tracking help');
    } finally {
      setScriptAssistLoading(false);
    }
  };

  const handleSave = async (payload: { type: IntegrationType; name: string; config: Record<string, string> }) => {
    if (modal?.mode === 'create') {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
    } else if (modal?.integration) {
      const response = await fetch(`/api/integrations/${modal.integration.id}?company_id=${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name: payload.name, config: payload.config }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
    }

    setModal(null);
    await load();
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const response = await fetch(`/api/integrations/${id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await response.json();
      setTestResult({ id, success: data.success, message: data.message });
      await load();
    } catch {
      setTestResult({ id, success: false, message: 'Test request failed.' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this integration? This cannot be undone.')) return;
    await fetch(`/api/integrations/${id}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await load();
  };

  const leadIntegrations = integrations.filter((integration) => integration.type === 'lead_webhook');
  const blogIntegrations = integrations.filter((integration) => integration.type === 'wordpress' || integration.type === 'custom_blog_api');

  const highlightedIds = useMemo(() => {
    if (focus === 'website') return new Set(['website-publishing', 'lead-capture-forms']);
    if (focus === 'data') return new Set(['crm-pipeline', 'website-analytics', 'files-imports']);
    return new Set<string>();
  }, [focus]);

  const categoryCards: CategoryCard[] = [
    {
      id: 'website-publishing',
      focus: 'website',
      title: 'Website Publishing',
      description: 'Choose where blogs and site content should publish once content is ready.',
      badge: 'Live now',
      icon: <Globe className="h-5 w-5" />,
      badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      items: ['WordPress publishing', 'Custom blog API endpoints', 'Website content delivery'],
      actions: [
        { label: 'Manage website publishing', href: '#website-publishing-section' },
        ...(isAdmin ? [{ label: 'Add WordPress', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }), tone: 'secondary' as const }] : []),
      ],
    },
    {
      id: 'lead-capture-forms',
      focus: 'website',
      title: 'Lead Capture Forms',
      description: 'Control how the website or landing pages collect leads and where those leads flow next.',
      badge: 'Live now',
      icon: <Plug className="h-5 w-5" />,
      badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      items: ['Hosted lead capture pages', 'Embeddable website forms', 'Webhook delivery to downstream tools'],
      actions: [
        { label: 'Open forms workspace', href: '/leads?tab=forms' },
        { label: 'Open webhook setup', href: '/leads?tab=connections' },
      ],
    },
    {
      id: 'crm-pipeline',
      focus: 'data',
      title: 'CRM & Pipeline',
      description: 'Bring deal, account, and owner context into the product so growth work can use real pipeline state.',
      badge: 'Planned next',
      icon: <Database className="h-5 w-5" />,
      badgeClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      items: ['CRM account sync', 'Lead and deal stage mapping', 'Owner and revenue context'],
      actions: [],
    },
    {
      id: 'website-analytics',
      focus: 'data',
      title: 'Website Analytics',
      description: 'Connect traffic and behavior signals so weak momentum shows up with proof instead of guesswork.',
      badge: 'Live now',
      icon: <BarChart3 className="h-5 w-5" />,
      badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      items: ['Google Analytics inputs', 'Traffic source trends', 'Conversion page performance'],
      actions: [
        { label: 'Open Google Analytics', href: '#google-analytics-section' },
      ],
    },
    {
      id: 'files-imports',
      focus: 'data',
      title: 'Files & Imports',
      description: 'Use external files when leads, calling reports, or manual business inputs still live outside APIs.',
      badge: 'Planned next',
      icon: <Files className="h-5 w-5" />,
      badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      items: ['CSV and spreadsheet uploads', 'Calling and outreach reports', 'Email lead lists and manual dumps'],
      actions: [],
    },
  ];

  const visibleCategoryCards = categoryCards.filter((card) => card.focus === focus);
  const showWebsiteFlow = focus === 'website';
  const showDataFlow = focus === 'data';
  const categoryTitle = focus === 'website' ? 'Website & Lead Capture' : 'Data & CRM Sources';
  const categoryDescription =
    focus === 'website'
      ? 'These are the website-side setup cards for publishing, forms, and lead capture.'
      : 'These are the business data setup cards for CRM, analytics, and imported files.';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Integrations</h1>
            <p className="mt-1 text-sm text-gray-500">
              Build the input layer for publishing, lead capture, CRM context, analytics, and imported business data.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Add Integration
            </button>
          )}
        </div>

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{categoryTitle}</h2>
              <p className="text-sm text-gray-500">{categoryDescription}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleCategoryCards.map((card) => {
              const isHighlighted = highlightedIds.has(card.id);
              return (
                <div
                  key={card.id}
                  className={`rounded-2xl border bg-white p-5 shadow-sm ${isHighlighted ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md' : 'border-gray-200'}`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${card.badgeClassName}`}>
                      {card.icon}
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${card.badgeClassName}`}>
                      {card.badge}
                    </span>
                  </div>

                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-600">{card.description}</p>
                  </div>

                  <div className="mb-5 space-y-2">
                    {card.items.map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm text-gray-600">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  {card.actions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {card.actions.map((action) => (
                        <CategoryAction key={action.label} action={action} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                      This source group is intentionally shown as a planned foundation area until a real setup surface exists.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {!companyId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Select a company to manage integrations.
          </div>
        )}

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {testResult && (
          <div
            className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {testResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{testResult.message}</span>
            <button onClick={() => setTestResult(null)} className="ml-auto shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading integrations...</div>
        ) : (
          <div className="space-y-8">
            {showWebsiteFlow && (
              <>
                <section id="website-publishing-section">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Website Integrations</h2>
                      <p className="text-xs text-gray-500">Connect the website or blog destination that published content should flow into.</p>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add WordPress
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Blog API
                        </button>
                      </div>
                    )}
                  </div>

                  {blogIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No website integrations yet."
                      actions={
                        isAdmin
                          ? [
                              { label: 'Add WordPress', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }) },
                              { label: 'Add Blog API', onClick: () => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration }) },
                            ]
                          : []
                      }
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {blogIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => setModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={handleDelete}
                          onTest={handleTest}
                          testing={testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section id="lead-capture-section" className="space-y-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Lead Capture Integrations</h2>
                      <p className="text-xs text-gray-500">Use forms in the lead workspace and connect webhook delivery for captured leads.</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration })}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Webhook
                      </button>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-950">Forms, hosted pages, and embed code already live in Lead Capture</h3>
                        <p className="mt-1 text-sm text-emerald-800">
                          Use the Lead Capture workspace for website forms, hosted links, HTML downloads, and embed snippets. Webhooks below handle where those submissions go next.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a href="/leads?tab=forms" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                          Open forms
                          <ArrowRight className="h-4 w-4" />
                        </a>
                        <a href="/leads?tab=connections" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                          Open webhooks
                        </a>
                      </div>
                    </div>
                  </div>

                  {leadIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No lead capture webhooks yet."
                      actions={isAdmin ? [{ label: 'Add Webhook', onClick: () => setModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration }) }] : []}
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {leadIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => setModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={handleDelete}
                          onTest={handleTest}
                          testing={testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {showDataFlow && (
              <GoogleAnalyticsSetupCard
                isAdmin={isAdmin}
                gaStatus={gaStatus}
                gaLoading={gaLoading}
                gaError={gaError}
                gaNotice={gaNotice}
                gaConnecting={gaConnecting}
                gaSelectingProperty={gaSelectingProperty}
                selectedPropertyId={selectedPropertyId}
                scriptAssistOpen={scriptAssistOpen}
                scriptAssistLoading={scriptAssistLoading}
                scriptAssistError={scriptAssistError}
                scriptAssistForm={scriptAssistForm}
                scriptAssistResult={scriptAssistResult}
                onConnect={handleConnectGoogleAnalytics}
                onSelectedPropertyChange={setSelectedPropertyId}
                onSelectProperty={handleSelectGoogleAnalyticsProperty}
                onToggleScriptAssist={() => setScriptAssistOpen((current) => !current)}
                onScriptAssistInput={(key, value) => setScriptAssistForm((current) => ({ ...current, [key]: value }))}
                onGenerateScriptAssist={handleGenerateTrackingAssist}
              />
            )}
          </div>
        )}
      </div>

      {modal && <IntegrationModal mode={modal.mode} initial={modal.integration} onClose={() => setModal(null)} onSave={handleSave} />}
    </div>
  );
}
