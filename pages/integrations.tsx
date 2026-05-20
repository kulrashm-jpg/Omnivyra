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

type IntegrationType =
  | 'lead_webhook'
  | 'wordpress'
  | 'custom_blog_api'
  | 'ghost'
  | 'drupal'
  | 'joomla'
  | 'webflow'
  | 'shopify'
  | 'hubspot'
  | 'wix'
  | 'squarespace';
type IntegrationStatus = 'connected' | 'failed' | 'pending';
type FocusArea = 'website' | 'data';

type CmsEnvironmentType = 'localhost' | 'local_network' | 'staging' | 'production';

// Mirrors backend CmsValidationReport (cmsEnvironmentFramework.ts).
interface CmsValidationReport {
  provider: string;
  environmentType: CmsEnvironmentType;
  httpsEnabled: boolean;
  apiReachable: boolean;
  detectedApiRoot: string | null;
  apiBase: string | null;
  authSupported: boolean | null;
  authWorking: boolean | null;
  publishSupported: boolean | null;
  webhookSupported: boolean | null;
  errorCode: string | null;
  severity: 'fatal' | 'error' | 'warning' | null;
  retryable: boolean | null;
  remediationSteps: string[];
  diagnostics?: Record<string, unknown>;
}

interface TestResultState {
  id: string;
  success: boolean;
  message: string;
  code?: string;
  diagnostics?: CmsValidationReport;
}

interface Integration {
  id: string;
  website_id?: string | null;
  website_connection_id?: string | null;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface Website {
  id: string;
  name: string;
  canonical_url: string;
  cms_provider: string | null;
  status: string;
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
  | 'limited_coverage'
  | 'property_unverified'
  | 'domain_mapping_required'
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
  provider_readiness?: Record<string, {
    status: string;
    message: string;
    action_label: string;
    connected: boolean;
    capability_ready: boolean;
  }>;
  search_console?: GoogleSearchConsoleStatusResponse;
};

type GoogleSearchConsoleStatusResponse = {
  connected: boolean;
  property: {
    id: string;
    name: string;
    account_id: string | null;
  } | null;
  status: GoogleAnalyticsCardStatus | 'setup_required';
  message: string;
  last_sync: string | null;
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
  ghost: 'Ghost',
  drupal: 'Drupal',
  joomla: 'Joomla',
  webflow: 'Webflow',
  shopify: 'Shopify Blog',
  hubspot: 'HubSpot CMS',
  wix: 'Wix Blog',
  squarespace: 'Squarespace (read-only)',
};

const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  lead_webhook: <Plug className="h-5 w-5" />,
  wordpress: <Globe className="h-5 w-5" />,
  custom_blog_api: <Rss className="h-5 w-5" />,
  ghost: <Files className="h-5 w-5" />,
  drupal: <Database className="h-5 w-5" />,
  joomla: <Files className="h-5 w-5" />,
  webflow: <Globe className="h-5 w-5" />,
  shopify: <Rss className="h-5 w-5" />,
  hubspot: <Database className="h-5 w-5" />,
  wix: <Globe className="h-5 w-5" />,
  squarespace: <Files className="h-5 w-5" />,
};

