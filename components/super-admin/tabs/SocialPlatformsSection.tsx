import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { config } from '@/config';
import { OAUTH_PLATFORMS } from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Save,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Copy,
  Check,
  Globe,
} from 'lucide-react';

export default function SocialPlatformsSection() {

  // Social platform OAuth config state
  // Social platform OAuth config state — OAUTH_PLATFORMS imported from super-admin.types
  const [socialPlatforms, setSocialPlatforms] = useState<any[]>(OAUTH_PLATFORMS);
  const [loadingSocialPlatforms, setLoadingSocialPlatforms] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [oauthForm, setOauthForm] = useState<Record<string, { client_id: string; client_secret: string; enabled: boolean }>>(
    Object.fromEntries(OAUTH_PLATFORMS.map((p) => [p.platform_key, { client_id: '', client_secret: '', enabled: false }]))
  );
  const [savingOauth, setSavingOauth] = useState<string | null>(null);
  const [oauthSaveMsg, setOauthSaveMsg] = useState<{ platform: string; type: 'success' | 'error'; text: string } | null>(null);
  const [showSecretFor, setShowSecretFor] = useState<string | null>(null);
  const [copiedRedirectFor, setCopiedRedirectFor] = useState<string | null>(null);
  const [checkingPlatform, setCheckingPlatform] = useState<string | null>(null);
  const [platformCheckResults, setPlatformCheckResults] = useState<Record<string, { credentials_ok: boolean; token_ok: boolean | null; token_detail: string | null; checked_at: string } | null>>({});

  const loadSocialPlatforms = async () => {
    setLoadingSocialPlatforms(true);
    try {
      const r = await fetchWithAuth('/api/super-admin/platform-oauth-configs');
      if (r.ok) {
        const data = await r.json();
        const apiPlatforms: any[] = data.platforms || [];
        if (apiPlatforms.length > 0) {
          // Merge API-enriched status into our always-visible list
          setSocialPlatforms((prev) =>
            prev.map((p) => {
              const fromApi = apiPlatforms.find((a: any) => a.platform_key === p.platform_key);
              return fromApi ? { ...p, ...fromApi } : p;
            })
          );
          setOauthForm((prev) => {
            const next = { ...prev };
            for (const p of apiPlatforms) {
              // Default to enabled=true for platforms that already have credentials saved
              // Never pre-fill credentials from API — secrets must not be sent to browser
              next[p.platform_key] = { client_id: '', client_secret: '', enabled: p.configured ? (p.enabled ?? true) : true };
            }
            return next;
          });
        }
      } else if (r.status === 403) {
        window.location.href = '/super-admin/login';
        return;
      }
    } catch (e) { console.error('Failed to load platform OAuth configs', e); }
    finally { setLoadingSocialPlatforms(false); }
  };

  const checkPlatformConfig = async (platformKey: string) => {
    setCheckingPlatform(platformKey);
    try {
      const r = await fetchWithAuth(`/api/social-accounts/verify-config?platform=${platformKey}`);
      if (r.ok) {
        const data = await r.json();
        setPlatformCheckResults((prev) => ({ ...prev, [platformKey]: data }));
      }
    } catch (e) {
      console.error('Check failed', e);
    } finally {
      setCheckingPlatform(null);
    }
  };

  const saveOauthConfig = async (platformKey: string) => {
    const form = oauthForm[platformKey];
    const alreadyConfigured = socialPlatforms.find((p) => p.platform_key === platformKey)?.configured ?? false;

    // If no client_id entered but credentials already exist, allow enabled-only toggle
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
      const r = await fetchWithAuth('/api/super-admin/platform-oauth-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setOauthSaveMsg({ platform: platformKey, type: 'success', text: 'Saved successfully' });
        loadSocialPlatforms();
        setExpandedPlatform(null);
      } else if (r.status === 403) {
        window.location.href = '/super-admin/login';
      } else {
        const err = await r.json().catch(() => ({}));
        setOauthSaveMsg({ platform: platformKey, type: 'error', text: err.error || 'Failed to save' });
      }
    } catch (e: any) {
      setOauthSaveMsg({ platform: platformKey, type: 'error', text: e.message });
    } finally {
      setSavingOauth(null);
    }
  };

  useEffect(() => {
    loadSocialPlatforms();
  }, []);

  return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Social Platform OAuth Credentials</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Configure Client ID &amp; Secret for each platform. Company admins use these to connect their accounts.</p>
                </div>
                <button onClick={loadSocialPlatforms} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Refresh">
                  <RefreshCw className={`h-4 w-4 ${loadingSocialPlatforms ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {socialPlatforms.map((p) => (
                  <div key={p.platform_key} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">{p.platform_label}</span>
                            {p.configured ? (
                              p.enabled ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200" title="Credentials saved and platform is enabled — users can connect their accounts">
                                  <CheckCircle className="h-3 w-3" /> Ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Credentials are saved but the platform is not enabled. Tick 'Enable this platform' and save.">
                                  <AlertCircle className="h-3 w-3" /> Saved · Not enabled
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200" title="No credentials entered yet">
                                <XCircle className="h-3 w-3" /> Not set up
                              </span>
                            )}
                          </div>
                          {p.configured && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              Client ID: {p.client_id_preview} · Secret: {p.has_client_secret ? '••••••' : 'not set'}
                              {p.updated_at && ` · Updated ${new Date(p.updated_at).toLocaleDateString()}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(() => {
                          const cr = platformCheckResults[p.platform_key];
                          if (!cr) return null;
                          if (!cr.credentials_ok) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title="Client ID / Secret not found — enter credentials and save">
                              <XCircle className="h-3 w-3" /> Credentials missing
                            </span>
                          );
                          if (cr.token_ok === false) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title={cr.token_detail ?? 'Token invalid or expired — reconnect the account'}>
                              <XCircle className="h-3 w-3" /> Token invalid — {cr.token_detail ?? 'reconnect account'}
                            </span>
                          );
                          if (cr.token_ok === true) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700" title={cr.token_detail ?? ''}>
                              <CheckCircle className="h-3 w-3" /> {cr.token_detail ?? 'Live · OK'}
                            </span>
                          );
                          // credentials_ok=true, token_ok=null — app credentials are valid, no connected account to live-test
                          const fromEnv = (cr as any).credentials_source === 'env';
                          return fromEnv ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-50 border border-amber-200 text-amber-700" title="Credentials found in .env file only — not saved via Super Admin. Add them here to manage centrally.">
                              <AlertCircle className="h-3 w-3" /> Creds from .env only · Add to DB
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700" title="OAuth app credentials verified in DB. No user account connected yet — go to Social Platforms to connect one.">
                            </span>
                          );
                        })()}
                        <button
                          onClick={() => checkPlatformConfig(p.platform_key)}
                          disabled={checkingPlatform === p.platform_key}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                          title="Verify credentials and token"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${checkingPlatform === p.platform_key ? 'animate-spin' : ''}`} />
                          {checkingPlatform === p.platform_key ? 'Checking…' : 'Check'}
                        </button>
                        <button
                          onClick={() => setExpandedPlatform(expandedPlatform === p.platform_key ? null : p.platform_key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors shrink-0"
                        >
                          {expandedPlatform === p.platform_key ? <><ChevronUp className="h-3.5 w-3.5" /> Close</> : <><ChevronDown className="h-3.5 w-3.5" /> {p.configured ? 'Update' : 'Configure'}</>}
                        </button>
                      </div>
                    </div>

                    {expandedPlatform === p.platform_key && (
                      <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
                        {/* Credentials-already-saved notice */}
                        {p.configured && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                            <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
                            <span>
                              <strong>Credentials are saved</strong> — Client ID: <span className="font-mono">{p.client_id_preview}</span> · Secret: ••••••
                              {p.updated_at && ` · Last updated ${new Date(p.updated_at).toLocaleDateString()}`}.
                              {' '}The fields below are blank for security. Enter new values only if you want to replace the saved credentials.
                            </span>
                          </div>
                        )}
                        {/* Redirect URI — only shown for platforms with an actual callback route */}
                        {(['linkedin','twitter','youtube','instagram','tiktok','pinterest','facebook','meta'] as string[]).includes(p.platform_key) && (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Redirect URIs <span className="text-gray-400 font-normal">(register <strong>all</strong> URLs below in the platform developer console)</span>
                          </label>
                          {(() => {
                            const prodBase = (config.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
                            const currentBase = (typeof window !== 'undefined' ? window.location.origin : prodBase).replace(/\/$/, '');
                            // Connector platforms: linkedin, twitter, facebook/meta/instagram use meta connector
                            const connectorKey = ['facebook','meta','instagram','whatsapp'].includes(p.platform_key) ? 'meta' : p.platform_key;
                            const hasConnector = ['linkedin','twitter','meta','facebook','instagram'].includes(p.platform_key);
                            // Build full list: auth callback + connector callback (local + prod)
                            const uriGroups: { label: string; uri: string }[] = [];
                            // Publishing (auth) callbacks
                            if (['linkedin','twitter','youtube','instagram','tiktok','pinterest','facebook'].includes(p.platform_key)) {
                              uriGroups.push({ label: 'Publishing (local)', uri: `http://localhost:3000/api/auth/${p.platform_key}/callback` });
                              if (prodBase) uriGroups.push({ label: 'Publishing (prod)', uri: `${prodBase}/api/auth/${p.platform_key}/callback` });
                              else uriGroups.push({ label: 'Publishing (current)', uri: `${currentBase}/api/auth/${p.platform_key}/callback` });
                            }
                            // Connector (community-ai) callbacks
                            if (hasConnector) {
                              uriGroups.push({ label: 'Connector (local)', uri: `http://localhost:3000/api/community-ai/connectors/${connectorKey}/callback` });
                              if (prodBase) uriGroups.push({ label: 'Connector (prod)', uri: `${prodBase}/api/community-ai/connectors/${connectorKey}/callback` });
                              else uriGroups.push({ label: 'Connector (current)', uri: `${currentBase}/api/community-ai/connectors/${connectorKey}/callback` });
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
                                      onFocus={(e) => e.target.select()}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(uri).then(() => {
                                          setCopiedRedirectFor(`${p.platform_key}::${uri}`);
                                          setTimeout(() => setCopiedRedirectFor(null), 2000);
                                        });
                                      }}
                                      className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                                      title="Copy redirect URI"
                                    >
                                      {copiedRedirectFor === `${p.platform_key}::${uri}` ? (
                                        <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
                                      ) : (
                                        <><Copy className="h-3.5 w-3.5" /> Copy</>
                                      )}
                                    </button>
                                  </div>
                                ))}
                                <p className="text-xs text-amber-600 mt-1">
                                  All URLs above must be registered as authorized redirect URIs in the platform&apos;s developer console.
                                  {!config.NEXT_PUBLIC_APP_URL && <> Set <code className="font-mono bg-amber-50 px-1 rounded">NEXT_PUBLIC_APP_URL</code> in your .env to show the exact production URL here.</>}
                                </p>
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
                              value={oauthForm[p.platform_key]?.client_id || ''}
                              onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], client_id: e.target.value } }))}
                              placeholder={p.configured ? 'Enter to replace…' : 'Paste Client ID…'}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
                            <div className="relative">
                              <input
                                type={showSecretFor === p.platform_key ? 'text' : 'password'}
                                value={oauthForm[p.platform_key]?.client_secret || ''}
                                onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], client_secret: e.target.value } }))}
                                placeholder="Paste Client Secret…"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSecretFor((prev) => prev === p.platform_key ? null : p.platform_key)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                title={showSecretFor === p.platform_key ? 'Hide' : 'Show'}
                              >
                                {showSecretFor === p.platform_key ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`enabled-${p.platform_key}`}
                            checked={oauthForm[p.platform_key]?.enabled ?? false}
                            onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], enabled: e.target.checked } }))}
                            className="rounded border-gray-300"
                          />
                          <label htmlFor={`enabled-${p.platform_key}`} className="text-xs text-gray-700">Enable this platform (company admins can connect accounts)</label>
                        </div>
                        {oauthSaveMsg?.platform === p.platform_key && (
                          <div className={`text-xs px-3 py-2 rounded-lg ${oauthSaveMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {oauthSaveMsg.text}
                          </div>
                        )}
                        <div className="flex justify-end">
                          <button
                            onClick={() => saveOauthConfig(p.platform_key)}
                            disabled={savingOauth === p.platform_key}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingOauth === p.platform_key ? 'Saving…' : 'Save Credentials'}
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 border-t border-gray-200 pt-2">
                          Credentials are encrypted with AES-256-GCM before storage. Only the first 6 characters of the Client ID are shown after saving.
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

  );
}
