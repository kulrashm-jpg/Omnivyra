import React, { useEffect, useMemo, useState } from 'react';
import { OAUTH_PLATFORMS } from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { parseJsonResponse } from '@/lib/utils/safeFetchJson';
import { classifyAuthFailure, describeAuthFailure, isRecoverableAuthFailure, type AuthFailure } from '@/lib/security/superAdminAuthFailure';
import { runStepUpFlowIfNeeded, describeStepUpOutcome } from '@/lib/security/superAdminStepUp';
import { AlertCircle, BarChart3, Check, CheckCircle, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Globe, RefreshCw, Save, XCircle } from 'lucide-react';

import { type OAuthFormState, type AnalyticsProviderFormState, type AnalyticsProviderConfigSummary, type PlatformCheckResult, type IntegrationHealthSummary, type BadgeTone, CALLBACK_PLATFORMS, CONNECTOR_PLATFORMS, PLATFORM_ICONS, createDefaultOauthForm, getPublicAppBaseUrl, getPublishingCallbackUri, getPlatformStatus } from './SocialPlatformsSectionModel';

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
  // Hydration gates — credential metadata (`client_id_preview`,
  // `has_client_secret`, `configured` badge, "Credentials saved" pill) renders
  // ONLY after a successful authorized fetch returns. Until then, the UI shows
  // a loading skeleton. This prevents previously-fetched values from a prior
  // mount or any other React state from being visible at first paint, and
  // gates all credential-adjacent display behind the same backend-authorization
  // boundary that the fetch itself goes through (capability check + step-up
  // when required). Reset to false on any auth failure so denied/lost-session
  // states cannot keep showing data.
  const [socialPlatformsLoaded, setSocialPlatformsLoaded] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [oauthForm, setOauthForm] = useState<OAuthFormState>(createDefaultOauthForm);
  const [savingOauth, setSavingOauth] = useState<string | null>(null);
  const [oauthSaveMsg, setOauthSaveMsg] = useState<{ platform: string; type: 'success' | 'error'; text: string } | null>(null);
  const [showSecretFor, setShowSecretFor] = useState<string | null>(null);
  const [copiedRedirectFor, setCopiedRedirectFor] = useState<string | null>(null);
  const [checkingPlatform, setCheckingPlatform] = useState<string | null>(null);
  const [platformCheckResults, setPlatformCheckResults] = useState<Record<string, PlatformCheckResult>>({});
  const [analyticsProvider, setAnalyticsProvider] = useState<AnalyticsProviderConfigSummary | null>(null);
  const [analyticsProviderLoaded, setAnalyticsProviderLoaded] = useState(false);
  const [analyticsProviderForm, setAnalyticsProviderForm] = useState<AnalyticsProviderFormState>({
    oauth_client_id: '',
    oauth_client_secret: '',
    enabled: false,
    redirect_uri: '',
    gsc_redirect_uri: '',
  });
  const [analyticsProviderExpanded, setAnalyticsProviderExpanded] = useState(false);
  const [analyticsProviderSaving, setAnalyticsProviderSaving] = useState(false);
  const [analyticsProviderMessage, setAnalyticsProviderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAnalyticsSecret, setShowAnalyticsSecret] = useState(false);

  // Phase E — canonical autonomous-lifecycle health summary.
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealthSummary | null>(null);
  const [integrationHealthLoading, setIntegrationHealthLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIntegrationHealthLoading(true);
      try {
        const res = await fetchWithAuth('/api/super-admin/integration-health');
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        setIntegrationHealth(data as IntegrationHealthSummary);
      } finally {
        if (!cancelled) setIntegrationHealthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Reset all credential-adjacent state to the unauthenticated baseline.
   * Called when an auth failure (recoverable or session-lost) is observed
   * so any previously-fetched preview, "configured" status, or in-flight
   * form values are cleared from React state.
   *
   * Does NOT clear the savings/error message banner so the operator still
   * sees what just failed.
   */
  const clearCredentialState = () => {
    setSocialPlatforms(OAUTH_PLATFORMS);
    setSocialPlatformsLoaded(false);
    setAnalyticsProvider(null);
    setAnalyticsProviderLoaded(false);
    setAnalyticsProviderExpanded(false);
    setOauthForm(createDefaultOauthForm());
    setAnalyticsProviderForm({
      oauth_client_id: '',
      oauth_client_secret: '',
      enabled: false,
      redirect_uri: '',
      gsc_redirect_uri: '',
    });
    setExpandedPlatform(null);
    setShowSecretFor(null);
    setShowAnalyticsSecret(false);
    setPlatformCheckResults({});
  };
  // Phase 1 — Frontend Auth Failure Differentiation. Holds the LAST
  // recoverable auth failure observed by any fetch on this section so the
  // user sees a banner (not a forced logout) when capability/step-up is
  // missing. Cleared on success.
  const [authFailure, setAuthFailure] = useState<AuthFailure | null>(null);

  // Centralized handler: classifies the response and decides whether to
  // redirect (only on NOT_AUTHENTICATED) or surface a banner. Returns
  // true when caller should treat the response as a hard auth failure
  // and stop processing (the page state remains intact regardless).
  const handleAuthFailure = async (res: Response): Promise<boolean> => {
    const failure = await classifyAuthFailure(res);
    if (failure.kind === 'ok') {
      setAuthFailure(null);
      return false;
    }
    if (failure.kind === 'not_authenticated') {
      // True session loss — clear ALL credential state from React memory
      // BEFORE redirecting so any in-flight render between now and the
      // redirect cannot expose preview values or in-progress form input.
      clearCredentialState();
      console.warn('[super-admin] auth failure → redirect to login', {
        kind: failure.kind,
        status: failure.status,
        correlationId: failure.correlationId,
      });
      window.location.href = '/super-admin/login';
      return true;
    }
    if (isRecoverableAuthFailure(failure)) {
      // Recoverable failure (capability denied / step-up required / bridge-
      // factor insufficient): the operator stays on the page, but any
      // previously-fetched credential metadata MUST disappear because the
      // current authorization no longer permits viewing it. The skeleton
      // returns until a follow-up authorized fetch succeeds.
      clearCredentialState();
      setAuthFailure(failure);
      console.warn('[super-admin] recoverable auth failure', {
        kind: failure.kind,
        status: failure.status,
        capability: 'capability' in failure ? failure.capability : null,
        correlationId: failure.correlationId,
      });
      return true;
    }
    clearCredentialState();
    setAuthFailure(failure);
    return true;
  };

  const appBaseUrl = useMemo(() => getPublicAppBaseUrl(), []);

  const checkPlatformConfig = async (platformKey: string) => {
    setCheckingPlatform(platformKey);
    try {
      const response = await fetchWithAuth(`/api/social-accounts/verify-config?platform=${platformKey}`);
      const parsed = await parseJsonResponse(response, '/api/social-accounts/verify-config');
      if (parsed.ok === true) {
        setPlatformCheckResults((prev) => ({ ...prev, [platformKey]: parsed.data as any }));
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
          const parsed = await parseJsonResponse(response, '/api/social-accounts/verify-config');
          if (parsed.ok !== true) return [platform.platform_key, null] as const;
          return [platform.platform_key, parsed.data] as const;
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
      // Auth-failure check FIRST — clears credential state and (per
      // handleAuthFailure) drops the load-gate to false, returning the UI
      // to the skeleton. Only NOT_AUTHENTICATED bounces to login.
      if (!response.ok) {
        await handleAuthFailure(response);
        return;
      }
      setAuthFailure(null);
      const parsed = await parseJsonResponse<{ platforms?: any[] }>(response, '/api/super-admin/platform-oauth-configs');
      if (parsed.ok === true) {
        const apiPlatforms: any[] = parsed.data.platforms || [];
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
        // Flip the load-gate ONLY after a successful authorized fetch.
        // From this point onward, credential metadata (preview, "configured"
        // pill, "Credentials saved" badge) is permitted to render.
        setSocialPlatformsLoaded(true);
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

      // Phase 2 — Step-Up UX: capture the request shape so the step-up
      // helper can re-fire it after a successful WebAuthn challenge
      // without losing the form the operator was filling in.
      const fire = () => fetchWithAuth('/api/super-admin/platform-oauth-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const initial = await fire();
      const outcome = await runStepUpFlowIfNeeded(initial, fire, {
        onChallengeStart: () => setOauthSaveMsg({ platform: platformKey, type: 'success', text: 'Confirm with your passkey to save…' }),
      });

      if (outcome.kind === 'success') {
        setAuthFailure(null);
        setOauthSaveMsg({ platform: platformKey, type: 'success', text: 'Saved successfully' });
        setExpandedPlatform(null);
        await loadSocialPlatforms();
      } else if (outcome.kind === 'session_lost') {
        await handleAuthFailure(outcome.response);
      } else if (outcome.kind === 'step_up_user_cancelled' || outcome.kind === 'step_up_unavailable') {
        setOauthSaveMsg({ platform: platformKey, type: 'error', text: describeStepUpOutcome(outcome) });
      } else {
        // auth_banner: capability not held / bridge / unknown.
        setAuthFailure(outcome.failure);
        const errorBody = await outcome.response.json().catch(() => ({}));
        setOauthSaveMsg({ platform: platformKey, type: 'error', text: errorBody.error || describeStepUpOutcome(outcome) });
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
        await handleAuthFailure(response);
        return;
      }
      const parsed = await parseJsonResponse<{ config?: AnalyticsProviderConfigSummary }>(response, '/api/super-admin/analytics-provider-config');
      if (parsed.ok !== true) return;
      const config = parsed.data?.config;
      if (!config) return;
      setAnalyticsProvider(config);
      setAnalyticsProviderForm({
        oauth_client_id: '',
        oauth_client_secret: '',
        enabled: config.enabled,
        redirect_uri: config.redirect_uri || '',
        gsc_redirect_uri: config.capability_redirect_uris?.google_search_console || config.redirect_uri || '',
      });
      // Flip the analytics-provider load-gate ONLY after a successful
      // authorized fetch — same boundary as the platform OAuth section.
      setAnalyticsProviderLoaded(true);
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
          capability_redirect_uris: {
            google_analytics: analyticsProviderForm.redirect_uri,
            google_search_console: analyticsProviderForm.gsc_redirect_uri,
          },
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
      {authFailure && authFailure.kind !== 'ok' && authFailure.kind !== 'not_authenticated' && (
        <div className="px-6 pt-4">
          <div
            role="alert"
            className={`rounded-lg border px-4 py-3 text-sm ${
              authFailure.kind === 'capability_not_held' || authFailure.kind === 'bridge_factor_insufficient'
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-blue-300 bg-blue-50 text-blue-900'
            }`}
          >
            <div className="font-medium">{describeAuthFailure(authFailure)}</div>
            {authFailure.correlationId && (
              <div className="mt-1 text-xs text-gray-600">
                Correlation id: <span className="font-mono">{authFailure.correlationId}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Phase E — autonomous lifecycle health summary. Read-only,
          no tokens or secrets. Driven by the integration-health endpoint
          which is the canonical operational surface for SUPER_ADMIN. */}
      <div className="px-6 pt-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Autonomous lifecycle health</h3>
              <p className="text-xs text-slate-600">
                Per-provider connection-state rollup across all tenants. Refreshed by the
                {' '}<span className="font-mono">oauth-refresh</span> sweep on the analytics-ingestion cron tick.
              </p>
            </div>
            {integrationHealthLoading && (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>
          {integrationHealth && integrationHealth.platforms.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {integrationHealth.platforms.map((p) => {
                const hasIssue = p.reauth_required_count > 0
                              || p.expired_count > 0
                              || p.degraded_count > 0
                              || p.rate_limited_count > 0;
                return (
                  <div
                    key={p.platform_key}
                    className={`rounded-lg border p-3 text-xs ${hasIssue
                      ? 'border-amber-300 bg-amber-50'
                      : p.connected_count > 0
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-900 capitalize">{p.platform_key}</div>
                      <div className="flex items-center gap-1">
                        {p.configured && <span className="text-[10px] uppercase tracking-wide text-slate-500">configured</span>}
                        {p.enabled    && <span className="text-[10px] uppercase tracking-wide text-emerald-700">enabled</span>}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                      <div><span className="font-semibold text-emerald-700">{p.connected_count}</span> connected</div>
                      <div><span className="font-semibold text-amber-700">{p.refresh_required_count}</span> refreshing</div>
                      <div><span className="font-semibold text-amber-700">{p.expired_count}</span> expired</div>
                      <div><span className="font-semibold text-red-700">{p.reauth_required_count}</span> reauth</div>
                      <div><span className="font-semibold text-amber-700">{p.degraded_count}</span> degraded</div>
                      <div><span className="font-semibold text-amber-700">{p.rate_limited_count}</span> 429</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            !integrationHealthLoading && (
              <div className="text-xs text-slate-500">No integrations recorded yet.</div>
            )
          )}
          {integrationHealth && (
            <div className="mt-3 text-[11px] text-slate-500">
              Generated at <span className="font-mono">{new Date(integrationHealth.generated_at).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-5 border-b border-gray-200 bg-white">
        <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Google Analytics + Search Console Provider</h3>
                  <p className="text-sm text-slate-600">
                    One global config powers the Company Admin click → connect → select → done flow.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {analyticsProviderLoaded ? (
                  <>
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
                  </>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2.5 py-1 font-medium text-slate-400">
                    <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-slate-300" />
                    Loading provider configuration…
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAnalyticsProviderExpanded((current) => !current)}
              disabled={!analyticsProviderLoaded}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyticsProviderExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {analyticsProviderLoaded
                ? (analyticsProvider?.configured ? 'Update Google Data Provider' : 'Configure Google Data Provider')
                : 'Loading…'}
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
                    // Defenses against browser autofill / password-manager hydration:
                    // an empty `name` removes the correlation key the browser uses to
                    // match saved credentials; `autoComplete="off"` is the spec hint;
                    // `data-lpignore` and `data-1p-ignore` cover LastPass / 1Password.
                    name=""
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">OAuth Client Secret</label>
                  <div className="relative">
                    <input
                      type={showAnalyticsSecret ? 'text' : 'password'}
                      value={analyticsProviderForm.oauth_client_secret}
                      onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, oauth_client_secret: event.target.value }))}
                      // For password-type inputs, modern Chrome ignores autoComplete="off"
                      // unless the value is `new-password`. Combined with empty `name`
                      // this prevents both autofill AND save-prompt offers.
                      name=""
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-1p-ignore="true"
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
                <label className="mb-1 block text-xs font-medium text-slate-700">Google Analytics Redirect URI</label>
                <input
                  type="text"
                  value={analyticsProviderForm.redirect_uri}
                  onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, redirect_uri: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Search Console Redirect URI</label>
                <input
                  type="text"
                  value={analyticsProviderForm.gsc_redirect_uri}
                  onChange={(event) => setAnalyticsProviderForm((current) => ({ ...current, gsc_redirect_uri: event.target.value }))}
                  placeholder={analyticsProviderForm.redirect_uri || 'https://www.omnivyra.com/api/analytics/connect/google/callback'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <p className="mt-1 text-xs text-slate-500">
                  This can match the Analytics redirect URI, but it is stored separately so GSC setup stays explicit.
                </p>
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
                Enable Google Analytics and Search Console for Company Admin self-serve connect
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

      {!socialPlatformsLoaded ? (
        // Skeleton — shown until the FIRST authorized fetch successfully
        // returns. Prevents the OAUTH_PLATFORMS defaults (or any prior-mount
        // state) from being rendered as if they were authoritative.
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 rounded bg-slate-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
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
                          // One Meta app covers Facebook, Instagram, and WhatsApp; register every callback URL.
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
                        // Prevent browser password manager + LastPass / 1Password
                        // from autofilling this field. Empty `name` removes the
                        // correlation key; `autoComplete="off"` is the spec hint.
                        name=""
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
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
                          // Chrome ignores autoComplete="off" on password inputs;
                          // `new-password` is the canonical hint to block both
                          // autofill AND save-password prompts.
                          name=""
                          autoComplete="new-password"
                          data-lpignore="true"
                          data-1p-ignore="true"
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
      )}
    </div>
  );
}