const TYPE_COLORS: Record<IntegrationType, string> = {
  lead_webhook: 'bg-emerald-100 text-emerald-700',
  wordpress: 'bg-blue-100 text-blue-700',
  custom_blog_api: 'bg-violet-100 text-violet-700',
  ghost: 'bg-gray-100 text-gray-700',
  drupal: 'bg-sky-100 text-sky-700',
  joomla: 'bg-orange-100 text-orange-700',
  webflow: 'bg-indigo-100 text-indigo-700',
  shopify: 'bg-green-100 text-green-700',
  hubspot: 'bg-orange-100 text-orange-700',
  wix: 'bg-pink-100 text-pink-700',
  squarespace: 'bg-zinc-100 text-zinc-700',
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
    { key: 'site_url', label: 'Site URL', placeholder: 'https://myblog.com', hint: 'Production sites must use https:// (WordPress blocks Application Passwords over HTTP). Localhost/dev sites can use http://.' },
    { key: 'username', label: 'WordPress Username', placeholder: 'admin' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: 'Generate in WordPress under Users > Profile > Application Passwords' },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Endpoint URL', placeholder: 'https://api.myblog.com/posts' },
    { key: 'api_key', label: 'API Key', placeholder: 'sk-...', type: 'password' },
    { key: 'auth_header', label: 'Auth Header (optional)', placeholder: 'Authorization', hint: 'Defaults to Authorization: Bearer <api_key>' },
  ],
  ghost: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://myblog.com', hint: 'Ghost base URL. Localhost/dev allowed over http://.' },
    { key: 'admin_api_key', label: 'Admin API Key', placeholder: 'id:secret', type: 'password', hint: 'Ghost Admin → Settings → Integrations → custom integration → Admin API Key.' },
    { key: 'author_email', label: 'Author Email (optional)', placeholder: 'author@site.com' },
  ],
  drupal: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://mydrupal.com', hint: 'JSON:API root is auto-detected (/jsonapi). Production must be HTTPS.' },
    { key: 'bearer_token', label: 'Bearer Token', placeholder: 'token', type: 'password', hint: 'OAuth/JSON:API bearer token with node create permission.' },
    { key: 'node_bundle', label: 'Node Bundle (optional)', placeholder: 'article' },
  ],
  joomla: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://myjoomla.com', hint: 'Enable Web Services (REST API) in Global Configuration.' },
    { key: 'api_token', label: 'Joomla API Token', placeholder: 'token', type: 'password', hint: 'Users → Manage → (user) → API tokens.' },
    { key: 'default_catid', label: 'Default Category ID (optional)', placeholder: '2' },
  ],
  webflow: [
    { key: 'access_token', label: 'OAuth Access Token', placeholder: 'wf-...', type: 'password', hint: 'Webflow OAuth access token or site API token.' },
    { key: 'collection_id', label: 'CMS Collection ID (optional)', placeholder: 'Run validate to discover collections', hint: 'Required for publishing; discovered on validation.' },
    { key: 'site_url', label: 'Site URL (optional)', placeholder: 'https://mysite.webflow.io' },
  ],
  shopify: [
    { key: 'shop_domain', label: 'Shop Domain', placeholder: 'mystore.myshopify.com' },
    { key: 'shopify_access_token', label: 'Admin API Access Token', placeholder: 'shpat_...', type: 'password', hint: 'Custom app token with write_content scope.' },
    { key: 'blog_id', label: 'Blog ID (optional)', placeholder: 'Auto-selects first blog' },
  ],
  hubspot: [
    { key: 'access_token', label: 'HubSpot Access Token', placeholder: 'pat-...', type: 'password', hint: 'Private-app token OR OAuth access token (content scope).' },
    { key: 'blog_id', label: 'HubSpot Blog ID', placeholder: 'Marketing → Website → Blog → Blog ID', hint: 'Required for publishing.' },
  ],
  wix: [
    { key: 'api_key', label: 'Wix API Key', placeholder: 'wix-api-key', type: 'password', hint: 'Wix Dashboard → Settings → Headless settings → API Key.' },
    { key: 'wix_site_id', label: 'Wix Site ID', placeholder: 'site-uuid' },
    { key: 'wix_account_id', label: 'Wix Account ID (optional)', placeholder: 'account-uuid', hint: 'Required when using an app token (not for site tokens).' },
  ],
  squarespace: [
    { key: 'site_url', label: 'Squarespace site URL', placeholder: 'https://yoursite.squarespace.com', hint: 'Reachability is validated via RSS/sitemap. Squarespace has no public write API — publishing is not supported.' },
  ],
};

interface ModalProps {
  mode: 'create' | 'edit';
  initial?: Partial<Integration>;
  websites: Website[];
  onClose: () => void;
  onSave: (data: { type: IntegrationType; name: string; config: Record<string, string>; website_id?: string | null }) => Promise<void>;
}

