import React, { useEffect, useMemo, useState } from 'react';
import { OAUTH_PLATFORMS } from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Globe,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react';

type OAuthFormState = Record<string, { client_id: string; client_secret: string; enabled: boolean }>;
type AnalyticsProviderFormState = {
  oauth_client_id: string;
  oauth_client_secret: string;
  enabled: boolean;
  redirect_uri: string;
};
type AnalyticsProviderConfigSummary = {
  provider: 'google_analytics';
  enabled: boolean;
  configured: boolean;
  client_id_preview: string;
  has_client_secret: boolean;
  scopes: string[];
  redirect_uri: string | null;
  status: string;
  updated_at: string | null;
};

type PlatformCheckResult = {
  credentials_ok: boolean;
  credentials_source?: 'platform_config' | 'env' | null;
  token_ok: boolean | null;
  token_detail: string | null;
  checked_at: string;
  live_check_supported?: boolean;
} | null;

type BadgeTone = 'neutral' | 'warning' | 'danger' | 'success' | 'info';

const CALLBACK_PLATFORMS = ['linkedin', 'x', 'youtube', 'tiktok', 'pinterest', 'facebook'];
const CONNECTOR_PLATFORMS = ['linkedin', 'x', 'facebook'];

const PLATFORM_ICONS: Record<string, string> = {
  linkedin:  '🔵',
  x:         '𝕏',
  youtube:   '▶️',
  facebook:  '📘',
  tiktok:    '🎵',
  pinterest: '📌',
  reddit:    '🟠',
};

function createDefaultOauthForm(): OAuthFormState {
  return Object.fromEntries(
    OAUTH_PLATFORMS.map((platform) => [
      platform.platform_key,
      { client_id: '', client_secret: '', enabled: false },
    ])
  );
}

function getPublicAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
}

function getPublishingCallbackUri(platformKey: string, baseUrl: string) {
  if (platformKey === 'x') {
    return `${baseUrl}/auth/x/callback`;
  }
  return `${baseUrl}/api/auth/${platformKey}/callback`;
}

function getPlatformStatus(
  platform: any,
  checkResult: PlatformCheckResult,
  isChecking: boolean
): { tone: BadgeTone; icon: any; label: string; title: string; spinning?: boolean } {
  if (!platform.configured) {
    return {
      tone: 'neutral',
      icon: XCircle,
      label: 'Not set up',
      title: 'No OAuth credentials have been saved yet.',
    };
  }

  if (!platform.enabled) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Saved - disabled',
      title: 'Credentials are saved, but the platform is disabled for company admins.',
    };
  }

  if (isChecking) {
    return {
      tone: 'info',
      icon: RefreshCw,
      label: 'Checking',
      title: 'Running a live verification check now.',
      spinning: true,
    };
  }

  if (!checkResult) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Configured - not verified',
      title: 'Credentials are saved, but no live verification has been run yet.',
    };
  }

  if (!checkResult.credentials_ok) {
    return {
      tone: 'danger',
      icon: XCircle,
      label: 'Credentials missing',
      title: 'This platform is enabled, but the client ID or secret is not available.',
    };
  }

  if (checkResult.token_ok === true) {
    return {
      tone: 'success',
      icon: CheckCircle,
      label: 'Live connection OK',
      title: checkResult.token_detail || 'Saved credentials and token both verified successfully.',
    };
  }

  if (checkResult.token_ok === false) {
    return {
      tone: 'danger',
      icon: XCircle,
      label: 'Connection broken',
      title: checkResult.token_detail || 'The saved token failed live verification.',
    };
  }

  if (checkResult.credentials_source === 'env') {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Env only',
      title: 'Credentials are coming from .env instead of the Super Admin database config.',
    };
  }

  if (checkResult.live_check_supported === false) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Manual verify',
      title: checkResult.token_detail || 'This platform does not have an automated live verification yet.',
    };
  }

  return {
    tone: 'warning',
    icon: AlertCircle,
    label: 'Awaiting account',
    title: checkResult.token_detail || 'Credentials are saved, but no connected account was found for live testing.',
  };
}

