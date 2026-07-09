/** Part 1/4 of integrations.tsx — verbatim split (barrel preserved; importers unchanged). */
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


export type IntegrationType =
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
export type FocusArea = 'website' | 'data';

export type CmsEnvironmentType = 'localhost' | 'local_network' | 'staging' | 'production';

// Mirrors backend CmsValidationReport (cmsEnvironmentFramework.ts).
export interface CmsValidationReport {
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

export interface TestResultState {
  id: string;
  success: boolean;
  message: string;
  code?: string;
  diagnostics?: CmsValidationReport;
}

export interface Integration {
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

export interface Website {
  id: string;
  name: string;
  canonical_url: string;
  cms_provider: string | null;
  status: string;
}

export interface CategoryCard {
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

export type IntegrationAction =
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

export type GoogleAnalyticsStatusResponse = {
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

export type GoogleSearchConsoleStatusResponse = {
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

export type TrackingAssistResponse = {
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

export const TYPE_LABELS: Record<IntegrationType, string> = {
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

export const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
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

export const TYPE_COLORS: Record<IntegrationType, string> = {
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

export const STATUS_BADGE: Record<IntegrationStatus, { label: string; cls: string; icon: React.ReactNode }> = {
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
    { key: 'site_url', label: 'WordPress URL', placeholder: 'https://omnivyra.com/blog', hint: 'The actual WordPress publishing endpoint. Examples: https://omnivyra.com or https://omnivyra.com/blog. Production sites must use https:// (Application Passwords require HTTPS); localhost/dev can use http://.' },
    { key: 'username', label: 'WordPress Username', placeholder: 'admin' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: 'Generate in WordPress under Users > Profile > Application Passwords' },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Endpoint URL', placeholder: 'https://api.myblog.com/posts' },
    { key: 'api_key', label: 'API Key', placeholder: 'sk-...', type: 'password' },
    { key: 'auth_header', label: 'Auth Header (optional)', placeholder: 'Authorization', hint: 'Defaults to Authorization: Bearer <api_key>' },
  ],
  ghost: [
    { key: 'site_url', label: 'Ghost URL', placeholder: 'https://blog.omnivyra.com', hint: 'The Ghost site base URL. Examples: https://omnivyra.com or https://blog.omnivyra.com. Localhost/dev allowed over http://.' },
    { key: 'admin_api_key', label: 'Admin API Key', placeholder: 'id:secret', type: 'password', hint: 'Ghost Admin → Settings → Integrations → custom integration → Admin API Key.' },
    { key: 'author_email', label: 'Author Email (optional)', placeholder: 'author@site.com' },
  ],
  drupal: [
    { key: 'site_url', label: 'Drupal URL', placeholder: 'https://omnivyra.com', hint: 'The Drupal site root. JSON:API path (/jsonapi) is auto-detected. Production must be HTTPS.' },
    { key: 'bearer_token', label: 'Bearer Token', placeholder: 'token', type: 'password', hint: 'OAuth/JSON:API bearer token with node create permission.' },
    { key: 'node_bundle', label: 'Node Bundle (optional)', placeholder: 'article' },
  ],
  joomla: [
    { key: 'site_url', label: 'Joomla URL', placeholder: 'https://omnivyra.com', hint: 'The Joomla site root. Enable Web Services (REST API) in Global Configuration.' },
    { key: 'api_token', label: 'Joomla API Token', placeholder: 'token', type: 'password', hint: 'Users → Manage → (user) → API tokens.' },
    { key: 'default_catid', label: 'Default Category ID (optional)', placeholder: '2' },
  ],
  webflow: [
    { key: 'access_token', label: 'OAuth Access Token', placeholder: 'wf-...', type: 'password', hint: 'Webflow OAuth access token or site API token.' },
    { key: 'collection_id', label: 'CMS Collection ID (optional)', placeholder: 'Run validate to discover collections', hint: 'Required for publishing; discovered on validation.' },
    { key: 'site_url', label: 'Webflow site URL (optional)', placeholder: 'https://mysite.webflow.io', hint: 'Your published Webflow URL (webflow.io or custom domain).' },
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

// ── Website / publishing-URL helpers ───────────────────────────────────────
//
// Older companies have a placeholder `Default Website` row whose
// `canonical_url` was backfilled as `https://company-<uuid>.local`. Those
// internal identifiers should NEVER appear in user-facing dropdowns or
// pre-fill into publishing-URL fields.
const PLACEHOLDER_HOST_PATTERNS = [
  /^company-[a-f0-9-]+\.local$/i,
  /\.local$/i,
  /\.test$/i,
];

function isPlaceholderCanonicalUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return true;
  let host: string;
  try {
    host = new URL(rawUrl).host;
  } catch {
    return true;
  }
  return PLACEHOLDER_HOST_PATTERNS.some((p) => p.test(host));
}

/**
 * Format a website for the picker dropdown.
 *   - "Omnivyra — https://omnivyra.com"           ← canonical case
 *   - "Omnivyra (no canonical domain set)"        ← placeholder/.local fallback
 *   - "Website abc12345"                          ← absolutely nothing usable
 *
 * Never exposes UUIDs, slugs, or system-generated `.local` domains.
 */
function formatWebsiteOptionLabel(website: Website): string {
  const name = website.name?.trim();
  const canonicalReal = !isPlaceholderCanonicalUrl(website.canonical_url);
  if (name && canonicalReal) {
    return `${name} — ${website.canonical_url}`;
  }
  if (name) return `${name} (no canonical domain set)`;
  if (canonicalReal) return website.canonical_url;
  return `Website ${website.id.slice(0, 8)}`;
}

/**
 * Normalize a user-entered publishing URL:
 *   - trim whitespace
 *   - collapse repeated trailing slashes to none
 *   - upgrade `http://` → `https://` when host is not localhost/.local/.test
 *   - reject obvious wp-admin URLs (we want the site root or blog root, not admin)
 *   - reject malformed inputs (returns { ok: false } with reason)
 */
function normalizePublishingUrl(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol (${parsed.protocol})` };
  }
  if (/\/wp-admin(\/|$)/i.test(parsed.pathname) || /\/wp-login\.php/i.test(parsed.pathname)) {
    return { ok: false, reason: 'wp-admin URL not allowed — enter the site root or blog root' };
  }
  // Upgrade http→https when the host is not a known dev/loopback host.
  const isLocalHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    /\.local$/i.test(parsed.hostname) ||
    /\.test$/i.test(parsed.hostname);
  if (parsed.protocol === 'http:' && !isLocalHost) {
    parsed.protocol = 'https:';
  }
  // Strip trailing slash on path (but keep "/" alone as empty path).
  let pathname = parsed.pathname.replace(/\/+$/g, '');
  if (pathname === '') pathname = '';
  parsed.pathname = pathname;
  return { ok: true, value: parsed.toString().replace(/\/$/, '') };
}

/**
 * True when `publishingUrl` is the canonical domain root OR a sub-path
 * thereof (e.g. canonical = https://omnivyra.com, publishing =
 * https://omnivyra.com/blog). Used to show the "Publishing under selected
 * website" relationship badge.
 */
function publishingUrlIsUnderWebsite(publishingUrl: string, websiteCanonicalUrl: string): boolean {
  try {
    const a = new URL(publishingUrl);
    const b = new URL(websiteCanonicalUrl);
    if (a.host !== b.host) return false;
    const aPath = a.pathname.replace(/\/+$/, '');
    const bPath = b.pathname.replace(/\/+$/, '');
    if (bPath === '' || bPath === '/') return true;
    return aPath === bPath || aPath.startsWith(bPath + '/');
  } catch {
    return false;
  }
}

interface ModalProps {
  mode: 'create' | 'edit';
  initial?: Partial<Integration>;
  websites: Website[];
  onClose: () => void;
  onSave: (data: { type: IntegrationType; name: string; config: Record<string, string>; website_id?: string | null }) => Promise<void>;
}

export function IntegrationModal({ mode, initial, websites, onClose, onSave }: ModalProps) {
  const [type, setType] = useState<IntegrationType>(initial?.type || 'lead_webhook');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, string>>(initial?.config || {});
  const [websiteId, setWebsiteId] = useState(initial?.website_id || websites[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteUrlNormalizationWarning, setSiteUrlNormalizationWarning] = useState<string | null>(null);

  const fields = CONFIG_FIELDS[type];
  const selectedWebsite = websites.find((w) => w.id === websiteId) ?? null;
  const websiteHasRealDomain = !!selectedWebsite && !isPlaceholderCanonicalUrl(selectedWebsite.canonical_url);

  // Auto-prefill the publishing/site URL from the selected website's canonical
  // domain — only when (a) the integration type has a `site_url` field,
  // (b) the field is currently empty, and (c) the website actually has a
  // real canonical domain (not the .local backfill placeholder). User can
  // override at any time after prefill; we never overwrite a non-empty value.
  useEffect(() => {
    const hasSiteUrlField = fields.some((f) => f.key === 'site_url');
    if (!hasSiteUrlField) return;
    if (config.site_url) return;
    if (!selectedWebsite || !websiteHasRealDomain) return;
    setConfig((current) => ({ ...current, site_url: selectedWebsite.canonical_url }));
  }, [websiteId, type, selectedWebsite, websiteHasRealDomain, fields, config.site_url]);

  const handleTypeChange = (nextType: IntegrationType) => {
    setType(nextType);
    setConfig({});
    setSiteUrlNormalizationWarning(null);
  };

  const handleSiteUrlBlur = (fieldKey: string) => {
    if (fieldKey !== 'site_url') return;
    const raw = config.site_url ?? '';
    if (!raw.trim()) {
      setSiteUrlNormalizationWarning(null);
      return;
    }
    const result = normalizePublishingUrl(raw);
    if ('reason' in result) {
      setSiteUrlNormalizationWarning(result.reason);
      return;
    }
    if (result.value !== raw) {
      setConfig((current) => ({ ...current, site_url: result.value }));
    }
    setSiteUrlNormalizationWarning(null);
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
          <h2 className="text-base font-semibold text-gray-900">{mode === 'create' ? 'Connect Publishing' : 'Edit Connection'}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {mode === 'create' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Where is this website built?</label>
              <p className="mb-2 text-xs text-gray-500">Choose the CMS or publishing system. We will only show fields for that choice.</p>
              <select
                value={type}
                onChange={(event) => handleTypeChange(event.target.value as IntegrationType)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="wordpress">WordPress</option>
                <option value="custom_blog_api">Custom Blog API</option>
                <option value="ghost">Ghost</option>
                <option value="drupal">Drupal</option>
                <option value="joomla">Joomla</option>
                <option value="webflow">Webflow</option>
                <option value="shopify">Shopify Blog</option>
                <option value="hubspot">HubSpot CMS</option>
                <option value="wix">Wix Blog</option>
                <option value="squarespace">Squarespace</option>
              </select>
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Parent website</label>
            <p className="mb-2 text-xs text-gray-500">The site this publishing destination belongs to.</p>
            <select
              value={websiteId}
              onChange={(event) => setWebsiteId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">No parent website</option>
              {websites.map((website) => (
                <option key={website.id} value={website.id}>
                  {formatWebsiteOptionLabel(website)}
                </option>
              ))}
            </select>
            {selectedWebsite && !websiteHasRealDomain && (
              <p className="mt-1 text-xs text-amber-700">
                This website does not have a canonical domain yet. Add one in the Websites section to enable auto-prefill.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="border-t border-gray-100 pt-3 text-sm font-medium text-gray-700">Publishing destination — {TYPE_LABELS[type]}</div>
            {fields.map((field) => {
              const isSiteUrl = field.key === 'site_url';
              const value = config[field.key] || '';
              const showRelationshipBadge =
                isSiteUrl &&
                value.trim() !== '' &&
                selectedWebsite &&
                websiteHasRealDomain &&
                publishingUrlIsUnderWebsite(value, selectedWebsite.canonical_url);
              return (
                <div key={field.key}>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
                  <input
                    type={field.type || 'text'}
                    value={value}
                    onChange={(event) => {
                      setConfig((current) => ({ ...current, [field.key]: event.target.value }));
                      if (isSiteUrl) setSiteUrlNormalizationWarning(null);
                    }}
                    onBlur={() => handleSiteUrlBlur(field.key)}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {field.hint && <p className="mt-1 text-xs text-gray-500">{field.hint}</p>}
                  {isSiteUrl && siteUrlNormalizationWarning && (
                    <p className="mt-1 text-xs text-red-700">{siteUrlNormalizationWarning}</p>
                  )}
                  {showRelationshipBadge && selectedWebsite && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      ↳ Publishing under {selectedWebsite.name}
                    </p>
                  )}
                </div>
              );
            })}
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