function IntegrationModal({ mode, initial, websites, onClose, onSave }: ModalProps) {
  const [type, setType] = useState<IntegrationType>(initial?.type || 'lead_webhook');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, string>>(initial?.config || {});
  const [websiteId, setWebsiteId] = useState(initial?.website_id || websites[0]?.id || '');
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
      await onSave({ type, name: name.trim(), config, website_id: websiteId || null });
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
          <h2 className="text-base font-semibold text-gray-900">{mode === 'create' ? 'Connect Your Website' : 'Edit Connection'}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {mode === 'create' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">How is your website managed?</label>
              <p className="mb-2 text-xs text-gray-500">Pick your platform and we'll show only the steps that apply to it.</p>
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Name this connection</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`e.g. ${TYPE_LABELS[type]} - Production`}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Which website is this for?</label>
            <select
              value={websiteId}
              onChange={(event) => setWebsiteId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Default website</option>
              {websites.map((website) => (
                <option key={website.id} value={website.id}>
                  {website.name} - {website.canonical_url}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <div className="border-t border-gray-100 pt-3 text-sm font-medium text-gray-700">Enable publishing on {TYPE_LABELS[type]}</div>
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
              {saving ? 'Saving...' : mode === 'create' ? 'Connect' : 'Save Changes'}
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
  const testedUrl =
    integration.config.site_url ||
    integration.config.endpoint_url ||
    integration.config.webhook_url ||
    integration.config.shop_domain ||
    '';

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
        {testedUrl && (
          <div className="truncate" title={testedUrl}>
            Testing: {testedUrl}
          </div>
        )}
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

const WP_LOCAL_CONFIG_SNIPPET = `define('WP_ENVIRONMENT_TYPE', 'local');

// or, equivalently:
define('WP_ENVIRONMENT_TYPE', 'development');`;

// Client-side mirror of provider local-dev guidance (label + optional snippet).
const PROVIDER_META: Record<string, { label: string; snippet?: string; localHint?: string }> = {
  wordpress: {
    label: 'WordPress',
    snippet: WP_LOCAL_CONFIG_SNIPPET,
    localHint: 'WordPress disables Application Passwords on non-HTTPS environments by default. Add this to wp-config.php to enable local auth:',
  },
  ghost: { label: 'Ghost', localHint: 'Create a Custom Integration in Ghost Admin and use its Admin API key for local development.' },
  joomla: { label: 'Joomla', localHint: 'Enable Web Services (REST API) and create a Joomla API token for local development.' },
  drupal: { label: 'Drupal', localHint: 'Enable the core JSON:API module to allow local development access.' },
  webflow: { label: 'Webflow' },
  shopify: { label: 'Shopify Blog' },
  hubspot: { label: 'HubSpot CMS' },
  wix: { label: 'Wix Blog' },
  squarespace: { label: 'Squarespace (read-only)', localHint: 'Squarespace has no public write API — this integration validates reachability only; publishing is not supported.' },
  custom_blog_api: { label: 'Custom Blog API' },
};

function providerMeta(provider: string) {
  return PROVIDER_META[provider] ?? { label: provider };
}

const ENV_BADGE: Record<CmsEnvironmentType, { label: string; cls: string }> = {
  localhost: { label: 'Localhost', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  local_network: { label: 'Local network', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  staging: { label: 'Staging / Dev', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  production: { label: 'Production', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function DiagRow({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const icon =
    ok === true ? (
      <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
    ) : ok === false ? (
      <XCircle className="h-3.5 w-3.5 text-red-600" />
    ) : (
      <Clock className="h-3.5 w-3.5 text-gray-400" />
    );
  return (
    <div className="flex items-center gap-2 text-xs text-gray-700">
      {icon}
      <span className="font-medium">{label}:</span>
      <span className="text-gray-500">{detail ?? (ok === true ? 'OK' : ok === false ? 'Failed' : 'Not checked')}</span>
    </div>
  );
}

function CmsDiagnosticsPanel({
  report,
  onRedetect,
  redetecting,
}: {
  report: CmsValidationReport;
  onRedetect?: () => void;
  redetecting?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const env = ENV_BADGE[report.environmentType] ?? ENV_BADGE.production;
  // Canonical operational base = apiBase. No detected root while apiReachable
  // means publishing is running on the legacy fallback (degraded).
  const usingFallback = report.apiReachable && !report.detectedApiRoot;
  const meta = providerMeta(report.provider);
  const isLocalDev = report.environmentType === 'localhost' || report.environmentType === 'local_network';
  // Local-setup guidance is only relevant for non-HTTPS local/dev sites where
  // the provider would otherwise refuse to authenticate, and only while auth
  // is not yet working.
  const showLocalGuidance =
    isLocalDev && !report.httpsEnabled && report.authWorking !== true && Boolean(meta.localHint);
  const devDiag =
    report.diagnostics && typeof report.diagnostics === 'object'
      ? (report.diagnostics as any).developerDiagnostics
      : null;

  const copySnippet = async () => {
    if (!meta.snippet) return;
    try {
      await navigator.clipboard.writeText(meta.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — snippet is still visible to copy manually */
    }
  };

  const sevBadge =
    report.severity === 'fatal'
      ? 'bg-red-100 text-red-800 border-red-300'
      : report.severity === 'warning'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">{meta.label} diagnostics</span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${env.cls}`}>
          <Globe className="h-3 w-3" />
          {env.label}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            report.httpsEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {report.httpsEnabled ? 'HTTPS' : 'HTTP only'}
        </span>
        {report.errorCode && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sevBadge}`}>
            {report.errorCode}
            {report.retryable ? ' · retryable' : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <DiagRow label="API" ok={report.apiReachable} detail={report.apiReachable ? 'Reachable' : 'Unreachable'} />
        <DiagRow
          label="Auth"
          ok={report.authWorking}
          detail={
            report.authWorking === true
              ? 'Working'
              : report.authWorking === false
                ? 'Failed'
                : report.authSupported === false
                  ? 'Unsupported'
                  : 'Not checked'
          }
        />
        <DiagRow label="Publish" ok={report.publishSupported} />
        <DiagRow label="Webhook" ok={report.webhookSupported} detail={report.webhookSupported ? 'Supported' : 'Unsupported'} />
        <DiagRow
          label="API root"
          ok={report.detectedApiRoot ? true : report.apiReachable ? null : false}
          detail={report.detectedApiRoot ?? 'Not detected'}
        />
        <DiagRow
          label="Canonical base"
          ok={report.apiBase ? true : null}
          detail={report.apiBase ?? 'Unresolved'}
        />
      </div>

      {(usingFallback || onRedetect) && (
        <div className="flex flex-wrap items-center gap-2">
          {usingFallback && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Fallback mode — REST root not auto-detected, using legacy default
            </span>
          )}
          {onRedetect && (
            <button
              type="button"
              onClick={onRedetect}
              disabled={redetecting}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${redetecting ? 'animate-spin' : ''}`} />
              {redetecting ? 'Re-detecting…' : 'Re-detect API'}
            </button>
          )}
        </div>
      )}

      {report.remediationSteps.length > 0 && (
        <div className="rounded-md bg-gray-50 p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">How to fix</div>
          <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
            {report.remediationSteps
              .filter((step) => !meta.snippet || step.trim() !== meta.snippet.trim())
              .map((step, i) => (
                <li key={i}>{step}</li>
              ))}
          </ul>
        </div>
      )}

      {showLocalGuidance && (
        <div className="rounded-md border border-violet-200 bg-violet-50 p-2">
          <div className="mb-1 text-xs font-semibold text-violet-800">Local development setup</div>
          <p className="mb-2 text-xs text-violet-700">{meta.localHint}</p>
          {meta.snippet && (
            <div className="relative">
              <pre className="overflow-x-auto rounded bg-gray-900 p-2 pr-16 text-[11px] leading-relaxed text-emerald-300">
                <code>{meta.snippet}</code>
              </pre>
              <button
                type="button"
                onClick={copySnippet}
                className="absolute right-1.5 top-1.5 rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/20"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {devDiag && (
        <div className="text-[11px] text-gray-500">
          <button
            type="button"
            onClick={() => setShowDev((v) => !v)}
            className="font-medium text-gray-600 underline-offset-2 hover:underline"
          >
            {showDev ? 'Hide' : 'Show'} developer diagnostics
          </button>
          {showDev && (
            <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-gray-700">{String(devDiag)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not synced yet';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Not synced yet';
  return timestamp.toLocaleString();
}

function GoogleAnalyticsGridCard({
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

function GoogleSearchConsoleGridCard({
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

function GoogleAnalyticsHelperPanel({
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

function GoogleSearchConsoleHelperPanel({
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

export default function IntegrationsPage() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const router = useRouter();
  const companyId = selectedCompanyId || '';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toUpperCase());
  const focusParam = typeof router.query.focus === 'string' ? router.query.focus : '';
  const focus: FocusArea = focusParam === 'data' ? 'data' : 'website';

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteDraft, setWebsiteDraft] = useState({ name: '', canonical_url: '' });
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResultState | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; integration?: Integration } | null>(null);
  const [gaStatus, setGaStatus] = useState<GoogleAnalyticsStatusResponse | null>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaError, setGaError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [gaSyncing, setGaSyncing] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [gscStatus, setGscStatus] = useState<GoogleSearchConsoleStatusResponse | null>(null);
  const [gscError, setGscError] = useState<string | null>(null);
  const [gscNotice, setGscNotice] = useState<string | null>(null);
  const [gscConnecting, setGscConnecting] = useState(false);
  const [gscSelectingProperty, setGscSelectingProperty] = useState(false);
  const [gscSyncing, setGscSyncing] = useState(false);
  const [selectedGscPropertyId, setSelectedGscPropertyId] = useState('');
  const [scriptAssistOpen, setScriptAssistOpen] = useState(false);
  const [scriptAssistLoading, setScriptAssistLoading] = useState(false);
  const [scriptAssistError, setScriptAssistError] = useState<string | null>(null);
  const [scriptAssistResult, setScriptAssistResult] = useState<TrackingAssistResponse | null>(null);
  const [scriptAssistForm, setScriptAssistForm] = useState({ website_url: '', platform: 'wordpress' });
  const [providerCards, setProviderCards] = useState<Array<{
    provider: string;
    label: string;
    enabled: boolean;
    authType: string;
    apiDiscoveryMode: string;
    capabilities: { publish: boolean; update: boolean; delete: boolean; media: boolean; taxonomy: boolean; webhook: boolean; oauth: boolean; localDev: boolean };
    setupHints: string[];
    troubleshootingHints: string[];
    rateLimitNote: string;
    recentPublishAttempts: number;
    recentPublishSuccesses: number;
    recentPublishFailures: number;
    successRate: number;
    recentAuthFailures: number;
    recentErrors: Array<{ at: string; eventName: string; message: string }>;
    health: 'healthy' | 'warning' | 'degraded' | 'unused';
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  }>>([]);
  const [providerCardsLoading, setProviderCardsLoading] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [integrationResponse, websiteResponse] = await Promise.all([
        fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }),
        fetch(`/api/websites?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }),
      ]);
      const data = await integrationResponse.json();
      const websiteData = await websiteResponse.json();
      if (!integrationResponse.ok) {
        throw new Error(data.error || 'Failed to load integrations');
      }
      if (!websiteResponse.ok) {
        throw new Error(websiteData.error || 'Failed to load websites');
      }
      setIntegrations(data.integrations || []);
      setWebsites(websiteData.websites || []);
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
    setGscError(null);
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
      setGscStatus(data?.search_console ?? null);
      if (data?.search_console?.property?.id) {
        setSelectedGscPropertyId(data.search_console.property.id);
      } else {
        setSelectedGscPropertyId('');
      }
    } catch (err: any) {
      setGaError(err?.message || 'Failed to load Google Analytics status');
      setGscError(err?.message || 'Failed to load Search Console status');
    } finally {
      setGaLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    void loadGoogleAnalyticsStatus();
  }, [load, loadGoogleAnalyticsStatus]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setProviderCardsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/integrations/diagnostics?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.providers) setProviderCards(data.providers);
      } catch { /* silent */ }
      finally { if (!cancelled) setProviderCardsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (focusParam !== 'website' && focusParam !== 'data') {
      void router.replace('/integrations?focus=website', undefined, { shallow: true });
      return;
    }
    const error = typeof router.query.error === 'string' ? router.query.error : '';
    const gaConnected = typeof router.query.ga4 === 'string' ? router.query.ga4 : '';
    const gscConnected = typeof router.query.gsc === 'string' ? router.query.gsc : '';

    if (error === 'oauth_failed') {
      setGaNotice('Failed to connect Google Analytics');
    } else if (error === 'no_properties_found') {
      setGaNotice('No GA properties found');
    } else if (error === 'gsc_oauth_failed') {
      setGscNotice('Failed to connect Search Console');
    } else if (error === 'no_search_console_properties_found') {
      setGscNotice('No Search Console properties found');
    } else if (gaConnected === 'connected') {
      setGaNotice('Google Analytics connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else if (gscConnected === 'connected') {
      setGscNotice('Search Console connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else {
      setGaNotice(null);
      setGscNotice(null);
    }
  }, [router.isReady, router.query.error, router.query.ga4, router.query.gsc, loadGoogleAnalyticsStatus]);

  const handleConnectGoogleAnalytics = async () => {
    if (!companyId) return;
    const endpoint = '/api/analytics/connect/google';
    const payload = {
      companyId,
      returnTo: '/integrations?focus=data',
    };
    setGaConnecting(true);
    setGaError(null);
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.group('[integrations][google_analytics][connect]');
        console.info('endpoint', endpoint);
        console.info('payload', payload);
      }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (process.env.NODE_ENV !== 'production') {
        console.info('responseStatus', response.status);
        console.info('responseBody', data);
      }
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      if (process.env.NODE_ENV !== 'production') {
        console.info('authorizationUrl', data.authorizationUrl);
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('error', err);
      }
      setGaError(err?.message || 'Failed to connect Google Analytics');
      setGaConnecting(false);
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        console.groupEnd();
      }
    }
  };

  const handleConnectSearchConsole = async () => {
    if (!companyId) return;
    const endpoint = '/api/analytics/connect/google';
    const payload = {
      companyId,
      capability: 'google_search_console',
      returnTo: '/integrations?focus=data',
    };
    setGscConnecting(true);
    setGscError(null);
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.group('[integrations][google_search_console][connect]');
        console.info('endpoint', endpoint);
        console.info('payload', payload);
      }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (process.env.NODE_ENV !== 'production') {
        console.info('responseStatus', response.status);
        console.info('responseBody', data);
      }
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Search Console');
      }
      if (process.env.NODE_ENV !== 'production') {
        console.info('authorizationUrl', data.authorizationUrl);
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('error', err);
      }
      setGscError(err?.message || 'Failed to connect Search Console');
      setGscConnecting(false);
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        console.groupEnd();
      }
    }
  };

  const handleForceSyncGoogleAnalytics = async () => {
    if (!companyId || gaSyncing) return;
    setGaSyncing(true);
    setGaError(null);
    setGaNotice('Syncing Google Analytics...');

    const requestStart = Date.now();

    try {
      const response = await fetchWithAuth('/api/analytics/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 400 && data?.error === 'no_active_property') {
        setGaError('Select a Google Analytics property before syncing.');
        return;
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(data?.error || data?.message || 'Failed to sync Google Analytics');
      }

      if (data?.status === 'synced') {
        const written = typeof data.sessions_written === 'number' ? ` (${data.sessions_written} sessions)` : '';
        setGaNotice(`Sync complete${written}.`);
        await loadGoogleAnalyticsStatus();
        return;
      }

      // status === 'started' — poll /api/analytics/status until last_sync moves
      // past requestStart, or status becomes error, or hard timeout (90s).
      const POLL_TIMEOUT_MS = 90_000;
      const POLL_INTERVAL_MS = 2_500;
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;

      let lastError: string | null = null;
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const pollResponse = await fetchWithAuth(
            `/api/analytics/status?companyId=${encodeURIComponent(companyId)}`,
          );
          if (!pollResponse.ok) continue;
          const pollData = await pollResponse.json();

          // Update the card live so the user sees status changes during polling.
          setGaStatus(pollData);

          if (pollData?.status === 'error') {
            lastError = pollData?.message || 'Sync failed';
            break;
          }

          const lastSyncMs = pollData?.last_sync ? new Date(pollData.last_sync).getTime() : 0;
          if (
            lastSyncMs > requestStart &&
            pollData?.status &&
            ['ready', 'low_data', 'waiting_for_data'].includes(pollData.status)
          ) {
            setGaNotice('Sync complete.');
            return;
          }
        } catch {
          // transient — keep polling
        }
      }

      if (lastError) {
        setGaError(lastError);
      } else {
        setGaNotice('Sync still running in the background. Refresh in a few minutes to see results.');
      }
    } catch (err: any) {
      setGaError(err?.message || 'Failed to sync Google Analytics');
    } finally {
      setGaSyncing(false);
    }
  };

  const handleForceSyncSearchConsole = async () => {
    if (!companyId || gscSyncing) return;
    setGscSyncing(true);
    setGscError(null);
    setGscNotice('Syncing Search Console...');
    const requestStart = Date.now();

    try {
      const response = await fetchWithAuth('/api/analytics/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, capability: 'google_search_console' }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 400 && data?.error === 'no_active_search_console_property') {
        setGscError('Select a Search Console property before syncing.');
        return;
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(data?.error || data?.message || 'Failed to sync Search Console');
      }

      if (data?.status === 'synced') {
        setGscNotice('Sync complete.');
        await loadGoogleAnalyticsStatus();
        return;
      }

      const POLL_TIMEOUT_MS = 90_000;
      const POLL_INTERVAL_MS = 2_500;
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      let lastError: string | null = null;

      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const pollResponse = await fetchWithAuth(
            `/api/analytics/status?companyId=${encodeURIComponent(companyId)}`,
          );
          if (!pollResponse.ok) continue;
          const pollData = await pollResponse.json();
          const nextGscStatus = pollData?.search_console ?? null;
          setGscStatus(nextGscStatus);

          if (nextGscStatus?.status === 'error') {
            lastError = nextGscStatus?.message || 'Search Console sync failed';
            break;
          }

          const lastSyncMs = nextGscStatus?.last_sync ? new Date(nextGscStatus.last_sync).getTime() : 0;
          if (
            lastSyncMs > requestStart &&
            nextGscStatus?.status &&
            ['ready', 'limited_coverage', 'waiting_for_data'].includes(nextGscStatus.status)
          ) {
            setGscNotice(nextGscStatus.status === 'ready' ? 'Sync complete.' : nextGscStatus.message || 'Search Console data is still building coverage.');
            return;
          }
        } catch {
          // transient - keep polling
        }
      }

      if (lastError) {
        setGscError(lastError);
      } else {
        setGscNotice('Sync still running in the background. Refresh in a few minutes to see results.');
      }
    } catch (err: any) {
      setGscError(err?.message || 'Failed to sync Search Console');
    } finally {
      setGscSyncing(false);
    }
  };

  const handleDisconnectSearchConsole = async () => {
    if (!companyId) return;
    const confirmed = window.confirm('Disconnect Search Console for this company? Existing report data stays stored, but new search syncs will stop until it is reconnected.');
    if (!confirmed) return;

    setGscSyncing(true);
    setGscError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, capability: 'google_search_console' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to disconnect Search Console');
      }
      setGscNotice('Search Console disconnected.');
      setSelectedGscPropertyId('');
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGscError(err?.message || 'Failed to disconnect Search Console');
    } finally {
      setGscSyncing(false);
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

  const handleSelectSearchConsoleProperty = async () => {
    if (!companyId || !selectedGscPropertyId) return;
    setGscSelectingProperty(true);
    setGscError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          propertyId: selectedGscPropertyId,
          capability: 'google_search_console',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to connect Search Console');
      }
      setGscNotice('Search Console property selected.');
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGscError(err?.message || 'Failed to connect Search Console');
    } finally {
      setGscSelectingProperty(false);
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

  const handleCreateWebsite = async () => {
    if (!companyId || !websiteDraft.name.trim() || !websiteDraft.canonical_url.trim()) return;
    setWebsiteSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/websites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          name: websiteDraft.name.trim(),
          canonical_url: websiteDraft.canonical_url.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create website');
      setWebsiteDraft({ name: '', canonical_url: '' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create website');
    } finally {
      setWebsiteSaving(false);
    }
  };

  const handleSave = async (payload: { type: IntegrationType; name: string; config: Record<string, string>; website_id?: string | null }) => {
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
        body: JSON.stringify({
          company_id: companyId,
          name: payload.name,
          config: payload.config,
          website_id: payload.website_id,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
    }

    setModal(null);
    await load();
  };

  const handleTest = async (id: string, rediscover = false) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const response = await fetch(`/api/integrations/${id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, rediscover }),
      });
      const data = await response.json();
      setTestResult({
        id,
        success: data.success,
        message: data.message,
        code: data.code,
        diagnostics: data.diagnostics,
      });
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
    if (focus === 'data') return new Set(['crm-pipeline', 'google-analytics', 'google-search-console', 'files-imports']);
    return new Set<string>();
  }, [focus]);

  const categoryCards: CategoryCard[] = [
    {
      id: 'website-publishing',
      focus: 'website',
      title: 'Connect Your Website',
      description: 'Link your site so Omnivyra can publish content to it automatically. We support most website platforms.',
      badge: 'Start here',
      icon: <Globe className="h-5 w-5" />,
      badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      items: ['Works with WordPress, Shopify, Webflow & more', 'Automatic publishing once connected', 'No code for most platforms'],
      actions: [
        { label: 'View connected websites', href: '#website-publishing-section' },
        ...(isAdmin ? [{ label: 'Connect a website', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }), tone: 'secondary' as const }] : []),
      ],
    },
    {
      id: 'lead-capture-forms',
      focus: 'website',
      title: 'Capture Leads From Your Site',
      description: 'Collect leads from your website or landing pages and send them wherever your team works.',
      badge: 'Live now',
      icon: <Plug className="h-5 w-5" />,
      badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      items: ['Hosted lead capture pages', 'Embeddable website forms', 'Send leads to your CRM or tools'],
      actions: [
        { label: 'Set up forms', href: '/leads?tab=forms' },
        { label: 'Send leads elsewhere', href: '/leads?tab=connections' },
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
      id: 'google-analytics',
      focus: 'data',
      title: 'Google Analytics',
      description: 'Connect your Google Analytics account to track traffic, user behavior, and performance insights.',
      badge: 'Live now',
      icon: <BarChart3 className="h-5 w-5" />,
      badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      items: ['Sessions and traffic sources', 'Page views and engagement', 'Conversion events'],
      actions: [],
    },
    {
      id: 'google-search-console',
      focus: 'data',
      title: 'Google Search Console',
      description: 'Connect verified search properties for organic query and landing-page performance.',
      badge: 'Live now',
      icon: <Search className="h-5 w-5" />,
      badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      items: ['Search queries and pages', 'Clicks, impressions, CTR, position', 'Verified property matching'],
      actions: [],
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
  const categoryTitle = focus === 'website' ? 'What you can set up' : 'Data & CRM Sources';
  const categoryDescription =
    focus === 'website'
      ? 'Start by connecting your website — publishing, forms, and visitor tracking turn on from there.'
      : 'These are the business data setup cards for CRM, analytics, and imported files.';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Connect Your Website</h1>
            <p className="mt-1 text-sm text-gray-500">
              Link your website to Omnivyra so it can publish content, capture leads, and track visitors — we'll adapt the steps to how your site is built.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Connect Website
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

          <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {visibleCategoryCards.map((card) => {
              if (card.id === 'google-analytics') {
                return (
                  <GoogleAnalyticsGridCard
                    key={card.id}
                    isAdmin={isAdmin}
                    gaStatus={gaStatus}
                    gaLoading={gaLoading}
                    gaError={gaError}
                    gaNotice={gaNotice}
                    gaConnecting={gaConnecting}
                    gaSyncing={gaSyncing}
                    onConnect={handleConnectGoogleAnalytics}
                    onForceSync={handleForceSyncGoogleAnalytics}
                  />
                );
              }
              if (card.id === 'google-search-console') {
                return (
                  <GoogleSearchConsoleGridCard
                    key={card.id}
                    isAdmin={isAdmin}
                    gscStatus={gscStatus}
                    loading={gaLoading}
                    error={gscError}
                    notice={gscNotice}
                    connecting={gscConnecting}
                    syncing={gscSyncing}
                    onConnect={handleConnectSearchConsole}
                    onForceSync={handleForceSyncSearchConsole}
                    onDisconnect={handleDisconnectSearchConsole}
                  />
                );
              }
              const isHighlighted = highlightedIds.has(card.id);
              return (
                <div
                  key={card.id}
                  className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${isHighlighted ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md' : 'border-gray-200'}`}
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
                    <div className="mt-auto flex flex-wrap gap-2">
                      {card.actions.map((action) => (
                        <CategoryAction key={action.label} action={action} />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-auto rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
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
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <div className="flex items-start gap-2">
              {testResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{testResult.message}</span>
              <button onClick={() => setTestResult(null)} className="ml-auto shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            {testResult.diagnostics && (
              <CmsDiagnosticsPanel
                report={testResult.diagnostics}
                onRedetect={() => handleTest(testResult.id, true)}
                redetecting={testingId === testResult.id}
              />
            )}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading integrations...</div>
        ) : (
          <div className="space-y-8">
            {showWebsiteFlow && (
              <>
                <section id="website-foundation-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Your Websites</h2>
                      <p className="text-xs text-gray-500">Each website you add can have its own publishing, forms, and visitor tracking.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href="/website-setup" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">Guided setup</a>
                      <code className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">/public/omnivera-tracker.js</code>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {websites.map((website) => (
                      <div key={website.id} className="rounded-xl border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{website.name}</p>
                            <p className="mt-1 break-all text-xs text-gray-500">{website.canonical_url}</p>
                          </div>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{website.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">Tracking snippet: <code>{`<script src="${origin}/omnivera-tracker.js" data-website-id="${website.id}"></script>`}</code></p>
                      </div>
                    ))}
                  </div>

                  {isAdmin && (
                    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        value={websiteDraft.name}
                        onChange={(event) => setWebsiteDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Website name"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        value={websiteDraft.canonical_url}
                        onChange={(event) => setWebsiteDraft((current) => ({ ...current, canonical_url: event.target.value }))}
                        placeholder="https://example.com"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={handleCreateWebsite}
                        disabled={websiteSaving || !websiteDraft.name.trim() || !websiteDraft.canonical_url.trim()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add Website
                      </button>
                    </div>
                  )}
                </section>

                <section id="website-publishing-section">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Connected Websites</h2>
                      <p className="text-xs text-gray-500">Websites where Omnivyra can publish content automatically.</p>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Connect website
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Custom publishing
                        </button>
                      </div>
                    )}
                  </div>

                  {blogIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No website connected yet — connect one to start publishing automatically."
                      actions={
                        isAdmin
                          ? [
                              { label: 'Connect website', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }) },
                              { label: 'Connect custom publishing', onClick: () => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration }) },
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

                <section id="provider-diagnostics-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Provider diagnostics</h2>
                      <p className="text-xs text-gray-500">Capability matrix, recent publish health, and provider-specific troubleshooting tips.</p>
                    </div>
                    {providerCardsLoading && <span className="text-[11px] text-gray-500">loading…</span>}
                  </div>
                  {providerCards.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {providerCards.map((card) => (
                        <div key={card.provider} className={`rounded-xl border p-3 text-xs ${
                          card.health === 'healthy' ? 'border-emerald-200 bg-emerald-50' :
                          card.health === 'warning' ? 'border-amber-200 bg-amber-50' :
                          card.health === 'degraded' ? 'border-red-200 bg-red-50' :
                          'border-gray-200 bg-gray-50'
                        }`}>
                          <div className="flex items-center justify-between">
                            <strong className="text-sm">{card.label}</strong>
                            <span className="text-[10px] uppercase tracking-wider opacity-70">{card.health}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-600">Auth: <code>{card.authType}</code> · {card.apiDiscoveryMode}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                            {Object.entries(card.capabilities).filter(([, v]) => v).map(([k]) => (
                              <span key={k} className="rounded bg-white/60 px-1.5 py-0.5 font-medium text-gray-700">{k}</span>
                            ))}
                          </div>
                          {card.recentPublishAttempts > 0 ? (
                            <p className="mt-1.5 text-[11px]">
                              7d publishes: <strong>{card.recentPublishSuccesses}</strong>/<strong>{card.recentPublishAttempts}</strong> ({(card.successRate * 100).toFixed(0)}%)
                              {card.recentAuthFailures > 0 && <span className="ml-1 rounded bg-red-100 px-1 text-red-700">{card.recentAuthFailures} auth fail</span>}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-gray-500">No publishes in 7d.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpandedProvider((p) => p === card.provider ? null : card.provider)}
                            className="mt-1.5 text-[11px] font-medium text-indigo-700 underline"
                          >
                            {expandedProvider === card.provider ? 'Hide tips' : 'Show setup + troubleshooting'}
                          </button>
                          {expandedProvider === card.provider && (
                            <div className="mt-1.5 space-y-1.5 rounded bg-white p-2 text-[11px] text-gray-700">
                              {card.setupHints.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Setup hints</p>
                                  <ul className="ml-3 list-disc">
                                    {card.setupHints.map((h, i) => <li key={i}>{h}</li>)}
                                  </ul>
                                </div>
                              )}
                              {card.troubleshootingHints.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Troubleshooting</p>
                                  <ul className="ml-3 list-disc">
                                    {card.troubleshootingHints.map((h, i) => <li key={i}>{h}</li>)}
                                  </ul>
                                </div>
                              )}
                              <p className="text-gray-500">Rate limits: {card.rateLimitNote}</p>
                              {card.recentErrors.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Recent errors</p>
                                  <ul className="ml-3 list-disc">
                                    {card.recentErrors.map((e, i) => (
                                      <li key={i}><span className="text-gray-500">{new Date(e.at).toLocaleString()}</span> · {e.message}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !providerCardsLoading && (
                    <p className="text-xs text-gray-500">No provider data yet.</p>
                  )}
                </section>

                <section id="lead-capture-section" className="space-y-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Forms &amp; Leads</h2>
                      <p className="text-xs text-gray-500">Collect leads from your site and choose where they should go.</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration })}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Send leads to a tool
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
              <div className="space-y-3">
                <GoogleAnalyticsHelperPanel
                  gaStatus={gaStatus}
                  gaSelectingProperty={gaSelectingProperty}
                  selectedPropertyId={selectedPropertyId}
                  scriptAssistOpen={scriptAssistOpen}
                  scriptAssistLoading={scriptAssistLoading}
                  scriptAssistError={scriptAssistError}
                  scriptAssistForm={scriptAssistForm}
                  scriptAssistResult={scriptAssistResult}
                  onSelectedPropertyChange={setSelectedPropertyId}
                  onSelectProperty={handleSelectGoogleAnalyticsProperty}
                  onToggleScriptAssist={() => setScriptAssistOpen((current) => !current)}
                  onScriptAssistInput={(key, value) => setScriptAssistForm((current) => ({ ...current, [key]: value }))}
                  onGenerateScriptAssist={handleGenerateTrackingAssist}
                />
                <GoogleSearchConsoleHelperPanel
                  gscStatus={gscStatus}
                  selecting={gscSelectingProperty}
                  selectedPropertyId={selectedGscPropertyId}
                  onSelectedPropertyChange={setSelectedGscPropertyId}
                  onSelectProperty={handleSelectSearchConsoleProperty}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <IntegrationModal
          mode={modal.mode}
          initial={modal.integration}
          websites={websites}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