function badgeClasses(tone: BadgeTone) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'danger':
      return 'bg-red-50 text-red-700 border border-red-200';
    case 'warning':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'info':
      return 'bg-blue-50 text-blue-700 border border-blue-200';
    default:
      return 'bg-gray-100 text-gray-500 border border-gray-200';
  }
}

export default function SocialPlatformsSection() {
  const [socialPlatforms, setSocialPlatforms] = useState<any[]>(OAUTH_PLATFORMS);
  const [loadingSocialPlatforms, setLoadingSocialPlatforms] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [oauthForm, setOauthForm] = useState<OAuthFormState>(createDefaultOauthForm);
  const [savingOauth, setSavingOauth] = useState<string | null>(null);
  const [oauthSaveMsg, setOauthSaveMsg] = useState<{ platform: string; type: 'success' | 'error'; text: string } | null>(null);
  const [showSecretFor, setShowSecretFor] = useState<string | null>(null);
  const [copiedRedirectFor, setCopiedRedirectFor] = useState<string | null>(null);
  const [checkingPlatform, setCheckingPlatform] = useState<string | null>(null);
  const [platformCheckResults, setPlatformCheckResults] = useState<Record<string, PlatformCheckResult>>({});
  const [analyticsProvider, setAnalyticsProvider] = useState<AnalyticsProviderConfigSummary | null>(null);
  const [analyticsProviderForm, setAnalyticsProviderForm] = useState<AnalyticsProviderFormState>({
    oauth_client_id: '',
    oauth_client_secret: '',
    enabled: false,
    redirect_uri: '',
  });
  const [analyticsProviderExpanded, setAnalyticsProviderExpanded] = useState(false);
  const [analyticsProviderSaving, setAnalyticsProviderSaving] = useState(false);
  const [analyticsProviderMessage, setAnalyticsProviderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAnalyticsSecret, setShowAnalyticsSecret] = useState(false);

  const appBaseUrl = useMemo(() => getPublicAppBaseUrl(), []);

  const checkPlatformConfig = async (platformKey: string) => {
    setCheckingPlatform(platformKey);
    try {
      const response = await fetchWithAuth(`/api/social-accounts/verify-config?platform=${platformKey}`);
      if (response.ok) {
        const data = await response.json();
        setPlatformCheckResults((prev) => ({ ...prev, [platformKey]: data }));
      }
    } catch (error) {
      console.error('Check failed', error);
      setPlatformCheckResults((prev) => ({
        ...prev,
        [platformKey]: {
          credentials_ok: false,
          token_ok: false,
          token_detail: error instanceof Error ? error.message : 'Verification failed',
          checked_at: new Date().toISOString(),
          live_check_supported: true,
        },
      }));
    } finally {
      setCheckingPlatform(null);
    }
  };

  const runInitialChecks = async (platforms: any[]) => {
    const configuredEnabledPlatforms = platforms.filter((platform) => platform.configured || platform.enabled);
    if (configuredEnabledPlatforms.length === 0) {
      setPlatformCheckResults({});
      return;
    }

    const results = await Promise.all(
      configuredEnabledPlatforms.map(async (platform) => {
        try {
          const response = await fetchWithAuth(`/api/social-accounts/verify-config?platform=${platform.platform_key}`);
          if (!response.ok) {
            return [platform.platform_key, null] as const;
          }
          const data = await response.json();
          return [platform.platform_key, data] as const;
        } catch (error) {
          console.error(`Failed to verify ${platform.platform_key}`, error);
          return [
            platform.platform_key,
            {
              credentials_ok: false,
              token_ok: false,
              token_detail: error instanceof Error ? error.message : 'Verification failed',
              checked_at: new Date().toISOString(),
              live_check_supported: true,
            },
          ] as const;
        }
      })
    );

    setPlatformCheckResults(Object.fromEntries(results));
  };

  const loadSocialPlatforms = async () => {
    setLoadingSocialPlatforms(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/platform-oauth-configs');
      if (response.ok) {
        const data = await response.json();
        const apiPlatforms: any[] = data.platforms || [];
        if (apiPlatforms.length > 0) {
          const mergedPlatforms = OAUTH_PLATFORMS.map((platform) => {
            const fromApi = apiPlatforms.find((item: any) => item.platform_key === platform.platform_key);
            return fromApi ? { ...platform, ...fromApi } : platform;
          });

          setSocialPlatforms(mergedPlatforms);
          setOauthForm((prev) => {
            const next = { ...prev };
            for (const platform of mergedPlatforms) {
              next[platform.platform_key] = {
                client_id: '',
                client_secret: '',
                enabled: platform.configured ? (platform.enabled ?? true) : false,
              };
            }
            return next;
          });

          await runInitialChecks(mergedPlatforms);
        } else {
          setSocialPlatforms(OAUTH_PLATFORMS);
          setPlatformCheckResults({});
        }
      } else if (response.status === 403) {
        window.location.href = '/super-admin/login';
      }
    } catch (error) {
      console.error('Failed to load platform OAuth configs', error);
    } finally {
      setLoadingSocialPlatforms(false);
    }
  };

  const saveOauthConfig = async (platformKey: string) => {
    const form = oauthForm[platformKey];
    const alreadyConfigured = socialPlatforms.find((platform) => platform.platform_key === platformKey)?.configured ?? false;

    if (!form?.client_id && !alreadyConfigured) {
      setOauthSaveMsg({ platform: platformKey, type: 'error', text: 'Client ID is required' });
      return;
    }

    setSavingOauth(platformKey);
    setOauthSaveMsg(null);

    try {
      const body: Record<string, unknown> = { platform: platformKey, enabled: form.enabled };
      if (form.client_id) {
        body.client_id = form.client_id;
        body.client_secret = form.client_secret;
      }

      const response = await fetchWithAuth('/api/super-admin/platform-oauth-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        setOauthSaveMsg({ platform: platformKey, type: 'success', text: 'Saved successfully' });
        setExpandedPlatform(null);
        await loadSocialPlatforms();
      } else if (response.status === 403) {
        window.location.href = '/super-admin/login';
      } else {
        const error = await response.json().catch(() => ({}));
        setOauthSaveMsg({ platform: platformKey, type: 'error', text: error.error || 'Failed to save' });
      }
    } catch (error: any) {
      setOauthSaveMsg({ platform: platformKey, type: 'error', text: error.message });
    } finally {
      setSavingOauth(null);
    }
  };

  const loadAnalyticsProvider = async () => {
    try {
      const response = await fetchWithAuth('/api/super-admin/analytics-provider-config');
      if (!response.ok) {
        if (response.status === 403) window.location.href = '/super-admin/login';
        return;
      }
      const data = await response.json();
      const config = data?.config as AnalyticsProviderConfigSummary | undefined;
      if (!config) return;
      setAnalyticsProvider(config);
      setAnalyticsProviderForm({
        oauth_client_id: '',
        oauth_client_secret: '',
        enabled: config.enabled,
        redirect_uri: config.redirect_uri || '',
      });
    } catch (error) {
      console.error('Failed to load analytics provider config', error);
    }
  };

  const saveAnalyticsProvider = async () => {
    setAnalyticsProviderSaving(true);
    setAnalyticsProviderMessage(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/analytics-provider-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: analyticsProviderForm.enabled,
          oauth_client_id: analyticsProviderForm.oauth_client_id,
          oauth_client_secret: analyticsProviderForm.oauth_client_secret,
          redirect_uri: analyticsProviderForm.redirect_uri,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAnalyticsProviderMessage({ type: 'error', text: data?.error || 'Failed to save Google Analytics config' });
        return;
      }
      setAnalyticsProviderMessage({ type: 'success', text: 'Google Analytics config saved' });
      setAnalyticsProviderExpanded(false);
      await loadAnalyticsProvider();
    } catch (error: any) {
      setAnalyticsProviderMessage({ type: 'error', text: error?.message || 'Failed to save Google Analytics config' });
    } finally {
      setAnalyticsProviderSaving(false);
    }
  };

  useEffect(() => {
    loadSocialPlatforms();
    loadAnalyticsProvider();
  }, []);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-6 py-5 border-b border-gray-200 bg-white">
        <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Google Analytics Provider</h3>
                  <p className="text-sm text-slate-600">
                    One global config powers the Company Admin click → connect → select → done flow.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${
                  analyticsProvider?.configured
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-500'
                }`}>
                  {analyticsProvider?.configured ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {analyticsProvider?.configured ? 'Credentials saved' : 'Not configured'}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${
                  analyticsProvider?.enabled
                    ? 'border-blue-200 bg-blue-100 text-blue-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {analyticsProvider?.enabled ? 'Enabled for companies' : 'Disabled for companies'}
                </span>
                {analyticsProvider?.client_id_preview && (
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                    Client ID: {analyticsProvider.client_id_preview}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAnalyticsProviderExpanded((current) => !current)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {analyticsProviderExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {analyticsProvider?.configured ? 'Update Google Analytics' : 'Configure Google Analytics'}
            </button>
          </div>

          {analyticsProviderExpanded && (
            <div className="mt-5 space-y-4 rounded-2xl border border-white/70 bg-white p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">OAuth Client ID</label>
                  <input
                    type="text"
                    value={analyticsProviderForm.oauth_client_id}
                    onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, oauth_client_id: event.target.value }))}
                    placeholder={analyticsProvider?.configured ? 'Enter to replace the saved client ID' : 'Paste Google OAuth client ID'}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">OAuth Client Secret</label>
                  <div className="relative">
                    <input
                      type={showAnalyticsSecret ? 'text' : 'password'}
                      value={analyticsProviderForm.oauth_client_secret}
                      onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, oauth_client_secret: event.target.value }))}
                      placeholder={analyticsProvider?.configured ? 'Enter to replace the saved client secret' : 'Paste Google OAuth client secret'}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAnalyticsSecret((current) => !current)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showAnalyticsSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Redirect URI</label>
                <input
                  type="text"
                  value={analyticsProviderForm.redirect_uri}
                  onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, redirect_uri: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                Scopes: {(analyticsProvider?.scopes || []).join(', ')}
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={analyticsProviderForm.enabled}
                  onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, enabled: event.target.checked }))}
                  className="rounded border-slate-300"
                />
                Enable Google Analytics for Company Admin self-serve connect
              </label>

              {analyticsProviderMessage && (
                <div className={`rounded-lg px-3 py-2 text-sm ${
                  analyticsProviderMessage.type === 'success'
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border border-red-200 bg-red-50 text-red-700'
                }`}>
                  {analyticsProviderMessage.text}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveAnalyticsProvider}
                  disabled={analyticsProviderSaving}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {analyticsProviderSaving ? 'Saving...' : 'Save Google Analytics'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Social Platform OAuth Credentials</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure client credentials here. Green now means a live check passed, not just that credentials were saved.
          </p>
        </div>
        <button onClick={loadSocialPlatforms} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loadingSocialPlatforms ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {socialPlatforms.map((platform) => {
          const checkResult = platformCheckResults[platform.platform_key];
          const isChecking = checkingPlatform === platform.platform_key;
          const status = getPlatformStatus(platform, checkResult, isChecking);
          const StatusIcon = status.icon;
          const detailTone: 'success' | 'danger' | 'warning' =
            checkResult?.token_ok === true
              ? 'success'
              : checkResult?.token_ok === false || (checkResult ? !checkResult.credentials_ok : false)
                ? 'danger'
                : 'warning';

          return (
            <div key={platform.platform_key} className="px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg leading-none shrink-0 w-5 text-center">
                    {PLATFORM_ICONS[platform.platform_key] ?? <Globe className="inline h-4 w-4 text-gray-400" />}
                  </span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{platform.platform_label}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badgeClasses(status.tone)}`}
                        title={status.title}
                      >
                        <StatusIcon className={`h-3 w-3 ${status.spinning ? 'animate-spin' : ''}`} />
                        {status.label}
                      </span>
                    </div>
                    {platform.configured && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Client ID: {platform.client_id_preview} - Secret: {platform.has_client_secret ? '******' : 'not set'}
                        {platform.updated_at && ` - Updated ${new Date(platform.updated_at).toLocaleDateString()}`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {checkResult && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${badgeClasses(detailTone)}`}
                      title={checkResult.token_detail || status.title}
                    >
                      {checkResult.token_ok === true ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : checkResult.token_ok === false || !checkResult.credentials_ok ? (
                        <XCircle className="h-3 w-3" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      {checkResult.token_ok === true
                        ? checkResult.token_detail || 'Live token verified'
                        : checkResult.token_ok === false
                          ? checkResult.token_detail || 'Token failed verification'
                          : checkResult.credentials_source === 'env'
                            ? 'Using .env credentials only'
                            : checkResult.live_check_supported === false
                              ? 'Automated live check not available'
                              : checkResult.token_detail || 'Waiting for a connected account'}
                    </span>
                  )}

                  <button
                    onClick={() => checkPlatformConfig(platform.platform_key)}
                    disabled={isChecking}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                    title="Verify credentials and token"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                    {isChecking ? 'Checking...' : 'Check'}
                  </button>

                  <button
                    onClick={() => setExpandedPlatform(expandedPlatform === platform.platform_key ? null : platform.platform_key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors shrink-0"
                  >
                    {expandedPlatform === platform.platform_key ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        Close
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        {platform.configured ? 'Update' : 'Configure'}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {expandedPlatform === platform.platform_key && (
                <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
                  {platform.configured && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                      <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
                      <span>
                        <strong>Credentials are saved</strong> - Client ID: <span className="font-mono">{platform.client_id_preview}</span> - Secret: ******
                        {platform.updated_at && ` - Last updated ${new Date(platform.updated_at).toLocaleDateString()}`}. The fields below stay blank for security.
                        Enter new values only if you want to replace the saved credentials.
                      </span>
                    </div>
                  )}

                  {CALLBACK_PLATFORMS.includes(platform.platform_key) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Redirect URIs <span className="text-gray-400 font-normal">(register all URLs below in the platform developer console)</span>
                      </label>
                      {(() => {
                        const isMeta = ['facebook', 'meta', 'instagram', 'whatsapp'].includes(platform.platform_key);
                        const connectorKey = isMeta ? 'meta' : platform.platform_key;
                        const uriGroups: Array<{ label: string; uri: string }> = [];

                        const pushBoth = (label: string, path: string) => {
                          uriGroups.push({ label: `${label} (local)`, uri: `http://localhost:3000${path}` });
                          if (appBaseUrl) uriGroups.push({ label: `${label} (cloud)`, uri: `${appBaseUrl}${path}` });
                        };

                        if (isMeta) {
                          // One Meta app covers all three; register every callback URL.
                          pushBoth('Facebook publishing', '/api/auth/facebook/callback');
                          pushBoth('Instagram publishing', '/api/auth/instagram/callback');
                        } else {
                          uriGroups.push({
                            label: 'Publishing (local)',
                            uri: getPublishingCallbackUri(platform.platform_key, 'http://localhost:3000'),
                          });
                          if (appBaseUrl) {
                            uriGroups.push({
                              label: 'Production (cloud)',
                              uri: getPublishingCallbackUri(platform.platform_key, appBaseUrl),
                            });
                          }
                        }

                        if (CONNECTOR_PLATFORMS.includes(platform.platform_key) && platform.platform_key !== 'x') {
                          uriGroups.push({
                            label: 'Connector (local)',
                            uri: `http://localhost:3000/api/community-ai/connectors/${connectorKey}/callback`,
                          });
                          if (appBaseUrl) {
                            uriGroups.push({
                              label: 'Connector (app)',
                              uri: `${appBaseUrl}/api/community-ai/connectors/${connectorKey}/callback`,
                            });
                          }
                        }

                        return (
                          <div className="space-y-1.5">
                            {uriGroups.map(({ label, uri }) => (
                              <div key={uri} className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-36 shrink-0">{label}</span>
                                <input
                                  readOnly
                                  value={uri}
                                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 font-mono cursor-text select-all"
                                  onFocus={(event) => event.target.select()}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(uri).then(() => {
                                      setCopiedRedirectFor(`${platform.platform_key}::${uri}`);
                                      setTimeout(() => setCopiedRedirectFor(null), 2000);
                                    });
                                  }}
                                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                                  title="Copy redirect URI"
                                >
                                  {copiedRedirectFor === `${platform.platform_key}::${uri}` ? (
                                    <>
                                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3.5 w-3.5" />
                                      Copy
                                    </>
                                  )}
                                </button>
                              </div>
                            ))}
                            {!process.env.NEXT_PUBLIC_APP_URL && (
                              <p className="text-xs text-amber-600 mt-1">
                                Set <code className="font-mono bg-amber-50 px-1 rounded">NEXT_PUBLIC_APP_URL</code> in `.env` to show the exact production URL here.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Client ID *</label>
                      <input
                        type="text"
                        value={oauthForm[platform.platform_key]?.client_id || ''}
                        onChange={(event) =>
                          setOauthForm((prev) => ({
                            ...prev,
                            [platform.platform_key]: { ...prev[platform.platform_key], client_id: event.target.value },
                          }))
                        }
                        placeholder={platform.configured ? 'Enter to replace...' : 'Paste client ID...'}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
                      <div className="relative">
                        <input
                          type={showSecretFor === platform.platform_key ? 'text' : 'password'}
                          value={oauthForm[platform.platform_key]?.client_secret || ''}
                          onChange={(event) =>
                            setOauthForm((prev) => ({
                              ...prev,
                              [platform.platform_key]: { ...prev[platform.platform_key], client_secret: event.target.value },
                            }))
                          }
                          placeholder="Paste client secret..."
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecretFor((prev) => (prev === platform.platform_key ? null : platform.platform_key))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          title={showSecretFor === platform.platform_key ? 'Hide' : 'Show'}
                        >
                          {showSecretFor === platform.platform_key ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`enabled-${platform.platform_key}`}
                      checked={oauthForm[platform.platform_key]?.enabled ?? false}
                      onChange={(event) =>
                        setOauthForm((prev) => ({
                          ...prev,
                          [platform.platform_key]: { ...prev[platform.platform_key], enabled: event.target.checked },
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    <label htmlFor={`enabled-${platform.platform_key}`} className="text-xs text-gray-700">
                      Enable this platform (company admins can connect accounts)
                    </label>
                  </div>

                  {oauthSaveMsg?.platform === platform.platform_key && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${oauthSaveMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {oauthSaveMsg.text}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => saveOauthConfig(platform.platform_key)}
                      disabled={savingOauth === platform.platform_key}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {savingOauth === platform.platform_key ? 'Saving...' : 'Save Credentials'}
                    </button>
                  </div>

                  <div className="text-xs text-gray-400 border-t border-gray-200 pt-2">
                    Credentials are encrypted before storage. Only a short client ID preview is shown after saving.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
